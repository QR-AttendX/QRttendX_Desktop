// Attendance store module - owns fetching via window.attendyAPI, caching, and computations
// No DOM access here. Exports a default object with methods described in the spec.

function _parseDateFlexible(str) {
  if (!str) return null;
  // native parser first
  const d1 = new Date(str);
  if (!Number.isNaN(d1.getTime())) return d1;

  // dd/mm/yyyy or dd-mm-yyyy with optional time (e.g. 13/01/2026, 07:55:55)
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    const hh = Number(m[4] || 0);
    const mm = Number(m[5] || 0);
    const ss = Number(m[6] || 0);
    const d = new Date(year, month - 1, day, hh, mm, ss);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // try replacing space with T for ISO-like strings
  const iso = str.replace(/\s+/g, 'T');
  const d2 = new Date(iso);
  if (!Number.isNaN(d2.getTime())) return d2;

  return null;
}

function _isSameLocalDay(isoStr) {
  const d = _parseDateFlexible(isoStr);
  if (!d) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

const store = (function () {
  let _cache = []; // newest-first
  let _indexById = new Map();
  let _todayLatestByKey = new Map(); // key -> latest row for today
  let _presentDaysByKey = new Map(); // key -> Set of YYYY-MM-DD within current month
  let _displayNameByKey = new Map();

  let _refreshInProgress = false;
  let _lastFingerprint = '';
  let _cachedMostPresent = [];
  let _cachedTodayRows = [];
  let _cachedTodayCounts = { total: 0, present: 0, absent: 0, late: 0 };
  const _subscribers = new Set();

  function subscribe(cb) {
    if (typeof cb !== 'function') return () => { };
    _subscribers.add(cb);
    return () => _subscribers.delete(cb);
  }

  function _emitChange() {
    try { console.log('attendanceStore: _emitChange - subscribers:', _subscribers.size); } catch (e) { }
    for (const cb of Array.from(_subscribers)) {
      try { cb(); } catch (e) { console.warn('subscriber error', e); }
    }
  }

  function _studentKey(r) {
    let key = (r.student_username || r.student_fullname || '').toString().trim().toLowerCase();
    if (!key) return '';
    if (key.startsWith('@')) key = key.replace(/^@+/, '');
    return key;
  }

  function _buildIndexes(rows) {
    _cache = rows.slice();
    _indexById.clear();
    _todayLatestByKey.clear();
    _presentDaysByKey.clear();
    _displayNameByKey.clear();

    // assume _cache already newest-first
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    for (const r of _cache) {
      const id = Number(r.id);
      _indexById.set(id, r);

      const key = _studentKey(r);
      if (key && !_displayNameByKey.has(key)) {
        _displayNameByKey.set(key, r.student_fullname || r.student_username || key);
      }

      const ts = r.timestamp || r.time_in;
      if (key && ts && _isSameLocalDay(ts) && !_todayLatestByKey.has(key)) {
        _todayLatestByKey.set(key, r);
      }

      const status = (r.status || '').toString().toLowerCase();
      if (status === 'present') {
        const t = r.timestamp || r.time_in;
        if (!t) continue;
        const d = _parseDateFlexible(t);
        if (!d) continue;
        if (d.getFullYear() !== currentYear || d.getMonth() !== currentMonth) continue;
        const dayKey = d.toISOString().slice(0, 10);
        if (!key) continue;
        if (!_presentDaysByKey.has(key)) _presentDaysByKey.set(key, new Set());
        _presentDaysByKey.get(key).add(dayKey);
      }
    }
    // build cached today rows (all rows whose timestamp is today)
    _cachedTodayRows = _cache.filter(r => _isSameLocalDay(r.timestamp || r.time_in));

    // build cached today counts from _todayLatestByKey
    const counts = { total: 0, present: 0, absent: 0, late: 0 };
    counts.total = _todayLatestByKey.size;
    for (const r of _todayLatestByKey.values()) {
      const s = (r.status || '').toString().toLowerCase();
      if (s === 'present') counts.present += 1;
      else if (s === 'late') counts.late += 1;
      else if (s === 'absent') counts.absent += 1;
    }
    _cachedTodayCounts = counts;

    // build cached most-present list
    _cachedMostPresent = Array.from(_presentDaysByKey.entries()).map(([key, set]) => ({ key, days: set.size }));
    _cachedMostPresent.sort((a, b) => b.days - a.days);
  }

  async function refreshAttendance() {
    if (_refreshInProgress) return { changed: false, rows: _cache };
    if (typeof document !== 'undefined' && document.hidden) return { changed: false, rows: _cache };
    if (!window.attendyAPI || typeof window.attendyAPI.getAttendance !== 'function') {
      console.warn('attendyAPI.getAttendance() is not available in preload. Cannot refresh attendance from renderer.');
      return { changed: false, rows: _cache };
    }
    _refreshInProgress = true;
    try {
      const rows = await window.attendyAPI.getAttendance();
      if (!Array.isArray(rows)) return { changed: false, rows: _cache };
      // sort newest-first using flexible parser
      rows.sort((a, b) => {
        const da = _parseDateFlexible(a.timestamp || a.time_in);
        const db = _parseDateFlexible(b.timestamp || b.time_in);
        const ta = da ? da.getTime() : 0;
        const tb = db ? db.getTime() : 0;
        return tb - ta;
      });

      // cheap fingerprint: join id|status|timestamp for each row
      const parts = [];
      for (const r of rows) {
        const id = r.id || '';
        const status = (r.status || '').toString();
        const ts = r.timestamp || r.time_in || '';
        parts.push(`${id}|${status}|${ts}`);
      }
      const fpString = parts.join('\n');
      const fp = _simpleHash(fpString);

      if (fp === _lastFingerprint) {
        return { changed: false, rows: _cache };
      }

      _lastFingerprint = fp;
      _buildIndexes(rows);
      return { changed: true, rows: _cache };
    } catch (e) {
      console.warn('refreshAttendance failed', e);
      return { changed: false, rows: _cache };
    } finally {
      _refreshInProgress = false;
    }
  }

  function _simpleHash(s) {
    // djb2
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h) + s.charCodeAt(i);
      h = h & 0xffffffff;
    }
    return h.toString(16);
  }

  function getTodayRows() {
    return _cachedTodayRows.slice();
  }

  function getTodayCounts() {
    return Object.assign({}, _cachedTodayCounts);
  }

  function getRecent(limit = 8) {
    const seen = new Set();
    const out = [];
    for (const r of _cache) {
      if (out.length >= limit) break;
      let key = _studentKey(r);
      if (!key) {
        key = (r.student_fullname || '').toString().trim().toLowerCase();
        if (!key) continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }

  function getMostPresent(limit = 10) {
    const out = [];
    for (let i = 0; i < Math.min(limit, _cachedMostPresent.length); i++) {
      const it = _cachedMostPresent[i];
      out.push({ name: _displayNameByKey.get(it.key) || it.key, days: it.days, key: it.key });
    }
    return out;
  }

  function _removeFromCacheById(id) {
    id = Number(id);
    const row = _indexById.get(id);
    if (!row) return;
    const key = _studentKey(row);
    _cache = _cache.filter(r => Number(r.id) !== id);
    _indexById.delete(id);
    if (key) {
      // recompute today's latest and present days for this key
      // find first matching in cache
      let found = null;
      for (const r of _cache) {
        if (_studentKey(r) !== key) continue;
        const ts = r.timestamp || r.time_in;
        if (ts && _isSameLocalDay(ts)) { found = r; break; }
      }
      if (found) _todayLatestByKey.set(key, found);
      else _todayLatestByKey.delete(key);

      // recompute present days set
      const s = new Set();
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      for (const r of _cache) {
        if (_studentKey(r) !== key) continue;
        const status = (r.status || '').toString().toLowerCase();
        if (status !== 'present') continue;
        const t = r.timestamp || r.time_in;
        if (!t) continue;
        const d = _parseDateFlexible(t);
        if (!d) continue;
        if (d.getFullYear() !== currentYear || d.getMonth() !== currentMonth) continue;
        s.add(d.toISOString().slice(0, 10));
      }
      if (s.size) _presentDaysByKey.set(key, s);
      else _presentDaysByKey.delete(key);
    }
  }

  async function deleteRow(id) {
    if (!window.attendyAPI || typeof window.attendyAPI.deleteAttendanceRow !== 'function') {
      console.warn('attendyAPI.deleteAttendanceRow not available');
      return false;
    }
    try {
      await window.attendyAPI.deleteAttendanceRow(Number(id));
      _removeFromCacheById(id);
      // update cached derived values and fingerprint
      _recomputeCachesAndFingerprint();
      _emitChange();
      return true;
    } catch (e) {
      console.warn('deleteRow failed: ', e);
      return false;
    }
  }

  async function updateStatus(id, status) {
    if (!window.attendyAPI || typeof window.attendyAPI.updateAttendance !== 'function') {
      console.warn('attendyAPI.updateAttendance not available');
      return false;
    }
    try {
      await window.attendyAPI.updateAttendance(Number(id), status);
      // update cache
      id = Number(id);
      const row = _indexById.get(id);
      if (row) {
        row.status = status;
        // recompute for this student
        const key = _studentKey(row);
        if (key) {
          // recompute today's latest and present days
          let found = null;
          for (const r of _cache) {
            if (_studentKey(r) !== key) continue;
            const ts = r.timestamp || r.time_in;
            if (ts && _isSameLocalDay(ts)) { found = r; break; }
          }
          if (found) _todayLatestByKey.set(key, found);
          else _todayLatestByKey.delete(key);

          // recompute present days set
          const s = new Set();
          const now = new Date();
          const currentYear = now.getFullYear();
          const currentMonth = now.getMonth();
          for (const r of _cache) {
            if (_studentKey(r) !== key) continue;
            const st = (r.status || '').toString().toLowerCase();
            if (st !== 'present') continue;
            const t = r.timestamp || r.time_in;
            if (!t) continue;
            const d = _parseDateFlexible(t);
            if (!d) continue;
            if (d.getFullYear() !== currentYear || d.getMonth() !== currentMonth) continue;
            s.add(d.toISOString().slice(0, 10));
          }
          if (s.size) _presentDaysByKey.set(key, s);
          else _presentDaysByKey.delete(key);
        }
      }
      // update derived caches and fingerprint to keep store consistent
      _recomputeCachesAndFingerprint();
      _emitChange();
      return true;
    } catch (e) {
      console.warn('updateStatus failed', e);
      return false;
    }
  }

  async function addRow(rowFromServer) {
    // insert at top and update indexes
    if (!rowFromServer || !rowFromServer.id) return;
    try { console.log('attendanceStore.addRow id=', rowFromServer.id); } catch (e) { }
    // avoid duplicates by id
    const id = Number(rowFromServer.id);
    if (_indexById.has(id)) return;
    _cache.unshift(rowFromServer);
    _indexById.set(id, rowFromServer);
    const key = _studentKey(rowFromServer);
    if (key && !_displayNameByKey.has(key)) _displayNameByKey.set(key, rowFromServer.student_fullname || rowFromServer.student_username || key);
    // recompute today's latest if applicable
    if (key) {
      if (_isSameLocalDay(rowFromServer.timestamp || rowFromServer.time_in)) {
        // since it's newest-first, set as latest
        _todayLatestByKey.set(key, rowFromServer);
      }
      // recompute present days set if status present
      if ((rowFromServer.status || '').toString().toLowerCase() === 'present') {
        const t = rowFromServer.timestamp || rowFromServer.time_in;
        if (t) {
          const d = _parseDateFlexible(t);
          if (d) {
            const dayKey = d.toISOString().slice(0, 10);
            if (!_presentDaysByKey.has(key)) _presentDaysByKey.set(key, new Set());
            _presentDaysByKey.get(key).add(dayKey);
          }
        }
      }
    }
    // reflect change in cached stats and fingerprint
    _recomputeCachesAndFingerprint();
    _emitChange();
  }

  async function setTimeoutForRows(ids, iso) {
    if (!ids) return false;
    if (!Array.isArray(ids)) ids = [ids];
    let changed = false;
    for (const raw of ids) {
      const id = Number(raw);
      if (!Number.isFinite(id)) continue;
      const row = _indexById.get(id);
      if (!row) continue;
      // only update if different
      if (row.time_out !== iso) {
        row.time_out = iso;
        changed = true;
      }
    }
    if (changed) {
      _recomputeCachesAndFingerprint();
      _emitChange();
    }
    return changed;
  }

  async function setTimeInForRow(id, iso) {
    if (!id) return false;
    id = Number(id);
    if (!Number.isFinite(id)) return false;
    const row = _indexById.get(id);
    if (!row) return false;
    if (row.time_in === iso) return false;
    row.time_in = iso;
    // keep caches consistent
    _recomputeCachesAndFingerprint();
    _emitChange();
    return true;
  }

  function _computeFingerprintFromCache() {
    const parts = [];
    for (const r of _cache) {
      const id = r.id || '';
      const status = (r.status || '').toString();
      const ts = r.timestamp || r.time_in || '';
      parts.push(`${id}|${status}|${ts}`);
    }
    return _simpleHash(parts.join('\n'));
  }

  function _recomputeCachesAndFingerprint() {
    // rebuild derived caches without fetching
    _cachedTodayRows = _cache.filter(r => _isSameLocalDay(r.timestamp || r.time_in));
    const counts = { total: 0, present: 0, absent: 0, late: 0 };
    // recompute todayLatestByKey
    _todayLatestByKey.clear();
    for (const r of _cache) {
      const key = _studentKey(r);
      if (key && !_todayLatestByKey.has(key) && _isSameLocalDay(r.timestamp || r.time_in)) {
        _todayLatestByKey.set(key, r);
      }
    }
    counts.total = _todayLatestByKey.size;
    for (const r of _todayLatestByKey.values()) {
      const s = (r.status || '').toString().toLowerCase();
      if (s === 'present') counts.present += 1;
      else if (s === 'late') counts.late += 1;
      else if (s === 'absent') counts.absent += 1;
    }
    _cachedTodayCounts = counts;

    // recompute present days by key
    _presentDaysByKey.clear();
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    for (const r of _cache) {
      const key = _studentKey(r);
      if (!key) continue;
      const st = (r.status || '').toString().toLowerCase();
      if (st !== 'present') continue;
      const t = r.timestamp || r.time_in;
      if (!t) continue;
      const d = _parseDateFlexible(t);
      if (!d) continue;
      if (d.getFullYear() !== currentYear || d.getMonth() !== currentMonth) continue;
      const dayKey = d.toISOString().slice(0, 10);
      if (!_presentDaysByKey.has(key)) _presentDaysByKey.set(key, new Set());
      _presentDaysByKey.get(key).add(dayKey);
    }
    _cachedMostPresent = Array.from(_presentDaysByKey.entries()).map(([key, set]) => ({ key, days: set.size }));
    _cachedMostPresent.sort((a, b) => b.days - a.days);

    _lastFingerprint = _computeFingerprintFromCache();
  }

  return {
    refreshAttendance,
    getTodayRows,
    getTodayCounts,
    getRecent,
    getMostPresent,
    deleteRow,
    updateStatus,
    addRow,
    setTimeoutForRows,
    setTimeInForRow,
    subscribe,
    // expose internal for debugging
    _internals: () => ({ cacheSize: _cache.length })
  };
})();

export default store;

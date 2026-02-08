// Attendance table actions: download, delete, apply timeout, select-all
(function () {
  function getSelectedIds() {
    const checked = Array.from(document.querySelectorAll('#attendance-tbody .row-select:checked'));
    return checked.map(cb => Number(cb.getAttribute('data-id'))).filter(Boolean);
  }

  function collectRowsData(ids) {
    const rows = [];
    const trs = ids && ids.length ? Array.from(document.querySelectorAll('#attendance-tbody tr')).filter(tr => ids.includes(Number(tr.getAttribute('data-id')))) : Array.from(document.querySelectorAll('#attendance-tbody tr'));
    for (const tr of trs) {
      const id = Number(tr.getAttribute('data-id')) || '';

      // Determine fullname cell robustly (different view builders use slightly different td structures)
      let fullname = '';
      try {
        const tds = Array.from(tr.querySelectorAll('td'));
        for (const td of tds) {
          // skip checkbox cell
          if (td.querySelector('.row-select')) continue;
          // skip meta/avatar cell
          if (td.classList && td.classList.contains('meta-cell')) continue;
          // skip times cell (may contain .times-select or label like "IN:" or "OUT:")
          if (td.querySelector('.times-select')) continue;
          const txt = (td.textContent || '').trim();
          if (/\bIN[: ]|OUT[: ]|Time In[: ]|Time Out[: ]/i.test(txt)) continue;
          // skip status select cell
          if (td.querySelector('.status-select')) continue;
          if (txt) { fullname = txt; break; }
        }
        // fallback to known index positions
        if (!fullname) {
          if (tr.children[2] && tr.children[2].textContent) fullname = tr.children[2].textContent.trim();
          else if (tr.children[1] && tr.children[1].textContent) fullname = tr.children[1].textContent.trim();
        }
      } catch (e) { fullname = (tr.children[2] && tr.children[2].textContent || '').trim(); }

      // times: try .times-select first, otherwise parse IN/OUT lines
      let timeIn = '';
      let timeOut = '';
      try {
        const sel = tr.querySelector('.times-select');
        if (sel) {
          const opt0 = sel.options[0] && sel.options[0].textContent || '';
          const opt1 = sel.options[1] && sel.options[1].textContent || '';
          timeIn = opt0.replace(/^\s*Time In:\s*/i, '').trim();
          timeOut = opt1.replace(/^\s*Time Out:\s*/i, '').trim();
        } else {
          // parse text content for lines like "IN: 9:15:51AM" and "OUT: 9:30:00AM"
          const txt = (tr.textContent || '').replace(/\s+/g, ' ');
          const mIn = txt.match(/IN[: ]\s*([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\s*(?:AM|PM)?)/i);
          const mOut = txt.match(/OUT[: ]\s*([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\s*(?:AM|PM)?)/i);
          if (mIn) timeIn = mIn[1].replace(/\s+/g, '');
          if (mOut) timeOut = mOut[1].replace(/\s+/g, '');
        }
      } catch (e) { /* ignore */ }

      const statusEl = tr.querySelector('.status-select');
      const status = statusEl ? statusEl.value : (tr.querySelector('.status-text') && tr.querySelector('.status-text').textContent || (tr.children[tr.children.length - 1] && tr.children[tr.children.length - 1].textContent) || '').trim();

      // username: prefer data-username attribute, then .username-cell text, otherwise blank
      let username = '';
      try {
        if (tr.dataset && tr.dataset.username) username = String(tr.dataset.username).trim();
        else if (tr.querySelector('.username-cell')) username = String(tr.querySelector('.username-cell').textContent || '').trim();
        else username = '';
      } catch (e) { username = ''; }

      // section: prefer data-section attribute, then .section-cell text, otherwise empty
      let section = '';
      try {
        if (tr.dataset && tr.dataset.section) section = String(tr.dataset.section).trim();
        else if (tr.querySelector('.section-cell')) section = String(tr.querySelector('.section-cell').textContent || '').trim();
        else section = '';
      } catch (e) { section = '' }

      rows.push({ id, fullname, username, section, timeIn, timeOut, status });
    }
    return rows;
  }

  async function downloadAsXlsx(data, filename = 'attendance.xlsx') {
    if (typeof XLSX === 'undefined') {
      console.error('XLSX library not found');
      return;
    }
    // remove internal-only fields (like id) before exporting; include username and section
    const exportKeys = ['fullname', 'username', 'section', 'timeIn', 'timeOut', 'status'];
    function _formatHumanTime(raw) {
      if (raw === null || raw === undefined || raw === '') return '';
      try {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) {
          const hh = d.getHours();
          const mm = String(d.getMinutes()).padStart(2, '0');
          const ss = String(d.getSeconds()).padStart(2, '0');
          const am = hh < 12;
          let h12 = hh % 12;
          if (h12 === 0) h12 = 12;
          const hStr = String(h12).padStart(2, '0');
          return `${hStr}:${mm}:${ss}${am ? 'AM' : 'PM'}`;
        }
      } catch (e) { /* fallthrough to regex parse */ }
      // fallback: extract hh:mm(:ss) from string
      try {
        const m = String(raw).match(/([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?/);
        if (m) {
          const hh = Number(m[1]);
          const mm = String(m[2]).padStart(2, '0');
          const ss = String(m[3] || '00').padStart(2, '0');
          const am = hh < 12;
          let h12 = hh % 12;
          if (h12 === 0) h12 = 12;
          const hStr = String(h12).padStart(2, '0');
          return `${hStr}:${mm}:${ss}${am ? 'AM' : 'PM'}`;
        }
      } catch (e) { /* ignore */ }
      return String(raw).trim();
    }

    const newData = (Array.isArray(data) ? data : []).map(row => {
      const out = {};
      for (const k of exportKeys) {
        if (Object.prototype.hasOwnProperty.call(row, k)) {
          if (k === 'timeIn' || k === 'timeOut') out[k] = _formatHumanTime(row[k]);
          else out[k] = row[k];
        } else out[k] = '';
      }
      return out;
    });
    const ws = XLSX.utils.json_to_sheet(newData, { header: exportKeys });
    // replace header labels with nicer display names
    const headerRow = ['Full Name', 'Username', 'Section', 'Time In', 'Time Out', 'Status'];
    XLSX.utils.sheet_add_aoa(ws, [headerRow], { origin: 'A1' });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'binary' });
    function s2ab(s) {
      const buf = new ArrayBuffer(s.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < s.length; ++i) view[i] = s.charCodeAt(i) & 0xFF;
      return buf;
    }
    const blob = new Blob([s2ab(wbout)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // collector for arbitrary tbody (calendar date view export)
  function collectRowsDataCALENDAR(tbodySelector, ids) {
    const rows = [];
    const tbody = document.querySelector(tbodySelector);
    if (!tbody) return rows;
    const trs = ids && ids.length ? Array.from(tbody.querySelectorAll('tr')).filter(tr => ids.includes(Number(tr.getAttribute('data-id')))) : Array.from(tbody.querySelectorAll('tr'));
    for (const tr of trs) {
      const id = Number(tr.getAttribute('data-id')) || '';
      let fullname = '';
      try {
        const tds = Array.from(tr.querySelectorAll('td'));
        for (const td of tds) {
          const txt = (td.textContent || '').trim();
          if (txt && !/IN[: ]|OUT[: ]|Time In[: ]|Time Out[: ]/i.test(txt)) { fullname = txt; break; }
        }
        if (!fullname) fullname = (tr.children[0] && tr.children[0].textContent) ? tr.children[0].textContent.trim() : '';
      } catch (e) { fullname = (tr.children[0] && tr.children[0].textContent) ? tr.children[0].textContent.trim() : ''; }

      let timeIn = '';
      let timeOut = '';
      try {
        // prefer explicit dataset values set by calendarAttendance (timeIn/timeOut raw)
        if (tr.dataset && (tr.dataset.timeIn || tr.dataset.timeOut)) {
          timeIn = tr.dataset.timeIn ? String(tr.dataset.timeIn).trim() : '';
          timeOut = tr.dataset.timeOut ? String(tr.dataset.timeOut).trim() : '';
        } else {
          // prefer separate cells if present (calendar view renders .time-in-cell and .time-out-cell)
          const inCell = tr.querySelector('.time-in-cell');
          const outCell = tr.querySelector('.time-out-cell');
          if (inCell || outCell) {
            timeIn = inCell ? (inCell.textContent || '').trim() : '';
            timeOut = outCell ? (outCell.textContent || '').trim() : '';
            // strip common labels if they exist
            timeIn = timeIn.replace(/^(?:Time In[:\s]*)/i, '').trim();
            timeOut = timeOut.replace(/^(?:Time Out[:\s]*)/i, '').trim();
          } else {
            // fallback: parse combined time cell text (IN:/OUT: or slash-separated)
            const timeCell = tr.querySelector('.time-cell') || tr.children[tr.children.length - 1];
            const timeText = timeCell ? (timeCell.textContent || '').trim() : '';
            const mIn = timeText.match(/IN[:\s]*([0-9:\sAPMapm]+)/i);
            const mOut = timeText.match(/OUT[:\s]*([0-9:\sAPMapm]+)/i);
            if (mIn) timeIn = mIn[1].trim();
            if (mOut) timeOut = mOut[1].trim();
            if (!timeIn && !timeOut && timeText) {
              const parts = timeText.split(/\s*[\/\-,]\s*/).map(s => s.trim()).filter(Boolean);
              if (parts.length === 2) { timeIn = parts[0]; timeOut = parts[1]; }
              else if (parts.length === 1) { timeIn = parts[0]; }
            }
          }
        }
      } catch (e) { timeIn = ''; timeOut = ''; }

      const statusEl = tr.querySelector('.status-select');
      const status = statusEl ? statusEl.value : (tr.querySelector('.status-text') && tr.querySelector('.status-text').textContent || '').trim();

      // username: prefer data-username or .username-cell
      let username = '';
      try {
        if (tr.dataset && tr.dataset.username) username = String(tr.dataset.username).trim();
        else if (tr.querySelector('.username-cell')) username = String(tr.querySelector('.username-cell').textContent || '').trim();
        else username = '';
      } catch (e) { username = ''; }

      let section = '';
      try { section = tr.dataset && tr.dataset.section ? String(tr.dataset.section).trim() : (tr.querySelector('.section-cell') ? (tr.querySelector('.section-cell').textContent || '').trim() : ''); } catch (e) { section = ''; }
      rows.push({ id, fullname, username, section, timeIn, timeOut, status });
    }
    return rows;
  }

  document.addEventListener('DOMContentLoaded', () => {
    // populate the attendance table date with today's date (MM-DD-YYYY)
    try {
      const el = document.getElementById('date-time-attendance-table');
      if (el) {
        const d = new Date();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yy = String(d.getFullYear());
        el.textContent = `${mm}-${dd}-${yy}`;
      }
    } catch (e) { /* ignore if element missing */ }

    const downloadBtn = document.getElementById('download-today-sheet');
    // download button inside the Calendar Download panel
    const downloadSpecBtn = document.getElementById('download-specDate-btn');
    const deleteBtn = document.getElementById('delete');
    const applyTimeoutBtn = document.getElementById('apply-timeout-btn');
    const selectAll = document.getElementById('select-all-rows');

    // deletion notice panel controls (replaces confirm() dialogs)
    const deletionPanel = document.querySelector('.deletion-notice-panel');
    const deletionCancelBtn = document.getElementById('deletion-cancel-btn');
    const deletionConfirmBtn = document.getElementById('deletion-confirm-btn');
    let pendingDelete = null; // { ids: [], handler: async(ids)=>{} }

    // universal notice panel (replaces alert())
    const noticePanel = document.querySelector('.notice-panel');
    const noticeHeader = document.getElementById('headerNotice');
    const noticeMessage = document.getElementById('PmessageNotice');
    const noticeOkBtn = document.getElementById('ok-btn');

    function showNotice(header, message) {
      try {
        if (!noticePanel) {
          // fallback to alert if notice panel not present
          if (message) alert((header ? header + ': ' : '') + message);
          else alert(header || 'Notice');
          return;
        }
        noticeHeader.textContent = header || '';
        noticeMessage.textContent = message || '';
        noticePanel.style.display = 'flex';
        // ensure ok button clears the panel
        const hide = () => { noticePanel.style.display = 'none'; };
        if (noticeOkBtn) {
          // remove previous handler by cloning
          const newBtn = noticeOkBtn.cloneNode(true);
          noticeOkBtn.parentNode.replaceChild(newBtn, noticeOkBtn);
          newBtn.addEventListener('click', hide);
        }
      } catch (e) {
        // Uncomment if made changes to styling or strucutre of your Html/CSS Files.
        // try { alert((header ? header + ': ' : '') + (message || '')); } catch (ee) { /* ignore */ }
      }
    }

    function showDeletionNotice(ids, handler) {
      if (!deletionPanel) return;
      pendingDelete = { ids: Array.isArray(ids) ? ids.slice() : (ids ? [ids] : []), handler };
      deletionPanel.style.display = 'flex';
      deletionPanel.dataset.ids = (pendingDelete.ids || []).join(',');
    }

    function hideDeletionNotice() {
      if (!deletionPanel) return;
      deletionPanel.style.display = 'none';
      deletionPanel.dataset.ids = '';
      pendingDelete = null;
    }

    if (deletionCancelBtn) deletionCancelBtn.addEventListener('click', hideDeletionNotice);
    if (deletionConfirmBtn) {
      deletionConfirmBtn.addEventListener('click', async () => {
        if (!pendingDelete || !pendingDelete.handler) { hideDeletionNotice(); return; }
        const ids = pendingDelete.ids || [];
        try {
          await pendingDelete.handler(ids);
        } catch (e) {
          console.error('delete handler failed', e);
          showNotice('Delete failed', 'An error occurred while deleting entries');
        } finally {
          hideDeletionNotice();
        }
      });
    }

    // clicking outside card closes the panel
    if (deletionPanel) {
      deletionPanel.addEventListener('click', (ev) => {
        if (ev.target === deletionPanel) hideDeletionNotice();
      });
    }
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') hideDeletionNotice();
    });

    if (selectAll) {
      selectAll.addEventListener('change', (e) => {
        const checked = !!selectAll.checked;
        const boxes = Array.from(document.querySelectorAll('#attendance-tbody .row-select'));
        boxes.forEach(b => {
          try { b.checked = checked; } catch (e) { /* ignore */ }
          // dispatch change so delegated handlers update visual highlight
          try { b.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* ignore */ }
        });
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', async () => {
        const ids = getSelectedIds();
        const data = collectRowsData(ids);
        // prefer user-specified filename from input if provided
        const fnameInput = document.getElementById('file-name-input');
        let base = '';
        if (fnameInput && fnameInput.value && String(fnameInput.value).trim()) {
          base = String(fnameInput.value).trim();
        } else {
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          base = ids.length ? `attendance-selected-${ts}` : `attendance-all-${ts}`;
        }
        const filename = base.toLowerCase().endsWith('.xlsx') ? base : `${base}.xlsx`;
        try {
          try { showNotice('Download started', 'Preparing your download...'); } catch (e) { /* ignore */ }
          await downloadAsXlsx(data, filename);
          try { showNotice('Download complete', `Saved ${filename}`); } catch (e) { /* ignore */ }
        } catch (e) {
          console.error('download failed', e);
          try { showNotice('Download failed', 'An error occurred while preparing the file'); } catch (ee) { /* ignore */ }
        }
      });
    }

    // Calendar download: open panel via explicit opener button, and perform download via panel button
    const openSpecPanelBtn = document.getElementById('open-download-option-panel');
    const panel = document.querySelector('.download-option-panel');
    if (openSpecPanelBtn && panel) {
      openSpecPanelBtn.addEventListener('click', (ev) => {
        try { ev && ev.preventDefault && ev.preventDefault(); } catch (e) { }
        // populate week start/end labels (this week) if present
        try {
          const now = new Date();
          const day = now.getDay();
          const diffToMon = (day + 6) % 7;
          const mon = new Date(now);
          mon.setDate(now.getDate() - diffToMon);
          const sun = new Date(mon);
          sun.setDate(mon.getDate() + 6);
          const startLabel = document.getElementById('start-of-week-day');
          const endLabel = document.getElementById('end-of-week-day');
          if (startLabel) startLabel.textContent = `${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}-${mon.getFullYear()}`;
          if (endLabel) endLabel.textContent = `${String(sun.getMonth() + 1).padStart(2, '0')}-${String(sun.getDate()).padStart(2, '0')}-${sun.getFullYear()}`;
        } catch (e) { /* ignore */ }
        panel.style.display = 'flex';
        panel.classList.add('active');
      });
    }

    // hide/show the week-select container depending on download option
    try {
      const downloadOptionSelect = document.getElementById('download-option-select');
      const weekSelectContainer = document.querySelector('.select-container.week-select');
      function updateWeekSelectVisibility() {
        if (!downloadOptionSelect || !weekSelectContainer) return;
        const v = String(downloadOptionSelect.value || '').toLowerCase();
        if (v === 'today') weekSelectContainer.style.display = 'none';
        else weekSelectContainer.style.display = '';
      }
      if (downloadOptionSelect) {
        downloadOptionSelect.addEventListener('change', updateWeekSelectVisibility);
        // initialize visibility
        try { updateWeekSelectVisibility(); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }

    // actual download action inside the download panel
    if (downloadSpecBtn && panel) {
      downloadSpecBtn.addEventListener('click', async (ev) => {
        try { ev && ev.preventDefault && ev.preventDefault(); } catch (e) { }
        const specTbody = document.getElementById('attendance-specDate-tbody');
        if (!specTbody) { showNotice('No data', 'No attendance data available for the selected date'); return; }

        // collect rows from tbody and only include visible rows
        let rows = collectRowsDataCALENDAR('#attendance-specDate-tbody');
        try {
          rows = (rows || []).filter(r => {
            try {
              const tr = specTbody.querySelector(`tr[data-id="${r.id}"]`);
              return tr ? ((tr.style.display || '') !== 'none') : true;
            } catch (e) { return true; }
          });
        } catch (e) { /* ignore */ }

        if (!rows || !rows.length) { showNotice('No rows', 'No visible rows to download'); return; }

        // build filename based on currently selected option (or fallback to timestamp)
        let base = '';
        try {
          const sel = document.querySelector('select[name="download-option-select"]') || document.querySelector('.select-box-download');
          const opt = sel ? String(sel.value || '').trim() : '';
          if (opt && opt !== 'specific-week' && opt !== 'specific-month' && opt !== 'specific-year') {
            base = `attendance-${opt.toLowerCase()}`;
          } else {
            const now = new Date();
            base = `attendance-${now.toISOString().slice(0, 10)}`;
          }
          // prefer calendar key if available
          const calKey = (window.calendarAttendance && typeof window.calendarAttendance.getLastSelectedDateKey === 'function') ? window.calendarAttendance.getLastSelectedDateKey() : null;
          if (calKey) base = `attendance-as-of-${calKey}`;
        } catch (e) { base = `attendance-${(new Date()).toISOString().slice(0, 10)}`; }

        const filename = base.toLowerCase().endsWith('.xlsx') ? base : `${base}.xlsx`;
        try {
          try { showNotice('Download started', 'Preparing your download...'); } catch (e) { /* ignore */ }
          await downloadAsXlsx(rows, filename);
          try { showNotice('Download complete', `Saved ${filename}`); } catch (e) { /* ignore */ }
        } catch (e) {
          console.error('spec date download failed', e);
          try { showNotice('Download failed', 'An error occurred while preparing the file'); } catch (ee) { /* ignore */ }
        }
        // close panel after download
        try { panel.style.display = 'none'; panel.classList.remove('active'); } catch (e) { /* ignore */ }
      });
    }

    // Import from Excel button
    const importBtn = document.getElementById('import-attendance-btn');
    if (importBtn) {
      importBtn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        // create hidden file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.xls,.csv';
        input.style.display = 'none';
        document.body.appendChild(input);
        input.addEventListener('change', async () => {
          const file = input.files && input.files[0];
          if (!file) { document.body.removeChild(input); return; }
          try {
            const reader = new FileReader();
            reader.onload = async (e) => {
              try {
                const data = e.target.result;
                const wb = XLSX.read(data, { type: 'array' });
                const sheetName = wb.SheetNames[0];
                const ws = wb.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

                // normalize header keys map (lowercase no-spaces)
                function normalizeKey(k) { return String(k || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

                // determine existing entries to avoid duplicates
                let existing = [];
                try {
                  const mod = await import('./attendanceStore.js');
                  const store = mod.default;
                  if (store && typeof store.getTodayRows === 'function') existing = store.getTodayRows();
                } catch (e) { /* fallback to DOM */ }

                const existingKeys = new Set();
                // store may contain richer records; add both username-based and name+section-based keys
                for (const r of (existing || [])) {
                  const uname = String(r.student_username || r.username || '').trim().toLowerCase();
                  const name = String(r.student_fullname || r.student_name || r.fullname || r.name || '').trim().toLowerCase();
                  const sec = String(r.student_section || r.section || '').trim().toLowerCase();
                  if (uname) existingKeys.add('u:' + uname);
                  if (name) existingKeys.add('n:' + name + '|' + sec);
                }

                // if store didn't yield keys, collect from DOM rows and add same key forms
                if (!existingKeys.size) {
                  const trs = Array.from(document.querySelectorAll('#attendance-tbody tr[data-id]'));
                  for (const tr of trs) {
                    const uname = String((tr.dataset && tr.dataset.username) || '').trim().toLowerCase();
                    const fname = String((tr.children[2] && tr.children[2].textContent) || '').trim().toLowerCase();
                    const sec = String((tr.dataset && tr.dataset.section) || (tr.querySelector('.section-cell') && tr.querySelector('.section-cell').textContent) || '').trim().toLowerCase();
                    if (uname) existingKeys.add('u:' + uname);
                    if (fname) existingKeys.add('n:' + fname + '|' + sec);
                  }
                }

                let imported = 0, skipped = 0;
                for (const row of rows) {
                  // map possible header names
                  const mapped = {};
                  for (const k of Object.keys(row)) {
                    const nk = normalizeKey(k);
                    const v = row[k];
                    if (['fullname', 'name', 'studentfullname', 'student_fullname'].includes(nk)) mapped.student_fullname = String(v).trim();
                    else if (['username', 'user', 'studentusername', 'student_username'].includes(nk)) mapped.student_username = String(v).trim();
                    else if (['section', 'studentsection', 'student_section'].includes(nk)) mapped.section = String(v).trim();
                    else if (['status'].includes(nk)) mapped.status = String(v).trim() || 'Present';
                    else if (['timein', 'timeinout', 'timein_time', 'time_in'].includes(nk)) mapped.time_in = String(v).trim();
                    else if (['timeout', 'time_out', 'time_out_time', 'timeo', 'time_outt'].includes(nk)) mapped.time_out = String(v).trim();
                    else {
                      // try to catch columns with spaces like 'time in'
                      if (nk.includes('timein')) mapped.time_in = String(v).trim();
                      if (nk.includes('timeout')) mapped.time_out = String(v).trim();
                    }
                  }

                  // build dedupe checks: prefer username match, otherwise fullname+section
                  const unameCheck = String(mapped.student_username || mapped.username || '').trim().toLowerCase();
                  const nameCheck = String(mapped.student_fullname || mapped.fullname || mapped.name || '').trim().toLowerCase();
                  const secCheck = String(mapped.section || '').trim().toLowerCase();
                  const userKey = unameCheck ? ('u:' + unameCheck) : null;
                  const nameKey = nameCheck ? ('n:' + nameCheck + '|' + secCheck) : null;
                  let isDup = false;
                  if (userKey && existingKeys.has(userKey)) isDup = true;
                  else if (nameKey && existingKeys.has(nameKey)) isDup = true;
                  if (isDup) { skipped++; continue; }

                  // build payload for server
                  const payload = {
                    fullname: mapped.student_fullname || mapped.student_fullname || '',
                    username: mapped.student_username || '',
                    section: mapped.section || '',
                    role: 'student',
                    status: mapped.status || 'Present'
                  };
                  // normalize times to ISO
                  try {
                    if (mapped.time_in) {
                      const hhmm = parseTimeToHHMM(mapped.time_in);
                      if (hhmm) {
                        const parts = hhmm.split(':').map(Number);
                        const hh = parts[0] || 0;
                        const mm = parts[1] || 0;
                        const ss = parts[2] || 0;
                        const d = new Date(); d.setHours(hh, mm, ss, 0);
                        payload.time_in = d.toISOString();
                      } else {
                        const d2 = new Date(mapped.time_in);
                        if (!isNaN(d2.getTime())) payload.time_in = d2.toISOString();
                      }
                    }
                    if (mapped.time_out) {
                      const hhmm2 = parseTimeToHHMM(mapped.time_out);
                      if (hhmm2) {
                        const parts2 = hhmm2.split(':').map(Number);
                        const hh2 = parts2[0] || 0;
                        const mm2 = parts2[1] || 0;
                        const ss2 = parts2[2] || 0;
                        const d3 = new Date(); d3.setHours(hh2, mm2, ss2, 0);
                        payload.time_out = d3.toISOString();
                      } else {
                        const d3b = new Date(mapped.time_out);
                        if (!isNaN(d3b.getTime())) payload.time_out = d3b.toISOString();
                      }
                    }
                  } catch (e) { /* ignore time parse errors */ }

                  // Ensure Time In is set to current time (today) regardless of imported value
                  try {
                    payload.time_in = new Date().toISOString();
                  } catch (e) { /* ignore */ }

                  // persist via preload API (recordAttendance)
                  try {
                    if (window.attendyAPI && typeof window.attendyAPI.recordAttendance === 'function') {
                      await window.attendyAPI.recordAttendance(payload);
                      imported++;
                      if (userKey) existingKeys.add(userKey);
                      if (nameKey) existingKeys.add(nameKey);
                    } else {
                      // fallback: append to DOM directly
                      try {
                        const viewMod = await import('./todayAttendanceView.js');
                        const rowObj = { id: Date.now() % 1000000, student_fullname: payload.fullname, student_username: payload.username, section: payload.section, status: payload.status, time_in: payload.time_in || new Date().toISOString() };
                        if (viewMod && typeof viewMod.buildRowHtml === 'function') {
                          const tbody = document.getElementById('attendance-tbody');
                          tbody.insertAdjacentHTML('beforeend', viewMod.buildRowHtml(rowObj));
                        }
                        imported++;
                        if (userKey) existingKeys.add(userKey);
                        if (nameKey) existingKeys.add(nameKey);
                      } catch (e) { skipped++; }
                    }
                  } catch (e) { skipped++; }
                }

                // refresh canonical store and views so tables update automatically
                try {
                  const mod2 = await import('./attendanceStore.js');
                  const store2 = mod2.default;
                  if (store2 && typeof store2.refreshAttendance === 'function') await store2.refreshAttendance();
                } catch (e) { /* ignore */ }
                try { const t = await import('./todayAttendanceView.js'); if (t && typeof t.renderTodayAttendance === 'function') t.renderTodayAttendance(); } catch (e) { }
                try { const r = await import('./recentStudentsView.js'); if (r && typeof r.renderRecentStudents === 'function') r.renderRecentStudents(); } catch (e) { }
                try { const m = await import('./mostPresentView.js'); if (m && typeof m.renderMostPresent === 'function') m.renderMostPresent(); } catch (e) { }
                try { const s = await import('./todayAttendanceSectionView.js'); if (s && typeof s.renderAttendanceSections === 'function') s.renderAttendanceSections(); } catch (e) { }

                // update section selects (populate from store) if available
                try { const dc = await import('./dashboardController.js'); if (dc && typeof dc.populateSectionSelects === 'function') dc.populateSectionSelects(); } catch (e) { }

                // refresh calendar view if present
                try {
                  if (window.calendarAttendance) {
                    if (typeof window.calendarAttendance.refreshAll === 'function') await window.calendarAttendance.refreshAll();
                    try {
                      const lastKey = (typeof window.calendarAttendance.getLastSelectedDateKey === 'function') ? window.calendarAttendance.getLastSelectedDateKey() : window.calendarAttendance._lastSelectedKey;
                      if (typeof window.calendarAttendance.renderSelectedDateAttendance === 'function') window.calendarAttendance.renderSelectedDateAttendance(lastKey || new Date());
                    } catch (e) { /* ignore */ }
                  }
                } catch (e) { /* ignore */ }

                // ensure download buttons reflect new rows
                try { if (typeof updateDownloadState === 'function') updateDownloadState(); } catch (e) { }
                try { if (typeof updateDownloadSpecState === 'function') updateDownloadSpecState(); } catch (e) { }

                showNotice('Import complete', `Imported ${imported} rows. Skipped ${skipped} duplicates/errors.`);
                try { const pnl = document.querySelector('.importORexport-panel'); if (pnl) { pnl.style.display = 'none'; pnl.classList.remove('active'); } } catch (e) { /* ignore */ }
              } catch (e) {
                console.error('import parse failed', e);
                showNotice('Import failed', 'Failed to parse the selected file');
              }
              document.body.removeChild(input);
            };
            reader.readAsArrayBuffer(file);
          } catch (e) {
            console.error('file read failed', e);
            showNotice('Import failed', 'Failed to read selected file');
            document.body.removeChild(input);
          }
        });
        input.click();
      });
    }

    // Wire the Import/Export panel open/close (the panel already exists in dash.html)
    const importExportToggle = document.getElementById('importORexport');
    const importPanel = document.querySelector('.importORexport-panel');
    const importCancelClose = () => { if (importPanel) { importPanel.style.display = 'none'; importPanel.classList.remove('active'); } };
    if (importExportToggle && importPanel) {
      importExportToggle.addEventListener('click', (ev) => {
        ev.preventDefault();
        // prefill filename input with calendar date if available
        try {
          const fnameInput = document.getElementById('file-name-input');
          if (fnameInput) {
            let base = '';
            const getKey = (window.calendarAttendance && typeof window.calendarAttendance.getLastSelectedDateKey === 'function') ? window.calendarAttendance.getLastSelectedDateKey : null;
            const key = getKey ? getKey() : null;
            if (key && typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key)) {
              const parts = key.split('-'); // [YYYY,MM,DD]
              base = `attendance as of (${parts[1]}-${parts[2]}-${parts[0]})`;
            } else {
              const d = new Date();
              const mm = String(d.getMonth() + 1).padStart(2, '0');
              const dd = String(d.getDate()).padStart(2, '0');
              const yy = String(d.getFullYear());
              base = `attendance as of (${mm}-${dd}-${yy})`;
            }
            fnameInput.value = base.toLowerCase().endsWith('.xlsx') ? base : `${base}.xlsx`;
          }
        } catch (e) { /* ignore */ }
        importPanel.style.display = 'flex';
        importPanel.classList.add('active');
      });
      // clicking overlay closes panel
      importPanel.addEventListener('click', (ev) => { if (ev.target === importPanel) importCancelClose(); });
      // ensure there is an automatic close when pressing Escape
      document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') importCancelClose(); });
    }

    // disable download button when table is empty
    function updateDownloadState() {
      const tbody = document.getElementById('attendance-tbody');
      if (!downloadBtn) return;
      const hasRows = tbody && tbody.querySelectorAll('tr').length > 0;
      downloadBtn.disabled = !hasRows;
    }

    // watch for DOM changes in the attendance tbody so the button state stays accurate
    const tbodyEl = document.getElementById('attendance-tbody');
    if (tbodyEl) {
      const mo = new MutationObserver(() => updateDownloadState());
      mo.observe(tbodyEl, { childList: true, subtree: false });
      // keep select-all checkbox in sync when individual boxes change
      tbodyEl.addEventListener('change', (ev) => {
        try {
          const cb = ev.target && (ev.target.classList && ev.target.classList.contains('row-select')) ? ev.target : (ev.target.closest && ev.target.closest('.row-select'));
          if (!cb) return;
          const boxes = Array.from(document.querySelectorAll('#attendance-tbody .row-select'));
          const allChecked = boxes.length > 0 && boxes.every(b => b.checked);
          if (selectAll) selectAll.checked = allChecked;
        } catch (e) { /* ignore */ }
      });
    }
    // initial state
    updateDownloadState();

    // --- Calendar download state & search for #attendance-specDate-tbody ---
    function updateDownloadSpecState() {
      const tbody = document.getElementById('attendance-specDate-tbody');
      if (!downloadSpecBtn) return;
      // consider only visible rows (search/section filters may hide rows via inline style)
      let hasVisible = false;
      if (tbody) {
        const trs = Array.from(tbody.querySelectorAll('tr'));
        hasVisible = trs.some(tr => (tr.style.display || '') !== 'none');
      }
      downloadSpecBtn.disabled = !hasVisible;
    }
    const tbodySpecEl = document.getElementById('attendance-specDate-tbody');
    if (tbodySpecEl) {
      const moSpec = new MutationObserver(() => updateDownloadSpecState());
      moSpec.observe(tbodySpecEl, { childList: true, subtree: false });
    }
    updateDownloadSpecState();

    (function setupSpecDateSearch() {
      const searchInput = document.querySelector('.list-student-calendar-container .search-input');
      const searchForm = searchInput && searchInput.closest('form');
      const specTbody = document.getElementById('attendance-specDate-tbody');
      const sectionSelect = document.querySelector('select.select-box-specDate') || document.querySelector('select[name="section-attendance-specDate"]');
      if (!searchInput || !specTbody) return;

      function normalize(s) { return String(s || '').toLowerCase().trim(); }

      function filterSpecRows(q) {
        const term = normalize(q);
        const tokens = term ? term.split(/\s+/).filter(Boolean) : [];
        const selectedSection = (sectionSelect && String(sectionSelect.value || 'all').toLowerCase()) || 'all';
        specTbody.querySelectorAll('tr').forEach(tr => {
          const fullname = normalize((tr.children[0] && tr.children[0].textContent) || '');
          let section = '';
          const secCell = tr.querySelector('.section-cell');
          if (secCell) section = normalize(secCell.textContent);
          else if (tr.dataset && tr.dataset.section) section = normalize(tr.dataset.section);
          else section = normalize(tr.textContent);

          // token match
          const tokenOk = tokens.length ? tokens.every(tok => fullname.includes(tok) || section.includes(tok)) : true;
          // section match (if specific section selected)
          const sectionOk = (!selectedSection || selectedSection === 'all') ? true : (section === selectedSection);
          const ok = tokenOk && sectionOk;
          tr.style.display = ok ? '' : 'none';
        });
      }

      searchInput.addEventListener('input', (e) => { filterSpecRows(e.target.value); updateDownloadSpecState(); });
      if (searchForm) searchForm.addEventListener('submit', (ev) => { ev.preventDefault(); filterSpecRows(searchInput.value); });

      // populate section select based on sections present in this tbody
      function updateSectionOptions() {
        if (!sectionSelect) return;
        const trs = Array.from(specTbody.querySelectorAll('tr'));
        const set = new Set();
        for (const tr of trs) {
          let section = '';
          const secCell = tr.querySelector('.section-cell');
          if (secCell) section = (secCell.textContent || '').trim();
          else if (tr.dataset && tr.dataset.section) section = String(tr.dataset.section).trim();
          else if (tr.children && tr.children[1] && tr.children[1].textContent) section = String(tr.children[1].textContent).trim();
          if (section) set.add(section);
        }
        const prev = String(sectionSelect.value || 'all');
        // rebuild options
        sectionSelect.innerHTML = '';
        const allOpt = document.createElement('option'); allOpt.value = 'all'; allOpt.textContent = 'All Sections';
        sectionSelect.appendChild(allOpt);
        Array.from(set).sort().forEach(sec => {
          const opt = document.createElement('option'); opt.value = sec; opt.textContent = sec; sectionSelect.appendChild(opt);
        });
        // restore previous if still present
        try { sectionSelect.value = prev; } catch (e) { sectionSelect.value = 'all'; }
      }

      if (sectionSelect) {
        sectionSelect.addEventListener('change', (ev) => { filterSpecRows(searchInput.value); updateDownloadSpecState(); });
      }

      const moS = new MutationObserver(() => { updateSectionOptions(); if (searchInput.value) filterSpecRows(searchInput.value); updateDownloadSpecState(); });
      moS.observe(specTbody, { childList: true, subtree: false });
      // initial population
      try { updateSectionOptions(); } catch (e) { /* ignore */ }
    })();

    // --- ATTENDANCE SEARCH (for #attendance-tbody) ---
    (function setupAttendanceSearch() {
      const searchInput = document.querySelector('.attendance-table-container .search-input');
      const searchForm = searchInput && searchInput.closest('form');
      // reuse tbodyEl if already declared above
      const attendanceTbody = (typeof tbodyEl !== 'undefined' && tbodyEl) ? tbodyEl : document.getElementById('attendance-tbody');
      if (!searchInput || !attendanceTbody) return;

      function normalize(s) { return String(s || '').toLowerCase().trim(); }

      function filterAttendanceRows(q) {
        const term = normalize(q);
        if (!term) {
          attendanceTbody.querySelectorAll('tr').forEach(tr => tr.style.display = '');
          return;
        }
        const tokens = term.split(/\s+/).filter(Boolean);
        attendanceTbody.querySelectorAll('tr').forEach(tr => {
          const fullname = normalize((tr.children[2] && tr.children[2].textContent) || '');
          // try explicit section cell (.section-cell) or data-section attribute or fallback to whole row text
          let section = '';
          const secCell = tr.querySelector('.section-cell');
          if (secCell) section = normalize(secCell.textContent);
          else if (tr.dataset && tr.dataset.section) section = normalize(tr.dataset.section);
          else section = normalize(tr.textContent);

          // match if every token is found in fullname OR section (substring)
          const ok = tokens.every(tok => fullname.includes(tok) || section.includes(tok));
          tr.style.display = ok ? '' : 'none';
        });
      }

      // live filter on input
      searchInput.addEventListener('input', (e) => filterAttendanceRows(e.target.value));

      // prevent form submit default (search via input)
      if (searchForm) searchForm.addEventListener('submit', (ev) => { ev.preventDefault(); filterAttendanceRows(searchInput.value); });

      // reapply filter when rows change
      if (attendanceTbody) {
        const moSearch = new MutationObserver(() => {
          if (searchInput.value) filterAttendanceRows(searchInput.value);
        });
        moSearch.observe(attendanceTbody, { childList: true, subtree: false });
      }
    })();

    // Edit panel wiring (replaces standalone time-setter UI)
    const editPanel = document.querySelector('.edit-student-panel');
    const editForm = document.getElementById('edit-student-form');
    const editFullname = document.getElementById('edit-student-fullname');
    const editUsername = document.getElementById('edit-student-username');
    const editTimeIn = document.getElementById('edit-student-time-in');
    const editTimeOut = document.getElementById('edit-student-time-out');
    const editSection = document.getElementById('edit-student-section');
    const editSectionSelect = document.querySelector('select[name="section-attendance-edit"]') || document.querySelector('.select-box-edit');
    const cancelEditBtn = document.getElementById('cancel-edit-student');

    function hhmmToDisplay(hhmm) {
      if (!hhmm) return '';
      try {
        const parts = String(hhmm).split(':').map(Number);
        const hh = parts[0] || 0;
        const mm = parts[1] || 0;
        const ss = parts[2] || 0;
        const d = new Date(); d.setHours(hh, mm, ss, 0);
        // include seconds in display only when provided
        const opts = { hour: 'numeric', minute: '2-digit', hour12: true };
        if (parts.length >= 3) opts.second = '2-digit';
        return d.toLocaleTimeString('en-US', opts).replace(/\s+/g, '');
      } catch (e) { return hhmm; }
    }

    function getFullnameFromRow(tr) {
      try {
        const tds = Array.from(tr.querySelectorAll('td'));
        let fullname = '';
        for (const td of tds) {
          if (td.querySelector && td.querySelector('.row-select')) continue;
          if (td.classList && td.classList.contains('meta-cell')) continue;
          if (td.querySelector && td.querySelector('.times-select')) continue;
          if (td.querySelector && td.querySelector('.status-select')) continue;
          const txt = (td.textContent || '').trim();
          if (/\bIN[: ]|OUT[: ]|Time In[: ]|Time Out[: ]/i.test(txt)) continue;
          if (txt) { fullname = txt; break; }
        }
        if (!fullname) {
          if (tr.children[2] && tr.children[2].textContent) fullname = tr.children[2].textContent.trim();
          else if (tr.children[1] && tr.children[1].textContent) fullname = tr.children[1].textContent.trim();
        }
        return fullname;
      } catch (e) { return (tr.children[2] && tr.children[2].textContent || '').trim(); }
    }

    function parseTimeToHHMM(raw) {
      // NOTE: This parser normalizes many possible time formats into a
      // canonical "HH:MM" form. It intentionally drops seconds when
      // present (e.g. "06:29:29PM" -> "06:29") because the edit
      // UI inputs and internal hh:mm display widgets expect only hours
      // and minutes. If you need to preserve seconds through the edit
      // flow, update this function to return seconds (HH:MM:SS) and
      // adjust the edit input handling and downstream ISO conversion.
      if (!raw) return '';
      let s = String(raw || '').trim();
      // remove common labels and non-breaking spaces
      s = s.replace(/\u00A0/g, ' ');
      s = s.replace(/^\s*(Time\s+In:|Time\s+Out:|IN:|OUT:)\s*/i, '').trim();

      // If string looks like an ISO datetime (contains 'T' or trailing Z), prefer Date parsing
      if (/\d{4}-\d{2}-\d{2}T/.test(s) || /Z$/.test(s)) {
        const iso = Date.parse(s);
        if (!isNaN(iso)) {
          const d = new Date(iso);
          return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
        }
      }

      // Try to match hh:mm with optional seconds and optional AM/PM (handles 9:16:01AM, 09:16 AM, 12:47:00PM)
      const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
      if (m) {
        let hh = parseInt(m[1], 10);
        const mm = String(parseInt(m[2], 10)).padStart(2, '0');
        const ss = m[3] ? String(parseInt(m[3], 10)).padStart(2, '0') : null;
        const ampm = (m[4] || '').toUpperCase();
        if (ampm === 'AM') {
          if (hh === 12) hh = 0;
        } else if (ampm === 'PM') {
          if (hh < 12) hh += 12;
        }
        return ss ? `${String(hh).padStart(2, '0')}:${mm}:${ss}` : `${String(hh).padStart(2, '0')}:${mm}`;
      }

      // Try to parse other Date strings as fallback
      const iso2 = Date.parse(s);
      if (!isNaN(iso2)) {
        const d2 = new Date(iso2);
        return `${String(d2.getHours()).padStart(2, '0')}:${String(d2.getMinutes()).padStart(2, '0')}:${String(d2.getSeconds()).padStart(2, '0')}`;
      }

      // Try to extract any hh:mm pair anywhere in the string
      const any = (String(raw || '')).match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
      if (any) {
        const parts = any[1].split(':');
        const hh = String(parseInt(parts[0], 10)).padStart(2, '0');
        const mm = String(parseInt(parts[1] || '0', 10)).padStart(2, '0');
        const ss = parts[2] ? String(parseInt(parts[2], 10)).padStart(2, '0') : null;
        return ss ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
      }

      return '';
    }

    async function showEditPanel(trOrId) {
      if (!editPanel) return;
      let tr = null;
      let id = null;
      if (typeof trOrId === 'number' || typeof trOrId === 'string') {
        id = Number(trOrId);
        tr = document.querySelector(`#attendance-tbody tr[data-id="${id}"]`) || document.querySelector(`#recent-students-tbody tr[data-id="${id}"]`);
      } else if (trOrId && trOrId.getAttribute) {
        tr = trOrId; id = Number(tr.getAttribute('data-id'));
      }

      if (tr) {
        const fullname = getFullnameFromRow(tr) || '';
        const timesEl = tr.querySelector('.times-select');
        let tIn = '', tOut = '';
        if (timesEl) {
          tIn = (timesEl.options[0] && timesEl.options[0].textContent || '').replace(/^Time In:\s*/i, '').trim();
          tOut = (timesEl.options[1] && timesEl.options[1].textContent || '').replace(/^Time Out:\s*/i, '').trim();
        } else {
          const txt = (tr.textContent || '').replace(/\s+/g, ' ');
          const mIn = txt.match(/IN[: ]\s*([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\s*(?:AM|PM)?)/i);
          const mOut = txt.match(/OUT[: ]\s*([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\s*(?:AM|PM)?)/i);
          if (mIn) tIn = mIn[1].replace(/\s+/g, '');
          if (mOut) tOut = mOut[1].replace(/\s+/g, '');
        }
        // If times not present in DOM, try fallback to canonical store (handles ISO time_in fields)
        try {
          // If either time value is missing in the DOM, try the canonical store
          if (((!tIn || !tIn.length) || (!tOut || !tOut.length)) && id) {
            try {
              const mod = await import('./attendanceStore.js');
              const store = mod && mod.default ? mod.default : mod;
              if (store) {
                let rows = [];
                try { rows = (typeof store.getTodayRows === 'function') ? store.getTodayRows() : (store.getRows ? store.getRows() : []); } catch (e) { rows = [] }
                const row = rows.find(r => Number(r.id) === Number(id));
                if (row) {
                  // prefer common keys for time in
                  if ((!tIn || !tIn.length)) {
                    const candIn = row.time_in || row.timeIn || row.student_time_in || row.student_time || row.timestamp || '';
                    if (candIn) tIn = String(candIn);
                  }
                  // prefer common keys for time out
                  if ((!tOut || !tOut.length)) {
                    const candOut = row.time_out || row.timeOut || row.student_time_out || row.studentTimeOut || row.checked_out_at || '';
                    if (candOut) tOut = String(candOut);
                  }
                }
              }
            } catch (e) { /* ignore store import errors */ }
          }
        } catch (e) { /* ignore fallback errors */ }
        const username = (tr.dataset && tr.dataset.username) || '';
        // section: support calendar rows which don't have .section-cell or data-section
        let section = '';
        try {
          if (tr.dataset && tr.dataset.section) section = String(tr.dataset.section).trim();
          else if (tr.querySelector('.section-cell')) section = String(tr.querySelector('.section-cell').textContent || '').trim();
          else if (tr.children && tr.children[1] && tr.children[1].textContent) section = String(tr.children[1].textContent).trim();
          else section = '';
        } catch (e) { section = '' }
        // status: prefer .status-select, then .status-text, then calendar column fallback (td index 2)
        let rowStatus = '';
        try {
          const stEl = tr.querySelector('.status-select');
          if (stEl) rowStatus = String(stEl.value || '').trim();
          else if (tr.querySelector('.status-text')) rowStatus = String(tr.querySelector('.status-text').textContent || '').trim();
          else if (tr.children && tr.children[2] && tr.children[2].textContent) rowStatus = String(tr.children[2].textContent).trim();
        } catch (e) { rowStatus = ''; }
        if (editFullname) editFullname.value = fullname || '';
        if (editUsername) editUsername.value = username || '';
        // assign parsed hh:mm to inputs; also set attribute to ensure UI widgets pick it up
        // NOTE: parseTimeToHHMM will return only HH:MM (seconds are removed).
        // That means the edit inputs will display and submit times without
        // seconds. The original row or canonical store may contain seconds
        // (ISO or hh:mm:ss) but the edit flow normalizes to minutes.
        try {
          const parsedFullIn = parseTimeToHHMM(tIn) || '';
          const parsedFullOut = parseTimeToHHMM(tOut) || '';
          // inputs expect HH:MM; derive that form for the UI but keep
          // the full parsed (HH:MM or HH:MM:SS) in the panel dataset so
          // we can preserve seconds when saving if the user doesn't
          // change the minute portion.
          const parsedInForInput = parsedFullIn ? parsedFullIn.split(':').slice(0, 2).join(':') : '';
          const parsedOutForInput = parsedFullOut ? parsedFullOut.split(':').slice(0, 2).join(':') : '';
          if (editTimeIn) {
            editTimeIn.value = parsedInForInput;
            try { editTimeIn.setAttribute('value', parsedInForInput); } catch (e) { /* ignore */ }
          }
          if (editTimeOut) {
            editTimeOut.value = parsedOutForInput;
            try { editTimeOut.setAttribute('value', parsedOutForInput); } catch (e) { /* ignore */ }
          }
          try { if (editPanel) { editPanel.dataset.origTimeIn = parsedFullIn || ''; editPanel.dataset.origTimeOut = parsedFullOut || ''; } } catch (e) { /* ignore */ }
        } catch (e) { /* ignore assign errors */ }
        // populate status select if present
        try {
          const editStatusEl = document.getElementById('edit-student-status');
          if (editStatusEl) {
            if (rowStatus) {
              // try to match option
              const match = Array.from(editStatusEl.options).find(o => (o.value || '').toLowerCase() === rowStatus.toLowerCase());
              if (match) editStatusEl.value = match.value;
              else {
                // add custom option
                const opt = document.createElement('option'); opt.value = rowStatus; opt.textContent = rowStatus; editStatusEl.appendChild(opt); editStatusEl.value = opt.value;
              }
            } else {
              editStatusEl.value = 'Present';
            }
          }
        } catch (e) { /* ignore */ }
        // ensure section selects are populated first (controller exposes helper)
        if (editSectionSelect && (!editSectionSelect.options || editSectionSelect.options.length === 0)) {
          try {
            const ctrl = await import('./dashboardController.js');
            if (ctrl && typeof ctrl.populateSectionSelects === 'function') await ctrl.populateSectionSelects();
          } catch (e) { /* ignore */ }
        }

        // set section select if present, otherwise set section input
        if (editSectionSelect) {
          const secNormalized = String(section || '').trim();
          let matched = null;
          if (secNormalized) {
            matched = Array.from(editSectionSelect.options).find(o => {
              const txt = (o.textContent || '').trim();
              if (txt && txt.toLowerCase() === secNormalized.toLowerCase()) return true;
              const valDecoded = (o.value || '').replace(/&quot;/g, '"').trim();
              if (valDecoded && valDecoded.toLowerCase() === secNormalized.toLowerCase()) return true;
              return false;
            });
          }
          if (matched) {
            editSectionSelect.value = matched.value;
            if (editSection) { editSection.style.display = 'none'; editSection.required = false; }
            // ensure UI reflects the change
            try { updateEditSectionFieldVisibility(); } catch (e) { /* ignore */ }
          } else if (!secNormalized) {
            // no section on row: choose 'new' so user can enter one
            if (Array.from(editSectionSelect.options).some(o => o.value === 'new')) editSectionSelect.value = 'new';
            if (editSection) { editSection.style.display = 'block'; editSection.required = true; editSection.value = ''; }
          } else {
            // section exists on row but not in options: add it and select
            try {
              // only add if not already present (case-insensitive match on text or value)
              const norm = secNormalized.toLowerCase();
              const foundOpt = Array.from(editSectionSelect.options || []).find(o => ((o.textContent || '').trim().toLowerCase() === norm) || ((o.value || '').replace(/&quot;/g, '"').trim().toLowerCase() === norm));
              if (foundOpt) {
                editSectionSelect.value = foundOpt.value;
              } else {
                const opt = document.createElement('option');
                opt.value = secNormalized.replace(/\"/g, '&quot;');
                opt.textContent = secNormalized;
                editSectionSelect.appendChild(opt);
                editSectionSelect.value = opt.value;
              }
              if (editSection) { editSection.style.display = 'none'; editSection.required = false; }
              try { updateEditSectionFieldVisibility(); } catch (e) { /* ignore */ }
            } catch (e) {
              // fallback to showing free-text
              if (Array.from(editSectionSelect.options).some(o => o.value === 'new')) editSectionSelect.value = 'new';
              if (editSection) { editSection.style.display = 'block'; editSection.required = true; editSection.value = section || ''; }
            }
          }
        } else {
          if (editSection) editSection.value = section || '';
        }
      } else {
        // clear fields
        if (editFullname) editFullname.value = '';
        if (editUsername) editUsername.value = '';
        if (editSection) editSection.value = '';
        if (editTimeIn) editTimeIn.value = '';
        if (editTimeOut) editTimeOut.value = '';
        try { const editStatusEl = document.getElementById('edit-student-status'); if (editStatusEl) editStatusEl.value = 'Present'; } catch (e) { }
      }

      editPanel.dataset.editId = id || '';
      editPanel.style.display = 'flex';
      editPanel.classList.add('active');
      if (editFullname) editFullname.focus();
    }

    function hideEditPanel() {
      if (!editPanel) return;
      editPanel.style.display = 'none';
      editPanel.classList.remove('active');
      delete editPanel.dataset.editId;
    }

    if (editForm) {
      editForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const id = Number(editPanel && editPanel.dataset && editPanel.dataset.editId) || null;
        const fullname = editFullname ? editFullname.value.trim() : '';
        const username = editUsername ? editUsername.value.trim() : '';
        const status = (document.getElementById('edit-student-status') && String(document.getElementById('edit-student-status').value || '').trim()) || undefined;
        // resolve section: prefer select (unless 'new'), otherwise free-text input
        let section = '';
        try {
          if (editSectionSelect) {
            const val = String(editSectionSelect.value || '').trim();
            if (val && val !== 'new') {
              section = val.replace(/&quot;/g, '"');
            } else if (editSection) {
              section = String(editSection.value || '').trim();
            }
          } else if (editSection) {
            section = String(editSection.value || '').trim();
          }
        } catch (e) { section = (editSection && editSection.value) ? String(editSection.value).trim() : ''; }
        let tIn = editTimeIn ? editTimeIn.value : '';
        let tOut = editTimeOut ? editTimeOut.value : '';
        // Preserve seconds from the original parsed values (if present)
        // when the user hasn't modified the minute portion.
        try {
          const origIn = (editPanel && editPanel.dataset && editPanel.dataset.origTimeIn) ? editPanel.dataset.origTimeIn : '';
          const origOut = (editPanel && editPanel.dataset && editPanel.dataset.origTimeOut) ? editPanel.dataset.origTimeOut : '';
          if (origIn && origIn.split(':').length === 3) {
            const origNoSec = origIn.split(':').slice(0, 2).join(':');
            if (tIn === origNoSec) tIn = origIn;
          }
          if (origOut && origOut.split(':').length === 3) {
            const origNoSecOut = origOut.split(':').slice(0, 2).join(':');
            if (tOut === origNoSecOut) tOut = origOut;
          }
        } catch (e) { /* ignore */ }

        // attempt to update canonical store first
        try {
          const mod = await import('./attendanceStore.js');
          const store = mod.default;
          if (store) {
            // Build update payload with common field names
            const payload = {
              student_fullname: fullname || undefined,
              student_username: username || undefined,
              student_section: section || undefined,
              status: status || undefined
            };
            if (id && typeof store.updateRow === 'function') {
              try { await store.updateRow(id, payload); } catch (e) { /* ignore */ }
            } else if (id) {
              // best-effort: mutate cached row
              try {
                const rows = (store.getTodayRows ? store.getTodayRows() : []).concat(store.getRecent ? store.getRecent(200) : []);
                const row = rows.find(r => Number(r.id) === id);
                if (row) {
                  if (fullname) row.student_fullname = fullname;
                  if (username) row.student_username = username;
                  if (section) row.student_section = section;
                  if (typeof store._internals === 'function') store._internals();
                }
              } catch (e) { /* ignore */ }
            }

            // persist to backend via API if available (best-effort)
            try {
              // include time fields (ISO) when calling backend
              const serverPayload = Object.assign({}, payload);
              if (id) serverPayload.id = id;
              // Convert edit input (`HH:MM`) into an ISO timestamp for the
              // server. Note: seconds are explicitly set to 0 here because
              // the edit UI only provides hours/minutes. If you want to
              // preserve seconds, the edit input must supply them and the
              // parser above must return them as well.
              if (tIn) {
                const parts1 = String(tIn).split(':').map(Number);
                const hh1 = parts1[0] || 0;
                const mm1 = parts1[1] || 0;
                const ss1 = parts1[2] || 0;
                const d1 = new Date(); d1.setHours(hh1, mm1, ss1, 0);
                serverPayload.time_in = d1.toISOString();
              }
              // include status when present
              if (status) serverPayload.status = status;
              // Same for Time Out: build an ISO using HH:MM from the edit
              // field and set seconds to zero. This is why saved rows lose
              // any original seconds value.
              if (tOut) {
                const parts2 = String(tOut).split(':').map(Number);
                const hh2 = parts2[0] || 0;
                const mm2 = parts2[1] || 0;
                const ss2 = parts2[2] || 0;
                const d2 = new Date(); d2.setHours(hh2, mm2, ss2, 0);
                serverPayload.time_out = d2.toISOString();
              }

              // Use preload API only — do NOT call localhost directly from renderer.
              if (window.attendyAPI) {
                if (typeof window.attendyAPI.updateAttendanceRow === 'function') {
                  try { await window.attendyAPI.updateAttendanceRow(id, serverPayload); } catch (e) { /* ignore */ }
                } else if (typeof window.attendyAPI.editAttendance === 'function') {
                  try { await window.attendyAPI.editAttendance(id, serverPayload); } catch (e) { /* ignore */ }
                } else {
                  console.warn('attendyAPI has no edit handler; skipping backend edit to avoid exposing localhost from renderer');
                }
              } else {
                console.warn('attendyAPI not available; skipping backend edit to avoid exposing localhost from renderer');
              }
            } catch (e) { /* ignore */ }

            // time updates (local store): convert HH:MM edit values into
            // ISO timestamps and persist. Note that seconds are set to 0
            // because the edit UI and parsing only handle hours and
            // minutes; this is the line that causes saved rows to lose
            // any original seconds component.
            if (id && tIn) {
              const parts = String(tIn).split(':').map(Number);
              const hh = parts[0] || 0;
              const mm = parts[1] || 0;
              const ss = parts[2] || 0;
              const d = new Date(); d.setHours(hh, mm, ss, 0);
              const iso = d.toISOString();
              if (typeof store.setTimeInForRow === 'function') await store.setTimeInForRow(id, iso);
            }
            if (id && tOut) {
              const partsO = String(tOut).split(':').map(Number);
              const hhO = partsO[0] || 0;
              const mmO = partsO[1] || 0;
              const ssO = partsO[2] || 0;
              const dO = new Date(); dO.setHours(hhO, mmO, ssO, 0);
              const isoO = dO.toISOString();
              if (typeof store.setTimeoutForRows === 'function') await store.setTimeoutForRows([id], isoO);
            }
          }
        } catch (e) { /* ignore store errors */ }

        // update DOM immediate feedback
        try {
          if (id) {
            const tr = document.querySelector(`#attendance-tbody tr[data-id="${id}"]`) || document.querySelector(`#attendance-specDate-tbody tr[data-id="${id}"]`);
            if (tr) {
              // helper: find sensible cells in a row (fullname, status, time cells)
              function findRowCells(row, fullnameHint) {
                const tds = Array.from(row.querySelectorAll('td'));
                let fullnameTd = null;
                let statusCell = null;
                let inCell = null;
                let outCell = null;
                let timesTd = null;
                for (const td of tds) {
                  // skip checkbox and meta
                  if (td.querySelector && td.querySelector('.row-select')) continue;
                  if (td.classList && td.classList.contains('meta-cell')) continue;
                  // times-select explicit
                  if (td.querySelector && td.querySelector('.times-select')) { timesTd = td; if (!inCell) inCell = td; if (!outCell) outCell = td; continue; }
                  const txt = (td.textContent || '').trim();
                  // fullname exact match
                  if (!fullnameTd && fullnameHint && txt === String(fullnameHint).trim()) { fullnameTd = td; continue; }
                  // status select
                  if (!statusCell && td.querySelector && td.querySelector('.status-select')) { statusCell = td; continue; }
                  // status text match
                  if (!statusCell && /(Present|Late|Absent|Excused)/i.test(txt)) { statusCell = td; continue; }
                  // time-like cell
                  if (!inCell && /(\d{1,2}:\d{2})(?::\d{2})?\s*(AM|PM)?/i.test(txt)) { inCell = td; continue; }
                  // choose first non-empty as fullname fallback
                  if (!fullnameTd && txt) fullnameTd = td;
                }
                return { tds, fullnameTd, statusCell, inCell, outCell, timesTd };
              }
              const cells = findRowCells(tr, fullname);
              // locate fullname cell robustly
              try {
                const fullnameTd = cells.fullnameTd || (tr.children[1] || null);
                if (fullname && fullnameTd) fullnameTd.textContent = fullname;
              } catch (e) { /* ignore */ }

              // update dataset attrs
              if (section) tr.dataset.section = section;
              if (username) tr.dataset.username = username;

              // update section cell only if explicit .section-cell exists; always update dataset
              try {
                const secEl = tr.querySelector('.section-cell');
                if (secEl && typeof section !== 'undefined') secEl.textContent = section;
                // always keep dataset in sync for canonical reads; avoid writing arbitrary cells to prevent layout corruption
                if (typeof section !== 'undefined') tr.dataset.section = section;
              } catch (e) { /* ignore */ }

              // update status cell / select
              try {
                const stEl = tr.querySelector('.status-select');
                if (stEl && status) {
                  // try to find matching option
                  const m = Array.from(stEl.options).find(o => (o.value || '').toLowerCase() === String(status).toLowerCase());
                  if (m) stEl.value = m.value;
                  else {
                    // avoid duplicate options
                    if (!Array.from(stEl.options || []).some(o => (o.value || '').toLowerCase() === String(status).toLowerCase() || (o.textContent || '').toLowerCase() === String(status).toLowerCase())) {
                      const opt = document.createElement('option'); opt.value = status; opt.textContent = status; stEl.appendChild(opt); stEl.value = opt.value;
                    } else {
                      stEl.value = status;
                    }
                  }
                } else if (status) {
                  // write into cells.statusCell if detected, otherwise try to pick a safe cell
                  const statusCell = cells.statusCell || (cells.tds && cells.tds.slice().reverse().find(td => !td.querySelector('.row-select') && !(td.classList && td.classList.contains('meta-cell')) && td !== cells.fullnameTd));
                  if (statusCell) statusCell.textContent = status;
                }
              } catch (e) { /* ignore */ }

              // update times cell(s)
              const sel = tr.querySelector('.times-select');
              if (sel) {
                if (sel.options[0]) sel.options[0].textContent = `Time In: ${tIn ? hhmmToDisplay(tIn) : 'Not Set'}`;
                if (sel.options[1]) sel.options[1].textContent = `Time Out: ${tOut ? hhmmToDisplay(tOut) : 'Not Set'}`;
              } else {
                try {
                  const inCell = cells.inCell || tr.querySelector('.time-in-cell');
                  const outCell = cells.outCell || tr.querySelector('.time-out-cell');
                  if (inCell && tIn && inCell !== cells.statusCell) inCell.textContent = hhmmToDisplay(tIn);
                  if (outCell && tOut && outCell !== cells.statusCell) outCell.textContent = hhmmToDisplay(tOut);
                } catch (e) { /* ignore */ }
                // fallback for combined IN/OUT layout
                try {
                  const tds = Array.from(tr.querySelectorAll('td'));
                  const timesTd = tds.find(td => /IN[: ]|OUT[: ]/i.test(td.textContent || ''));
                  if (timesTd && timesTd !== cells.statusCell) timesTd.innerHTML = `IN: ${tIn ? hhmmToDisplay(tIn) : 'Not Set'} <br> OUT: ${tOut ? hhmmToDisplay(tOut) : 'Not Set'}`;
                } catch (e) { /* ignore */ }
              }
            }
          }
        } catch (e) { /* ignore DOM update errors */ }

        // update calendar view data immediately (no full refresh)
        try {
          const cal = (typeof window !== 'undefined' && window.calendarAttendance) ? window.calendarAttendance : null;
          if (cal && id && typeof cal.updateRecordById === 'function') {
            const updates = {};
            if (fullname) { updates.student_fullname = fullname; updates.fullname = fullname; }
            if (username) { updates.student_username = username; updates.username = username; }
            if (section) { updates.section = section; updates.student_section = section; }
            if (status) { updates.status = status; }
            const res = cal.updateRecordById(id, updates);
            const key = (res && res.key) || (typeof cal.getLastSelectedDateKey === 'function' ? cal.getLastSelectedDateKey() : null);
            if (key && typeof cal.renderSelectedDateAttendance === 'function') {
              cal.renderSelectedDateAttendance(key);
            }
          }
        } catch (e) { /* ignore calendar update errors */ }

        // refresh relevant views
        try { const t = await import('./todayAttendanceView.js'); if (t && typeof t.renderTodayAttendance === 'function') t.renderTodayAttendance(); } catch (e) { }
        try { const r = await import('./recentStudentsView.js'); if (r && typeof r.renderRecentStudents === 'function') r.renderRecentStudents(); } catch (e) { }
        try { const m = await import('./mostPresentView.js'); if (m && typeof m.renderMostPresent === 'function') m.renderMostPresent(); } catch (e) { }
        try { const s = await import('./todayAttendanceSectionView.js'); if (s && typeof s.renderAttendanceSections === 'function') s.renderAttendanceSections(); } catch (e) { }
        try {
          const c = await import('./calendarAttendance.js');
          if (c && c.default && typeof c.default.refreshAll === 'function') {
            await c.default.refreshAll();
            const k = (typeof c.default.getLastSelectedDateKey === 'function') ? c.default.getLastSelectedDateKey() : null;
            if (k && typeof c.default.renderSelectedDateAttendance === 'function') {
              c.default.renderSelectedDateAttendance(k);
            }
          }
        } catch (e) { /* ignore */ }

        // ensure selects and counts update to reflect changed/added section
        try { const ctrl = await import('./dashboardController.js'); if (ctrl && typeof ctrl.populateSectionSelects === 'function') await ctrl.populateSectionSelects(); } catch (e) { /* ignore */ }

        hideEditPanel();
      });
    }

    if (cancelEditBtn && editPanel) cancelEditBtn.addEventListener('click', (ev) => { ev.preventDefault(); hideEditPanel(); });

    if (editPanel) {
      editPanel.addEventListener('click', (ev) => { if (ev.target === editPanel) hideEditPanel(); });
      document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hideEditPanel(); });
    }

    // manage visibility of the edit section free-text input when select changes
    function updateEditSectionFieldVisibility() {
      if (!editSectionSelect || !editSection) return;
      const val = String(editSectionSelect.value || '').trim();
      if (val === 'new') {
        editSection.style.display = 'block';
        editSection.required = true;
      } else {
        editSection.style.display = 'none';
        editSection.required = false;
      }
    }
    if (editSectionSelect) {
      editSectionSelect.addEventListener('change', updateEditSectionFieldVisibility);
      // initial visibility
      try { updateEditSectionFieldVisibility(); } catch (e) { /* ignore */ }
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        const ids = getSelectedIds();
        if (!ids.length) {
          showNotice('Select rows', 'Select rows to delete');
          return;
        }
        // show deletion panel and perform deletion on confirm
        showDeletionNotice(ids, async (idsToDelete) => {
          // attempt server-side delete, remove DOM rows and update local store
          for (const id of idsToDelete) {
            try {
              // try server API first (if available)
              if (window.attendyAPI && typeof window.attendyAPI.deleteAttendanceRow === 'function') {
                try { await window.attendyAPI.deleteAttendanceRow(id); } catch (e) { /* ignore server error but continue */ }
              }
            } catch (e) { /* ignore */ }

            // remove row from DOM immediately
            try {
              const tr = document.querySelector(`#attendance-tbody tr[data-id="${id}"]`);
              if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
            } catch (e) { /* ignore */ }

            // update attendanceStore if present
            try {
              const mod = await import('./attendanceStore.js');
              const store = mod.default;
              if (typeof store.deleteRow === 'function') {
                try { await store.deleteRow(id); } catch (e) { /* ignore */ }
              }
            } catch (e) { /* ignore */ }
          }

          // ensure store is in sync with backend
          try {
            const mod2 = await import('./attendanceStore.js');
            const store2 = mod2.default;
            if (typeof store2.refreshAttendance === 'function') {
              await store2.refreshAttendance();
            }
          } catch (e) { /* ignore */ }

          // refresh download state and any search filters
          try { updateDownloadState(); } catch (e) { /* ignore */ }
          const searchInput = document.querySelector('.attendance-table-container .search-input');
          if (searchInput && searchInput.value) {
            try { searchInput.dispatchEvent(new Event('input')); } catch (e) { /* ignore */ }
          }
        });
      });
    }

    if (applyTimeoutBtn) {
      applyTimeoutBtn.addEventListener('click', async () => {
        const ids = getSelectedIds();
        if (!ids.length) {
          showNotice('Select rows', 'Select rows to apply timeout');
          return;
        }
        const timeInput = document.getElementById('timeout-time');
        if (!timeInput || !timeInput.value) {
          // Always show a notice when no time is selected from the toolbar.
          // The time-setter panel should only be opened explicitly from the
          // context menu / right-click flows.
          showNotice('Select a time', 'Please select a time first');
          return;
        }
        // build ISO string for today with selected hh:mm(:ss) - support seconds if provided
        const partsT = String(timeInput.value).split(':').map(Number);
        const hh = partsT[0] || 0;
        const mm = partsT[1] || 0;
        const ss = partsT[2] || 0;
        const d = new Date();
        d.setHours(hh, mm, ss, 0);
        const iso = d.toISOString();

        //Fix for Issue #2 Time out is still being set on the data that has time out on it - ryuzkzqt-ops
        // filter out rows that already have a timeOut set (check DOM and canonical store)
        let idsToApply = [];
        try {
          const rows = collectRowsData(ids);
          // attempt to also consult canonical store for existing time_out values
          let storeRowsMap = null;
          try {
            const mod = await import('./attendanceStore.js');
            const store = mod && (mod.default || mod);
            if (store) {
              let srows = [];
              try { srows = (typeof store.getTodayRows === 'function') ? store.getTodayRows() : (store.getRows ? store.getRows() : []); } catch (ee) { srows = []; }
              storeRowsMap = new Map((srows || []).map(r => [Number(r.id), r]));
            }
          } catch (e) { /* ignore store import errors */ }

          idsToApply = (rows || []).filter(r => {
            try {
              const domHas = (r.timeOut && String(r.timeOut).trim().length);
              if (domHas) return false; // skip if DOM already shows timeOut
              // check store record (prefer canonical source)
              if (storeRowsMap && storeRowsMap.has(Number(r.id))) {
                const sr = storeRowsMap.get(Number(r.id));
                const cand = sr && (sr.time_out || sr.timeOut || sr.student_time_out || sr.studentTimeOut || sr.checked_out_at || '');
                if (cand && String(cand).trim().length) return false; // skip if store has time out
              }
              return true; // apply if neither DOM nor store has timeOut
            } catch (e) { return true; }
          }).map(r => r.id).filter(Boolean);
        } catch (e) {
          idsToApply = ids.slice(); // fallback: try all
        }

        if (!idsToApply.length) {
          showNotice('No rows updated', 'Selected rows already have Time Out values');
          return;
        }

        try {
          if (!window.attendyAPI || typeof window.attendyAPI.setTimeoutForRows !== 'function') {
            console.error('attendyAPI.setTimeoutForRows not available');
            showNotice('Timeout API', 'Timeout API not available');
            return;
          }
          await window.attendyAPI.setTimeoutForRows(idsToApply, iso);
          // update local store cache so UI updates immediately
          try {
            const mod = await import('./attendanceStore.js');
            const store = mod.default;
            if (typeof store.setTimeoutForRows === 'function') {
              await store.setTimeoutForRows(idsToApply, iso);
            } else {
              // fallback to refresh if available
              try { await store.refreshAttendance(); } catch (e) { /* ignore */ }
            }
          } catch (e) { /* ignore */ }
        } catch (e) {
          console.error('apply timeout failed', e);
          showNotice('Failed', 'Failed to apply timeout');
        }
      });
    }

    // ---------------------------
    // Add Student -> inject row into #attendance-tbody
    // ---------------------------
    (function setupAddStudent() {
      const addForm = document.getElementById('add-student-form');
      const cancelAddBtn = document.getElementById('cancel-add-student');
      const addPanel = document.querySelector('.add-student-panel');
      const tbody = document.getElementById('attendance-tbody');

      // compute starting id from existing rows or timestamp
      let nextGeneratedId = (() => {
        try {
          const ids = Array.from(document.querySelectorAll('#attendance-tbody tr[data-id]')).map(tr => Number(tr.getAttribute('data-id')) || 0);
          const m = ids.length ? Math.max(...ids) : 0;
          return m > 0 ? m + 1 : Date.now() % 1000000;
        } catch (e) { return Date.now() % 1000000; }
      })();

      function sanitize(s) { return String(s || '').trim(); }

      function createAttendanceRow({ id, fullname, username, section, timeIn = '', timeOut = '', status = 'Present' }) {
        const tr = document.createElement('tr');
        tr.setAttribute('data-id', id);
        tr.dataset.section = section || '';
        if (username) tr.dataset.username = username;

        // checkbox cell (col 1)
        const tdChk = document.createElement('td');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'row-select';
        cb.setAttribute('data-id', id);
        tdChk.appendChild(cb);

        // placeholder / meta cell (col 2) - keep empty so fullname remains at index 2
        const tdMeta = document.createElement('td');
        tdMeta.className = 'meta-cell';
        tdMeta.innerHTML = ''; // reserved for icon/avatar if needed

        // fullname cell (index 2 used by search)
        const tdFull = document.createElement('td');
        tdFull.textContent = fullname || '';

        // times cell (index 3)
        const tdTimes = document.createElement('td');
        const selTimes = document.createElement('select');
        selTimes.className = 'times-select';
        const optIn = document.createElement('option');
        optIn.textContent = `Time In: ${timeIn || ''}`;
        const optOut = document.createElement('option');
        optOut.textContent = `Time Out: ${timeOut || ''}`;
        selTimes.appendChild(optIn);
        selTimes.appendChild(optOut);
        tdTimes.appendChild(selTimes);

        // status cell (index 4)
        const tdStatus = document.createElement('td');
        const selStatus = document.createElement('select');
        selStatus.className = 'status-select';
        ['Present', 'Late', 'Absent', 'Excused'].forEach(st => {
          const o = document.createElement('option');
          o.value = st;
          o.textContent = st;
          if (st === status) o.selected = true;
          selStatus.appendChild(o);
        });
        tdStatus.appendChild(selStatus);

        tr.appendChild(tdChk);
        tr.appendChild(tdMeta);
        tr.appendChild(tdFull);
        tr.appendChild(tdTimes);
        tr.appendChild(tdStatus);

        return tr;
      }

      // show panel helper
      function showAddPanel() {
        if (!addPanel) return;
        addPanel.style.display = 'flex';
        addPanel.classList.add('active');
        // ensure section field visibility matches current select state
        try { updateSectionFieldVisibility(); } catch (e) { /* ignore */ }
        const fn = document.getElementById('student-fullname');
        if (fn) fn.focus();
      }
      function hideAddPanel() {
        if (!addPanel) return;
        addPanel.style.display = 'none';
        addPanel.classList.remove('active');
      }

      // attach open button (the "add Student" button)
      const addStudentBtn = document.getElementById('add-student');
      if (addStudentBtn && addPanel) {
        addStudentBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          showAddPanel();
        });
      }

      // helper: ensure all relevant tables update after a new row is added
      async function ensureTablesUpdate(rowObj) {
        // Preferred: update canonical store (so controller + subscribed views re-render)
        try {
          const mod = await import('./attendanceStore.js');
          const store = mod.default;
          if (store) {
            if (typeof store.addRow === 'function') {
              try { await store.addRow(rowObj); } catch (e) { /* ignore */ }
            }
            if (typeof store.refreshAttendance === 'function') {
              try { await store.refreshAttendance(); } catch (e) { /* ignore */ }
            }
            // now trigger view renders that read from the store
            try {
              const t = await import('./todayAttendanceView.js');
              if (t && typeof t.renderTodayAttendance === 'function') t.renderTodayAttendance();
            } catch (e) { /* ignore */ }
            try {
              const r = await import('./recentStudentsView.js');
              if (r && typeof r.renderRecentStudents === 'function') r.renderRecentStudents();
            } catch (e) { /* ignore */ }
            try {
              const m = await import('./mostPresentView.js');
              if (m && typeof m.renderMostPresent === 'function') m.renderMostPresent();
            } catch (e) { /* ignore */ }
            try {
              const s = await import('./todayAttendanceSectionView.js');
              if (s && typeof s.renderAttendanceSections === 'function') s.renderAttendanceSections();
            } catch (e) { /* ignore */ }

            // refresh calendar-specific view if present
            try {
              if (window.calendarAttendance && typeof window.calendarAttendance.renderSelectedDateAttendance === 'function') {
                window.calendarAttendance.renderSelectedDateAttendance(new Date());
              }
            } catch (e) { /* ignore */ }

            // ensure section <select> elements reflect latest store data
            try {
              const ctrl = await import('./dashboardController.js');
              if (ctrl && typeof ctrl.populateSectionSelects === 'function') ctrl.populateSectionSelects();
            } catch (e) { /* ignore */ }

            return;
          }
        } catch (e) { /* ignore store import errors */ }

        // Fallback: update DOM tables directly when store / views unavailable
        try {
          const viewMod = await import('./todayAttendanceView.js');
          const html = (viewMod && typeof viewMod.buildRowHtml === 'function') ? viewMod.buildRowHtml(rowObj) : null;
          const tbody = document.getElementById('attendance-tbody');
          if (html && tbody) tbody.insertAdjacentHTML('beforeend', html);
          else if (tbody) {
            const tr = createAttendanceRow({
              id: rowObj.id,
              fullname: rowObj.student_fullname || rowObj.fullname || '',
              section: rowObj.section || ''
            });
            tbody.appendChild(tr);
          }

          // update section table (attendance-section-tbody) - increment/create section row
          const secTbody = document.getElementById('attendance-section-tbody');
          if (secTbody && rowObj.section) {
            const sec = String(rowObj.section).trim();
            let secRow = Array.from(secTbody.querySelectorAll('tr')).find(r => (r.dataset && r.dataset.section || '').toLowerCase() === sec.toLowerCase() || (r.children[0] && r.children[0].textContent.trim().toLowerCase() === sec.toLowerCase()));
            if (!secRow) {
              secRow = document.createElement('tr');
              secRow.dataset.section = sec;
              const tdSec = document.createElement('td');
              tdSec.textContent = sec;
              const tdCount = document.createElement('td');
              tdCount.textContent = '1';
              secRow.appendChild(tdSec);
              secRow.appendChild(tdCount);
              secTbody.appendChild(secRow);
            } else {
              try {
                const cntCell = secRow.children[1];
                const cnt = Number(cntCell && cntCell.textContent) || 0;
                if (cntCell) cntCell.textContent = String(cnt + 1);
              } catch (e) { /* ignore */ }
            }
          }

          // update recent students table (prepend)
          try {
            const recentTbody = document.getElementById('recent-students-tbody');
            if (recentTbody) {
              const tr = document.createElement('tr');
              tr.setAttribute('data-id', rowObj.id);
              const tdName = document.createElement('td'); tdName.textContent = rowObj.student_fullname || rowObj.fullname || '';
              const tdTime = document.createElement('td'); tdTime.textContent = new Date(rowObj.time_in || rowObj.timestamp || Date.now()).toLocaleString();
              const tdSec = document.createElement('td'); tdSec.textContent = rowObj.section || '';
              tr.appendChild(tdName); tr.appendChild(tdTime); tr.appendChild(tdSec);
              // insert at start
              if (recentTbody.firstChild) recentTbody.insertBefore(tr, recentTbody.firstChild);
              else recentTbody.appendChild(tr);
            }
          } catch (e) { /* ignore */ }

          // update most-present - best-effort: refresh if function present
          try {
            const mp = await import('./mostPresentView.js');
            if (mp && typeof mp.renderMostPresent === 'function') mp.renderMostPresent();
          } catch (e) { /* ignore */ }

          // update calendar-specific tbody if present
          try {
            const specTbody = document.getElementById('attendance-specDate-tbody');
            if (specTbody) {
              const tr = document.createElement('tr');
              tr.setAttribute('data-id', rowObj.id);
              const tdName = document.createElement('td'); tdName.textContent = rowObj.student_fullname || rowObj.fullname || '';
              const tdSec = document.createElement('td'); tdSec.textContent = rowObj.section || '';
              const tdStatus = document.createElement('td'); tdStatus.textContent = rowObj.status || '';
              const tdTime = document.createElement('td'); tdTime.textContent = new Date(rowObj.time_in || rowObj.timestamp || Date.now()).toLocaleString();
              tr.appendChild(tdName); tr.appendChild(tdSec); tr.appendChild(tdStatus); tr.appendChild(tdTime);
              if (specTbody.firstChild) specTbody.insertBefore(tr, specTbody.firstChild);
              else specTbody.appendChild(tr);
            }
          } catch (e) { /* ignore */ }
        } catch (e) {
          console.warn('ensureTablesUpdate fallback failed', e);
        }
      }

      // Section selection for Add Student panel: toggle student-section input visibility
      const sectionSelectAdd = document.querySelector('select[name="section-attendance-add"]') || document.querySelector('.select-box-add');
      const sectionInput = document.getElementById('student-section');
      const sectionLabel = document.querySelector('label[for="student-section"]');

      function updateSectionFieldVisibility() {
        if (!sectionSelectAdd || !sectionInput) return;
        const val = String(sectionSelectAdd.value || '').trim();
        if (val === 'new') {
          if (sectionLabel) sectionLabel.style.display = 'block';
          sectionInput.style.display = 'block';
          sectionInput.required = true;
          sectionInput.value = '';
        } else {
          if (sectionLabel) sectionLabel.style.display = 'none';
          sectionInput.style.display = 'none';
          // set the hidden input value to the selected option's display text (so form still submits a section)
          const optText = (sectionSelectAdd.options && sectionSelectAdd.selectedIndex >= 0) ? sectionSelectAdd.options[sectionSelectAdd.selectedIndex].text : val;
          sectionInput.value = optText || val;
          sectionInput.required = false;
        }
      }

      if (sectionSelectAdd) {
        sectionSelectAdd.addEventListener('change', () => updateSectionFieldVisibility());
      }

      // ensure initial visibility reflects current selection when opening the panel
      updateSectionFieldVisibility();

      if (addForm && tbody) {
        addForm.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const fnEl = document.getElementById('student-fullname');
          const unEl = document.getElementById('student-username');
          const secEl = document.getElementById('student-section');
          const fullname = sanitize(fnEl && fnEl.value);
          const username = sanitize(unEl && unEl.value);
          const section = sanitize(secEl && secEl.value);
          if (!fullname || !username || !section) {
            showNotice('Missing fields', 'Please fill fullname, username and section');
            return;
          }

          // Prepare minimal attendance payload
          // include role by default to satisfy backend expectations
          const payload = { fullname, username, section, role: 'student', status: 'Present', time_in: new Date().toISOString() };

          // Try to persist via attendyAPI.recordAttendance first.
          let savedOnServer = false;
          let returnedId = null;
          let serverRow = null;
          try {
            if (window.attendyAPI && typeof window.attendyAPI.recordAttendance === 'function') {
              const res = await window.attendyAPI.recordAttendance(payload);
              // handle common response shapes
              const row = (res && (res.data || res.row)) ? (res.data || res.row) : res;
              serverRow = row || null;
              returnedId = row && (row.id || row._id || row.user_id || row.attendance_id) ? (row.id || row._id || row.user_id || row.attendance_id) : (res && res.id ? res.id : null);
              savedOnServer = true;
            }
          } catch (e) {
            console.warn('recordAttendance failed; falling back to local-only add', e);
            savedOnServer = false;
            returnedId = null;
            serverRow = null;
          }

          // If server saved, refresh attendance store (preferred) so all views update from canonical source.
          if (savedOnServer) {
            try {
              const mod = await import('./attendanceStore.js');
              const store = mod.default;
              if (store) {
                if (typeof store.refreshAttendance === 'function') {
                  try {
                    const res = await store.refreshAttendance();
                    if (res && res.changed === true) {
                      // store refreshed - manually trigger renders because refreshAttendance does not emit change
                      try { const t = await import('./todayAttendanceView.js'); if (t && typeof t.renderTodayAttendance === 'function') t.renderTodayAttendance(); } catch (e) { /* ignore */ }
                      try { const r = await import('./recentStudentsView.js'); if (r && typeof r.renderRecentStudents === 'function') r.renderRecentStudents(); } catch (e) { /* ignore */ }
                      try { const m = await import('./mostPresentView.js'); if (m && typeof m.renderMostPresent === 'function') m.renderMostPresent(); } catch (e) { /* ignore */ }
                      try { const s = await import('./todayAttendanceSectionView.js'); if (s && typeof s.renderAttendanceSections === 'function') s.renderAttendanceSections(); } catch (e) { /* ignore */ }
                      try { if (window.calendarAttendance && typeof window.calendarAttendance.renderSelectedDateAttendance === 'function') window.calendarAttendance.renderSelectedDateAttendance(new Date()); } catch (e) { /* ignore */ }

                      // ensure section selects update
                      try {
                        const ctrl = await import('./dashboardController.js');
                        if (ctrl && typeof ctrl.populateSectionSelects === 'function') ctrl.populateSectionSelects();
                      } catch (e) { /* ignore */ }

                      addForm.reset();
                      try { updateSectionFieldVisibility(); } catch (e) { }
                      hideAddPanel();
                      try { updateDownloadState(); } catch (e) { /* ignore */ }
                      const searchInput = document.querySelector('.attendance-table-container .search-input');
                      if (searchInput && searchInput.value) {
                        try { searchInput.dispatchEvent(new Event('input')); } catch (e) { /* ignore */ }
                      }
                      return;
                    }
                    // if refresh did not report changes, fall through to try adding the server row to cache
                  } catch (e) { /* ignore refresh errors and fall through */ }
                }

                // if we have the server row, insert it into the local store so subscribers trigger
                if (serverRow && typeof store.addRow === 'function') {
                  try { await store.addRow(serverRow); } catch (e) { /* ignore */ }
                  // force view renders as a safety-net
                  try { const t = await import('./todayAttendanceView.js'); if (t && typeof t.renderTodayAttendance === 'function') t.renderTodayAttendance(); } catch (e) { }
                  try { const r = await import('./recentStudentsView.js'); if (r && typeof r.renderRecentStudents === 'function') r.renderRecentStudents(); } catch (e) { }
                  try { const m = await import('./mostPresentView.js'); if (m && typeof m.renderMostPresent === 'function') m.renderMostPresent(); } catch (e) { }
                  try { const s = await import('./todayAttendanceSectionView.js'); if (s && typeof s.renderAttendanceSections === 'function') s.renderAttendanceSections(); } catch (e) { }

                  // ensure section selects update after manual render
                  try {
                    const ctrl = await import('./dashboardController.js');
                    if (ctrl && typeof ctrl.populateSectionSelects === 'function') ctrl.populateSectionSelects();
                  } catch (e) { /* ignore */ }

                  addForm.reset();
                  try { updateSectionFieldVisibility(); } catch (e) { }
                  hideAddPanel();
                  try { updateDownloadState(); } catch (e) { /* ignore */ }
                  const searchInput = document.querySelector('.attendance-table-container .search-input');
                  if (searchInput && searchInput.value) {
                    try { searchInput.dispatchEvent(new Event('input')); } catch (e) { /* ignore */ }
                  }
                  return;
                }
              }
            } catch (e) {
              // if store not available, fall back to appending a row locally using returnedId
              console.warn('attendanceStore.refreshAttendance failed', e);
            }
          }

          // Fallback: no backend or store not present — append a local row and attempt best-effort store update
          const id = returnedId || nextGeneratedId++;

          // try to reuse today's view row builder for consistent markup
          try {
            const viewMod = await import('./todayAttendanceView.js');
            const rowObj = {
              id,
              student_fullname: fullname,
              student_username: username,
              section,
              status: 'Present',
              time_in: new Date().toISOString()
            };
            if (viewMod && typeof viewMod.buildRowHtml === 'function') {
              tbody.insertAdjacentHTML('beforeend', viewMod.buildRowHtml(rowObj));
            } else {
              const tr = createAttendanceRow({ id, fullname, section });
              tbody.appendChild(tr);
            }

            // ensure other tables / store are updated
            try { await ensureTablesUpdate(rowObj); } catch (e) { /* ignore */ }
          } catch (e) {
            // fallback to DOM builder if view import fails
            const tr = createAttendanceRow({ id, fullname, section });
            tbody.appendChild(tr);
            try { await ensureTablesUpdate({ id, student_fullname: fullname, student_username: username, section, status: 'Present', time_in: new Date().toISOString() }); } catch (e) { /* ignore */ }
          }

          // reset form and hide panel
          addForm.reset();
          try { updateSectionFieldVisibility(); } catch (e) { }
          hideAddPanel();

          // attempt to update local store cache if available
          try {
            const mod2 = await import('./attendanceStore.js');
            const store2 = mod2.default;
            if (typeof store2.addRow === 'function') {
              try { await store2.addRow({ id, student_fullname: fullname, section, status: 'Present', time_in: new Date().toISOString() }); } catch (e) { /* ignore */ }
            } else if (typeof store2.refreshAttendance === 'function') {
              try { await store2.refreshAttendance(); } catch (e) { /* ignore */ }
            }
          } catch (e) { /* ignore */ }

          // ensure download state / search re-apply
          try { updateDownloadState(); } catch (e) { /* ignore */ }
          const searchInput = document.querySelector('.attendance-table-container .search-input');
          if (searchInput && searchInput.value) {
            try { searchInput.dispatchEvent(new Event('input')); } catch (e) { /* ignore */ }
          }
        }, { passive: false });
      }

      if (cancelAddBtn && addPanel) {
        cancelAddBtn.addEventListener('click', (ev) => {
          ev.preventDefault();
          hideAddPanel();
        });
      }

      // clicking on overlay (outside the card) closes panel
      if (addPanel) {
        addPanel.addEventListener('click', (ev) => {
          if (ev.target === addPanel) hideAddPanel();
        });
      }
      // escape closes panel
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') hideAddPanel();
      });
    })();

    // Right-click menu handling for table rows
    const rMenu = document.getElementById('R-clk-menu');
    // remember the row id that was toggled/opened by the context menu
    let lastContextRowId = null;
    // right-clicking a row should also toggle its selection checkbox
    const attendanceTbodyEl = document.getElementById('attendance-tbody');
    if (attendanceTbodyEl) {
      attendanceTbodyEl.addEventListener('contextmenu', (ev) => {
        try {
          const tr = ev.target && ev.target.closest ? ev.target.closest('tr') : null;
          if (!tr) return;
          const cb = tr.querySelector && tr.querySelector('.row-select');
          if (!cb) return;
          const newId = Number(tr.getAttribute('data-id')) || null;
          // if another row was previously context-selected, uncheck it first
          try {
            if (lastContextRowId && lastContextRowId !== newId) {
              const prevCb = document.querySelector(`#attendance-tbody .row-select[data-id="${lastContextRowId}"]`);
              if (prevCb) {
                prevCb.checked = false;
                try { prevCb.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* ignore */ }
              }
            }
          } catch (e) { /* ignore */ }

          // ensure current checkbox is checked (do NOT uncheck when right-clicking the same row)
          try {
            const wasChecked = !!cb.checked;
            if (!wasChecked) {
              cb.checked = true;
              try { cb.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* ignore */ }
            }
            // remember which row was toggled/selected by the context menu (keep set even if already checked)
            try { lastContextRowId = newId; } catch (e) { lastContextRowId = null; }
          } catch (e) { /* ignore */ }
        } catch (e) { /* ignore */ }
      });
    }
    function hideRMenu(opts = {}) {
      if (!rMenu) return;
      // if caller indicates this was an outside click, uncheck the previously toggled row
      try {
        if (opts.uncheckContextRow && lastContextRowId) {
          const cb = document.querySelector(`#attendance-tbody .row-select[data-id="${lastContextRowId}"]`);
          if (cb) {
            cb.checked = false;
            try { cb.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* ignore */ }
          }
        }
      } catch (e) { /* ignore */ }
      rMenu.style.display = 'none';
      rMenu.innerHTML = '';
      lastContextRowId = null;
    }


    function posMenu(x, y) {
      if (!rMenu) return;
      rMenu.style.left = x + 'px';
      rMenu.style.top = y + 'px';
      rMenu.style.display = 'block';
    }

    async function buildMenuFor(tbodyId, tr) {
      if (!rMenu || !tr) return;
      const id = Number(tr.getAttribute('data-id')) || null;
      // fetch store row if available
      let storeRow = null;
      try {
        const mod = await import('./attendanceStore.js');
        const store = mod.default;
        if (id && typeof store._internals === 'function') {
          // try to read cache via public methods
          const rows = store.getTodayRows().concat(store.getRecent ? store.getRecent(50) : []);
          storeRow = rows.find(r => Number(r.id) === id) || null;
        }
      } catch (e) { /* ignore */ }

      const makeBtn = (txt, cls) => `<button class="rcm-btn ${cls}">${txt}</button>`;
      let html = '';

      if (tbodyId === 'new-added-students' && id) {
        html += makeBtn('Delete', 'delete');
        html += makeBtn('Check Info', 'info');
      } else if (tbodyId === 'attendance-specDate-tbody' && id) {
        html += makeBtn('Delete', 'delete');
        html += makeBtn('Edit', 'edit');
        html += makeBtn('Check Info', 'info');
      } else if (tbodyId === 'attendance-tbody' && id) {
        html += makeBtn('Edit', 'edit');
        html += makeBtn('Delete', 'delete');
        html += makeBtn('Check Info', 'info');
      } else if (tbodyId === 'recent-students-tbody' && id) {
        // recent students list: minimal options
        html += makeBtn('Delete', 'delete');
        html += makeBtn('Check Info', 'info');
      } else if (!html && id) {
        // fallback for other tbodies that contain row data
        html += makeBtn('Delete', 'delete');
        html += makeBtn('Check Info', 'info');
      }

      if (!html) {
        rMenu.innerHTML = '';
        return false;
      }

      rMenu.innerHTML = html;

      // attach listeners
      rMenu.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', async (ev) => {
          const cls = btn.className || '';
          hideRMenu();
          try {
            const mod = await import('./attendanceStore.js');
            const store = mod.default;
            if (cls.includes('delete')) {
              // replace confirm dialog with deletion panel
              showDeletionNotice(id ? [id] : [], async (idsToDelete) => {
                if (!idsToDelete.length) return;
                if (id) await store.deleteRow(idsToDelete[0]);
              });
              return;
            }
            if (cls.includes('info')) {
              // show quick info
              const text = storeRow ? JSON.stringify(storeRow, null, 2) : (tr ? tr.textContent : 'No info');
              showNotice('Row Info', text);
              return;
            }
            if (cls.includes('set-status')) {
              const status = prompt('Enter status (Present/Late/Excused/Absent):  ');
              if (!status) return;
              if (id) await store.updateStatus(id, status);
              return;
            }
            if (cls.includes('set-timeout')) {
              try {
                const existing = tr && tr.querySelector && tr.querySelector('.times-select');
                let defaultTime = '';
                if (existing) {
                  const opt = existing.options && existing.options[1] && existing.options[1].textContent || '';
                  defaultTime = opt.replace(/^[^0-9]*/, '').trim();
                }
                showEditPanel(tr);
                if (typeof editTimeOut !== 'undefined' && editTimeOut) { editTimeOut.value = parseTimeToHHMM(defaultTime) || ''; editTimeOut.focus(); }
              } catch (e) { /* ignore */ }
              return;
            }
            if (cls.includes('set-timein')) {
              try {
                const existing = tr && tr.querySelector && tr.querySelector('.times-select');
                let defaultTime = '';
                if (existing) {
                  const opt = existing.options && existing.options[0] && existing.options[0].textContent || '';
                  defaultTime = opt.replace(/^[^0-9]*/, '').trim();
                }
                showEditPanel(tr);
                if (typeof editTimeIn !== 'undefined' && editTimeIn) { editTimeIn.value = parseTimeToHHMM(defaultTime) || ''; editTimeIn.focus(); }
              } catch (e) { /* ignore */ }
              return;
            }
            if (cls.includes('edit')) {
              // open full edit panel instead of prompt
              try { showEditPanel(tr); } catch (e) { /* ignore */ }
              return;
            }
          } catch (e) {
            console.error('right-click action failed', e);
          }
        });
      });
      return true;
    }

    // global contextmenu handler - delegate to rows
    document.addEventListener('contextmenu', (ev) => {
      const tr = ev.target.closest && ev.target.closest('tr');
      if (!tr) { hideRMenu(); return; }
      const tbody = tr.closest && tr.closest('tbody');
      if (!tbody) { hideRMenu(); return; }
      const tbid = tbody.id;
      ev.preventDefault();
      buildMenuFor(tbid, tr).then((show) => {
        if (show) posMenu(ev.pageX, ev.pageY);
        else hideRMenu();
      }).catch(() => hideRMenu());
    });

    // hide on any click outside; if hiding due to outside click, uncheck the context-row
    document.addEventListener('click', (ev) => {
      if (!rMenu) return;
      if (ev.target.closest && ev.target.closest('#R-clk-menu')) return;
      hideRMenu({ uncheckContextRow: true });
    });

    // Update student counts when a section is selected
    async function updateCountsForSelectedSection() {
      try {
        const sel = document.querySelector('select[name="section-attendance"], select.select-box');
        const totalEl = document.getElementById('student-total');
        const presentEl = document.getElementById('student-present');
        const absentEl = document.getElementById('student-absent');
        const lateEl = document.getElementById('student-late');
        if (!totalEl || !presentEl || !absentEl || !lateEl) return;
        const value = sel ? (sel.value || 'all') : 'all';

        // get today's rows from store
        let rows = [];
        try {
          const mod = await import('./attendanceStore.js');
          const store = mod.default;
          if (store && typeof store.getTodayRows === 'function') rows = store.getTodayRows();
        } catch (e) {
          // ignore
        }

        // filter rows by section and compute latest per student
        const seen = new Map();
        for (const r of rows) {
          const sec = (r.student_section || r.section || r.section_name || '').toString().trim();
          if (value !== 'all' && sec.toLowerCase() !== String(value).toLowerCase()) continue;
          const key = ((r.student_username || r.student_fullname) || '').toString().trim().toLowerCase();
          if (!key) continue;
          if (!seen.has(key)) seen.set(key, r); // rows are newest-first in store
        }

        const counts = { total: seen.size, present: 0, absent: 0, late: 0 };
        for (const r of seen.values()) {
          const s = (r.status || '').toString().toLowerCase();
          if (s === 'present') counts.present += 1;
          else if (s === 'late') counts.late += 1;
          else if (s === 'absent') counts.absent += 1;
        }

        totalEl.textContent = String(counts.total);
        presentEl.textContent = String(counts.present);
        absentEl.textContent = String(counts.absent);
        lateEl.textContent = String(counts.late);
      } catch (e) { /* ignore */ }
    }

    // Attach change handlers and subscribe to store updates
    (function attachSectionHandlers() {
      try {
        const selects = Array.from(document.querySelectorAll('select[name="section-attendance"], select.select-box'));
        for (const sel of selects) {
          sel.addEventListener('change', () => {
            const v = sel.value || 'all';
            updateCountsForSelectedSection().catch(() => { });
            // re-render filtered lists
            import('./recentStudentsView.js').then(m => { if (m && typeof m.renderRecentStudents === 'function') m.renderRecentStudents(v).catch?.(() => { }); }).catch(() => { });
            import('./mostPresentView.js').then(m => { if (m && typeof m.renderMostPresent === 'function') m.renderMostPresent(v).catch?.(() => { }); }).catch(() => { });
          });
        }
        // initial compute + render
        updateCountsForSelectedSection().catch(() => { });
        const curSel = (selects[0] && selects[0].value) ? selects[0].value : 'all';
        import('./recentStudentsView.js').then(m => { if (m && typeof m.renderRecentStudents === 'function') m.renderRecentStudents(curSel).catch?.(() => { }); }).catch(() => { });
        import('./mostPresentView.js').then(m => { if (m && typeof m.renderMostPresent === 'function') m.renderMostPresent(curSel).catch?.(() => { }); }).catch(() => { });
        // subscribe to store changes
        import('./attendanceStore.js').then(mod => {
          const store = mod.default;
          if (store && typeof store.subscribe === 'function') {
            try { store.subscribe(() => { updateCountsForSelectedSection().catch(() => { }); const sel = selects[0] && selects[0].value || 'all'; import('./recentStudentsView.js').then(m => { if (m && typeof m.renderRecentStudents === 'function') m.renderRecentStudents(sel).catch?.(() => { }); }).catch(() => { }); import('./mostPresentView.js').then(m => { if (m && typeof m.renderMostPresent === 'function') m.renderMostPresent(sel).catch?.(() => { }); }).catch(() => { }); }); } catch (e) { /* ignore */ }
          }
        }).catch(() => { });
      } catch (e) { /* ignore */ }
    })();

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') hideRMenu();
    });
  });
})();

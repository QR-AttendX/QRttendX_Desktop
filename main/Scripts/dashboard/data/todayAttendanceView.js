import attendanceStore from './attendanceStore.js';
import { renderAttendanceSections } from './todayAttendanceSectionView.js';

let _lastFingerprint = '';
let _eventsAttached = false;
let _subscribed = false;

function _formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return String(ts);
  // produce 12-hour time without a space before AM/PM, e.g. "10:50PM"
  const s = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  return s.replace(/\s+/g, '');
}

function _buildRowHtml(r) {
  const fullname = r.student_fullname || r.student_username || '';
  const status = r.status || '';
  const timestampIN = r.time_in || r.timestamp || '';
  const timestampOUT = r.time_out ? _formatTime(r.time_out) : '';
  const rowSection = (r.student_section || r.section || r.section_name || r.section_attendance || '') || '';
  return `
    <label for="row-select-${r.id}">
    <tr data-id="${r.id}" data-username="${(r.student_username || r.username || '')}" data-section="${rowSection}">
      <td class="row-checkbox-cell"><input id="row-select-${r.id}" type="checkbox" class="row-select" data-id="${r.id}"></td>
      <td class="fullname-cell">${fullname}</td>
      <td class="time-in-cell">${timestampIN ? _formatTime(timestampIN) : 'Not Set'}</td>
      <td class="time-out-cell">${timestampOUT || 'Not Set'}</td>
      <td class="status-cell">
        <select class="status-select">
          <option value="Present" ${status === 'Present' ? 'selected' : ''}>Present</option>
          <option value="Late" ${status === 'Late' ? 'selected' : ''}>Late</option>
          <option value="Excused" ${status === 'Excused' ? 'selected' : ''}>Excused</option>
          <option value="Absent" ${status === 'Absent' ? 'selected' : ''}>Absent</option>
        </select>
      </td>
    </tr>
</label>

    `;
}

function _attachEvents(tbody) {
  if (_eventsAttached) return;
  _eventsAttached = true;

  // delegated click for delete
  tbody.addEventListener('click', async (ev) => {
    const btn = ev.target.closest && ev.target.closest('.trash-btn');
    if (!btn) return;
    const id = Number(btn.getAttribute('data-id'));
    if (!id) return;
    try {
      await attendanceStore.deleteRow(id);
      // remove row immediately for instant feedback
      try {
        const tr = document.querySelector(`tr[data-id="${id}"]`);
        if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
      } catch (e) { }
      // store will emit change; controller will re-render lists
      try { renderTodayAttendance(); } catch (e) { }
      try { renderAttendanceSections(); } catch (e) { }
    } catch (e) {
      console.warn('delete failed', e);
    }
  });

  // delegated change for status selects
  tbody.addEventListener('change', async (ev) => {
    const sel = ev.target.closest && ev.target.closest('.status-select') || (ev.target.classList && ev.target.classList.contains('status-select') && ev.target);
    if (!sel) return;
    const tr = sel.closest('tr');
    if (!tr) return;
    const id = Number(tr.getAttribute('data-id'));
    const newStatus = sel.value;
    try {
      await attendanceStore.updateStatus(id, newStatus);
      // update status text cell
      const stEl = tr.querySelector('.status-text');
      if (stEl) stEl.textContent = newStatus;
      // update counts
      const counts = attendanceStore.getTodayCounts();
      const elTotal = document.getElementById('student-total');
      const elPresent = document.getElementById('student-present');
      const elAbsent = document.getElementById('student-absent');
      const elLate = document.getElementById('student-late');
      if (elTotal) elTotal.textContent = String(counts.total);
      if (elPresent) elPresent.textContent = String(counts.present);
      if (elAbsent) elAbsent.textContent = String(counts.absent);
      if (elLate) elLate.textContent = String(counts.late);
      // update per-section counts as well
      try { renderAttendanceSections(); } catch (e) { }
    } catch (e) {
      console.warn('status update failed', e);
    }
  });

  // delegated change for row-select checkboxes: toggle visual highlight
  tbody.addEventListener('change', (ev) => {
    try {
      const cb = ev.target.closest && ev.target.closest('.row-select') || (ev.target.classList && ev.target.classList.contains('row-select') && ev.target);
      if (!cb) return;
      const tr = cb.closest && cb.closest('tr');
      if (!tr) return;
      if (cb.checked) tr.classList.add('row-selected'); else tr.classList.remove('row-selected');
    } catch (e) { /* ignore */ }
  });

  // delegated click on row toggles the checkbox (but ignore clicks on interactive elements)
  tbody.addEventListener('click', (ev) => {
    try {
      const tr = ev.target.closest && ev.target.closest('tr');
      if (!tr) return;
      // ignore clicks directly on inputs, selects, links, or buttons
      if (ev.target.closest && (ev.target.closest('input') || ev.target.closest('select') || ev.target.closest('a') || ev.target.closest('button') || ev.target.closest('.trash-btn'))) return;
      const cb = tr.querySelector('.row-select');
      if (!cb) return;
      cb.checked = !cb.checked;
      // emit change event on checkbox so any listeners update
      try { cb.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
  });
}

// subscribe to store changes to ensure view stays in sync
try {
  if (!_subscribed && attendanceStore && typeof attendanceStore.subscribe === 'function') {
    attendanceStore.subscribe(() => {
      try { renderTodayAttendance(); } catch (e) { }
      try { renderAttendanceSections(); } catch (e) { }
    });
    _subscribed = true;
  }
} catch (e) { }

export function renderTodayAttendance() {
  const tbody = document.getElementById('attendance-tbody');
  if (!tbody) return;
  const rows = attendanceStore.getTodayRows();

  // compute cheap fingerprint for rows
  const parts = rows.map(r => `${r.id}|${(r.status || '')}|${r.timestamp || r.time_in || ''}|${r.time_out || ''}`);
  const fp = parts.join('\n');
  if (fp === _lastFingerprint) return; // nothing changed
  _lastFingerprint = fp;

  _attachEvents(tbody);

  // build html once and replace
  const html = rows.map(r => _buildRowHtml(r)).join('');
  tbody.innerHTML = html;

  // update counters
  try {
    const counts = attendanceStore.getTodayCounts();
    const elTotal = document.getElementById('student-total');
    const elPresent = document.getElementById('student-present');
    const elAbsent = document.getElementById('student-absent');
    const elLate = document.getElementById('student-late');
    if (elTotal) elTotal.textContent = String(counts.total);
    if (elPresent) elPresent.textContent = String(counts.present);
    if (elAbsent) elAbsent.textContent = String(counts.absent);
    if (elLate) elLate.textContent = String(counts.late);
  } catch (e) {
    console.warn('update counters failed', e);
  }
}
// expose build helper for other modules (used by add-student panel)
export { _buildRowHtml as buildRowHtml };

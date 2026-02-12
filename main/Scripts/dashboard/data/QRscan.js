import attendanceStore from './attendanceStore.js';
import { renderTodayAttendance } from './todayAttendanceView.js';
import { renderRecentStudents } from './recentStudentsView.js';
import { renderMostPresent } from './mostPresentView.js';
import { renderAttendanceSections } from './todayAttendanceSectionView.js';

const scanBtn = document.getElementById('scan-QR') || document.querySelector('#scan-QR');
const scannerContainer = document.querySelector('.camera-activation-container');
const result = document.getElementById('scan-result') || document.querySelector('#scan-result');
const cameraSelect = document.getElementById('camera-select') || document.querySelector('#camera-select');
const exit = document.querySelector('#close-USER');
let html5QrCode = null;

// Map to prevent duplicate handling of the same user in short time window
const _recentlyScanned = new Map(); // username -> timestamp

function startScanner() {
  if (!document.getElementById('reader')) return;
  if (html5QrCode) return; // already running
  try {
    html5QrCode = new Html5Qrcode('reader');
  } catch (e) {
    console.error('Html5Qrcode init failed', e);
    html5QrCode = null;
    return;
  }

  // choose camera: deviceId if selected, otherwise prefer back camera
  let cameraConfig = { facingMode: 'environment' };
  try {
    if (cameraSelect && cameraSelect.value) {
      cameraConfig = { deviceId: { exact: cameraSelect.value } };
    }
  } catch (e) { /* ignore */ }

  html5QrCode.start(
    cameraConfig,
    { fps: 10, qrbox: 250 },
    async (decodedText) => {
      if (result) result.textContent = 'Scan result: ' + decodedText;
      console.log('QR decoded:', decodedText);

      try {
        const txt = (decodedText || '').trim();

        // Ignore obvious URL QR codes
        if (/^https?:\/\//i.test(txt) || /^www\./i.test(txt)) {
          console.log('Ignored URL QR code');
          return;
        }

        // Parse JSON payload
        let payload;
        try {
          payload = JSON.parse(txt);
        } catch {
          console.log('QR payload not JSON, ignoring');
          return;
        }

        const fullname = (payload.fullname || '').trim();
        let username = (payload.username || '').trim();
        const role = (payload.role || '').trim();
        const section = (payload.section || '').trim();

        if (!username) return;

        // normalize username
        if (username.startsWith('@')) username = username.replace(/^@+/, '');
        const normUser = username.toLowerCase();

        const now = Date.now();

        // short-window duplicate check (prevent rapid double-scans)
        const recentTs = _recentlyScanned.get(normUser) || 0;
        if (now - recentTs < 3000) {
          console.log('Duplicate scan ignored (short window):', normUser);
          return;
        }
        _recentlyScanned.set(normUser, now);

        // Also check the shared store for an existing record for this user today.
        // If the student was deleted, the store will not contain them and the scan will proceed.
        try {
          if (typeof attendanceStore.getTodayRows === 'function') {
            const today = attendanceStore.getTodayRows();
            const nowDate = new Date();
            const isSameCalendarDay = (d1, d2) => d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();

            const exists = today.some(r => {
              // Resolve candidate username fields
              const key = (r.student_username || r.username || r.stored_username || r.student_fullname || '').toString().trim().toLowerCase();
              if (!key) return false;
              if (key !== normUser) return false;

              // Prefer explicit time fields to check calendar day
              const dateFields = [r.time_in, r.time, r.timestamp, r.created_at, r.created, r.date, r.ts];
              for (const df of dateFields) {
                if (!df) continue;
                const parsed = new Date(df);
                if (isNaN(parsed.getTime())) continue;
                if (isSameCalendarDay(parsed, nowDate)) return true;
                return false; // found a valid date but it's not today
              }

              // If no parseable date field exists, conservatively treat as not existing today
              return false;
            });
            if (exists) {
              console.log('Ignored scan — already recorded today (store):', normUser);
              return;
            }
          }
        } catch (e) {
          console.warn('store check for existing today record failed', e);
        }

        // Prepare backend payload
        const postData = { fullname, username: normUser, role, section, time_in: new Date().toISOString() };

        // DOM visual duplicate check
        const tbody = document.getElementById('new-added-students');
        let visualDuplicate = false;
        if (tbody) {
          const existing = tbody.querySelector(`tr[data-username="${CSS.escape(normUser)}"]`);
          if (existing) {
            visualDuplicate = true;
            existing.classList.add('recent-duplicate');
            setTimeout(() => existing.classList.remove('recent-duplicate'), 800);
          }
        }

        // Send to backend (use dupe handler if available)
        const doRecord = async () => {
          try {
            if (window.attendyDupe && typeof window.attendyDupe.handlePotentialDuplicate === 'function') {
              const res = await window.attendyDupe.handlePotentialDuplicate(postData);
              console.log('handlePotentialDuplicate result', res);
              // If created or used-existing, ensure store refresh/add visual row
              if (res && (res.action === 'created' || res.action === 'used-existing' || res.action === 'used-existing-today' || res.action === 'used-existing-past')) {
                try {
                  if (typeof attendanceStore.refreshAttendance === 'function') await attendanceStore.refreshAttendance();
                  else if (res.existing && attendanceStore.addRow) attendanceStore.addRow(res.existing);
                } catch (e) { /* ignore */ }
                if (!visualDuplicate && tbody) {
                  const tr = document.createElement('tr');
                  tr.dataset.username = normUser;
                  tr.innerHTML = `<td>${fullname || normUser}</td><td>${new Date().toLocaleTimeString()}</td><td>${section || ''}</td>`;
                  tbody.prepend(tr);
                }
              }
              return res;
            }

            // fallback to direct recordAttendance
            let resp;
            if (window.attendyAPI && typeof window.attendyAPI.recordAttendance === 'function') {
              resp = await window.attendyAPI.recordAttendance(postData);
            } else {
              resp = await fetch('http://localhost:5005/record_attendance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(postData)
              }).then(r => r.json());
            }

            console.log('recordAttendance response', resp);
            try {
              if (resp && (resp.row || resp)) {
                attendanceStore.addRow(resp.row || resp);
              } else if (typeof attendanceStore.refreshAttendance === 'function') {
                attendanceStore.refreshAttendance().catch(() => { });
              }
            } catch (e) { console.warn('handling recordAttendance response failed', e); }

            if (!visualDuplicate && tbody) {
              const tr = document.createElement('tr');
              tr.dataset.username = normUser;
              tr.innerHTML = `<td>${fullname || normUser}</td><td>${new Date().toLocaleTimeString()}</td><td>${section || ''}</td>`;
              tbody.prepend(tr);
            }
            return resp;
          } catch (err) { console.warn('record/dupe handler failed', err); return { error: err }; }
        };

        doRecord();

        // Cleanup old recently scanned entries
        for (const [k, ts] of _recentlyScanned.entries()) {
          if (now - ts > 5 * 60 * 1000) _recentlyScanned.delete(k);
        }

      } catch (e) {
        console.warn('Error handling decoded QR:', e);
      }
    },
    (errorMessage) => {
      // ignore scan errors
    }
  ).catch(err => {
    console.error('Camera start failed', err);
    html5QrCode = null;
  });
}

function stopScanner() {
  if (!html5QrCode) return Promise.resolve();
  return html5QrCode.stop().then(() => {
    try { html5QrCode.clear(); } catch (e) { }
    html5QrCode = null;
    if (result) result.textContent = '';
  }).catch(err => {
    console.warn('Failed to stop scanner', err);
    html5QrCode = null;
  });
}

async function populateCameras() {
  if (!cameraSelect || !window.Html5Qrcode) return;
  try {
    const devices = await Html5Qrcode.getCameras();
    cameraSelect.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.text = 'Default';
    cameraSelect.appendChild(defaultOpt);
    devices.forEach(d => {
      const o = document.createElement('option');
      o.value = d.id;
      o.text = d.label || d.id;
      cameraSelect.appendChild(o);
    });
  } catch (e) {
    console.warn('populateCameras failed', e);
  }
}

if (cameraSelect) {
  cameraSelect.addEventListener('change', () => {
    if (html5QrCode) {
      stopScanner().then(() => startScanner());
    }
  });
}

if (scanBtn) {
  scanBtn.addEventListener('click', () => {
    if (!scannerContainer) return;
    const willActivate = !scannerContainer.classList.contains('activate');
    scannerContainer.classList.toggle('activate');
    if (willActivate) startScanner();
    else stopScanner();
  });
}

if (exit) {
  exit.addEventListener('click', () => {
    if (!scannerContainer) return;
    scannerContainer.classList.toggle('activate');
    // stop scanner then refresh UI counts/tables immediately
    stopScanner().then(() => {
      // refresh store from backend then render views
      try {
        if (typeof attendanceStore.refreshAttendance === 'function') {
          attendanceStore.refreshAttendance().then(() => {
            try { renderTodayAttendance(); } catch (_) { }
            try { renderRecentStudents(); } catch (_) { }
            try { renderMostPresent(); } catch (_) { }
            try { renderAttendanceSections(); } catch (_) { }
          }).catch(() => {
            // fallback to render from existing cache
            try { renderTodayAttendance(); } catch (_) { }
            try { renderRecentStudents(); } catch (_) { }
            try { renderMostPresent(); } catch (_) { }
            try { renderAttendanceSections(); } catch (_) { }
          });
        } else {
          try { renderTodayAttendance(); } catch (_) { }
          try { renderRecentStudents(); } catch (_) { }
          try { renderMostPresent(); } catch (_) { }
        }
      } catch (e) { console.warn('refresh after close failed', e); }
    }).catch(() => { /* ignore stop failure */ });
  });
}

// Start scanner if container is already active
if (scannerContainer && scannerContainer.classList.contains('activate')) {
  startScanner();
}

// Populate camera list on load
populateCameras();

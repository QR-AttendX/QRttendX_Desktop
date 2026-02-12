const optionsCustom = document.querySelector('.acting-options');

function actingSelect() {
  optionsCustom.classList.toggle('show');
}

const settingContainer = document.querySelector('.settings-container');
const calendarContainer = document.querySelector('.calendar-container');
const attendanceContainer = document.querySelector('.student-attendance-container');
const statisticsContainer = document.querySelector('.student-statistics-container');
const dashboardContainer = document.querySelector('.dashboard-container');
const adviserContainer = document.querySelector('.adviser-container');

function closeAll() {
  if (settingContainer) settingContainer.classList.add('closed');
  if (calendarContainer) calendarContainer.classList.add('closed');
  if (attendanceContainer) attendanceContainer.classList.add('closed');
  if (statisticsContainer) statisticsContainer.classList.add('closed');
  if (dashboardContainer) dashboardContainer.classList.add('closed');
  if (adviserContainer) adviserContainer.classList.add('closed');
}

function showContainerForHash(hash) {
  closeAll();
  switch ((hash || '').toString().toLowerCase()) {
    case '#settings':
      if (settingContainer) settingContainer.classList.remove('closed');
      break;
    case '#calendar':
      if (calendarContainer) calendarContainer.classList.remove('closed');
      break;
    case '#attendance':
      if (attendanceContainer) attendanceContainer.classList.remove('closed');
      break;
    case '#statistics':
      if (statisticsContainer) statisticsContainer.classList.remove('closed');
      break;
    case '#adviser':
      if (adviserContainer) adviserContainer.classList.remove('closed');
      break;
    case '#dashboard':
    default:
      if (dashboardContainer) dashboardContainer.classList.remove('closed');
      break;
  }
  // keep QR panel visibility in sync with current container/sidebar state
  try {
    if (typeof updateQRcontainerVisibility === 'function') updateQRcontainerVisibility();
  } catch (e) { /* ignore if helper not available */ }
}

// respond to hash changes (keeps behavior consistent with sidebar.js)
window.addEventListener('hashchange', () => {
  showContainerForHash(window.location.hash);
});

// initialize on load
document.addEventListener('DOMContentLoaded', () => {
  showContainerForHash(window.location.hash || '#dashboard');
});

// Make profile-info buttons navigate to settings and close sidebar
document.addEventListener('DOMContentLoaded', () => {
  const navToSettings = (e) => {
    e?.preventDefault();
    // update hash to trigger existing handlers
    window.location.hash = '#settings';
    // ensure settings container shows immediately
    try { showContainerForHash('#settings'); } catch (e) { }
    // close sidebar and hide labels
    const sidebar = document.getElementById('side-bar');
    const toggleButton = document.getElementById('toggle-btn');
    const sub = document.querySelector('.sub');
    const sub2 = document.querySelector('.sub2');
    if (sidebar && !sidebar.classList.contains('close')) sidebar.classList.add('close');
    if (toggleButton && !toggleButton.classList.contains('rotate')) toggleButton.classList.add('rotate');
    if (sub) sub.classList.add('hide-text');
    if (sub2) sub2.classList.add('hide-text');
    // close any opened sub-menus
    if (sidebar) {
      Array.from(sidebar.getElementsByClassName('show')).forEach(ul => {
        ul.classList.remove('show');
        if (ul.previousElementSibling) ul.previousElementSibling.classList.remove('rotate');
      });
    }
    // update active nav if available
    if (typeof setActiveNav === 'function') setActiveNav();
    // ensure QR visibility updates after collapsing sidebar
    try {
      if (typeof updateQRcontainerVisibility === 'function') updateQRcontainerVisibility();
    } catch (e) { /* ignore */ }
  };

  document.querySelectorAll('#opn-pf-info').forEach(btn => {
    btn.addEventListener('click', navToSettings);
  });
});



// Notification panel logic
document.addEventListener('DOMContentLoaded', () => {
  const ntfPanel = document.getElementById('ntf-panel');
  const ntfList = document.getElementById('ntf-list');
  const noNtf = document.getElementById('no-ntf');
  const notificationBtns = Array.from(document.querySelectorAll('.notification-btn'));

  if (!ntfPanel || !ntfList || !noNtf) return;

  // update visibility of "no notifications" text
  function updateNtfVisibility() {
    const hasNotifications = Array.from(ntfList.children).some(n => n.nodeType === 1 && n.textContent.trim() !== '');
    noNtf.style.display = hasNotifications ? 'none' : 'block';
  }

  // position panel directly under button
  function positionPanelUnderButton(btn) {
    if (!btn) return;
    const btnRect = btn.getBoundingClientRect();
    const panelWidth = ntfPanel.offsetWidth;
    const panelHeight = ntfPanel.offsetHeight;

    const viewportLeft = window.scrollX;
    const viewportRight = window.scrollX + window.innerWidth;
    const viewportBottom = window.scrollY + window.innerHeight;

    // Preferred: place the panel to the LEFT of the button
    let left = Math.round(btnRect.left + window.scrollX - panelWidth - 8); // 8px gap to the left
    // Vertical position remains below the button by default
    let top = Math.round(btnRect.bottom + window.scrollY + 8);

    // If placing to the left would overflow on the left, try placing to the RIGHT of the button
    if (left < viewportLeft + 8) {
      const rightCandidate = Math.round(btnRect.right + window.scrollX + 8);
      if (rightCandidate + panelWidth <= viewportRight - 8) {
        left = rightCandidate;
      } else {
        // Neither side fits fully: clamp within viewport (prefer left edge)
        left = Math.max(viewportLeft + 8, viewportRight - panelWidth - 8);
      }
    }

    // If panel would go below viewport, try placing above the button
    if (top + panelHeight > viewportBottom - 8) {
      const altTop = Math.round(btnRect.top + window.scrollY - panelHeight - 8);
      if (altTop > window.scrollY + 8) top = altTop;
      else {
        // clamp vertically so panel stays mostly visible
        top = Math.max(window.scrollY + 8, viewportBottom - panelHeight - 8);
      }
    }

    ntfPanel.style.left = `${left}px`;
    ntfPanel.style.top = `${top}px`;
  }

  // toggle panel show/hide, optionally anchored to btn
  function toggleNtfPanel(anchorBtn) {
    const isShown = ntfPanel.classList.contains('show')
    if (isShown) {
      ntfPanel.classList.remove('show');
    } else {
      updateNtfVisibility();
      positionPanelUnderButton(anchorBtn);
      ntfPanel.classList.add('show');
      // focus for keyboard handling
      ntfPanel.setAttribute('tabindex', '-1');
      ntfPanel.focus();
    }
  }

  // attach to all notification buttons
  notificationBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleNtfPanel(e.currentTarget);
    });
  });

  // clicking inside panel should not close it
  ntfPanel.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // click outside closes panel
  document.addEventListener('click', () => {
    if (ntfPanel.classList.contains('show')) ntfPanel.classList.remove('show');
  });

  // close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ntfPanel.classList.contains('show')) {
      ntfPanel.classList.remove('show');
    }
  });

  // reposition if viewport changes while open
  window.addEventListener('resize', () => {
    if (ntfPanel.classList.contains('show')) {
      // try to find the currently active button (one that was last used)
      const activeBtn = document.querySelector('.notification-btn[aria-pressed="true"]') || document.querySelector('.notification-btn');
      positionPanelUnderButton(activeBtn);
    }
  });
  window.addEventListener('scroll', () => {
    if (ntfPanel.classList.contains('show')) {
      const activeBtn = document.querySelector('.notification-btn[aria-pressed="true"]') || document.querySelector('.notification-btn');
      positionPanelUnderButton(activeBtn);
    }
  }, { passive: true });

  // observe changes to notification list and update message visibility
  const mo = new MutationObserver(() => updateNtfVisibility());
  mo.observe(ntfList, { childList: true, subtree: false });

  // initial state
  ntfPanel.classList.remove('show');
  updateNtfVisibility();
});

// Disable/enable main export button when attendance table has no visible rows
document.addEventListener('DOMContentLoaded', () => {
  const downloadBtn = document.getElementById('download-sheet');
  const attendanceTbody = document.getElementById('attendance-tbody');
  if (!downloadBtn || !attendanceTbody) return;

  function updateMainDownloadState() {
    const rows = Array.from(attendanceTbody.children).filter(n => n.nodeType === 1);
    const hasVisible = rows.some(r => r.offsetParent !== null);
    downloadBtn.disabled = !hasVisible;
    // keep a CSS hook as well for styles that don't target [disabled]
    if (downloadBtn.disabled) downloadBtn.classList.add('disabled'); else downloadBtn.classList.remove('disabled');
  }

  const mo = new MutationObserver(() => updateMainDownloadState());
  mo.observe(attendanceTbody, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

  // initial state
  updateMainDownloadState();
});




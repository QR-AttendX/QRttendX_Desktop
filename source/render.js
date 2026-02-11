// Event listener when the DOM is loaded
// Title bar: dash.html has minimize, maximize, close; start.html has minimize, close only.
window.addEventListener("DOMContentLoaded", () => {
  const btnMin = document.getElementById("minimize");
  const btnMax = document.getElementById("maximize");
  const btnClose = document.getElementById("close");

  if (btnMin) btnMin.addEventListener('click', () => window.electronAPI.windowControl('minimize'));
  if (btnMax) btnMax.addEventListener('click', () => window.electronAPI.windowControl('maximize'));
  if (btnClose) btnClose.addEventListener('click', () => window.electronAPI.windowControl('close'));

  // Ctrl+A: toggle select/deselect attendance rows in #attendance-tbody
  document.addEventListener('keydown', (e) => {
    // Respect platform modifier (Ctrl on Windows/Linux, Meta on Mac)
    const isModifier = e.ctrlKey || e.metaKey;
    if (!isModifier) return;
    if (e.key && e.key.toLowerCase() === 'a') {
      // Don't override default text selection inside inputs/textareas
      const active = document.activeElement;
      const activeTag = active && active.tagName;
      const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || active && active.isContentEditable;
      if (isTyping) return;

      e.preventDefault();

      // Only act when the Attendance panel is open (not closed)
      const attendancePanel = document.querySelector('section.student-attendance-container');
      if (attendancePanel && attendancePanel.classList.contains('closed')) return;

      const tbody = document.getElementById('attendance-tbody');
      if (!tbody) return;

      // If there's a select-all checkbox, toggle it and use its new state
      const selectAll = document.getElementById('select-all-rows');
      let newState;
      if (selectAll) {
        newState = !selectAll.checked;
        selectAll.checked = newState;
        selectAll.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        // Otherwise infer: if any checkbox is unchecked => select all, else deselect all
        const rowCheckboxes = Array.from(tbody.querySelectorAll('input[type="checkbox"]'));
        const anyUnchecked = rowCheckboxes.some(cb => !cb.checked);
        newState = anyUnchecked;
      }

      // Apply newState to all row checkboxes
      const rowCheckboxes = tbody.querySelectorAll('input[type="checkbox"]');
      rowCheckboxes.forEach(cb => {
        if (cb.checked !== newState) {
          cb.checked = newState;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }
  });

});


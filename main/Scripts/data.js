
// Show teacher-main or student-main based on user role from session
(function setMainByRole() {
  document.addEventListener('DOMContentLoaded', async () => {
    const teacherMain = document.getElementById('teacher-main');
    const studentMain = document.getElementById('student-main');
    // Essential of a specific teacher needs
    const adviserSec = document.getElementById('adviser-section');
    //Grabs the InnerHtml of the sidebar so we can move the statistics outside the Student dropdown to ease access for teachers
    const sidebar = document.querySelector('#side-bar > ul');
    const statisticLi = document.getElementById('statistics');
    const calendarLi = document.getElementById('calendar');

    if (!teacherMain || !studentMain) return;

    try {
      const user = await window.attendyAPI.getSession();
      const role = (user && user.role) ? String(user.role).toLowerCase() : 'teacher';

      // the role strings can be "student", "teacher subject", "teacher adviser", or "teacher subject adviser"
      //this grabs information from the config.json fil at your Appdata/Roaming/QRttendX
      //to acces it use windows key + R and type %appdata%/QRttendX/config.json and open it with notepad, to check the role string assigned to you for debugging purposes
      if (role === 'student') {
        studentMain.style.display = 'grid';
        teacherMain.style.display = 'none';
      } else if (role === 'teacher subject') {
        teacherMain.style.display = 'grid';
        studentMain.style.display = 'none';

        adviserSec.style.display = 'none';
      } else if (role === 'teacher adviser') {
        teacherMain.style.display = 'grid';
        studentMain.style.display = 'none';

        adviserSec.style.display = 'block';
        sidebar.insertBefore(statisticLi, calendarLi); // move statistics above calendar

      }
      else if (role === 'teacher subject adviser') {
        teacherMain.style.display = 'grid';
        studentMain.style.display = 'none';

        adviserSec.style.display = 'block';
        sidebar.insertBefore(statisticLi, calendarLi); // move statistics above calendar

      }
    } catch (e) {
      console.warn('setMainByRole failed, defaulting to teacher', e);
      teacherMain.style.display = 'grid';
      studentMain.style.display = 'none';
    }
  });
})();

// Dark theme toggle + persistence
// Looks for the checkbox inside the label with id="dark-theme"
(() => {
  const storageKey = 'darkmode';
  const checkbox = document.querySelector('#dark-theme input[type="checkbox"]');
  const darkClass = 'dark-theme';

  function setDarkMode(active) {
    if (active) {
      document.documentElement.classList.add(darkClass);
      if (checkbox) checkbox.checked = true;
      localStorage.setItem(storageKey, 'active');
    } else {
      document.documentElement.classList.remove(darkClass);
      if (checkbox) checkbox.checked = false;
      localStorage.removeItem(storageKey);
    }
  }

  // Expose global toggle function if other scripts want to call it

  document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem(storageKey);
    if (checkbox) {
      // Initialize checkbox and class from storage
      if (saved === 'active') setDarkMode(true);
      else setDarkMode(false);

      // sync when user toggles checkbox
      checkbox.addEventListener('change', () => {
        setDarkMode(checkbox.checked);
      });
    } else {
      // No checkbox found; still apply saved preference
      if (saved === 'active') setDarkMode(true);
    }
  });
})();

// Compact table toggle: similar behavior to dark mode, persisted in localStorage
(() => {
  const storageKey = 'compactTable';
  const checkbox = document.querySelector('#compact-table input[type="checkbox"]');
  const compactClass = 'compact-table';

  function setCompactMode(active) {
    if (active) {
      document.documentElement.classList.add(compactClass);
      if (checkbox) checkbox.checked = true;
      localStorage.setItem(storageKey, 'active');
    } else {
      document.documentElement.classList.remove(compactClass);
      if (checkbox) checkbox.checked = false;
      localStorage.removeItem(storageKey);
    }
  }

  // Expose global toggle if needed elsewhere
  window.toggleCompactMode = setCompactMode;

  document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem(storageKey);
    if (checkbox) {
      if (saved === 'active') setCompactMode(true);
      else setCompactMode(false);

      checkbox.addEventListener('change', () => {
        setCompactMode(checkbox.checked);
      });
    } else {
      if (saved === 'active') setCompactMode(true);
    }
  });
})();
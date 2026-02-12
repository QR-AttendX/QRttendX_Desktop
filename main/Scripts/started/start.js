/*
QR Attendy base on Website and WebApp lol
Develop by BELDAD-Ace on Github with the team group 1 for PR2

all rights reserved 2025

*/




// Script for Getting started
const started = document.querySelector('#start');
if (started) {
  started.addEventListener('click', () => {
    const mt = document.querySelector('.main-title');
    const bs = document.querySelector('.body-started');
    if (mt) mt.style.display = 'none';
    if (bs) bs.style.display = 'block';
  });
}

// Prevent duplicate submissions and manage teacher-role selection
let _isSubmitting = false;
let _selectedTeacherRole = null; // 'teacher subject' | 'teacher adviser' | 'teacher subject adviser'

const form = document.querySelector('.Sign-in-field');
const nextBtn = document.getElementById('next-body');
const teacherChoicePanel = document.querySelector('.body-started-teacher-choice');
const subjectBtn = document.getElementById('subject-teacher');
const adviserBtn = document.getElementById('adviser-teacher');
const bothBtn = document.getElementById('both-teacher');

// wire the form submit (handles Enter and button type=submit)
if (form) form.addEventListener('submit', start);

// When Next is clicked and role is 'teacher', show the teacher-choice panel
function showTeacherChoiceIfNeeded() {
  const roleEl = document.getElementById('role');
  const role = roleEl ? String(roleEl.value || '').trim() : '';
  if (role === 'teacher') {
    // hide initial body and show teacher choice
    const bs = document.querySelector('.body-started');
    if (bs) bs.style.display = 'none';
    if (teacherChoicePanel) teacherChoicePanel.style.display = 'block';
    return true;
  }
  return false;
}

// helper to disable/enable controls while submitting
function setSubmitting(v) {
  _isSubmitting = !!v;
  try { if (nextBtn) nextBtn.disabled = _isSubmitting; } catch (e) { }
  try { if (subjectBtn) subjectBtn.disabled = _isSubmitting; } catch (e) { }
  try { if (adviserBtn) adviserBtn.disabled = _isSubmitting; } catch (e) { }
  try { if (bothBtn) bothBtn.disabled = _isSubmitting; } catch (e) { }
}

async function createUserAndProceed(roleToSend) {
  if (_isSubmitting) return;
  setSubmitting(true);
  const fullname = (document.getElementById('fullname') && document.getElementById('fullname').value) ? document.getElementById('fullname').value.trim() : '';
  const username = (document.getElementById('username') && document.getElementById('username').value) ? document.getElementById('username').value.trim() : '';
  if (!fullname || !username) {
    document.getElementById('warning-error').textContent = 'Please fill in all required fields.';
    setSubmitting(false);
    return;
  }

  try {
    const user = await window.attendyAPI.createUser(fullname, username, roleToSend);
    if (user && user.status === 'error') {
      document.getElementById('warning-error').textContent = user.message || 'Failed to create user.';
      setSubmitting(false);
      return;
    }
    if (!user || !user.username || !user.fullname) {
      document.getElementById('warning-error').textContent = 'Invalid user data returned. Please try again.';
      setSubmitting(false);
      return;
    }

    await window.attendyAPI.saveSession(user);
    window.attendyAPI.openDashboard();
  } catch (error) {
    alert('Error creating user: ' + (error && error.message ? error.message : String(error)));
    setSubmitting(false);
  }
}

// main start handler invoked by form submit
async function start(event) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  if (_isSubmitting) return;

  // validate required fields before doing anything
  const fullname = (document.getElementById('fullname') && document.getElementById('fullname').value) ? document.getElementById('fullname').value.trim() : '';
  const username = (document.getElementById('username') && document.getElementById('username').value) ? document.getElementById('username').value.trim() : '';
  if (!fullname || !username) {
    try { document.getElementById('warning-error').textContent = 'Please fill in all required fields.'; } catch (e) { }
    return;
  }

  const roleEl = document.getElementById('role');
  const role = roleEl ? String(roleEl.value || '').trim() : '';

  // If teacher chosen, ask for more granular teacher type first
  if (role === 'teacher') {
    showTeacherChoiceIfNeeded();
    return;
  }

  // otherwise proceed to create user immediately
  await createUserAndProceed(role || 'teacher');
}

// teacher choice buttons: send createUser with appropriate role string
if (subjectBtn) subjectBtn.addEventListener('click', async (ev) => {
  ev && ev.preventDefault && ev.preventDefault();
  _selectedTeacherRole = 'teacher subject';
  if (teacherChoicePanel) teacherChoicePanel.style.display = 'none';
  await createUserAndProceed(_selectedTeacherRole);
});
if (adviserBtn) adviserBtn.addEventListener('click', async (ev) => {
  ev && ev.preventDefault && ev.preventDefault();
  _selectedTeacherRole = 'teacher adviser';
  if (teacherChoicePanel) teacherChoicePanel.style.display = 'none';
  await createUserAndProceed(_selectedTeacherRole);
});
if (bothBtn) bothBtn.addEventListener('click', async (ev) => {
  ev && ev.preventDefault && ev.preventDefault();
  _selectedTeacherRole = 'teacher subject adviser';
  if (teacherChoicePanel) teacherChoicePanel.style.display = 'none';
  await createUserAndProceed(_selectedTeacherRole);
});

### QRttendX for Destkop Psuedo Code/Algorithm

```txt
BEGIN APPLICATION_START
  SET isDev = NOT app.isPackaged
  INITIALIZE electron-store
  ATTEMPT renderer file watcher startup
  (in packaged builds this is usually a no-op when chokidar is unavailable)

  WHEN app.ready:
    CALL START_BACKEND
    IF backend failed THEN
      CALL KILL_BACKEND
      app.quit
    ENDIF

    READ currentUser FROM electron-store
    IF currentUser exists THEN
      OPEN dashboard window
    ELSE
      OPEN start window
    ENDIF

    IN production:
      REMOVE app menu
      REGISTER shortcuts to block reload/devtools
END

PROCEDURE START_BACKEND
  IF isDev THEN
    SPAWN python -u main/pyX/AttendX.py
  ELSE
    EXEC packaged AttendX.exe
  ENDIF

  ATTACH stdout/stderr logging
  CONSIDER backend ready when:
    - server-ready log appears on stdout, OR
    - /health returns ready before timeout
  RETURN success/failure
ENDPROCEDURE

PROCEDURE KILL_BACKEND
  IF backend process exists THEN
    ON Windows: taskkill /T /F on backend PID
    ON POSIX: kill children, SIGTERM, then SIGKILL fallback
  ENDIF
ENDPROCEDURE

BEGIN START_WINDOW_FLOW (main/Scripts/started/start.js)
  ON "Let's get started": show sign-in form

  ON form submit:
    VALIDATE fullname and username
    READ selected role

    IF role = teacher THEN
      SHOW teacher subtype choices:
        - teacher subject
        - teacher adviser
        - teacher subject adviser
      WAIT for user choice
    ENDIF

    CALL attendyAPI.createUser(fullname, username, chosenRole)
    IF success THEN
      CALL attendyAPI.saveSession(user)
      SEND IPC "open-dashboard"
    ELSE
      SHOW error message
    ENDIF
END

BEGIN PRELOAD_BRIDGE (source/load.js)
  EXPOSE electronAPI:
    - windowControl(action)
    - setSetting/getSetting

  EXPOSE attendyAPI:
    - saveSession/getSession/logout/openDashboard
    - createUser/generateQR
    - recordAttendance/getAttendance/update/edit/delete
    - setTimeoutForRows/setTimeoutForRow
END

BEGIN DASHBOARD_BOOT (main/Scripts/source.js + data.js)
  LOAD session user
  IF no session user THEN reload page

  FILL profile labels (fullname/username/email)
  GENERATE QR for current user and display image

  SWITCH visible main layout by user role:
    - student main
    - teacher subject
    - teacher adviser
    - teacher subject adviser

  INITIALIZE settings toggles:
    - dark mode (localStorage)
    - compact table (localStorage)

  INITIALIZE hash-based container routing:
    #dashboard / #adviser / #attendance / #statistics / #calendar / #settings

  INITIALIZE sidebar behaviors and active-nav highlighting
  INITIALIZE notifications panel behavior
END

BEGIN DASHBOARD_CONTROLLER_LOOP (dashboardController.js)
  ON DOMContentLoaded:
    INIT controller once

  INIT:
    RENDER cached views immediately
    POPULATE section dropdowns
    RENDER selected calendar date view
    CALL REFRESH_AND_RENDER once
    START interval >= 15 seconds while tab is visible

  REFRESH_AND_RENDER:
    CALL attendanceStore.refreshAttendance
    IF data changed THEN
      RENDER today table
      RENDER recent students
      RENDER most present
      RENDER per-section summary
      POPULATE section dropdowns
    ENDIF

  ON attendanceStore change:
    RE-RENDER all dependent views immediately
    REFRESH calendar selected-date table
END

BEGIN ATTENDANCE_STORE (attendanceStore.js)
  CACHE attendance rows newest-first
  BUILD indexes:
    - id -> row
    - latest row per student for today
    - present-days per student for current month

  DERIVE cached data:
    - today rows
    - today counts (total/present/absent/late)
    - recent unique students
    - most-present leaderboard

  refreshAttendance:
    FETCH all rows via attendyAPI.getAttendance
    SORT newest-first
    COMPUTE fingerprint(id|status|timestamp)
    IF fingerprint changed THEN
      REBUILD indexes/caches
      RETURN changed=true
    ELSE
      RETURN changed=false
    ENDIF

  SUPPORT mutations:
    deleteRow, updateStatus, addRow, setTimeoutForRows, setTimeInForRow
  AFTER mutation:
    RECOMPUTE caches
    EMIT change to subscribers
END

BEGIN TODAY/RECENT/MOST-PRESENT/SECTION VIEWS
  todayAttendanceView.js:
    RENDER today rows into #attendance-tbody
    BIND delegated row interactions (status change, row selection)
    UPDATE dashboard count widgets

  recentStudentsView.js:
    RENDER latest unique students to #recent-students-tbody
    OPTIONAL filter by selected section

  mostPresentView.js:
    RENDER leaderboard by monthly present days
    OPTIONAL filter by selected section

  todayAttendanceSectionView.js:
    GROUP today rows by section
    RENDER status totals per section
END

BEGIN QR_SCAN_FLOW (QRscan.js)
  ON "Scan QR": open camera panel and start Html5Qrcode
  ON camera change: restart scanner with selected device

  ON QR decode:
    IGNORE URL QR codes
    PARSE JSON payload (fullname, username, role, section)
    NORMALIZE username

    IF scanned within 3 seconds for same user THEN ignore
    IF user already recorded today in store THEN ignore

    SEND attendance to backend:
      - prefer duplicate handler (attendyDupe.handlePotentialDuplicate)
      - else attendyAPI.recordAttendance
      - fallback to direct fetch(http://localhost:5005/record_attendance) if preload API is unavailable

    ON success:
      UPDATE attendanceStore (addRow or refresh)
      PREPEND quick result row in scanner results table

  ON close scanner:
    STOP camera
    REFRESH store
    RE-RENDER dashboard views
END

BEGIN DATA_ACTIONS (DataHandler.js)
  PROVIDE actions for attendance management:

  1) Selection and bulk helpers
    - select all / per-row checkboxes
    - compute selected row IDs

  2) Export
    - export today's rows to XLSX
    - export selected calendar-date rows to XLSX

  3) Import
    - read XLSX/CSV
    - normalize headers
    - deduplicate by username or fullname+section
    - send each valid row to attendyAPI.recordAttendance
    - refresh store + re-render all views

  4) Search and filters
    - attendance table search
    - calendar specific-date search
    - section-based filtering and counts

  5) Edit operations
    - single edit panel (fullname/username/section/status/time in/out)
    - multi-edit panel for selected rows
    - push changes to backend via attendyAPI.editAttendance
    - sync local store and DOM immediately

  6) Delete operations
    - deletion confirmation panel
    - delete selected rows (or context-menu row)
    - sync backend + store + UI

  7) Bulk timeout
    - apply time_out to selected rows missing time_out
    - backend call setTimeoutForRows
    - store/UI sync

  8) Add student
    - open add panel
    - call recordAttendance with default Present
    - refresh store and all related tables

  9) Right-click menu
    - actions: Edit, Delete, Check Info
    - row-aware behavior for attendance/recent/calendar tables
END

BEGIN CALENDAR_FLOW
  calendar.js:
    RENDER monthly grid
    ON day click -> dispatch "calendar-date-selected" with YYYY-MM-DD

  calendarAttendance.js:
    FETCH attendance and index by date key
    ON selected date:
      RENDER #attendance-specDate-tbody
      REMEMBER last selected date key
      CALL calendar graph renderer

  graph.js:
    DRAW donut and bar charts on canvas
    KEEP donut as initial/static chart
    UPDATE per-day status distribution on selected date via bar chart renderer
END

BEGIN WINDOW_AND_SESSION_IPC (snapdragon.js)
  HANDLE IPC "window-control": minimize/maximize/close/reload/devtools (guarded)
  HANDLE session IPC:
    - save-session
    - get-session
    - logout (clear session, go to start window)
    - open-dashboard (close start window, open dashboard)
END

BEGIN SHUTDOWN
  ON before-quit:
    KILL backend
    UNREGISTER global shortcuts

  ON window-all-closed:
    KILL backend
    app.quit
END

```

PROJECT QR ATTENDANCE SYSTEM (QRttendX) PSUEDO CODE/ALGORITHM
CONTRIBUTORS:
- @AshBeldad02
- @ryuzkzqt-ops

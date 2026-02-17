import { app, BrowserWindow, ipcMain, Menu, globalShortcut } from "electron"; //Electron Modules
import path from "path"; //Node.js Path Module
import { fileURLToPath } from "url"; //Node.js URL Module
import { spawn } from "child_process"; //Node.js Child Process Module
import Store from "electron-store"; //Electron Store Module
import { execFile } from "child_process"; //Node.js Exec File Module
import http from "http";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = !app.isPackaged;
const store = new Store();

// no error will occur during production as chokidar will be disabled
import { watchRenderer } from './watcher.js';
watchRenderer([
  path.join(__dirname, '../main/dash.html'),
  path.join(__dirname, '../main/start.html'),
  path.join(__dirname, '../main/zesty-design/dashboard.css'),
  path.join(__dirname, '../main/zesty-design/start.css'),
  path.join(__dirname, '../main/zesty-design/graph.css'),
  path.join(__dirname, '../main/zesty-design/source.css'),
  // script here soon lol
]);

let PyAttendy;
let startedWin;
let dashboardWin;

// Robustly kill the Python backend and any children it spawned.
function killBackendProcess() {
  if (!PyAttendy || !PyAttendy.pid) return;
  const pid = PyAttendy.pid;
  try {
    if (process.platform === 'win32') {
      // Use taskkill to terminate the process tree on Windows
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F']);
      killer.on('error', (err) => {
        console.error('taskkill failed:', err);
      });
    } else {
      // Try to kill child processes first (POSIX) then the main pid
      try {
        // pkill -P <pid> kills children by parent pid
        const ppk = spawn('pkill', ['-P', String(pid)]);
        ppk.on('error', () => { /* ignore if pkill missing */ });
      } catch (e) { /* ignore */ }
      try { process.kill(pid, 'SIGTERM'); } catch (e) { /* ignore */ }
      // ensure termination after short delay
      setTimeout(() => {
        try { process.kill(pid, 'SIGKILL'); } catch (e) { /* ignore */ }
      }, 500);
    }
  } catch (e) {
    try { PyAttendy.kill(); } catch (ee) { console.error('failed to kill backend:', ee); }
  }
}


// Replace AttendyEngine with a starter that returns when backend ready
function startBackend({ timeoutMs = 30000, intervalMs = 300 } = {}) {
  return new Promise((resolve, reject) => {
    // spawn process (dev vs production)
    if (isDev) {
      // Run python with unbuffered output so logs appear immediately
      PyAttendy = spawn('python', ['-u', path.join(__dirname, '../main/pyX/AttendX.py')], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    } else {
      const exePath = path.join(process.resourcesPath, 'atom', 'AttendX.exe');
      PyAttendy = execFile(exePath, { windowsHide: true });
    }

    if (!PyAttendy) return reject(new Error('failed to start backend process'));

    // ensure we clear the reference when the backend exits
    try {
      PyAttendy.on && PyAttendy.on('exit', (code, signal) => {
        console.log('PyAttendy exited:', code, signal);
        PyAttendy = null;
      });
      PyAttendy.on && PyAttendy.on('close', () => { PyAttendy = null; });
      PyAttendy.on && PyAttendy.on('error', (err) => { console.error('PyX error:', err); });
    } catch (e) { /* ignore */ }

    // Relay logs and watch for server-ready messages to speed up startup
    if (PyAttendy.stdout) {
      PyAttendy.stdout.on("data", d => {
        const text = d.toString();
        console.log("Py Log: ", text);
        // Some servers (waitress) print "Serving on http://127.0.0.1:5005"
        if (text.includes('Serving on') || text.includes('Running on http://') || text.includes('Press CTRL+C to quit')) {
          // Heuristic: consider backend started when we see a server bind log
          try { resolve(); } catch (e) { /* ignore if already settled */ }
        }
      });
    }
    if (PyAttendy.stderr) {
      PyAttendy.stderr.on("data", d => {
        const text = d.toString();
        console.error("Python log -", text);
      });
    }

    const start = Date.now();

    const check = () => {
      const req = http.get({ hostname: '127.0.0.1', port: 5005, path: '/health', timeout: 2000 }, res => {
        let body = '';
        res.on('data', c => body += c.toString());
        res.on('end', () => {
          try {
            const json = JSON.parse(body || '{}');
            if (res.statusCode === 200 && json && json.ready) return resolve();
          } catch (e) { /* ignore */ }
          if (Date.now() - start > timeoutMs) return reject(new Error('backend health check timed out'));
          setTimeout(check, intervalMs);
        });
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return reject(new Error('backend health check timed out'));
        setTimeout(check, intervalMs);
      });
      req.on('timeout', () => req.destroy());
    };

    // start polling
    setTimeout(check, 100);
  });
}

// -------------------------------------
// Controllers
// -------------------------------------
ipcMain.on("window-control", (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;

  switch (action) {
    case "minimize": win.minimize(); break;
    case "maximize": win.isMaximized() ? win.unmaximize() : win.maximize(); break;
    case "close": win.close(); break;
    case "reload":
      // allow reload in dev or when explicitly enabled in store
      try {
        if (isDev || store.get('allowReload')) win.reload();
      } catch (e) { console.warn('reload failed', e); }
      break;
    case "toggle-devtools":
      // allow devtools in dev or when explicitly enabled in store
      try {
        if (isDev || store.get('allowDevtools')) {
          if (!win.webContents.isDevToolsOpened()) win.webContents.openDevTools({ mode: 'detach' });
          else win.webContents.closeDevTools();
        }
      } catch (e) { console.warn('toggle-devtools failed', e); }
      break;
    default: console.warn("Unknown action:", action);
  }

  if (win.isMaximized()) win.send("window-control-signal");
});

// Allow renderer to persist small boolean settings via Store
ipcMain.handle('set-setting', (_, key, value) => {
  try { store.set(key, value); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; }
});

ipcMain.handle('get-setting', (_, key) => {
  try { return store.get(key); } catch (e) { return null; }
});
// -------------------------------------
// WINDOWS
//-------------------------------------
//Started Windows
function startedWindow() {
  startedWin = new BrowserWindow({
    resizable: false,
    width: 500,
    height: 650,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "../source/load.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  startedWin.loadFile(path.join(__dirname, "../main/start.html"));

  startedWin.once('ready-to-show', () => {
    startedWin.show();
  });

  // In packaged builds, block refresh/devtools keyboard shortcuts
  if (!isDev && startedWin && startedWin.webContents) {
    startedWin.webContents.on('before-input-event', (event, input) => {
      try {
        const key = (input.key || '').toLowerCase();
        const isCtrl = !!(input.control || input.meta);
        const isShift = !!input.shift;
        // block Ctrl+R, Ctrl+Shift+R, Ctrl+Shift+I and F12
        if ((isCtrl && key === 'r') || (isCtrl && isShift && key === 'r') || (isCtrl && isShift && key === 'i') || input.code === 'F12') {
          event.preventDefault();
        }
      } catch (e) { /* ignore */ }
    });
    startedWin.webContents.on('devtools-opened', () => {
      try { startedWin.webContents.closeDevTools(); } catch (e) { /* ignore */ }
    });
  }

  startedWin.on("closed", () => {
    startedWin = null;
  });

}
//Dashboard Window
function dashboardWindow() {
  dashboardWin = new BrowserWindow({
    width: 1200,
    height: 850,
    minHeight: 750,
    minWidth: 1300,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "../source/load.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  dashboardWin.loadFile(path.join(__dirname, "../main/dash.html"));

  dashboardWin.once('ready-to-show', () => {
    dashboardWin.show();
  });
  // In packaged builds, block refresh/devtools keyboard shortcuts
  if (!isDev && dashboardWin && dashboardWin.webContents) {
    dashboardWin.webContents.on('before-input-event', (event, input) => {
      try {
        const key = (input.key || '').toLowerCase();
        const isCtrl = !!(input.control || input.meta);
        const isShift = !!input.shift;
        if ((isCtrl && key === 'r') || (isCtrl && isShift && key === 'r') || (isCtrl && isShift && key === 'i') || input.code === 'F12') {
          event.preventDefault();
        }
      } catch (e) { /* ignore */ }
    });
    dashboardWin.webContents.on('devtools-opened', () => {
      try { dashboardWin.webContents.closeDevTools(); } catch (e) { /* ignore */ }
    });
  }
  dashboardWin.on("closed", () => {
    dashboardWin = null;
  });
}

// -------------------------------------
// APP BOOT
// -------------------------------------
app.whenReady().then(async () => {
  try {
    await startBackend();
    const currentUser = store.get("currentUser");
    // Remove application menu in packaged builds to avoid built-in reload/devtools menu items
    if (!isDev) {
      try { Menu.setApplicationMenu(null); } catch (e) { /* ignore */ }
      // Register global shortcuts in production to further prevent reload/devtools
      try {
        // common reload keys
        globalShortcut.register('CommandOrControl+R', () => { });
        globalShortcut.register('CommandOrControl+Shift+R', () => { });
        // devtools
        globalShortcut.register('CommandOrControl+Shift+I', () => { });
        globalShortcut.register('F12', () => { });
      } catch (e) { /* ignore */ }
    }
    currentUser ? dashboardWindow() : startedWindow();
    console.log("Backend started successfully.");
  } catch (err) {
    console.error("Failed to start backend:", err);
    // ensure process is killed and quit gracefully
    try { killBackendProcess(); } catch (e) { /* ignore */ }
    app.quit();
  }
});

// -------------------------------------
// Session IPC
// -------------------------------------
ipcMain.handle("save-session", (_, user) => {
  store.set("currentUser", user);
});

ipcMain.handle("get-session", () => {
  return store.get("currentUser");
});

ipcMain.handle("logout", () => {
  store.delete("currentUser");

  if (dashboardWin) dashboardWin.close();
  startedWindow();
});

ipcMain.on("open-dashboard", () => {
  if (startedWin) startedWin.close();
  dashboardWindow();
});

// -------------------------------------
// Cleanup on quit
// -------------------------------------
app.on("before-quit", () => {
  try { killBackendProcess(); } catch (e) { /* ignore */ }
  // unregister global shortcuts when quitting
  try { globalShortcut.unregisterAll(); } catch (e) { /* ignore */ }
});

// Ensure backend shuts down when all windows are closed (Windows/Linux).
app.on("window-all-closed", () => {
  try { killBackendProcess(); } catch (e) { /* ignore */ }
  app.quit();
});

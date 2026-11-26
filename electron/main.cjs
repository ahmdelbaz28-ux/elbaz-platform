const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const isDev = require('electron-is-dev');

// ✅ SECURITY FIX (audit run-3, electron-shell-navigation-policy-missing):
// the shell previously had NO navigation-origin policy — any navigation or
// popup initiated by the remote page (a chat citation link, a notification
// URL, or a compromised first-party page) moved the whole chromeless window
// to an arbitrary origin while it still looked like the trusted app
// (chromeless phishing). Policy:
//   · in-window navigation is allowed only to the FIRST-PARTY origins,
//   · every other http(s) target is delegated to the OS browser via
//     shell.openExternal,
//   · window.open popups are denied in-shell (the handler routes the URL out).
const FIRST_PARTY_ORIGINS = new Set([
  'https://ahmedelbaz.qzz.io',
  'http://localhost:5173',
  'http://localhost:3000',
]);

function isAllowedNavigation(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'devtools:') return true;
    return FIRST_PARTY_ORIGINS.has(parsed.origin);
  } catch {
    return false;
  }
}

function openExternalIfSafe(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      shell.openExternal(url);
    }
  } catch {
    // unparseable target — ignore
  }
}

function applyNavigationPolicy(contents) {
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
      openExternalIfSafe(url);
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    icon: path.join(__dirname, '../public/favicon.ico'),
    title: 'Elbaz Courses',
  });

  applyNavigationPolicy(win.webContents);

  // For this demonstration/start, we load the built file
  if (isDev && !process.argv.includes('--prod')) {
    win.loadURL('http://localhost:5173').catch(() => {
      console.log("Dev server not found, loading local file...");
      win.loadFile(path.join(__dirname, '../dist/public/index.html'));
    });
  } else {
    // ✅ SESSION PERSISTENCE FIX: production loads the LIVE site instead of
    // file://. A file:// page is an opaque origin — Chromium cannot store the
    // API's Secure/SameSite=None session cookies for it and the CSRF/CORS
    // gates reject Origin "null", so the desktop app lost its session on every
    // restart ("must log in again each time"). The live origin is first-party:
    // cookies persist in the default session (userData partition) and the
    // user stays logged in across restarts unless they explicitly log out.
    win.loadURL('https://ahmedelbaz.qzz.io').catch(() => {
      console.log("Live site unreachable, loading local file as offline fallback...");
      win.loadFile(path.join(__dirname, '../dist/public/index.html'));
    });
  }

  // Remove menu in production
  if (!isDev) {
    win.setMenu(null);
  }
}

// ✅ SECURITY FIX (audit run-3): apply the SAME policy to every webContents
// created later (popups, secondary windows) — not only the main window.
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'window' || contents.getType() === 'browserView') {
    applyNavigationPolicy(contents);
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

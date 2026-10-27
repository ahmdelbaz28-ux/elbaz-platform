const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const isDev = require('electron-is-dev');

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

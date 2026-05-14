const { app, BrowserWindow } = require('electron');
const path = require('path');
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
  const forceProd = process.argv.includes('--prod') || !isDev;
  
  if (isDev && !process.argv.includes('--prod')) {
    win.loadURL('http://localhost:5173').catch(() => {
      console.log("Dev server not found, loading local file...");
      win.loadFile(path.join(__dirname, '../dist/public/index.html'));
    });
  } else {
    win.loadFile(path.join(__dirname, '../dist/public/index.html'));
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

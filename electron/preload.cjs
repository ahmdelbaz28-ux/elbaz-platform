const { contextBridge } = require('electron');

// Expose minimal APIs if needed
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
});

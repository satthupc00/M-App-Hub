const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mah', {
  isElectron: true,
  checkUpdate: () => ipcRenderer.invoke('upd:check'),
  installUpdate: () => ipcRenderer.send('upd:install'),
  onUpdate: cb => ipcRenderer.on('upd:status', (_e, data) => cb(data)),
  version: () => ipcRenderer.invoke('app:version'),
  openDataFolder: () => ipcRenderer.invoke('app:open-data')
});

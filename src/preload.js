const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  checkPathStatus: () => ipcRenderer.invoke('check-path-status'),
  addToPath: (platform) => ipcRenderer.invoke('add-to-path', platform),
  removeFromPath: (platform) => ipcRenderer.invoke('remove-from-path', platform),
  selectDirectory: (platform, currentPath) => ipcRenderer.invoke('select-directory', platform, currentPath),
  setUnsavedChanges: (flag) => ipcRenderer.send('set-unsaved-changes', flag)
});

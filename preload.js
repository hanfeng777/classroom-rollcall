const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFiles: () => ipcRenderer.invoke('select-files'),
  readFiles: (paths) => ipcRenderer.invoke('read-files', paths),
  getPathForFile: (file) => webUtils.getPathForFile(file)
});

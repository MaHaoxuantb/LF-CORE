const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lfcoreDesktop', Object.freeze({
  saveProject: (defaultName, contents) => ipcRenderer.invoke('project:save', { defaultName, contents }),
  openProject: () => ipcRenderer.invoke('project:open')
}));

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rtlmSync', {
  getMulesoftUrl: () => ipcRenderer.invoke('get-mulesoft-url'),
  getAppMeta: () => ipcRenderer.invoke('get-app-meta'),
  startAuth: () => ipcRenderer.invoke('start-auth'),
  sendAuthEnter: () => ipcRenderer.send('auth-enter'),
  startScraper: () => ipcRenderer.invoke('start-scraper'),
  stopProcess: () => ipcRenderer.invoke('stop-process'),
  onLog: (fn) => {
    const sub = (_e, line) => fn(line);
    ipcRenderer.on('proc-log', sub);
    return () => ipcRenderer.removeListener('proc-log', sub);
  },
  onProcExit: (fn) => {
    const sub = (_e, payload) => fn(payload);
    ipcRenderer.on('proc-exit', sub);
    return () => ipcRenderer.removeListener('proc-exit', sub);
  },
  onShortcut: (fn) => {
    const sub = (_e, action) => fn(action);
    ipcRenderer.on('shortcut', sub);
    return () => ipcRenderer.removeListener('shortcut', sub);
  },
});

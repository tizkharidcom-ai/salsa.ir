'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('westoDesktop', Object.freeze({
  isElectron: true,
  platform: process.platform,
  arch: process.arch,
  version: process.versions.electron,
  getConnectionUrl: () => ipcRenderer.invoke('westo:connection-url'),
  saveConnectionUrl: (url) => ipcRenderer.invoke('westo:save-connection-url', String(url || '')),
  openApp: () => ipcRenderer.invoke('westo:open-app'),
  openExternal: (url) => ipcRenderer.invoke('westo:open-external', String(url || '')),
}));

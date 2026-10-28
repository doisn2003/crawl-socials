import type { DesktopApi } from '../shared/desktop-api.js';
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');
const api: DesktopApi = Object.freeze({
  getInfo: () => ipcRenderer.invoke('csd:get-info'),
  runOfflineCheck: () => ipcRenderer.invoke('csd:offline-check'),
  probe: Object.freeze({
    config: () => ipcRenderer.invoke('csd:probe:config'),
    start: (input: { profileId: string }) => ipcRenderer.invoke('csd:probe:start', input),
    stop: () => ipcRenderer.invoke('csd:probe:stop'),
    status: () => ipcRenderer.invoke('csd:probe:status'),
  }),
  profiles: Object.freeze({
    list: () => ipcRenderer.invoke('csd:profiles:list'),
    create: (input: { label: string }) => ipcRenderer.invoke('csd:profiles:create', input),
    open: (input: { profileId: string }) => ipcRenderer.invoke('csd:profiles:open', input),
    close: (input: { profileId: string }) => ipcRenderer.invoke('csd:profiles:close', input),
    openLogin: (input: { profileId: string }) => ipcRenderer.invoke('csd:profiles:login', input),
  }),
});
contextBridge.exposeInMainWorld('csd', api);

import type { ProductionApi, UserConfig, Platform } from '../shared/production-api.js';
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');
const api: ProductionApi = Object.freeze({
  getState: () => ipcRenderer.invoke('csd:state'),
  saveConfig: (input: UserConfig) => ipcRenderer.invoke('csd:config', input),
  login: (input: { platform: Platform; profileId?: string }) => ipcRenderer.invoke('csd:login', input),
  start: (input: { profiles: { platform: Platform; profileId: string }[] }) => ipcRenderer.invoke('csd:start', input),
  stop: () => ipcRenderer.invoke('csd:stop'),
  exportResults: (input: { format: 'json' | 'xlsx' }) => ipcRenderer.invoke('csd:export', input),
  openOutput: () => ipcRenderer.invoke('csd:open-output'),
});
contextBridge.exposeInMainWorld('csd', api);

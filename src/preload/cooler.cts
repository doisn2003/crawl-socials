import type { CoolerProgress } from '../shared/production-api.js';
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');
contextBridge.exposeInMainWorld('cooler', Object.freeze({ progress: (): Promise<CoolerProgress> => ipcRenderer.invoke('csd:cooler:progress') }));

// The safe bridge. The renderer can only call exactly what we expose here.

import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { ScriptRunnerApi } from '../shared/api';
import type { Flow, Settings, StepStatus } from '../shared/types';

const api: ScriptRunnerApi = {
  listFlows: () => ipcRenderer.invoke('flows:list'),
  saveFlow: (flow: Flow) => ipcRenderer.invoke('flows:save', flow),
  deleteFlow: (id: string) => ipcRenderer.invoke('flows:delete', id),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Settings) => ipcRenderer.invoke('settings:save', settings),

  runFlow: (flow: Flow, vars: Record<string, string>) =>
    ipcRenderer.invoke('run:start', { flow, vars }),
  stopFlow: () => ipcRenderer.invoke('run:stop'),

  onLog: (cb: (msg: string) => void) => {
    const handler = (_e: IpcRendererEvent, msg: string) => cb(msg);
    ipcRenderer.on('run:log', handler);
    return () => ipcRenderer.off('run:log', handler);
  },
  onStatus: (cb: (status: StepStatus) => void) => {
    const handler = (_e: IpcRendererEvent, status: StepStatus) => cb(status);
    ipcRenderer.on('run:status', handler);
    return () => ipcRenderer.off('run:status', handler);
  },
};

contextBridge.exposeInMainWorld('api', api);

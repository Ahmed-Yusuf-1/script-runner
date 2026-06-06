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

  listPresets: () => ipcRenderer.invoke('presets:list'),
  getActivePresetId: () => ipcRenderer.invoke('presets:getActive'),
  selectPreset: (id: string | null) => ipcRenderer.invoke('presets:select', id),
  createPreset: (name: string) => ipcRenderer.invoke('presets:create', name),
  deletePreset: (id: string) => ipcRenderer.invoke('presets:delete', id),
  importPreset: () => ipcRenderer.invoke('presets:import'),
  exportPreset: (id: string | null) => ipcRenderer.invoke('presets:export', id),

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

// The safe bridge. The renderer can only call exactly what we expose here.

import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { ScriptRunnerApi } from '../shared/api';

/** Subscribe to a main → renderer channel; returns an unsubscribe function. */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

/**
 * Invoke a handler. Electron wraps errors as "Error invoking remote method 'x':
 * Error: message"; unwrap them so the UI shows just the message.
 */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

const api: ScriptRunnerApi = {
  listFlows: () => invoke('flows:list'),
  saveFlow: (flow) => invoke('flows:save', flow),
  deleteFlow: (id) => invoke('flows:delete', id),
  exportFlow: (flow) => invoke('flows:export', flow),
  importFlows: () => invoke('flows:import'),

  getSettings: () => invoke('settings:get'),
  saveSettings: (settings) => invoke('settings:save', settings),
  pickFolder: (current) => invoke('dialog:pickFolder', current),
  pickFile: (current) => invoke('dialog:pickFile', current),
  clearBrowserProfile: () => invoke('profile:clear'),

  listPresets: () => invoke('presets:list'),
  getActivePresetId: () => invoke('presets:getActive'),
  selectPreset: (id) => invoke('presets:select', id),
  createPreset: (name) => invoke('presets:create', name),
  renamePreset: (id, name) => invoke('presets:rename', id, name),
  deletePreset: (id) => invoke('presets:delete', id),
  importPreset: () => invoke('presets:import'),
  exportPreset: (id) => invoke('presets:export', id),

  runFlow: (flow, vars, options) => invoke('run:start', flow, vars, options ?? {}),
  stopFlow: () => invoke('run:stop'),
  pauseFlow: () => invoke('run:pause'),
  resumeFlow: () => invoke('run:resume'),
  getRunState: () => invoke('run:state'),
  onLog: (cb) => on('run:log', cb),
  onStatus: (cb) => on('run:status', cb),
  onProgress: (cb) => on('run:progress', cb),

  listRuns: () => invoke('history:list'),
  getRun: (id) => invoke('history:get', id),
  deleteRun: (id) => invoke('history:delete', id),
  clearRuns: () => invoke('history:clear'),

  openDownloads: () => invoke('shell:openDownloads'),
  openFile: (path) => invoke('shell:openFile', path),
  showInFolder: (path) => invoke('shell:showInFolder', path),
  saveTextFile: (name, text) => invoke('file:saveText', name, text),
  appInfo: () => invoke('app:info'),
  checkUpdate: () => invoke('app:checkUpdate'),
  openExternal: (url) => invoke('shell:openExternal', url),
};

contextBridge.exposeInMainWorld('api', api);

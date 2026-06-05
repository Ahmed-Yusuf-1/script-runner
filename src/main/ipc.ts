// Registers all IPC handlers — the only way the GUI can reach the engine,
// storage, and settings. Also owns the "current run" so Stop can cancel it.

import { ipcMain, app } from 'electron';
import type { WebContents } from 'electron';
import type { Flow } from '../shared/types';
import { runFlow } from './engine/runner';
import {
  listFlows,
  saveFlow,
  deleteFlow,
  getSettings,
  saveSettings,
} from './storage/flows';

let currentRun: AbortController | null = null;

export function registerIpc(): void {
  // ---- Flows ----
  ipcMain.handle('flows:list', () => listFlows());
  ipcMain.handle('flows:save', (_e, flow: Flow) => saveFlow(flow));
  ipcMain.handle('flows:delete', (_e, id: string) => deleteFlow(id));

  // ---- Settings ----
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:save', (_e, settings) => saveSettings(settings));

  // ---- Running ----
  ipcMain.handle(
    'run:start',
    async (e, payload: { flow: Flow; vars: Record<string, string> }) => {
      // Cancel any previous run first.
      currentRun?.abort();
      currentRun = new AbortController();

      const sender: WebContents = e.sender;
      const emit = {
        log: (msg: string) => sender.send('run:log', msg),
        status: (status: unknown) => sender.send('run:status', status),
      };

      const settings = await getSettings();
      try {
        return await runFlow(
          payload.flow,
          settings,
          payload.vars ?? {},
          emit,
          currentRun.signal,
          app.getPath('userData')
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sender.send('run:log', '❌ ' + message);
        return { ok: false, error: message };
      } finally {
        currentRun = null;
      }
    }
  );

  ipcMain.handle('run:stop', () => {
    currentRun?.abort();
    return { ok: true };
  });
}

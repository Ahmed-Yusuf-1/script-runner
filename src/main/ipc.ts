// Registers all IPC handlers — the only way the GUI can reach the engine,
// storage, and settings. Validates every payload at this boundary, and owns the
// current run so Stop / Pause / Resume can reach it.

import { ipcMain, app, shell, nativeTheme } from 'electron';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { promises as fs } from 'fs';
import { resolve, relative, isAbsolute } from 'path';
import type { Flow, LogEntry, LogLevel, RunOptions, Settings, StepStatus, RunProgress } from '../shared/types';
import type { RunState } from '../shared/api';
import { normalizeFlow } from '../shared/normalize';
import { runFlow, RunController } from './engine/runner';
import { listFlows, saveFlow, deleteFlow, exportFlow, importFlows } from './storage/flows';
import { getSettings, saveSettings } from './storage/settings';
import {
  listPresets,
  getActivePresetId,
  getActivePreset,
  selectPreset,
  createPreset,
  renamePreset,
  deletePreset,
  importPreset,
  exportPreset,
} from './storage/presets';
import { addRun, listRuns, getRun, deleteRun, clearRuns, knownFiles } from './storage/history';
import { paths, showOpen, showSave } from './storage/paths';

interface ActiveRun {
  controller: RunController;
  flowId: string;
  progress?: RunProgress;
  done: Promise<unknown>;
}
let active: ActiveRun | null = null;

// ---- Payload checks ----

function asString(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new Error(`Invalid ${what}.`);
  return v;
}

function asFlow(v: unknown): Flow {
  const flow = normalizeFlow(v);
  if (!flow) throw new Error('Invalid flow.');
  return flow;
}

function asVars(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val;
  }
  return out;
}

function asRunOptions(v: unknown): RunOptions {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const idx = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : undefined);
  return { startAt: idx(o.startAt), only: idx(o.only) };
}

/** True if `p` is `dir` or inside it. */
function isInside(dir: string, p: string): boolean {
  const rel = relative(resolve(dir), resolve(p));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Only open files the app itself saved: in the download folder, or listed in Run history. */
async function assertOpenable(p: string): Promise<string> {
  const target = resolve(asString(p, 'path'));
  const settings = await getSettings();
  if (isInside(settings.downloadDir, target)) return target;
  if ((await knownFiles()).has(target)) return target;
  throw new Error('Script Runner only opens files it saved.');
}

/** Register an invoke handler. Thrown errors reach the renderer as rejected promises. */
function handle<A extends unknown[], R>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => Promise<R> | R): void {
  ipcMain.handle(channel, (e, ...args) => fn(e, ...(args as A)));
}

/** Batches log lines so a chatty run doesn't flood IPC. */
function logBatcher(sender: WebContents) {
  let buf: LogEntry[] = [];
  let timer: NodeJS.Timeout | null = null;
  const flush = () => {
    timer = null;
    if (!buf.length || sender.isDestroyed()) return;
    const out = buf;
    buf = [];
    sender.send('run:log', out);
  };
  return {
    push(msg: string, level: LogLevel = 'info') {
      buf.push({ ts: Date.now(), level, msg });
      if (!timer) timer = setTimeout(flush, 40);
    },
    flush() {
      if (timer) clearTimeout(timer);
      flush();
    },
  };
}

export function applyTheme(settings: Settings): void {
  nativeTheme.themeSource = settings.theme;
}

export function registerIpc(): void {
  // ---- Flows ----
  handle('flows:list', () => listFlows());
  handle('flows:save', (_e, flow: unknown) => saveFlow(asFlow(flow)));
  handle('flows:delete', (_e, id: unknown) => deleteFlow(asString(id, 'flow id')));
  handle('flows:export', (_e, flow: unknown) => exportFlow(asFlow(flow)));
  handle('flows:import', () => importFlows());

  // ---- Settings ----
  handle('settings:get', () => getSettings());
  handle('settings:save', async (_e, settings: unknown) => {
    if (!settings || typeof settings !== 'object') throw new Error('Invalid settings.');
    const saved = await saveSettings(settings as Settings);
    applyTheme(saved);
    return saved;
  });
  handle('dialog:pickFolder', async (_e, current: unknown) => {
    const [dir] = await showOpen({
      title: 'Choose the download folder',
      defaultPath: typeof current === 'string' && current ? current : app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'],
    });
    return dir ?? null;
  });
  handle('profile:clear', async () => {
    if (active) throw new Error('Stop the current run first.');
    await fs.rm(paths.profileDir(), { recursive: true, force: true });
  });

  // ---- Presets ----
  const switched = async () => applyTheme(await getSettings());
  handle('presets:list', () => listPresets());
  handle('presets:getActive', () => getActivePresetId());
  handle('presets:select', async (_e, id: unknown) => {
    await selectPreset(id === null ? null : asString(id, 'preset id'));
    await switched();
  });
  handle('presets:create', (_e, name: unknown) => createPreset(asString(name, 'name')));
  handle('presets:rename', (_e, id: unknown, name: unknown) => renamePreset(asString(id, 'preset id'), asString(name, 'name')));
  handle('presets:delete', async (_e, id: unknown) => {
    await deletePreset(asString(id, 'preset id'));
    await switched();
  });
  handle('presets:import', async () => {
    const id = await importPreset();
    if (id) await switched();
    return id;
  });
  handle('presets:export', (_e, id: unknown) => exportPreset(id === null ? null : asString(id, 'preset id')));

  // ---- Running ----
  handle('run:start', async (e, flowRaw: unknown, varsRaw: unknown, optsRaw: unknown) => {
    if (active) throw new Error('A run is already in progress.');
    const flow = asFlow(flowRaw);
    const vars = asVars(varsRaw);
    const runOptions = asRunOptions(optsRaw);
    const sender = e.sender;
    const logs = logBatcher(sender);
    const send = (channel: string, payload: unknown) => {
      if (!sender.isDestroyed()) sender.send(channel, payload);
    };

    const controller = new RunController();
    const current: ActiveRun = { controller, flowId: flow.id, done: Promise.resolve() };
    active = current;

    const work = (async () => {
      const [settings, preset] = await Promise.all([getSettings(), getActivePreset()]);
      const result = await runFlow(
        flow,
        settings,
        vars,
        {
          log: (msg, level) => logs.push(msg, level),
          status: (s: StepStatus) => send('run:status', s),
          progress: (p) => {
            current.progress = p;
            send('run:progress', p);
          },
        },
        controller,
        { cacheDir: app.getPath('userData'), run: runOptions, presetName: preset?.name }
      );
      logs.flush();
      if (result.record) {
        await addRun(result.record).catch((err) => console.error('Could not save run history', err));
      }
      // The renderer has the log already; don't send it back twice.
      if (result.record) result.record = { ...result.record, log: [] };
      return result;
    })();
    current.done = work.catch(() => {});

    try {
      return await work;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logs.push(message, 'error');
      logs.flush();
      return { ok: false, status: 'error' as const, error: message };
    } finally {
      if (active === current) active = null;
    }
  });

  handle('run:stop', () => {
    active?.controller.stop();
  });
  handle('run:pause', () => {
    active?.controller.pause();
  });
  handle('run:resume', () => {
    active?.controller.resume();
  });
  handle('run:state', (): RunState =>
    active
      ? { running: true, paused: active.controller.paused, flowId: active.flowId, progress: active.progress }
      : { running: false, paused: false }
  );

  // ---- History ----
  handle('history:list', () => listRuns());
  handle('history:get', (_e, id: unknown) => getRun(asString(id, 'run id')));
  handle('history:delete', (_e, id: unknown) => deleteRun(asString(id, 'run id')));
  handle('history:clear', () => clearRuns());

  // ---- Files & app ----
  handle('shell:openDownloads', async () => {
    const { downloadDir } = await getSettings();
    await fs.mkdir(downloadDir, { recursive: true });
    const err = await shell.openPath(downloadDir);
    if (err) throw new Error(err);
  });
  handle('shell:openFile', async (_e, p: unknown) => {
    const target = await assertOpenable(p as string);
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
  });
  handle('shell:showInFolder', async (_e, p: unknown) => {
    shell.showItemInFolder(await assertOpenable(p as string));
  });
  handle('shell:openExternal', async (_e, url: unknown) => {
    const u = new URL(asString(url, 'link'));
    if (u.protocol !== 'https:') throw new Error('Only https links can be opened.');
    await shell.openExternal(u.toString());
  });
  handle('file:saveText', async (_e, name: unknown, text: unknown) => {
    const filePath = await showSave({
      title: 'Save',
      defaultPath: asString(name, 'file name'),
      filters: [{ name: 'Text', extensions: ['txt', 'log'] }],
    });
    if (!filePath) return false;
    await fs.writeFile(filePath, asString(text, 'text'), 'utf-8');
    return true;
  });
  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    dataDir: app.getPath('userData'),
  }));
}

/** Stop any run and wait (briefly) for it to close its browser. Used on quit. */
export async function shutdown(timeoutMs = 5000): Promise<void> {
  const run = active;
  if (!run) return;
  run.controller.stop();
  await Promise.race([run.done, new Promise((r) => setTimeout(r, timeoutMs))]);
}

export function isRunning(): boolean {
  return active !== null;
}

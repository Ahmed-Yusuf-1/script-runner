import { app, dialog, BrowserWindow } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import { join } from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import type { Flow, Settings, Preset } from '../../shared/types';

function flowsDir(): string {
  return join(app.getPath('userData'), 'flows');
}

async function ensureDir(): Promise<string> {
  const dir = flowsDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// ---- Active Preset State ----

let activePresetId: string | null = null;
let activePresetInit = false;

async function getActivePresetIdInternal(): Promise<string | null> {
  if (!activePresetInit) {
    try {
      const file = join(app.getPath('userData'), 'active-preset.json');
      const raw = await fs.readFile(file, 'utf-8');
      activePresetId = JSON.parse(raw).activePresetId ?? null;
    } catch {
      activePresetId = null;
    }
    activePresetInit = true;
  }
  return activePresetId;
}

export async function getActivePresetId(): Promise<string | null> {
  return getActivePresetIdInternal();
}

export async function getActivePreset(): Promise<Preset | null> {
  const currentId = await getActivePresetIdInternal();
  if (!currentId) return null;
  const file = join(app.getPath('userData'), 'presets', `${currentId}.json`);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw) as Preset;
  } catch {
    return null;
  }
}

export async function savePreset(preset: Preset): Promise<void> {
  const dir = join(app.getPath('userData'), 'presets');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, `${preset.id}.json`), JSON.stringify(preset, null, 2), 'utf-8');
}

// ---- Flows ----

export async function listFlows(): Promise<Flow[]> {
  const preset = await getActivePreset();
  if (preset) {
    return [...preset.flows].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  const dir = await ensureDir();
  const entries = await fs.readdir(dir);
  const flows: Flow[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(join(dir, name), 'utf-8');
      flows.push(JSON.parse(raw) as Flow);
    } catch {
      /* skip a corrupt file rather than failing the whole list */
    }
  }
  return flows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveFlow(flow: Flow): Promise<void> {
  flow.updatedAt = Date.now();
  const currentId = await getActivePresetIdInternal();
  if (currentId) {
    const preset = await getActivePreset();
    if (preset) {
      const index = preset.flows.findIndex((f) => f.id === flow.id);
      if (index >= 0) {
        preset.flows[index] = flow;
      } else {
        preset.flows.push(flow);
      }
      await savePreset(preset);
    }
    return;
  }

  const dir = await ensureDir();
  await fs.writeFile(join(dir, `${flow.id}.json`), JSON.stringify(flow, null, 2), 'utf-8');
}

export async function deleteFlow(id: string): Promise<void> {
  const currentId = await getActivePresetIdInternal();
  if (currentId) {
    const preset = await getActivePreset();
    if (preset) {
      preset.flows = preset.flows.filter((f) => f.id !== id);
      await savePreset(preset);
    }
    return;
  }

  const dir = await ensureDir();
  await fs.rm(join(dir, `${id}.json`), { force: true });
}

// ---- Settings ----

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export function defaultSettings(): Settings {
  return {
    headless: false,
    downloadDir: app.getPath('downloads'),
    timeoutMs: 15000,
    adblock: true,
    blockPopupWindows: true,
    blockPopupTabs: true,
    popupWhitelist: [],
    persistentSession: true,
  };
}

export async function getSettings(): Promise<Settings> {
  const preset = await getActivePreset();
  if (preset) {
    const defaults = defaultSettings();
    return { ...defaults, ...preset.settings };
  }

  try {
    const raw = await fs.readFile(settingsFile(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Settings> & { blockPopups?: boolean };
    const defaults = defaultSettings();
    if (parsed.blockPopups !== undefined) {
      if (parsed.blockPopupWindows === undefined) parsed.blockPopupWindows = parsed.blockPopups;
      if (parsed.blockPopupTabs === undefined) parsed.blockPopupTabs = parsed.blockPopups;
    }
    return { ...defaults, ...parsed };
  } catch {
    return defaultSettings();
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const currentId = await getActivePresetIdInternal();
  if (currentId) {
    const preset = await getActivePreset();
    if (preset) {
      preset.settings = settings;
      await savePreset(preset);
    }
    return;
  }

  await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 2), 'utf-8');
}

// ---- Presets Management ----

export async function selectPreset(id: string | null): Promise<void> {
  activePresetId = id;
  activePresetInit = true;
  const file = join(app.getPath('userData'), 'active-preset.json');
  await fs.writeFile(file, JSON.stringify({ activePresetId }), 'utf-8');
}

export async function createPreset(name: string): Promise<string> {
  const id = randomUUID();
  const settings = await getSettings();
  const flows = await listFlows();

  const preset: Preset = {
    id,
    name,
    settings,
    flows,
  };

  await savePreset(preset);
  await selectPreset(id);
  return id;
}

export async function deletePreset(id: string): Promise<void> {
  const dir = join(app.getPath('userData'), 'presets');
  await fs.rm(join(dir, `${id}.json`), { force: true });
  const currentId = await getActivePresetIdInternal();
  if (currentId === id) {
    await selectPreset(null);
  }
}

export async function listPresets(): Promise<{ id: string; name: string }[]> {
  const dir = join(app.getPath('userData'), 'presets');
  try {
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir);
    const list: { id: string; name: string }[] = [];
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(join(dir, name), 'utf-8');
        const parsed = JSON.parse(raw) as Preset;
        if (parsed.id && parsed.name) {
          list.push({ id: parsed.id, name: parsed.name });
        }
      } catch {
        // skip corrupt
      }
    }
    return list;
  } catch {
    return [];
  }
}

export async function exportPreset(id: string | null): Promise<boolean> {
  let name = 'Default Profile';
  let settings: Settings;
  let flows: Flow[];

  if (id) {
    const file = join(app.getPath('userData'), 'presets', `${id}.json`);
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const preset = JSON.parse(raw) as Preset;
      name = preset.name;
      settings = preset.settings;
      flows = preset.flows;
    } catch (err) {
      console.error('Failed to read preset for export', err);
      return false;
    }
  } else {
    settings = await getSettings();
    flows = await listFlows();
  }

  const saveOptions: SaveDialogOptions = {
    title: 'Export Preset',
    defaultPath: `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.preset.json`,
    filters: [
      { name: 'Script Runner Preset', extensions: ['json'] }
    ]
  };
  // Attach the dialog to the focused window when there is one.
  const win = BrowserWindow.getFocusedWindow();
  const { filePath } = win
    ? await dialog.showSaveDialog(win, saveOptions)
    : await dialog.showSaveDialog(saveOptions);

  if (!filePath) return false;

  const exportData = {
    version: 1,
    type: 'script-runner-preset',
    name,
    settings,
    flows,
  };

  await fs.writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf-8');
  return true;
}

export async function importPreset(): Promise<string | null> {
  const openOptions: OpenDialogOptions = {
    title: 'Import Preset',
    filters: [
      { name: 'Script Runner Preset', extensions: ['json'] }
    ],
    properties: ['openFile']
  };
  const win = BrowserWindow.getFocusedWindow();
  const { filePaths } = win
    ? await dialog.showOpenDialog(win, openOptions)
    : await dialog.showOpenDialog(openOptions);

  if (!filePaths || filePaths.length === 0) return null;

  try {
    const raw = await fs.readFile(filePaths[0], 'utf-8');
    const data = JSON.parse(raw);

    if (!data.name || !data.settings || !Array.isArray(data.flows)) {
      throw new Error('Invalid preset file structure. Must contain name, settings, and flows.');
    }

    const id = randomUUID();
    const preset: Preset = {
      id,
      name: `${data.name} (Imported)`,
      settings: data.settings,
      flows: data.flows,
    };

    await savePreset(preset);
    await selectPreset(id);
    return id;
  } catch (err) {
    console.error('Failed to import preset', err);
    dialog.showErrorBox('Import Error', err instanceof Error ? err.message : String(err));
    return null;
  }
}

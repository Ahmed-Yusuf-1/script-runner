// Preset profiles: each bundles its own flows and settings. When no preset is
// active the "Default profile" is used (flows/ and settings.json).

import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import type { Preset, Flow } from '../../shared/types';
import { normalizeFlow, normalizeSettings } from '../../shared/normalize';
import { paths, showOpen, showSave, slug } from './paths';
import { readJson, writeJsonAtomic, withLock, listJsonFiles, isSafeId } from './fsutil';
import { defaultSettings, getSettings } from './settings';
import { listFlows } from './flows';

export interface PresetInfo {
  id: string;
  name: string;
}

const EXPORT_TYPE = 'script-runner-preset';

let activePresetId: string | null = null;
let activeLoaded = false;

export async function getActivePresetId(): Promise<string | null> {
  if (!activeLoaded) {
    const r = await readJson<{ activePresetId?: unknown }>(paths.activePresetFile());
    const id = r.ok ? r.value.activePresetId : null;
    activePresetId = isSafeId(id) ? id : null;
    // A deleted or missing preset falls back to the default profile.
    if (activePresetId && !(await readPreset(activePresetId))) activePresetId = null;
    activeLoaded = true;
  }
  return activePresetId;
}

function normalizePreset(raw: unknown, id: string): Preset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const flows = Array.isArray(r.flows) ? r.flows.map(normalizeFlow).filter((f): f is Flow => f !== null) : [];
  return {
    id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Untitled preset',
    settings: normalizeSettings(r.settings, defaultSettings()),
    flows,
  };
}

export async function readPreset(id: string): Promise<Preset | null> {
  if (!isSafeId(id)) return null;
  const r = await readJson(paths.presetFile(id));
  return r.ok ? normalizePreset(r.value, id) : null;
}

export async function getActivePreset(): Promise<Preset | null> {
  const id = await getActivePresetId();
  return id ? readPreset(id) : null;
}

export async function writePreset(preset: Preset): Promise<void> {
  await writeJsonAtomic(paths.presetFile(preset.id), preset);
}

/** Read-modify-write a preset under a lock, so concurrent saves can't lose edits. */
export function updatePreset(id: string, mutate: (p: Preset) => void | Promise<void>): Promise<Preset | null> {
  return withLock(`preset:${id}`, async () => {
    const preset = await readPreset(id);
    if (!preset) return null;
    await mutate(preset);
    await writePreset(preset);
    return preset;
  });
}

export async function selectPreset(id: string | null): Promise<void> {
  if (id !== null && !(await readPreset(id))) throw new Error('That preset no longer exists.');
  activePresetId = id;
  activeLoaded = true;
  await writeJsonAtomic(paths.activePresetFile(), { activePresetId: id });
}

export async function listPresets(): Promise<PresetInfo[]> {
  const names = await listJsonFiles(paths.presetsDir());
  const list: PresetInfo[] = [];
  for (const file of names) {
    const id = file.replace(/\.json$/, '');
    if (!isSafeId(id)) continue;
    const r = await readJson<{ name?: unknown }>(paths.presetFile(id));
    if (r.ok && typeof r.value?.name === 'string') list.push({ id, name: r.value.name });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/** Create a preset from the current flows and settings, and switch to it. */
export async function createPreset(name: string): Promise<string> {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error('A preset needs a name.');
  const id = randomUUID();
  const preset: Preset = { id, name: clean, settings: await getSettings(), flows: await listFlows() };
  await writePreset(preset);
  await selectPreset(id);
  return id;
}

export async function renamePreset(id: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error('A preset needs a name.');
  await updatePreset(id, (p) => {
    p.name = clean;
  });
}

export async function deletePreset(id: string): Promise<void> {
  if (!isSafeId(id)) return;
  await withLock(`preset:${id}`, () => fs.rm(paths.presetFile(id), { force: true }));
  if ((await getActivePresetId()) === id) await selectPreset(null);
}

export async function exportPreset(id: string | null): Promise<boolean> {
  const preset = id ? await readPreset(id) : null;
  if (id && !preset) throw new Error('That preset no longer exists.');
  const name = preset?.name ?? 'Default profile';
  const settings = preset?.settings ?? (await getSettings());
  const flows = preset?.flows ?? (await listFlows());

  const filePath = await showSave({
    title: 'Export preset',
    defaultPath: `${slug(name)}.preset.json`,
    filters: [{ name: 'Script Runner preset', extensions: ['json'] }],
  });
  if (!filePath) return false;
  // The download folder is machine-specific, so it isn't exported.
  const { downloadDir: _omit, ...portable } = settings;
  await writeJsonAtomic(filePath, { version: 2, type: EXPORT_TYPE, name, settings: portable, flows });
  return true;
}

/** Import a preset file and switch to it. Returns its id, or null if cancelled. */
export async function importPreset(): Promise<string | null> {
  const [file] = await showOpen({
    title: 'Import preset',
    filters: [{ name: 'Script Runner preset', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (!file) return null;
  const r = await readJson<Record<string, unknown>>(file);
  if (!r.ok) throw new Error('That file isn’t valid JSON.');
  const data = r.value;
  if (!data || typeof data !== 'object' || !Array.isArray(data.flows) || typeof data.name !== 'string') {
    throw new Error('That file isn’t a Script Runner preset (it needs a name, settings and flows).');
  }
  const id = randomUUID();
  const preset = normalizePreset({ ...data, name: `${data.name} (imported)` }, id)!;
  // Imported flows get fresh ids so they can't collide with existing ones.
  preset.flows = preset.flows.map((f) => ({ ...f, id: randomUUID() }));
  await writePreset(preset);
  await selectPreset(id);
  return id;
}

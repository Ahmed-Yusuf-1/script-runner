// Flows: stored inside the active preset, or as one file each in flows/ for the
// default profile. Everything read from disk is normalized, so older or
// hand-edited files load safely.

import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import type { Flow } from '../../shared/types';
import { normalizeFlow } from '../../shared/normalize';
import { paths, showOpen, showSave, slug } from './paths';
import { readJson, writeJsonAtomic, listJsonFiles, quarantine, withLock, isSafeId } from './fsutil';
import { getActivePresetId, getActivePreset, updatePreset } from './presets';

const EXPORT_TYPE = 'script-runner-flow';

const newestFirst = (a: Flow, b: Flow) => b.updatedAt - a.updatedAt;

export async function listFlows(): Promise<Flow[]> {
  const preset = await getActivePreset();
  if (preset) return [...preset.flows].sort(newestFirst);

  const dir = paths.flowsDir();
  const flows: Flow[] = [];
  for (const name of await listJsonFiles(dir)) {
    const file = `${dir}/${name}`;
    const r = await readJson(file);
    const flow = r.ok ? normalizeFlow(r.value) : null;
    if (flow) flows.push(flow);
    else if (!r.ok && !r.missing) await quarantine(file); // skip a corrupt file rather than failing the list
  }
  return flows.sort(newestFirst);
}

/** Save (create or update) a flow. Returns the flow as stored. */
export async function saveFlow(raw: Flow): Promise<Flow> {
  const flow = normalizeFlow(raw);
  if (!flow || !isSafeId(flow.id)) throw new Error('That flow couldn’t be saved: it is malformed.');
  flow.updatedAt = Date.now();

  const presetId = await getActivePresetId();
  if (presetId) {
    const saved = await updatePreset(presetId, (p) => {
      const i = p.flows.findIndex((f) => f.id === flow.id);
      if (i >= 0) p.flows[i] = flow;
      else p.flows.push(flow);
    });
    if (saved) return flow;
  }
  await withLock(`flow:${flow.id}`, () => writeJsonAtomic(paths.flowFile(flow.id), flow));
  return flow;
}

export async function deleteFlow(id: string): Promise<void> {
  if (!isSafeId(id)) return;
  const presetId = await getActivePresetId();
  if (presetId) {
    const saved = await updatePreset(presetId, (p) => {
      p.flows = p.flows.filter((f) => f.id !== id);
    });
    if (saved) return;
  }
  await withLock(`flow:${id}`, () => fs.rm(paths.flowFile(id), { force: true }));
}

/** Save one flow to a file the user picks. */
export async function exportFlow(raw: Flow): Promise<boolean> {
  const flow = normalizeFlow(raw);
  if (!flow) throw new Error('That flow couldn’t be exported: it is malformed.');
  const filePath = await showSave({
    title: 'Export flow',
    defaultPath: `${slug(flow.name)}.flow.json`,
    filters: [{ name: 'Script Runner flow', extensions: ['json'] }],
  });
  if (!filePath) return false;
  await writeJsonAtomic(filePath, { version: 2, type: EXPORT_TYPE, flow });
  return true;
}

/**
 * Import flows from files the user picks (a flow export, a bare flow, or a
 * preset export, whose flows are all imported). Returns the saved flows.
 */
export async function importFlows(): Promise<Flow[]> {
  const files = await showOpen({
    title: 'Import flow',
    filters: [{ name: 'Script Runner flow or preset', extensions: ['json'] }],
    properties: ['openFile', 'multiSelections'],
  });
  const imported: Flow[] = [];
  for (const file of files) {
    const r = await readJson<Record<string, unknown>>(file);
    if (!r.ok) throw new Error(`${file} isn’t valid JSON.`);
    const data = r.value;
    const candidates: unknown[] =
      data && typeof data === 'object'
        ? Array.isArray(data.flows)
          ? data.flows
          : data.flow
            ? [data.flow]
            : [data]
        : [];
    for (const c of candidates) {
      const flow = normalizeFlow(c);
      if (!flow) continue;
      flow.id = randomUUID(); // never overwrite an existing flow
      flow.createdAt = Date.now();
      imported.push(await saveFlow(flow));
    }
  }
  if (files.length && !imported.length) throw new Error('No flows were found in that file.');
  return imported;
}

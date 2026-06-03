// Persists flows as individual JSON files under the app's userData directory,
// and stores settings in a single settings.json.

import { app } from 'electron';
import { join } from 'path';
import { promises as fs } from 'fs';
import type { Flow, Settings } from '../../shared/types';

function flowsDir(): string {
  return join(app.getPath('userData'), 'flows');
}

async function ensureDir(): Promise<string> {
  const dir = flowsDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function listFlows(): Promise<Flow[]> {
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
  const dir = await ensureDir();
  flow.updatedAt = Date.now();
  await fs.writeFile(join(dir, `${flow.id}.json`), JSON.stringify(flow, null, 2), 'utf-8');
}

export async function deleteFlow(id: string): Promise<void> {
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
  };
}

export async function getSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(settingsFile(), 'utf-8');
    return { ...defaultSettings(), ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return defaultSettings();
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 2), 'utf-8');
}

// File helpers for app data: atomic JSON writes (so a crash mid-save can't
// leave a half-written file) and per-key locks (so two saves to the same preset
// can't interleave and lose one of the edits). No Electron imports.

import { promises as fs } from 'fs';
import { dirname } from 'path';

const locks = new Map<string, Promise<unknown>>();

/** Run fn with exclusive access to `key`; calls with the same key run one at a time. */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  const tail = next.catch(() => {});
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return next;
}

let tmpCounter = 0;

/** Write JSON atomically: write a temp file next to the target, then rename it over. */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${++tmpCounter}.tmp`;
  const text = JSON.stringify(data, null, 2);
  try {
    await fs.writeFile(tmp, text, 'utf-8');
    await renameWithRetry(tmp, path);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Windows can briefly lock a file (antivirus, indexer); retry the rename a few times. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
}

export type ReadResult<T> = { ok: true; value: T } | { ok: false; missing: boolean; error?: unknown };

/** Read and parse a JSON file without throwing. */
export async function readJson<T = unknown>(path: string): Promise<ReadResult<T>> {
  let text: string;
  try {
    text = await fs.readFile(path, 'utf-8');
  } catch (err) {
    return { ok: false, missing: (err as NodeJS.ErrnoException).code === 'ENOENT', error: err };
  }
  try {
    return { ok: true, value: JSON.parse(text.replace(/^﻿/, '')) as T };
  } catch (error) {
    return { ok: false, missing: false, error };
  }
}

/**
 * Move an unreadable file aside (`name.corrupt-<time>.json`) so the app can
 * start fresh without destroying data someone might want to recover.
 */
export async function quarantine(path: string): Promise<string | null> {
  const dest = path.replace(/\.json$/i, '') + `.corrupt-${Date.now()}.json`;
  try {
    await fs.rename(path, dest);
    return dest;
  } catch {
    return null;
  }
}

/** List the *.json files in a directory (none if it doesn't exist). */
export async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((n) => n.endsWith('.json') && !n.includes('.corrupt-') && !n.endsWith('.tmp'));
  } catch {
    return [];
  }
}

/** Only allow ids we generated (UUID-ish) to become file names. */
export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

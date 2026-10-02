// Run history: one file per run (with its log), plus a small index of summaries
// so the History view can list runs without reading every log. Keeps the most
// recent MAX_RUNS runs.

import { promises as fs } from 'fs';
import type { RunRecord, RunSummary } from '../../shared/types';
import { paths } from './paths';
import { readJson, writeJsonAtomic, withLock, listJsonFiles, isSafeId } from './fsutil';

export const MAX_RUNS = 200;
const LOCK = 'history';

export function summarize(r: RunRecord): RunSummary {
  const { log: _log, steps, vars: _vars, ...rest } = r;
  return {
    ...rest,
    stepCount: steps.filter((s) => s.runs > 0).length,
    failures: steps.reduce((n, s) => n + s.failures, 0),
  };
}

async function readIndex(): Promise<RunSummary[]> {
  const r = await readJson<RunSummary[]>(paths.historyIndex());
  if (r.ok && Array.isArray(r.value)) return r.value;
  return rebuildIndex();
}

/** Recreate the index from the run files (if it was lost or corrupted). */
async function rebuildIndex(): Promise<RunSummary[]> {
  const out: RunSummary[] = [];
  for (const name of await listJsonFiles(paths.historyDir())) {
    if (name === 'index.json') continue;
    const r = await readJson<RunRecord>(`${paths.historyDir()}/${name}`);
    if (r.ok && r.value && typeof r.value.id === 'string') out.push(summarize(r.value));
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  if (out.length) await writeJsonAtomic(paths.historyIndex(), out).catch(() => {});
  return out;
}

export function addRun(record: RunRecord): Promise<void> {
  if (!isSafeId(record.id)) return Promise.resolve();
  return withLock(LOCK, async () => {
    await writeJsonAtomic(paths.historyFile(record.id), record);
    const index = [summarize(record), ...(await readIndex()).filter((r) => r.id !== record.id)];
    const keep = index.slice(0, MAX_RUNS);
    for (const old of index.slice(MAX_RUNS)) {
      if (isSafeId(old.id)) await fs.rm(paths.historyFile(old.id), { force: true }).catch(() => {});
    }
    await writeJsonAtomic(paths.historyIndex(), keep);
  });
}

export function listRuns(): Promise<RunSummary[]> {
  return withLock(LOCK, readIndex);
}

export async function getRun(id: string): Promise<RunRecord | null> {
  if (!isSafeId(id)) return null;
  const r = await readJson<RunRecord>(paths.historyFile(id));
  return r.ok ? r.value : null;
}

export function deleteRun(id: string): Promise<void> {
  if (!isSafeId(id)) return Promise.resolve();
  return withLock(LOCK, async () => {
    await fs.rm(paths.historyFile(id), { force: true });
    await writeJsonAtomic(paths.historyIndex(), (await readIndex()).filter((r) => r.id !== id));
  });
}

export function clearRuns(): Promise<void> {
  return withLock(LOCK, async () => {
    await fs.rm(paths.historyDir(), { recursive: true, force: true });
  });
}

/** Files that history recorded (downloads and screenshots), for "open" requests. */
export async function knownFiles(): Promise<Set<string>> {
  const set = new Set<string>();
  for (const r of await listRuns()) {
    for (const f of [...(r.downloads ?? []), ...(r.screenshots ?? [])]) set.add(f.path);
  }
  return set;
}

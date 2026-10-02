// Unit tests for the Node-side helpers (file names, atomic writes, locks) and
// the renderer's pure flow helpers. No browser. Run with:  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import { sanitizeFilename, uniquePath, release, sleep, AbortedError, errorMessage, formatMs, csvRow, csvHeaderNames } from '../src/main/engine/util';
import { isNewer } from '../src/shared/version';
import { similarity } from '../src/main/engine/target';
import { writeJsonAtomic, readJson, withLock, quarantine, isSafeId, listJsonFiles } from '../src/main/storage/fsutil';
import { insertStep, removeStepAt, moveStep, copyFlow, snapshot } from '../src/renderer/src/lib/flow';
import type { Flow, Step } from '../src/shared/types';

const tmp = () => mkdtempSync(join(tmpdir(), 'sr-unit-'));

// ---- file names ----

test('sanitizeFilename strips folders, bad characters and reserved names', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), '_.._etc_passwd');
  assert.equal(sanitizeFilename('a<b>:c"d|e?f*g.png'), 'a_b__c_d_e_f_g.png');
  assert.equal(sanitizeFilename('CON.txt'), '_CON.txt');
  assert.equal(sanitizeFilename('   '), 'file');
  assert.equal(sanitizeFilename('name. '), 'name');
  const long = sanitizeFilename('x'.repeat(300) + '.mp3');
  assert.ok(long.length <= 200 && long.endsWith('.mp3'));
});

test('uniquePath never returns an existing or reserved file', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'a.txt'), '');
  const p1 = await uniquePath(dir, 'a.txt');
  const p2 = await uniquePath(dir, 'a.txt'); // p1 is reserved, not yet written
  assert.equal(basename(p1), 'a (1).txt');
  assert.equal(basename(p2), 'a (2).txt');
  release(p1);
  release(p2);
  assert.equal(basename(await uniquePath(dir, 'a.txt')), 'a (1).txt');
  rmSync(dir, { recursive: true, force: true });
});

// ---- sleep ----

test('sleep ends early with AbortedError when stopped', async () => {
  const ac = new AbortController();
  const t0 = Date.now();
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(sleep(10_000, ac.signal), AbortedError);
  assert.ok(Date.now() - t0 < 1000);
  await assert.rejects(sleep(10, ac.signal), AbortedError); // already stopped
});

test('errorMessage drops Playwright call logs and colour codes', () => {
  assert.equal(errorMessage(new Error('Timeout 5000ms\nCall log:\n  - waiting')), 'Timeout 5000ms');
  assert.equal(errorMessage(new Error('[31mred[39m')), 'red');
  assert.equal(formatMs(1500), '1.5 s');
  assert.equal(formatMs(125_000), '2 m 05 s');
});

// ---- storage helpers ----

test('writeJsonAtomic writes complete files and leaves no temp files', async () => {
  const dir = tmp();
  const file = join(dir, 'sub', 'x.json');
  await Promise.all(Array.from({ length: 20 }, (_, i) => writeJsonAtomic(file, { i })));
  const r = await readJson<{ i: number }>(file);
  assert.ok(r.ok);
  assert.deepEqual(readdirSync(join(dir, 'sub')), ['x.json']);
  rmSync(dir, { recursive: true, force: true });
});

test('readJson reports missing vs corrupt files; quarantine moves corrupt ones aside', async () => {
  const dir = tmp();
  const missing = await readJson(join(dir, 'nope.json'));
  assert.equal(missing.ok, false);
  assert.equal(!missing.ok && missing.missing, true);
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{ not json');
  const r = await readJson(bad);
  assert.equal(!r.ok && r.missing, false);
  const moved = await quarantine(bad);
  assert.ok(moved && moved.includes('.corrupt-'));
  assert.deepEqual(await listJsonFiles(dir), []); // quarantined files aren't listed
  writeFileSync(join(dir, 'bom.json'), '﻿{"a":1}');
  const bom = await readJson<{ a: number }>(join(dir, 'bom.json'));
  assert.ok(bom.ok && bom.value.a === 1);
  rmSync(dir, { recursive: true, force: true });
});

test('withLock runs same-key work one at a time, and survives failures', async () => {
  const dir = tmp();
  const file = join(dir, 'count.json');
  writeFileSync(file, '0');
  const bump = () =>
    withLock('count', async () => {
      const n = Number(readFileSync(file, 'utf8'));
      await new Promise((r) => setTimeout(r, 2));
      writeFileSync(file, String(n + 1));
    });
  const failing = withLock('count', async () => {
    throw new Error('boom');
  });
  await Promise.all([...Array.from({ length: 25 }, bump), failing.catch(() => {})]);
  assert.equal(readFileSync(file, 'utf8'), '25');
  rmSync(dir, { recursive: true, force: true });
});

test('isSafeId only accepts plain ids', () => {
  assert.ok(isSafeId('0b7d6b3e-0f6e-4d3c-9a0a-1c2b3d4e5f60'));
  for (const bad of ['../x', 'a/b', '', 'x'.repeat(65), 5, null]) assert.equal(isSafeId(bad), false);
});

// ---- flow editing helpers ----

const steps = (n: number): Step[] => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, action: 'back' }) as Step);
const withRepeat = (n: number, from: number, to: number): Flow => ({
  id: 'f',
  name: 'F',
  steps: steps(n),
  createdAt: 0,
  updatedAt: 0,
  repeat: { enabled: true, fromStep: from, toStep: to, times: 2, counterName: 'n', counterStart: 1, counterStep: 1, delayMs: 0, waitForDownloads: true },
});
const range = (f: Flow) => [f.repeat!.fromStep, f.repeat!.toStep];

test('inserting a step keeps the repeat range on the same steps', () => {
  const x: Step = { id: 'x', action: 'back' };
  assert.deepEqual(range(insertStep(withRepeat(5, 3, 4), 0, x)), [4, 5]); // before the range
  assert.deepEqual(range(insertStep(withRepeat(5, 3, 4), 3, x)), [3, 5]); // inside it
  assert.deepEqual(range(insertStep(withRepeat(5, 3, 4), 5, x)), [3, 4]); // after it
  assert.equal(insertStep(withRepeat(5, 3, 4), 2, x).steps[2].id, 'x');
});

test('removing a step keeps the repeat range on the same steps', () => {
  assert.deepEqual(range(removeStepAt(withRepeat(5, 3, 4), 0)), [2, 3]);
  assert.deepEqual(range(removeStepAt(withRepeat(5, 3, 4), 3)), [3, 3]);
  assert.deepEqual(range(removeStepAt(withRepeat(5, 3, 4), 4)), [3, 4]);
  assert.equal(removeStepAt(withRepeat(5, 3, 4), 0).steps.length, 4);
});

test('moveStep reorders and ignores out-of-range moves', () => {
  const f = withRepeat(3, 1, 3);
  assert.deepEqual(moveStep(f, 0, 2).steps.map((s) => s.id), ['s2', 's3', 's1']);
  assert.equal(moveStep(f, 0, 5), f);
});

test('copyFlow gives the flow and every step new ids', () => {
  const f = withRepeat(2, 1, 2);
  const c = copyFlow(f);
  assert.notEqual(c.id, f.id);
  assert.ok(c.steps.every((s, i) => s.id !== f.steps[i].id));
  assert.equal(c.name, 'F (copy)');
});

test('snapshot ignores timestamps', () => {
  const f = withRepeat(1, 1, 1);
  assert.equal(snapshot(f), snapshot({ ...f, updatedAt: 999, createdAt: 5 }));
  assert.notEqual(snapshot(f), snapshot({ ...f, name: 'G' }));
});

// ---- CSV output ----

test('csvRow quotes only what needs quoting, and flattens newlines', () => {
  assert.equal(csvRow(['a', 'b']), 'a,b');
  assert.equal(csvRow(['Smith, John', 'ok']), '"Smith, John",ok');
  assert.equal(csvRow(['say "hi"']), '"say ""hi"""');
  assert.equal(csvRow(['two\nlines']), 'two lines');
  assert.equal(csvRow(['  padded  ']), 'padded');
});

test('csvHeaderNames names columns after the variables in the template', () => {
  assert.deepEqual(csvHeaderNames('{{title}}, {{price}}'), ['title', 'price']);
  assert.deepEqual(csvHeaderNames('{{a}} {{b}}, literal, '), ['a b', 'literal', 'column 3']);
});

// ---- update check ----

test('isNewer compares versions numerically, not alphabetically', () => {
  assert.equal(isNewer('1.2.10', '1.2.9'), true);
  assert.equal(isNewer('0.3.0', '0.2.9'), true);
  assert.equal(isNewer('v1.0.1', '1.0.1'), false);
  assert.equal(isNewer('1.0.0', '1.0.1'), false);
  assert.equal(isNewer('1.0.0', '1.0.0-beta'), true); // a release beats its pre-release
  assert.equal(isNewer('nonsense', '1.0.0'), false);
});

// ---- "did you mean" similarity ----

test('similarity ranks near-misses above unrelated text', () => {
  assert.ok(similarity('download mp3', 'download mp3') === 1);
  assert.ok(similarity('download', 'download mp3') > 0.7);
  assert.ok(similarity('downlod mp3', 'download mp3') > 0.8); // a typo
  assert.ok(similarity('download', 'subscribe now') < 0.34);
});

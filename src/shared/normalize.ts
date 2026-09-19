// Turns untrusted JSON (a saved file from an older version, or an imported
// preset/flow) into a well-formed Flow / Settings. Unknown fields are dropped,
// missing ones get defaults, and malformed steps are skipped rather than
// crashing the app.

import type { Flow, Step, Target, Settings, StepOptions, Action, Theme } from './types';
import { SCHEMA_VERSION } from './types';
import { ACTION_META } from './actions';
import { normalizeRepeat } from './repeat';
import type { LegacyRepeat } from './repeat';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined;
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

function normalizeTarget(raw: unknown): Target | undefined {
  if (!isObj(raw)) return undefined;
  const by = str(raw.by);
  const t: Target = {
    by: by === 'placeholder' || by === 'searchbox' || by === 'selector' ? by : 'text',
  };
  if (str(raw.text) !== undefined) t.text = str(raw.text);
  if (raw.match === 'contains' || raw.match === 'exact') t.match = raw.match;
  if (str(raw.selector) !== undefined) t.selector = str(raw.selector);
  // Older files stored the item number as a number.
  const index = str(raw.index) ?? (num(raw.index) !== undefined ? String(num(raw.index)) : undefined);
  if (index !== undefined) t.index = index;
  if (bool(raw.autoIncrement)) t.autoIncrement = true;
  return t;
}

function normalizeOptions(raw: unknown): StepOptions | undefined {
  if (!isObj(raw)) return undefined;
  const o: StepOptions = {};
  if (bool(raw.pressEnter) !== undefined) o.pressEnter = bool(raw.pressEnter);
  if (raw.onError === 'continue' || raw.onError === 'stop') o.onError = raw.onError;
  const positive = (k: 'timeoutMs' | 'waitMs' | 'waitAfterMs' | 'retries') => {
    const n = num(raw[k]);
    if (n !== undefined && n >= 0) o[k] = k === 'retries' ? Math.min(10, Math.round(n)) : n;
  };
  positive('timeoutMs');
  positive('waitMs');
  positive('waitAfterMs');
  positive('retries');
  if (raw.waitState === 'visible' || raw.waitState === 'hidden') o.waitState = raw.waitState;
  if (raw.expect === 'present' || raw.expect === 'absent') o.expect = raw.expect;
  return Object.keys(o).length ? o : undefined;
}

export function normalizeStep(raw: unknown): Step | null {
  if (!isObj(raw)) return null;
  const action = str(raw.action) as Action | undefined;
  if (!action || !(action in ACTION_META)) return null;
  const step: Step = { id: str(raw.id) || newId(), action };
  if (str(raw.value) !== undefined) step.value = str(raw.value);
  else if (num(raw.value) !== undefined) step.value = String(num(raw.value));
  const target = normalizeTarget(raw.target);
  if (target) step.target = target;
  if (str(raw.saveAs)) step.saveAs = str(raw.saveAs);
  if (bool(raw.disabled)) step.disabled = true;
  if (str(raw.note)) step.note = str(raw.note);
  const options = normalizeOptions(raw.options);
  if (options) step.options = options;
  return step;
}

/** Normalize a flow. Returns null when the input isn't recognizably a flow. */
export function normalizeFlow(raw: unknown): Flow | null {
  if (!isObj(raw) || !Array.isArray(raw.steps)) return null;
  const steps = raw.steps.map(normalizeStep).filter((s): s is Step => s !== null);

  // Step ids must be unique (history and live status are keyed by them).
  const seen = new Set<string>();
  for (const s of steps) {
    if (seen.has(s.id)) s.id = newId();
    seen.add(s.id);
  }

  const variables: Record<string, string> = {};
  if (isObj(raw.variables)) {
    for (const [k, v] of Object.entries(raw.variables)) {
      if (typeof v === 'string') variables[k] = v;
      else if (typeof v === 'number') variables[k] = String(v);
    }
  }

  const now = Date.now();
  const flow: Flow = {
    id: str(raw.id) || newId(),
    name: (str(raw.name) ?? '').trim() || 'Untitled flow',
    variables,
    steps,
    createdAt: num(raw.createdAt) ?? now,
    updatedAt: num(raw.updatedAt) ?? now,
    schemaVersion: SCHEMA_VERSION,
  };
  if (isObj(raw.repeat)) flow.repeat = normalizeRepeat(raw.repeat as LegacyRepeat, steps.length);
  return flow;
}

/** Fill in defaults and drop anything malformed. Also migrates v0.1 fields. */
export function normalizeSettings(raw: unknown, defaults: Settings): Settings {
  if (!isObj(raw)) return { ...defaults };
  // v0.1 had one "blockPopups" switch before it was split in two.
  const legacyPopups = bool(raw.blockPopups);
  const theme = str(raw.theme);
  const whitelist = Array.isArray(raw.popupWhitelist)
    ? raw.popupWhitelist.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
    : defaults.popupWhitelist;
  const timeout = num(raw.timeoutMs);
  const slowMo = num(raw.slowMoMs);
  return {
    headless: bool(raw.headless) ?? defaults.headless,
    downloadDir: (str(raw.downloadDir) ?? '').trim() || defaults.downloadDir,
    timeoutMs: timeout !== undefined && timeout >= 1000 ? Math.min(timeout, 3_600_000) : defaults.timeoutMs,
    adblock: bool(raw.adblock) ?? defaults.adblock,
    blockPopupWindows: bool(raw.blockPopupWindows) ?? legacyPopups ?? defaults.blockPopupWindows,
    blockPopupTabs: bool(raw.blockPopupTabs) ?? legacyPopups ?? defaults.blockPopupTabs,
    popupWhitelist: whitelist,
    persistentSession: bool(raw.persistentSession) ?? defaults.persistentSession,
    slowMoMs: slowMo !== undefined && slowMo >= 0 ? Math.min(slowMo, 5000) : defaults.slowMoMs,
    screenshotOnError: bool(raw.screenshotOnError) ?? defaults.screenshotOnError,
    theme: theme === 'dark' || theme === 'light' || theme === 'system' ? (theme as Theme) : defaults.theme,
  };
}

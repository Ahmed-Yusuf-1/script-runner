// Defaults + normalization for the Repeat config. Centralized so the engine and
// the UI agree, and so flows saved with the OLD repeat shape still load.

import type { RepeatConfig } from './types';

/** The old (pre-redesign) shape we still read from saved flows. */
export type LegacyRepeat = Partial<RepeatConfig> & { from?: number; to?: number; step?: number };

export function defaultRepeat(stepCount: number): RepeatConfig {
  const last = Math.max(1, stepCount);
  return {
    enabled: false,
    fromStep: 1,
    toStep: last,
    times: 3,
    counterName: 'n',
    counterStart: 1,
    counterStep: 1,
    delayMs: 0,
    waitForDownloads: true,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** A finite number, or undefined (so `??` falls through to the default). */
function fin(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** Upper bound on passes, so a typo can't queue a billion repetitions. */
export const MAX_REPEAT_TIMES = 100_000;

/** Fill in defaults, clamp the step range to the flow, and migrate legacy fields. */
export function normalizeRepeat(r: LegacyRepeat | undefined, stepCount: number): RepeatConfig {
  const d = defaultRepeat(stepCount);
  if (!r) return d;

  const last = Math.max(1, stepCount);
  // Legacy "from/to/step" counted passes by counter values.
  const from = fin(r.from);
  const to = fin(r.to);
  const legacyTimes =
    from != null && to != null ? Math.floor((to - from) / (fin(r.step) || 1)) + 1 : undefined;

  const fromStep = clamp(Math.round(fin(r.fromStep) ?? 1), 1, last);
  const toStep = clamp(Math.round(fin(r.toStep) ?? last), fromStep, last);

  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : false,
    fromStep,
    toStep,
    times: clamp(Math.round(fin(r.times) ?? legacyTimes ?? d.times), 0, MAX_REPEAT_TIMES),
    counterName: (typeof r.counterName === 'string' ? r.counterName : 'n').replace(/[^\w]/g, '') || 'n',
    counterStart: fin(r.counterStart) ?? from ?? 1,
    counterStep: fin(r.counterStep) ?? fin(r.step) ?? 1,
    delayMs: Math.max(0, fin(r.delayMs) ?? 0),
    waitForDownloads: typeof r.waitForDownloads === 'boolean' ? r.waitForDownloads : true,
  };
}

/** The counter value on a given (0-based) pass. */
export function counterAt(r: RepeatConfig, passIndex: number): number {
  return r.counterStart + passIndex * r.counterStep;
}

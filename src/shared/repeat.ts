// Defaults + normalization for the Repeat config. Centralized so the engine and
// the UI agree, and so flows saved with the OLD repeat shape still load.

import type { RepeatConfig } from './types';

/** The old (pre-redesign) shape we still read from saved flows. */
type LegacyRepeat = Partial<RepeatConfig> & { from?: number; to?: number; step?: number };

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

/** Fill in defaults, clamp the step range to the flow, and migrate legacy fields. */
export function normalizeRepeat(r: LegacyRepeat | undefined, stepCount: number): RepeatConfig {
  const d = defaultRepeat(stepCount);
  if (!r) return d;

  const last = Math.max(1, stepCount);
  // Legacy "from/to/step" counted passes by counter values.
  const legacyTimes =
    r.from != null && r.to != null ? Math.floor((r.to - r.from) / (r.step || 1)) + 1 : undefined;

  const fromStep = clamp(Math.round(r.fromStep ?? 1), 1, last);
  const toStep = clamp(Math.round(r.toStep ?? last), fromStep, last);

  return {
    enabled: r.enabled ?? false,
    fromStep,
    toStep,
    times: Math.max(0, Math.round(r.times ?? legacyTimes ?? d.times)),
    counterName: (r.counterName || 'n').replace(/[^\w]/g, '') || 'n',
    counterStart: r.counterStart ?? r.from ?? 1,
    counterStep: r.counterStep ?? r.step ?? 1,
    delayMs: Math.max(0, r.delayMs ?? 0),
    waitForDownloads: r.waitForDownloads ?? true,
  };
}

/** The counter value on a given (0-based) pass. */
export function counterAt(r: RepeatConfig, passIndex: number): number {
  return r.counterStart + passIndex * r.counterStep;
}

// Executes a Flow start to finish. If Repeat is on, it runs the steps BEFORE the
// repeated range once, then the chosen range N times (with an incrementing
// counter and optional pause), then the steps AFTER the range once.
//
// Along the way it streams log lines, per-step status and progress; honors Stop
// and Pause; retries failing steps; applies each step's onError policy; and
// returns a RunRecord for Run history. No Electron imports.

import { join } from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import type {
  Flow,
  Settings,
  RunResult,
  StepStatus,
  Step,
  LogLevel,
  LogEntry,
  RunProgress,
  RunOptions,
  RunRecord,
  RunStatus,
  StepResult,
  RepeatConfig,
} from '../../shared/types';
import { ACTION_META } from '../../shared/actions';
import { applyVariables, builtinValues, findMissing } from '../../shared/variables';
import { normalizeRepeat, counterAt } from '../../shared/repeat';
import { launch, close } from './browser';
import type { RunContext } from './browser';
import { runAction } from './actions';
import { sleep, uniquePath, release, errorMessage, formatMs, sanitizeFilename, csvHeaderNames, AbortedError } from './util';

export interface RunEmit {
  log: (msg: string, level?: LogLevel) => void;
  status: (status: StepStatus) => void;
  progress?: (progress: RunProgress) => void;
}

/** Stop / Pause / Resume for one run. */
export class RunController {
  private readonly ac = new AbortController();
  private isPaused = false;
  private waiters: (() => void)[] = [];
  private listeners: ((paused: boolean) => void)[] = [];

  constructor(external?: AbortSignal) {
    if (external) {
      if (external.aborted) this.ac.abort();
      else external.addEventListener('abort', () => this.stop(), { once: true });
    }
  }

  get signal(): AbortSignal {
    return this.ac.signal;
  }
  get paused(): boolean {
    return this.isPaused;
  }

  stop(): void {
    this.ac.abort();
    this.release();
  }

  pause(): void {
    if (this.ac.signal.aborted || this.isPaused) return;
    this.isPaused = true;
    this.listeners.forEach((l) => l(true));
  }

  resume(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.release();
    this.listeners.forEach((l) => l(false));
  }

  onPauseChange(cb: (paused: boolean) => void): void {
    this.listeners.push(cb);
  }

  /** Resolves immediately unless paused; then when resumed or stopped. */
  async waitIfPaused(): Promise<void> {
    while (this.isPaused && !this.ac.signal.aborted) {
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }

  private release(): void {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((r) => r());
  }
}

export interface RunFlowOptions {
  /** Where the ad-block cache and persistent browser profile live. */
  cacheDir?: string;
  /** Run the whole flow (default), start at a step, or run a single step. */
  run?: RunOptions;
  /** Shown in Run history. */
  presetName?: string;
}

/** Keep history records small: at most this many log lines. */
const MAX_RECORD_LOG = 2000;

type Halt = { status: 'error' | 'stopped'; error?: string };

export async function runFlow(
  flow: Flow,
  settings: Settings,
  vars: Record<string, string>,
  emit: RunEmit,
  control: RunController | AbortSignal,
  opts: RunFlowOptions = {}
): Promise<RunResult> {
  const controller = control instanceof RunController ? control : new RunController(control);
  const signal = controller.signal;
  const steps = flow.steps;
  const startedAt = Date.now();
  const runId = randomUUID();
  const only = opts.run?.only;
  const startAt = only == null ? Math.max(0, opts.run?.startAt ?? 0) : 0;
  const repeat: RepeatConfig | null =
    only == null && flow.repeat?.enabled ? normalizeRepeat(flow.repeat, steps.length) : null;

  // ---- Logging: stream to the UI and keep a copy for Run history ----
  const logEntries: LogEntry[] = [];
  let logTruncated = false;
  const log = (msg: string, level: LogLevel = 'info') => {
    const entry: LogEntry = { ts: Date.now(), level, msg };
    logEntries.push(entry);
    if (logEntries.length > MAX_RECORD_LOG) {
      logEntries.splice(0, logEntries.length - MAX_RECORD_LOG);
      logTruncated = true;
    }
    emit.log(msg, level);
  };

  // ---- Per-step results, aggregated across repeat passes ----
  const results = new Map<string, StepResult>();
  steps.forEach((s, index) =>
    results.set(s.id, { id: s.id, index, action: s.action, state: 'skipped', runs: 0, failures: 0, totalMs: 0 })
  );
  const setStatus = (status: StepStatus) => emit.status(status);

  // ---- Progress ----
  let ctx: RunContext | null = null;
  const progress: RunProgress = {
    runId,
    startedAt,
    stepIndex: -1,
    stepCount: steps.length,
    downloadsStarted: 0,
    downloadsSaved: 0,
    paused: false,
  };
  const pushProgress = (patch: Partial<RunProgress> = {}) => {
    Object.assign(progress, patch);
    if (ctx) {
      progress.downloadsStarted = ctx.downloadsStarted;
      progress.downloadsSaved = ctx.downloads.length;
    }
    emit.progress?.({ ...progress });
  };
  controller.onPauseChange((paused) => {
    log(paused ? 'Paused. The run continues after the current step when you press Resume.' : 'Resumed.', 'info');
    pushProgress({ paused });
  });

  const baseVars = { ...builtinValues(new Date(startedAt)), ...vars };
  const scope =
    only != null ? `step ${only + 1} only` : startAt > 0 ? `from step ${startAt + 1}` : `${steps.length} steps`;
  log(
    `Running “${flow.name}” (${scope}` +
      (repeat ? `, repeating steps ${repeat.fromStep}–${repeat.toStep} × ${repeat.times}` : '') +
      ')'
  );
  for (const name of findMissing(steps, vars, repeat?.counterName ?? flow.repeat?.counterName)) {
    log(`The input {{${name}}} is empty, so it will be replaced with nothing.`, 'warn');
  }

  let halt: Halt | null = null;
  let continuedFailures = 0;
  let dataFiles: { path: string; filename: string; bytes?: number }[] = [];

  const finish = (status: RunStatus, error?: string): RunResult => {
    const endedAt = Date.now();
    const record: RunRecord = {
      id: runId,
      flowId: flow.id,
      flowName: flow.name,
      presetName: opts.presetName,
      startedAt,
      endedAt,
      status,
      error,
      vars,
      steps: [...results.values()],
      downloads: ctx ? [...ctx.downloads] : [],
      screenshots: ctx ? [...ctx.screenshots] : [],
      dataFiles: dataFiles.slice(),
      log: logEntries,
      logTruncated: logTruncated || undefined,
    };
    return { ok: status !== 'error', status, error, record };
  };

  // Downloads can go straight into the folder, or be grouped per flow or per run
  // so a big job doesn't mix with everything else.
  const builtins = builtinValues(new Date(startedAt));
  const folderName = sanitizeFilename(flow.name || 'Flow', 'Flow');
  const downloadDir =
    settings.downloadSubfolder === 'flow'
      ? join(settings.downloadDir, folderName)
      : settings.downloadSubfolder === 'run'
        ? join(settings.downloadDir, `${folderName} ${builtins.datetime}`)
        : settings.downloadDir;

  // Make sure the download folder exists before anything tries to save into it.
  try {
    await fs.mkdir(downloadDir, { recursive: true });
    if (downloadDir !== settings.downloadDir) log(`Saving files to ${downloadDir}`, 'debug');
  } catch (err) {
    const message = `Can't use the download folder “${downloadDir}”: ${errorMessage(err)}`;
    log(message, 'error');
    return finish('error', message);
  }

  log('Launching browser…', 'debug');
  try {
    ctx = await launch({
      headless: settings.headless,
      downloadDir,
      timeoutMs: settings.timeoutMs,
      adblock: settings.adblock,
      blockPopupWindows: settings.blockPopupWindows,
      blockPopupTabs: settings.blockPopupTabs,
      popupWhitelist: settings.popupWhitelist,
      slowMoMs: settings.slowMoMs,
      dismissConsent: settings.dismissConsent,
      handleDialogs: settings.handleDialogs,
      blockImages: settings.blockImages,
      skipExistingDownloads: settings.skipExistingDownloads,
      viewportWidth: settings.viewportWidth,
      viewportHeight: settings.viewportHeight,
      userAgent: settings.userAgent,
      proxy: settings.proxy,
      cacheDir: opts.cacheDir,
      profileDir: settings.persistentSession && opts.cacheDir ? join(opts.cacheDir, 'browser-profile') : undefined,
      log,
      signal,
    });
  } catch (err) {
    const message = errorMessage(err);
    log(message, 'error');
    return finish('error', message);
  }
  const run = ctx;

  // The "Pause for me" step hands control to the person until they press Resume.
  run.pauseForUser = async (message: string) => {
    pushProgress({ paused: true, pauseReason: message });
    controller.pause();
    await controller.waitIfPaused();
    pushProgress({ paused: false, pauseReason: undefined });
  };

  const onAbort = () => void close(run);
  signal.addEventListener('abort', onAbort);
  const ticker = setInterval(() => pushProgress(), 1000);

  // A safety net for unattended runs: stop automatically after the time limit.
  const limit =
    settings.maxRunMs > 0
      ? setTimeout(() => {
          log(`Stopping: this run hit the ${formatMs(settings.maxRunMs)} time limit.`, 'warn');
          controller.stop();
        }, settings.maxRunMs)
      : null;
  pushProgress();

  /** Run step i with the given variables. Returns a Halt to end the run. */
  const exec = async (i: number, stepVars: Record<string, string>, pass?: number): Promise<Halt | null> => {
    await controller.waitIfPaused();
    if (signal.aborted) return { status: 'stopped' };
    pushProgress({ stepIndex: i, pass, passes: pass != null && repeat ? repeat.times : undefined });
    // A new CSV gets a header row named after the variables in the template.
    run.csvHeaders = steps[i].action === 'appendRow' ? csvHeaderNames(steps[i].value ?? '') : undefined;
    const r = await runStep(run, steps[i], i, settings, { ...stepVars, ...run.runVars }, log, setStatus, signal);
    const res = results.get(steps[i].id)!;
    if (r.outcome !== 'skipped') {
      res.runs += 1;
      res.totalMs += r.ms;
    }
    if (r.outcome === 'ok' && res.state !== 'error') res.state = 'ok';
    if (r.outcome === 'failed' || r.outcome === 'continued') {
      res.failures += 1;
      res.state = 'error';
      res.message = r.message;
    }
    if (r.outcome === 'continued') continuedFailures += 1;
    if (r.outcome === 'stopped') return { status: 'stopped' };
    if (r.outcome === 'failed') return { status: 'error', error: r.message };
    return null;
  };

  try {
    if (only != null) {
      if (only < 0 || only >= steps.length) throw new Error(`There is no step ${only + 1}.`);
      // A step inside the repeat range sees the counter's first value.
      const rep = flow.repeat?.enabled ? normalizeRepeat(flow.repeat, steps.length) : null;
      const inRange = rep && only >= rep.fromStep - 1 && only <= rep.toStep - 1;
      const v = inRange ? { ...baseVars, [rep.counterName]: String(counterAt(rep, 0)) } : baseVars;
      halt = await exec(only, v);
    } else if (!repeat) {
      for (let i = startAt; i < steps.length && !halt; i++) halt = await exec(i, baseVars);
    } else {
      const from = repeat.fromStep - 1; // 0-based
      const to = repeat.toStep - 1; // 0-based, inclusive

      // 1) Steps before the repeated range — run once.
      for (let i = startAt; i < from && !halt; i++) halt = await exec(i, baseVars);

      // 2) The repeated range — run `times` times with the counter. "Run from
      //    step N" inside the range starts the FIRST pass at N.
      if (startAt <= to) {
        for (let p = 0; p < repeat.times && !halt; p++) {
          const counter = counterAt(repeat, p);
          const passVars = { ...baseVars, [repeat.counterName]: String(counter) };
          log(`Repetition ${p + 1} of ${repeat.times} · ${repeat.counterName} = ${counter}`, 'debug');
          const first = p === 0 ? Math.max(from, startAt) : from;
          for (let i = first; i <= to && !halt; i++) halt = await exec(i, passVars, p + 1);
          if (halt || p === repeat.times - 1) break;
          // Don't start the next repetition while a download is still saving.
          if (repeat.waitForDownloads) await waitForActiveDownloads(run, log, signal, settings.downloadWaitMs);
          if (repeat.delayMs > 0 && !signal.aborted) {
            log(`Pausing ${formatMs(repeat.delayMs)} before the next repetition…`, 'debug');
            await sleep(repeat.delayMs, signal).catch(() => {});
          }
          if (signal.aborted) halt = { status: 'stopped' };
        }
      }

      // 3) Steps after the repeated range — run once.
      for (let i = Math.max(to + 1, startAt); i < steps.length && !halt; i++) halt = await exec(i, baseVars);
    }

    // Let any in-progress download finish before we close the browser (closing
    // would abort a large download mid-stream).
    if (!halt && !signal.aborted) await waitForActiveDownloads(run, log, signal, settings.downloadWaitMs);
    if (signal.aborted && !halt) halt = { status: 'stopped' };
  } catch (err) {
    if (signal.aborted) halt = { status: 'stopped' };
    else {
      const message = errorMessage(err);
      log(message, 'error');
      halt = { status: 'error', error: message };
    }
  } finally {
    clearInterval(ticker);
    if (limit) clearTimeout(limit);
    signal.removeEventListener('abort', onAbort);
    dataFiles = await Promise.all(
      run.savedRows.map(async (p) => ({
        path: p,
        filename: p.split(/[\\/]/).pop() ?? p,
        bytes: await fs.stat(p).then((st) => st.size).catch(() => undefined),
      }))
    );
    await close(run);
    log('Browser closed.', 'debug');
  }

  pushProgress({ stepIndex: -1, paused: false });
  const took = formatMs(Date.now() - startedAt);
  const files = run.downloads.length;
  const filesText = files ? `, ${files} file${files === 1 ? '' : 's'} saved` : '';

  if (halt?.status === 'stopped') {
    log(`Stopped after ${took}${filesText}.`, 'warn');
    return finish('stopped');
  }
  if (halt?.status === 'error') {
    log(`Run failed after ${took}: ${halt.error}`, 'error');
    return finish('error', halt.error);
  }
  if (continuedFailures > 0) {
    log(
      `Finished in ${took}${filesText}, but ${continuedFailures} step${continuedFailures === 1 ? '' : 's'} failed and ${continuedFailures === 1 ? 'was' : 'were'} skipped.`,
      'warn'
    );
    return finish('warn');
  }
  log(`Done in ${took}${filesText}.`, 'success');
  return finish('ok');
}

/** Block until all in-progress downloads finish saving (or the user hits Stop). */
async function waitForActiveDownloads(
  ctx: RunContext,
  log: (m: string, l?: LogLevel) => void,
  signal: AbortSignal,
  maxWaitMs = 0
): Promise<void> {
  if (ctx.activeDownloads <= 0 || signal.aborted) return;
  log(`Waiting for ${ctx.activeDownloads} download(s) to finish saving…`);
  const started = Date.now();
  while (ctx.activeDownloads > 0 && !signal.aborted) {
    // A download that stalls forever shouldn't hold the run (and the browser)
    // open for the rest of the day.
    if (maxWaitMs > 0 && Date.now() - started > maxWaitMs) {
      log(`Still ${ctx.activeDownloads} download(s) unfinished after ${formatMs(maxWaitMs)} — carrying on without them.`, 'warn');
      return;
    }
    await sleep(300, signal).catch(() => {});
  }
  if (!signal.aborted) log('Download(s) finished.', 'debug');
}

type StepOutcome = { outcome: 'ok' | 'skipped' | 'stopped' | 'failed' | 'continued'; ms: number; message?: string };

/** Runs one step, with retries. Never throws. */
async function runStep(
  ctx: RunContext,
  step: Step,
  index: number,
  settings: Settings,
  vars: Record<string, string>,
  log: (msg: string, level?: LogLevel) => void,
  setStatus: (s: StepStatus) => void,
  signal: AbortSignal
): Promise<StepOutcome> {
  const label = `Step ${index + 1} (${ACTION_META[step.action]?.label ?? step.action})`;
  if (signal.aborted) return { outcome: 'stopped', ms: 0 };

  if (step.disabled) {
    setStatus({ id: step.id, state: 'skipped', message: 'Disabled' });
    log(`${label} is disabled, skipping.`, 'debug');
    return { outcome: 'skipped', ms: 0 };
  }

  // Some sites close our tab when a download starts. Recover onto a live tab so
  // the rest of the flow (and the next repetition) can continue.
  if (ctx.page.isClosed()) {
    try {
      const open = ctx.context.pages().filter((p) => !p.isClosed());
      ctx.page = open.length ? open[open.length - 1] : await ctx.context.newPage();
      log('The page had closed; continuing on a fresh tab.', 'warn');
    } catch {
      if (signal.aborted) return { outcome: 'stopped', ms: 0 };
      return { outcome: 'failed', ms: 0, message: 'The browser was closed before the run finished.' };
    }
  }

  const timeout = step.options?.timeoutMs && step.options.timeoutMs > 0 ? step.options.timeoutMs : settings.timeoutMs;
  ctx.stepTimeout = timeout;
  ctx.context.setDefaultTimeout(timeout);
  const attempts = 1 + Math.max(0, Math.min(10, Math.round(step.options?.retries ?? 0)));
  const started = Date.now();
  let lastError = '';

  try {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      setStatus({ id: step.id, state: 'running', attempt, attempts });
      // Retrying must reuse the same "auto-increment" item, not skip to the next.
      const autoBefore = ctx.autoIndex.get(step.id);
      try {
        await runAction(ctx, applyVariables(step, vars), { log });
        setStatus({ id: step.id, state: 'ok', message: attempt > 1 ? `Succeeded on attempt ${attempt}` : undefined });
        return { outcome: 'ok', ms: Date.now() - started };
      } catch (err) {
        if (signal.aborted || err instanceof AbortedError) {
          setStatus({ id: step.id, state: 'skipped', message: 'Stopped' });
          return { outcome: 'stopped', ms: Date.now() - started };
        }
        lastError = errorMessage(err);
        if (attempt < attempts) {
          if (autoBefore === undefined) ctx.autoIndex.delete(step.id);
          else ctx.autoIndex.set(step.id, autoBefore);
          const backoff = Math.min(1000 * attempt, 5000);
          log(`${label} failed (attempt ${attempt} of ${attempts}): ${lastError} Retrying in ${formatMs(backoff)}…`, 'warn');
          try {
            await sleep(backoff, signal);
          } catch {
            setStatus({ id: step.id, state: 'skipped', message: 'Stopped' });
            return { outcome: 'stopped', ms: Date.now() - started };
          }
          if (ctx.page.isClosed()) {
            const open = ctx.context.pages().filter((p) => !p.isClosed());
            if (open.length) ctx.page = open[open.length - 1];
          }
        }
      }
    }
  } finally {
    ctx.stepTimeout = settings.timeoutMs;
    try {
      ctx.context.setDefaultTimeout(settings.timeoutMs);
    } catch {
      /* browser already closed */
    }
  }

  // Every attempt failed.
  const message = attempts > 1 ? `${lastError} (after ${attempts} attempts)` : lastError;
  setStatus({ id: step.id, state: 'error', message });
  log(`${label} failed: ${message}`, 'error');
  if (settings.screenshotOnError) await captureError(ctx, index, log);

  if ((step.options?.onError ?? 'stop') === 'stop') {
    return { outcome: 'failed', ms: Date.now() - started, message: `Step ${index + 1}: ${message}` };
  }
  log('Continuing with the next step (this step is set to continue on error).', 'warn');
  return { outcome: 'continued', ms: Date.now() - started, message };
}

/** Save a screenshot of the page as it was when a step failed. Never throws. */
async function captureError(ctx: RunContext, index: number, log: (m: string, l?: LogLevel) => void): Promise<void> {
  if (ctx.page.isClosed()) return;
  let path = '';
  try {
    const dir = join(ctx.downloadDir, 'Script Runner errors');
    await fs.mkdir(dir, { recursive: true });
    const b = builtinValues();
    path = await uniquePath(dir, `${b.datetime} step ${index + 1}.png`);
    await ctx.page.screenshot({ path, timeout: 5000 });
    ctx.screenshots.push({ path, filename: path.split(/[\\/]/).pop() ?? 'error.png' });
    log(`Saved a screenshot of the failure: ${path}`, 'info');
  } catch {
    /* best effort */
  } finally {
    if (path) release(path);
  }
}


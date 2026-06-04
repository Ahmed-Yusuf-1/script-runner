// Executes a Flow start to finish. If Repeat is on, it runs the steps BEFORE the
// repeated range once, then the chosen range N times (with an incrementing
// counter and optional pause), then the steps AFTER the range once. Streams log
// lines and per-step status, honors Stop and each step's onError policy.

import type { Flow, Settings, RunResult, StepStatus, Step } from '../../shared/types';
import { applyVariables } from '../../shared/variables';
import { normalizeRepeat, counterAt } from '../../shared/repeat';
import { launch, close } from './browser';
import { runAction } from './actions';

export interface RunEmit {
  log: (msg: string) => void;
  status: (status: StepStatus) => void;
}

export async function runFlow(
  flow: Flow,
  settings: Settings,
  vars: Record<string, string>,
  emit: RunEmit,
  signal: AbortSignal,
  cacheDir?: string
): Promise<RunResult> {
  const steps = flow.steps;
  const repeat = flow.repeat?.enabled ? normalizeRepeat(flow.repeat, steps.length) : null;

  emit.log(
    `--- Running "${flow.name}" (${steps.length} steps` +
      (repeat ? `, repeating steps ${repeat.fromStep}–${repeat.toStep} × ${repeat.times}` : '') +
      ') ---'
  );
  emit.log('Launching browser…');

  const ctx = await launch({
    headless: settings.headless,
    downloadDir: settings.downloadDir,
    timeoutMs: settings.timeoutMs,
    adblock: settings.adblock,
    blockPopupWindows: settings.blockPopupWindows,
    blockPopupTabs: settings.blockPopupTabs,
    popupWhitelist: settings.popupWhitelist,
    cacheDir,
    profileDir:
      settings.persistentSession && cacheDir ? `${cacheDir}/browser-profile` : undefined,
    log: emit.log,
  });

  const onAbort = () => void close(ctx);
  signal.addEventListener('abort', onAbort);

  try {
    if (!repeat) {
      for (const step of steps) {
        const halt = await runStep(ctx, step, settings, vars, emit, signal);
        if (halt) return halt;
      }
    } else {
      const from = repeat.fromStep - 1; // 0-based
      const to = repeat.toStep - 1; // 0-based, inclusive

      // 1) Steps before the repeated range — run once.
      for (let i = 0; i < from; i++) {
        const halt = await runStep(ctx, steps[i], settings, vars, emit, signal);
        if (halt) return halt;
      }

      // 2) The repeated range — run `times` times with the counter.
      for (let p = 0; p < repeat.times && !signal.aborted; p++) {
        const counter = counterAt(repeat, p);
        const passVars = { ...vars, [repeat.counterName]: String(counter) };
        emit.log(`\n— Repetition ${p + 1} of ${repeat.times}  (${repeat.counterName} = ${counter}) —`);
        for (let i = from; i <= to; i++) {
          const halt = await runStep(ctx, steps[i], settings, passVars, emit, signal);
          if (halt) return halt;
        }
        if (repeat.delayMs > 0 && p < repeat.times - 1 && !signal.aborted) {
          emit.log(`Pausing ${repeat.delayMs}ms before the next repetition…`);
          await new Promise((r) => setTimeout(r, repeat.delayMs));
        }
      }

      // 3) Steps after the repeated range — run once.
      for (let i = to + 1; i < steps.length && !signal.aborted; i++) {
        const halt = await runStep(ctx, steps[i], settings, vars, emit, signal);
        if (halt) return halt;
      }
    }

    if (!signal.aborted) emit.log('✅ Done.');
    return { ok: true };
  } finally {
    signal.removeEventListener('abort', onAbort);
    await close(ctx);
    emit.log('Browser closed.');
  }
}

/** Runs one step. Returns null to continue, or a RunResult to halt the whole run. */
async function runStep(
  ctx: Awaited<ReturnType<typeof launch>>,
  step: Step,
  settings: Settings,
  vars: Record<string, string>,
  emit: RunEmit,
  signal: AbortSignal
): Promise<RunResult | null> {
  if (signal.aborted) {
    emit.log('⏹ Stopped by user.');
    return { ok: true };
  }

  // Some sites close our tab when a download starts. Recover onto a live tab so
  // the rest of the flow (and the next repetition) can continue.
  if (ctx.page.isClosed()) {
    try {
      const open = ctx.context.pages().filter((p) => !p.isClosed());
      ctx.page = open.length ? open[open.length - 1] : await ctx.context.newPage();
      emit.log('↻ The page had closed — continuing on a fresh tab.');
    } catch {
      if (signal.aborted) return { ok: true };
      return { ok: false, error: 'The browser was closed before the run finished.' };
    }
  }

  emit.status({ id: step.id, state: 'running' });
  if (step.options?.timeoutMs) ctx.context.setDefaultTimeout(step.options.timeoutMs);

  try {
    const resolved = applyVariables(step, vars);
    await runAction(ctx, resolved, emit);
    emit.status({ id: step.id, state: 'ok' });
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (signal.aborted) {
      emit.status({ id: step.id, state: 'skipped' });
      return { ok: true };
    }
    emit.status({ id: step.id, state: 'error', message });
    emit.log('❌ ' + message);
    if ((step.options?.onError ?? 'stop') === 'stop') {
      return { ok: false, error: message };
    }
    emit.log('Continuing to the next step (onError = continue).');
    return null;
  } finally {
    if (step.options?.timeoutMs) ctx.context.setDefaultTimeout(settings.timeoutMs);
  }
}

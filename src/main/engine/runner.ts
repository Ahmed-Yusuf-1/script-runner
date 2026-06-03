// Executes a Flow start to finish: applies variables, runs each step, streams
// log lines and per-step status, honors the Stop signal and each step's
// onError policy.

import type { Flow, Settings, RunResult, StepStatus } from '../../shared/types';
import { applyVariables } from '../../shared/variables';
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
  signal: AbortSignal
): Promise<RunResult> {
  emit.log(`--- Running "${flow.name}" (${flow.steps.length} steps) ---`);
  emit.log('Launching browser…');

  const ctx = await launch({
    headless: settings.headless,
    downloadDir: settings.downloadDir,
    timeoutMs: settings.timeoutMs,
  });

  // Pressing Stop closes the browser, which makes any in-flight Playwright call
  // reject and breaks us out of the loop promptly.
  const onAbort = () => {
    void close(ctx);
  };
  signal.addEventListener('abort', onAbort);

  try {
    for (const step of flow.steps) {
      if (signal.aborted) {
        emit.log('⏹ Stopped by user.');
        break;
      }

      emit.status({ id: step.id, state: 'running' });

      // Per-step timeout override, if set.
      if (step.options?.timeoutMs) {
        ctx.context.setDefaultTimeout(step.options.timeoutMs);
      }

      try {
        const resolved = applyVariables(step, vars);
        await runAction(ctx, resolved, emit);
        emit.status({ id: step.id, state: 'ok' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (signal.aborted) {
          emit.status({ id: step.id, state: 'skipped' });
          break;
        }
        emit.status({ id: step.id, state: 'error', message });
        emit.log('❌ ' + message);
        const policy = step.options?.onError ?? 'stop';
        if (policy === 'stop') {
          return { ok: false, error: message };
        }
        emit.log('Continuing to the next step (onError = continue).');
      } finally {
        // Restore the default timeout for the next step.
        if (step.options?.timeoutMs) {
          ctx.context.setDefaultTimeout(settings.timeoutMs);
        }
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

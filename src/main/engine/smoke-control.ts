// Headless smoke test for run control: Stop interrupts a long wait right away,
// disabled steps are skipped, retries recover a flaky step, "continue on error"
// finishes with a warning, run-from-step / run-one-step, pause & resume, and the
// screenshot taken when a step fails. Run with:  npm run smoke:control

import { mkdtempSync, existsSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runFlow, RunController } from './runner';
import { serve, testSettings, Checks, quietEmit } from './testkit';
import type { Flow, Step } from '../../shared/types';

const flow = (steps: Step[]): Flow => ({ id: 'f', name: 'control', steps, createdAt: 0, updatedAt: 0 });
const shot = (id: string, file: string, extra: Partial<Step> = {}): Step => ({ id, action: 'screenshot', value: file, ...extra });

async function main() {
  const t = new Checks();
  const srv = await serve({
    '/late': `<body><script>setTimeout(() => { const b = document.createElement('button'); b.textContent = 'Late'; document.body.append(b); }, 2200)</script></body>`,
    '/plain': '<body><p>Nothing to click</p></body>',
  });
  const fresh = () => mkdtempSync(join(tmpdir(), 'sr-ctl-'));
  const dirs: string[] = [];

  try {
    // 1) Stop during a 20 s wait returns promptly.
    {
      const dir = fresh();
      dirs.push(dir);
      const c = new RunController();
      const started = Date.now();
      setTimeout(() => c.stop(), 1500);
      const res = await runFlow(flow([{ id: 'w', action: 'wait', value: '20000' }]), testSettings(dir), {}, quietEmit, c);
      const took = Date.now() - started;
      t.check(`Stop ended a 20 s wait promptly (${took}ms)`, res.status === 'stopped' && took < 5000, res);
    }

    // 2) Disabled steps are skipped.
    {
      const dir = fresh();
      dirs.push(dir);
      const res = await runFlow(
        flow([shot('a', 'a.png'), shot('b', 'b.png', { disabled: true }), shot('c', 'c.png')]),
        testSettings(dir),
        {},
        quietEmit,
        new AbortController().signal
      );
      const bState = res.record?.steps.find((s) => s.id === 'b')?.state;
      t.check(
        'a disabled step is skipped, the others run',
        res.ok && existsSync(join(dir, 'a.png')) && !existsSync(join(dir, 'b.png')) && existsSync(join(dir, 'c.png')) && bState === 'skipped',
        { bState }
      );
    }

    // 3) Retries recover a step whose element shows up late.
    {
      const dir = fresh();
      dirs.push(dir);
      const res = await runFlow(
        flow([
          { id: 'g', action: 'goto', value: srv.base + '/late' },
          { id: 'k', action: 'click', target: { by: 'text', text: 'Late' }, options: { timeoutMs: 800, retries: 3 } },
        ]),
        testSettings(dir),
        {},
        quietEmit,
        new AbortController().signal
      );
      const k = res.record?.steps.find((s) => s.id === 'k');
      t.check('retries recovered a flaky step', res.status === 'ok' && k?.state === 'ok', { status: res.status, k });
    }

    // 4) "Continue on error" finishes the run with a warning; screenshot on error is saved.
    {
      const dir = fresh();
      dirs.push(dir);
      const res = await runFlow(
        flow([
          { id: 'g', action: 'goto', value: srv.base + '/plain' },
          { id: 'x', action: 'click', target: { by: 'text', text: 'Missing' }, options: { timeoutMs: 500, onError: 'continue' } },
          shot('after', 'after.png'),
        ]),
        testSettings(dir, { screenshotOnError: true }),
        {},
        quietEmit,
        new AbortController().signal
      );
      const errDir = join(dir, 'Script Runner errors');
      const errShots = existsSync(errDir) ? readdirSync(errDir).filter((f) => f.endsWith('.png')) : [];
      t.check('continue-on-error finished with a warning and ran the next step', res.status === 'warn' && existsSync(join(dir, 'after.png')), res.status);
      t.check('a screenshot was saved when the step failed', errShots.length === 1 && (res.record?.screenshots.length ?? 0) >= 1, errShots);
    }

    // 5) A failing step with onError=stop fails the run.
    {
      const dir = fresh();
      dirs.push(dir);
      const res = await runFlow(
        flow([
          { id: 'g', action: 'goto', value: srv.base + '/plain' },
          { id: 'x', action: 'click', target: { by: 'text', text: 'Missing' }, options: { timeoutMs: 500 } },
          shot('after', 'after.png'),
        ]),
        testSettings(dir),
        {},
        quietEmit,
        new AbortController().signal
      );
      t.check('a failing step stops the run', res.status === 'error' && !existsSync(join(dir, 'after.png')) && !!res.error, res.error);
    }

    // 6) Run from a step, and run a single step.
    {
      const dir = fresh();
      dirs.push(dir);
      const steps = [shot('1', 's1.png'), shot('2', 's2.png'), shot('3', 's3.png')];
      await runFlow(flow(steps), testSettings(dir), {}, quietEmit, new AbortController().signal, { run: { startAt: 1 } });
      const fromOk = !existsSync(join(dir, 's1.png')) && existsSync(join(dir, 's2.png')) && existsSync(join(dir, 's3.png'));
      t.check('run from step 2 skipped step 1', fromOk);

      const dir2 = fresh();
      dirs.push(dir2);
      await runFlow(flow(steps), testSettings(dir2), {}, quietEmit, new AbortController().signal, { run: { only: 2 } });
      t.check('run only step 3', readdirSync(dir2).join(',') === 's3.png', readdirSync(dir2));
    }

    // 7) Run from a step inside a repeat range: first pass starts there, later passes run the whole range.
    {
      const dir = fresh();
      dirs.push(dir);
      const f = flow([shot('1', 'a{{n}}.png'), shot('2', 'b{{n}}.png')]);
      f.repeat = { enabled: true, fromStep: 1, toStep: 2, times: 2, counterName: 'n', counterStart: 1, counterStep: 1, delayMs: 0, waitForDownloads: false };
      await runFlow(f, testSettings(dir), {}, quietEmit, new AbortController().signal, { run: { startAt: 1 } });
      const files = readdirSync(dir).sort().join(',');
      t.check('run from a step inside the repeat range', files === 'a2.png,b1.png,b2.png', files);
    }

    // 8) Pause holds the run until Resume.
    {
      const dir = fresh();
      dirs.push(dir);
      const c = new RunController();
      c.pause();
      const done = runFlow(flow([shot('p1', 'p1.png'), shot('p2', 'p2.png')]), testSettings(dir), {}, quietEmit, c);
      await new Promise((r) => setTimeout(r, 2500));
      const heldWhilePaused = !existsSync(join(dir, 'p1.png'));
      c.resume();
      const res = await done;
      t.check('pause held the run, resume finished it', heldWhilePaused && res.ok && existsSync(join(dir, 'p2.png')), { heldWhilePaused });
    }

    // 9) Built-in variables resolve.
    {
      const dir = fresh();
      dirs.push(dir);
      await runFlow(flow([shot('d', 'day-{{date}}.png')]), testSettings(dir), {}, quietEmit, new AbortController().signal);
      const f = readdirSync(dir)[0] ?? '';
      t.check('{{date}} resolved in a file name', /^day-\d{4}-\d{2}-\d{2}\.png$/.test(f), f);
    }
  } finally {
    await srv.close();
    dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
  }
  t.done();
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});

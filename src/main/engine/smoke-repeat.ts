// Headless smoke test for the redesigned Repeat: it should run the steps BEFORE
// the range once, repeat ONLY the chosen range (with the counter), and run the
// steps AFTER the range once. Run with:  npm run smoke:repeat

import { mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runFlow } from './runner';
import type { Flow, Settings } from '../../shared/types';

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'sr-smoke-'));
  const settings: Settings = {
    headless: true,
    downloadDir: dir,
    timeoutMs: 15000,
    adblock: false,
    blockPopupWindows: false,
    blockPopupTabs: false,
    popupWhitelist: [],
    persistentSession: false,
  };

  // Steps: 1 = before (once), 2 = looped, 3 = after (once). Repeat only step 2, 3x.
  const flow: Flow = {
    id: 't',
    name: 'repeat a range',
    repeat: {
      enabled: true,
      fromStep: 2,
      toStep: 2,
      times: 3,
      counterName: 'n',
      counterStart: 1,
      counterStep: 1,
      delayMs: 0,
      waitForDownloads: false,
    },
    variables: {},
    steps: [
      { id: 's1', action: 'screenshot', value: 'before.png' },
      { id: 's2', action: 'screenshot', value: 'loop{{n}}.png' },
      { id: 's3', action: 'screenshot', value: 'after.png' },
    ],
    createdAt: 0,
    updatedAt: 0,
  };

  const emit = { log: (m: string) => console.log('   ' + m), status: () => {} };

  try {
    await runFlow(flow, settings, {}, emit, new AbortController().signal);
    const has = (f: string) => existsSync(join(dir, f));
    const ok =
      has('before.png') &&
      has('loop1.png') &&
      has('loop2.png') &&
      has('loop3.png') &&
      has('after.png') &&
      !has('loop4.png'); // times=3, so no 4th pass

    if (ok) {
      console.log('PASS: before once, step 2 repeated 3× (loop1–3), after once');
    } else {
      console.error('FAIL: unexpected files', {
        before: has('before.png'),
        loop1: has('loop1.png'),
        loop2: has('loop2.png'),
        loop3: has('loop3.png'),
        loop4: has('loop4.png'),
        after: has('after.png'),
      });
      process.exitCode = 1;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});

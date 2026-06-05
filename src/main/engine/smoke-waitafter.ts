// Headless smoke test for the universal "then wait": any step with waitAfterMs
// should pause that long after it runs. Run with:  npm run smoke:waitafter

import { launch, close } from './browser';
import { runAction } from './actions';
import type { Emit } from './actions';

async function main() {
  const ctx = await launch({ headless: true, downloadDir: process.cwd(), timeoutMs: 8000 });
  const emit: Emit = { log: (m) => console.log('   ' + m) };

  try {
    await ctx.page.setContent('<p>hi</p>');
    const t0 = Date.now();
    await runAction(ctx, { id: '1', action: 'pressKey', value: 'Escape', options: { waitAfterMs: 500 } }, emit);
    const dt = Date.now() - t0;
    if (dt >= 500) {
      console.log(`PASS: step paused ${dt}ms afterward (>=500)`);
    } else {
      console.error(`FAIL: only waited ${dt}ms`);
      process.exitCode = 1;
    }
  } finally {
    await close(ctx);
  }
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});

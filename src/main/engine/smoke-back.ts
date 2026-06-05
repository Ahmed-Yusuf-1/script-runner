// Headless smoke test for the "Go back" action: navigate A → B, then Back, and
// confirm we're on A again. Run with:  npm run smoke:back

import { launch, close } from './browser';
import { runAction } from './actions';
import type { Emit } from './actions';

async function main() {
  const ctx = await launch({ headless: true, downloadDir: process.cwd(), timeoutMs: 8000 });
  const emit: Emit = { log: (m) => console.log('   ' + m) };

  try {
    await ctx.page.goto('data:text/html,<title>PageA</title>PageA');
    await ctx.page.goto('data:text/html,<title>PageB</title>PageB');
    await runAction(ctx, { id: '1', action: 'back' }, emit);
    const title = await ctx.page.title();
    if (title === 'PageA') {
      console.log('PASS: Back returned to the previous page (PageA)');
    } else {
      console.error(`FAIL: expected PageA, got "${title}"`);
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

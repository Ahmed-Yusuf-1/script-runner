// Headless smoke test for the engine — no Electron involved. Verifies the NEW
// fillField action can find and type into a real site's own search box.
// Run with:  npm run smoke

import { launch, close } from './browser';
import { runAction } from './actions';
import type { Emit } from './actions';

async function main() {
  const emit: Emit = { log: (m) => console.log('   ' + m) };
  const ctx = await launch({
    headless: true,
    downloadDir: process.cwd(),
    timeoutMs: 15000,
  });

  try {
    await runAction(ctx, { id: '1', action: 'goto', value: 'https://en.wikipedia.org' }, emit);
    await runAction(
      ctx,
      {
        id: '2',
        action: 'fillField',
        value: 'Playwright',
        target: { by: 'searchbox' },
        options: { pressEnter: false },
      },
      emit
    );

    const value = await ctx.page
      .locator('input[name="search"], input[type="search"], input#searchInput')
      .first()
      .inputValue()
      .catch(() => '');

    if (value.includes('Playwright')) {
      console.log('PASS: fillField typed into the on-site search box →', JSON.stringify(value));
    } else {
      console.error('FAIL: expected "Playwright" in the search box, got', JSON.stringify(value));
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

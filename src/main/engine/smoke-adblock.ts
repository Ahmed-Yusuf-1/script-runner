// Headless smoke test for ad + pop-up blocking:
//   1. the Ghostery filter engine downloads/compiles and caches to disk, and
//   2. the pop-up guard auto-closes a pop-up window.
// Run with:  npm run smoke:adblock

import { mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { launch, close } from './browser';

async function main() {
  const cacheDir = mkdtempSync(join(tmpdir(), 'sr-ab-'));
  const ctx = await launch({
    headless: true,
    downloadDir: cacheDir,
    timeoutMs: 20000,
    adblock: true,
    blockPopupWindows: true,
    blockPopupTabs: true,
    cacheDir,
    log: (m) => console.log('   ' + m),
  });

  try {
    await ctx.page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    const cached = existsSync(join(cacheDir, 'adblocker-engine.bin'));

    // Open a pop-up via a real click (a user gesture) and confirm it's closed.
    await ctx.page.setContent('<a id="x" href="about:blank" target="_blank">open</a>');
    const before = ctx.context.pages().length;
    await ctx.page.click('#x');
    await ctx.page.waitForTimeout(2500); // pop-up guard waits up to ~1.5s before closing
    const after = ctx.context.pages().length;

    if (cached && after <= before) {
      console.log(`PASS: filter engine cached; pop-up auto-closed (pages ${before} → ${after})`);
    } else {
      console.error(`FAIL: cached=${cached}, pages ${before} → ${after}`);
      process.exitCode = 1;
    }
  } finally {
    await close(ctx);
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});

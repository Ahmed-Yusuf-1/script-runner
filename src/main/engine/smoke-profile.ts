// Headless smoke test for the persistent profile (the "remember the check"
// cache): data saved in one run should still be there in the next run using the
// same profile dir. Run with:  npm run smoke:profile

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { launch, close } from './browser';

async function main() {
  const base = mkdtempSync(join(tmpdir(), 'sr-prof-'));
  const profileDir = join(base, 'profile');

  try {
    const c1 = await launch({ headless: true, downloadDir: base, timeoutMs: 15000, profileDir });
    await c1.page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await c1.page.evaluate(() => localStorage.setItem('sr_test', 'remembered'));
    await close(c1);

    const c2 = await launch({ headless: true, downloadDir: base, timeoutMs: 15000, profileDir });
    await c2.page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    const v = await c2.page.evaluate(() => localStorage.getItem('sr_test'));
    await close(c2);

    if (v === 'remembered') {
      console.log('PASS: persistent profile remembered data across two runs');
    } else {
      console.error(`FAIL: expected "remembered", got ${JSON.stringify(v)}`);
      process.exitCode = 1;
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});

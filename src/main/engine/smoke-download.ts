// Headless smoke test for the simplified downloadWait action: click a link,
// save the downloaded file, then wait. Uses a local HTML page with a real
// download link — no network. Run with:  npm run smoke:download

import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { launch, close } from './browser';
import { runAction } from './actions';
import type { Emit } from './actions';

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'sr-dl-'));
  const pagePath = join(dir, 'page.html');
  // A page whose link downloads a small text file when clicked.
  writeFileSync(
    pagePath,
    '<a download="hello.txt" href="data:text/plain,hello%20world">Get file</a>'
  );

  const emit: Emit = { log: (m) => console.log('   ' + m) };
  const ctx = await launch({ headless: true, downloadDir: dir, timeoutMs: 15000 });

  try {
    await ctx.page.goto(pathToFileURL(pagePath).href);
    await runAction(
      ctx,
      {
        id: '1',
        action: 'downloadWait',
        target: { by: 'text', text: 'Get file', match: 'exact' },
        options: { waitMs: 5000 },
      },
      emit
    );
    const saved = existsSync(join(dir, 'hello.txt'));
    const recorded = ctx.downloads.some((d) => d.filename === 'hello.txt');

    if (saved && recorded) {
      console.log('PASS: clicked link, captured & saved hello.txt');
    } else {
      console.error(`FAIL: saved=${saved}, recorded=${recorded}`);
      process.exitCode = 1;
    }
  } finally {
    await close(ctx);
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});

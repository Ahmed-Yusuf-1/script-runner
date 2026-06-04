// Headless smoke test for the new-tab download case (the spotidown scenario):
// a link opens a NEW TAB that delivers a file (Content-Disposition: attachment),
// and the Download step should still capture it instead of timing out.
// Run with:  npm run smoke:newtab

import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { launch, close } from './browser';
import { runAction } from './actions';
import type { Emit } from './actions';

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'sr-nt-'));

  // Tiny server: "/" links (target=_blank) to "/file", which downloads.
  const server = createServer((req, res) => {
    if (req.url === '/file') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="fromtab.txt"',
      });
      res.end('hello from a new tab');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<a id="x" target="_blank" href="/file">Download MP3</a>');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const emit: Emit = { log: (m) => console.log('   ' + m) };
  const ctx = await launch({ headless: true, downloadDir: dir, timeoutMs: 15000, blockPopupWindows: true, blockPopupTabs: true });

  try {
    await ctx.page.goto(base + '/');
    await runAction(
      ctx,
      { id: '1', action: 'download', target: { by: 'text', text: 'Download MP3', match: 'exact' } },
      emit
    );
    const saved =
      ctx.downloads.some((d) => d.filename === 'fromtab.txt') && existsSync(join(dir, 'fromtab.txt'));
    if (saved) {
      console.log('PASS: captured a download that opened in a NEW TAB (fromtab.txt)');
    } else {
      console.error('FAIL: new-tab download was not captured');
      process.exitCode = 1;
    }
  } finally {
    await close(ctx);
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});

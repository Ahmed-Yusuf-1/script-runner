// Headless smoke test: the Download step must resolve when a SLOW download
// STARTS (not when it finishes), and the file must still complete in the
// background. Simulates a big file by streaming bytes over ~2s.
// Run with:  npm run smoke:dlstart

import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { launch, close } from './browser';
import { runAction } from './actions';
import type { Emit } from './actions';

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'sr-dls-'));
  const server = createServer((req, res) => {
    if (req.url === '/file') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="big.bin"',
      });
      let n = 0;
      const iv = setInterval(() => {
        res.write('x'.repeat(1000));
        if (++n >= 20) {
          clearInterval(iv);
          res.end();
        }
      }, 100); // ~2 seconds total
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<a href="/file">Get</a>');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const emit: Emit = { log: (m) => console.log('   ' + m) };
  const ctx = await launch({ headless: true, downloadDir: dir, timeoutMs: 8000 });

  try {
    await runAction(ctx, { id: '0', action: 'goto', value: base + '/' }, emit);

    const t0 = Date.now();
    await runAction(ctx, { id: '1', action: 'download', target: { by: 'text', text: 'Get', match: 'exact' } }, emit);
    const dt = Date.now() - t0;
    const activeRightAfter = ctx.activeDownloads;

    // Now wait for the background save to finish.
    while (ctx.activeDownloads > 0) await new Promise((r) => setTimeout(r, 50));
    const saved = existsSync(join(dir, 'big.bin'));

    if (saved && dt < 1500 && activeRightAfter >= 1) {
      console.log(`PASS: returned on download start (${dt}ms), file finished in background`);
    } else {
      console.error(`FAIL: saved=${saved}, dt=${dt}ms, activeRightAfter=${activeRightAfter}`);
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

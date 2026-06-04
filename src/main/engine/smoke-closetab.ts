// Headless smoke test for "Close current tab": open a second tab, close it, and
// confirm the engine returns to the first tab. Run with:  npm run smoke:closetab

import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { launch, close } from './browser';
import { runAction } from './actions';
import type { Emit } from './actions';

async function main() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (req.url === '/next') res.end('<title>NEXT</title><p>second tab</p>');
    else res.end('<title>HOME</title><a target="_blank" href="/next">Open</a>');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const emit: Emit = { log: (m) => console.log('   ' + m) };
  const ctx = await launch({ headless: true, downloadDir: process.cwd(), timeoutMs: 8000, blockPopupWindows: true, blockPopupTabs: true });

  try {
    await runAction(ctx, { id: '1', action: 'goto', value: base + '/' }, emit);
    await runAction(ctx, { id: '2', action: 'click', target: { by: 'text', text: 'Open', match: 'exact' } }, emit);
    await new Promise((r) => setTimeout(r, 2500)); // let the engine follow to /next
    const onNext = ctx.page.url().endsWith('/next');

    await runAction(ctx, { id: '3', action: 'closeTab' }, emit);
    const backHome = ctx.page.url().endsWith('/') && !ctx.page.isClosed();
    const tabCount = ctx.context.pages().filter((p) => !p.isClosed()).length;

    if (onNext && backHome && tabCount === 1) {
      console.log('PASS: closed the current tab and returned to the previous one');
    } else {
      console.error(`FAIL: onNext=${onNext}, backHome=${backHome}, openTabs=${tabCount}`);
      process.exitCode = 1;
    }
  } finally {
    await close(ctx);
    server.close();
  }
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});

// Headless smoke test for following a new tab (the filecrypt → datanodes case):
// clicking a link that opens a new tab should move the engine onto that tab, so
// the next step acts there. Run with:  npm run smoke:tabfollow

import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { launch, close } from './browser';
import { runAction } from './actions';
import type { Emit } from './actions';

async function main() {
  const server = createServer((req, res) => {
    if (req.url === '/next') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<title>NEXT</title><button onclick="document.title=\'clicked\'">Continue to Download</button>'
      );
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<title>HOME</title><a target="_blank" href="/next">Download</a>');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const emit: Emit = { log: (m) => console.log('   ' + m) };
  const ctx = await launch({ headless: true, downloadDir: process.cwd(), timeoutMs: 8000, blockPopupWindows: true, blockPopupTabs: true });

  try {
    await runAction(ctx, { id: '1', action: 'goto', value: base + '/' }, emit);
    // Click the link that opens /next in a new tab.
    await runAction(ctx, { id: '2', action: 'click', target: { by: 'text', text: 'Download', match: 'exact' } }, emit);
    // Give the manager a moment to follow the new tab.
    await new Promise((r) => setTimeout(r, 2500));
    // This must run on the NEW tab now.
    await runAction(
      ctx,
      { id: '3', action: 'click', target: { by: 'text', text: 'Continue to Download', match: 'exact' } },
      emit
    );

    const onNext = ctx.page.url().endsWith('/next');
    const title = await ctx.page.title();
    if (onNext && title === 'clicked') {
      console.log('PASS: engine followed into the new tab and clicked "Continue to Download"');
    } else {
      console.error(`FAIL: onNext=${onNext}, title="${title}"`);
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

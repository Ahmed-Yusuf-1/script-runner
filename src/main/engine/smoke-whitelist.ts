// Headless smoke test for the pop-up whitelist: a pop-up that the blocker would
// normally close (about:blank) is KEPT when its opener site is whitelisted.
// Run with:  npm run smoke:whitelist

import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { launch, close } from './browser';
import { runAction } from './actions';
import type { Emit } from './actions';

async function main() {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <title>HOME</title>
      <a id="tab-link" target="_blank" href="about:blank">Open Tab</a>
      <button id="win-btn" onclick="window.open('about:blank', '_blank', 'width=300,height=300')">Open Window</button>
    `);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const emit: Emit = { log: (m) => console.log('   ' + m) };
  // Pop-up blocking ON, but our local host is whitelisted.
  const ctx = await launch({
    headless: true,
    downloadDir: process.cwd(),
    timeoutMs: 8000,
    blockPopupWindows: true,
    blockPopupTabs: true,
    popupWhitelist: ['127.0.0.1'],
  });

  try {
    await runAction(ctx, { id: '1', action: 'goto', value: base + '/' }, emit);

    // 1. Open whitelisted tab
    await runAction(ctx, { id: '2', action: 'click', target: { by: 'text', text: 'Open Tab', match: 'exact' } }, emit);
    await new Promise((r) => setTimeout(r, 2500)); // let the manager decide

    const tabsAfterTabClick = ctx.context.pages().filter((p) => !p.isClosed()).length;

    // Switch back to the main page to click the window button
    ctx.page = ctx.context.pages()[0];

    // 2. Open whitelisted window
    await runAction(ctx, { id: '3', action: 'click', target: { by: 'text', text: 'Open Window', match: 'exact' } }, emit);
    await new Promise((r) => setTimeout(r, 2500)); // let the manager decide

    const tabsAfterWinClick = ctx.context.pages().filter((p) => !p.isClosed()).length;

    if (tabsAfterTabClick === 2 && tabsAfterWinClick === 2) {
      console.log('PASS: whitelisted pop-up tab was kept (2 tabs open), whitelisted pop-up window was closed');
    } else {
      console.error(`FAIL: expected 2 tabs after tab click (got ${tabsAfterTabClick}), and 2 tabs after window click (got ${tabsAfterWinClick})`);
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

// Headless smoke test for "item #" targeting: on a page with three identical
// "Download Mp3" buttons, clicking item #1, then #2, then #3 should press each
// in turn (the playlist scenario). Run with:  npm run smoke:nth

import { launch, close } from './browser';
import { runAction } from './actions';
import type { Emit } from './actions';

async function main() {
  const ctx = await launch({ headless: true, downloadDir: process.cwd(), timeoutMs: 8000 });
  const emit: Emit = { log: (m) => console.log('   ' + m) };

  try {
    // Three buttons with the SAME name; each appends its number to the title.
    await ctx.page.setContent(
      '<button onclick="document.title+=1">Download Mp3</button>' +
        '<button onclick="document.title+=2">Download Mp3</button>' +
        '<button onclick="document.title+=3">Download Mp3</button>'
    );
    await ctx.page.evaluate(() => {
      document.title = '';
    });

    for (const i of ['1', '2', '3']) {
      await runAction(
        ctx,
        { id: i, action: 'click', target: { by: 'text', text: 'Download Mp3', match: 'exact', index: i } },
        emit
      );
    }

    const title = await ctx.page.title();
    if (title === '123') {
      console.log('PASS: pressed the 1st, 2nd, 3rd of three identical "Download Mp3" buttons');
    } else {
      console.error(`FAIL: expected "123", got "${title}"`);
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

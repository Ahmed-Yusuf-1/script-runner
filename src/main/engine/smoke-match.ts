// Headless smoke test for case-insensitive text matching: searching for
// "Download MP3" must find a button whose real text is "Download Mp3"
// (the spotidown casing). Run with:  npm run smoke:match

import { launch, close } from './browser';
import { runAction } from './actions';
import type { Emit } from './actions';

async function main() {
  const ctx = await launch({ headless: true, downloadDir: process.cwd(), timeoutMs: 8000 });
  const emit: Emit = { log: (m) => console.log('   ' + m) };

  try {
    // Note the casing: the button says "Download Mp3", we search "Download MP3".
    await ctx.page.setContent(
      '<button onclick="document.title=\'clicked\'">Download Mp3</button>'
    );
    await runAction(
      ctx,
      { id: '1', action: 'click', target: { by: 'text', text: 'Download MP3', match: 'exact' } },
      emit
    );
    const title = await ctx.page.title();
    if (title === 'clicked') {
      console.log('PASS: "Download MP3" matched the "Download Mp3" button (case-insensitive)');
    } else {
      console.error(`FAIL: click did not register (title="${title}")`);
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

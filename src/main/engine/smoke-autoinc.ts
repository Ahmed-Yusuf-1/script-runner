// Headless smoke test for "auto-increment item #": a Click step with
// autoIncrement should press the 1st match, then the 2nd, then the 3rd on
// successive runs — without any {{variable}}. Run with:  npm run smoke:autoinc

import { launch, close } from './browser';
import { runAction } from './actions';
import type { Emit } from './actions';

async function main() {
  const ctx = await launch({ headless: true, downloadDir: process.cwd(), timeoutMs: 8000 });
  const emit: Emit = { log: (m) => console.log('   ' + m) };

  try {
    await ctx.page.setContent(
      '<button onclick="document.title+=1">Download Mp3</button>' +
        '<button onclick="document.title+=2">Download Mp3</button>' +
        '<button onclick="document.title+=3">Download Mp3</button>'
    );
    await ctx.page.evaluate(() => {
      document.title = '';
    });

    // Same step id each run (as a Repeat loop would do) — counter lives on ctx.
    for (let p = 0; p < 3; p++) {
      await runAction(
        ctx,
        {
          id: 'click1',
          action: 'click',
          target: { by: 'text', text: 'Download Mp3', match: 'exact', autoIncrement: true },
        },
        emit
      );
    }

    const title = await ctx.page.title();
    if (title === '123') {
      console.log('PASS: auto-increment pressed the 1st, 2nd, 3rd button across runs');
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

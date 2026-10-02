// Headless smoke test: two downloads with the same suggested file name must
// both be kept ("same.txt" and "same (1).txt") instead of the second one
// overwriting the first. Also checks screenshot names can't escape the folder.
// Run with:  npm run smoke:dlname

import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { launch, close } from './browser';
import { runAction } from './actions';
import type { Emit } from './actions';
import { serve, Checks } from './testkit';

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'sr-dn-'));
  const t = new Checks();
  const srv = await serve((req, res) => {
    const m = /^\/file\/(\w+)/.exec(req.url ?? '');
    if (m) {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="same.txt"',
      });
      res.end(`content ${m[1]}`);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<a href="/file/one">One</a> <a href="/file/two">Two</a>');
  });
  const emit: Emit = { log: (m) => console.log('   ' + m) };
  const ctx = await launch({ headless: true, downloadDir: dir, timeoutMs: 10000 });

  try {
    await ctx.page.goto(srv.base + '/');
    await runAction(ctx, { id: 'a', action: 'download', target: { by: 'text', text: 'One' } }, emit);
    await runAction(ctx, { id: 'b', action: 'download', target: { by: 'text', text: 'Two' } }, emit);
    const until = Date.now() + 10000;
    while (ctx.downloads.length < 2 && Date.now() < until) await new Promise((r) => setTimeout(r, 100));

    const first = join(dir, 'same.txt');
    const second = join(dir, 'same (1).txt');
    const contents = [first, second].filter(existsSync).map((p) => readFileSync(p, 'utf8')).sort();
    t.check(
      'both same-named downloads were kept',
      contents.join('|') === 'content one|content two',
      readdirSync(dir)
    );

    await runAction(ctx, { id: 's', action: 'screenshot', value: '../../escape.png' }, emit);
    t.check(
      'a screenshot name with folders stays inside the download folder',
      !existsSync(join(dir, '..', 'escape.png')) && readdirSync(dir).some((f) => f.endsWith('escape.png')),
      readdirSync(dir)
    );
  } finally {
    await close(ctx);
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
  t.done();
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});

// Headless smoke test for the v0.2 actions: hover, choose from dropdown, scroll,
// reload, wait for element (appear / disappear), check page text, and save text
// into a variable that a later step uses. Run with:  npm run smoke:actions2

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { launch, close } from './browser';
import { runAction } from './actions';
import type { Emit } from './actions';
import { runFlow } from './runner';
import { serve, testSettings, Checks, quietEmit } from './testkit';
import type { Flow, Step } from '../../shared/types';

const PAGE = `<!doctype html><html><body style="margin:0">
<h1>Welcome</h1>
<button id="menu" onmouseover="document.getElementById('sub').style.display='block'">Menu</button>
<div id="sub" style="display:none">Submenu open</div>
<label for="colour">Colour</label>
<select id="colour"><option value="r">Red</option><option value="g">Green</option></select>
<span id="price">  $ 42.50 </span>
<div id="spinner">Loading…</div>
<div style="height:5000px"></div>
<script>
  setTimeout(() => { const p = document.createElement('p'); p.textContent = 'Loaded later'; document.body.prepend(p); }, 800);
  setTimeout(() => document.getElementById('spinner').remove(), 900);
</script>
</body></html>`;

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'sr-a2-'));
  let reloads = 0;
  let echoed = '';
  const srv = await serve((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/reload') reloads++;
    if (url.pathname === '/echo') echoed = url.searchParams.get('v') ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE);
  });
  const emit: Emit = { log: (m) => console.log('   ' + m) };
  const ctx = await launch({ headless: true, downloadDir: dir, timeoutMs: 5000 });
  const t = new Checks();
  const step = (s: Omit<Step, 'id'>): Step => ({ id: Math.random().toString(36).slice(2), ...s });
  const fails = async (s: Step) => runAction(ctx, s, emit).then(() => false, () => true);

  try {
    await ctx.page.goto(srv.base + '/');

    await runAction(ctx, step({ action: 'hover', target: { by: 'text', text: 'Menu' } }), emit);
    t.check('hover opened the hover menu', await ctx.page.locator('#sub').isVisible());

    await runAction(ctx, step({ action: 'selectOption', value: 'Green', target: { by: 'placeholder', text: 'Colour' } }), emit);
    t.check('chose a dropdown option by its label', (await ctx.page.locator('#colour').inputValue()) === 'g');
    await runAction(ctx, step({ action: 'selectOption', value: 'r', target: { by: 'selector', selector: '#colour' } }), emit);
    t.check('chose a dropdown option by its value (CSS selector target)', (await ctx.page.locator('#colour').inputValue()) === 'r');
    t.check('an unknown dropdown option fails', await fails(step({ action: 'selectOption', value: 'Blue', target: { by: 'selector', selector: '#colour' } })));

    await runAction(ctx, step({ action: 'waitFor', target: { by: 'text', text: 'Loaded later' } }), emit);
    t.check('waited for late content to appear', await ctx.page.getByText('Loaded later').isVisible());
    await runAction(ctx, step({ action: 'waitFor', target: { by: 'selector', selector: '#spinner' }, options: { waitState: 'hidden' } }), emit);
    t.check('waited for an element to go away', (await ctx.page.locator('#spinner').count()) === 0);

    await runAction(ctx, step({ action: 'assertText', value: 'welcome' }), emit);
    t.check('check page text passes when the text is there (any case)', true);
    t.check('check page text fails when the text is missing', await fails(step({ action: 'assertText', value: 'Not here', options: { timeoutMs: 500 } })));
    await runAction(ctx, step({ action: 'assertText', value: 'Not here', options: { expect: 'absent' } }), emit);
    t.check('check page text "absent" passes when the text is missing', true);

    await runAction(ctx, step({ action: 'scroll', value: 'bottom' }), emit);
    const y = await ctx.page.evaluate(() => window.scrollY);
    await runAction(ctx, step({ action: 'scroll', value: 'top' }), emit);
    const y2 = await ctx.page.evaluate(() => window.scrollY);
    t.check('scroll to bottom, then back to top', y > 1000 && y2 === 0, { y, y2 });

    await ctx.page.goto(srv.base + '/reload');
    await runAction(ctx, step({ action: 'reload' }), emit);
    t.check('reload loaded the page again', reloads === 2, { reloads });
  } finally {
    await close(ctx);
  }

  // Save text as a variable, then use it in a later step (needs the runner).
  const flow: Flow = {
    id: 'f',
    name: 'extract',
    steps: [
      { id: 's1', action: 'goto', value: srv.base + '/' },
      { id: 's2', action: 'extractText', saveAs: 'price', target: { by: 'selector', selector: '#price' } },
      { id: 's3', action: 'goto', value: srv.base + '/echo?v={{price}}' },
    ],
    createdAt: 0,
    updatedAt: 0,
  };
  const res = await runFlow(flow, testSettings(dir), {}, quietEmit, new AbortController().signal);
  t.check('saved text into {{price}} and used it in a later step', res.ok && echoed === '$ 42.50', { echoed, res: res.error });

  await srv.close();
  rmSync(dir, { recursive: true, force: true });
  t.done();
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});

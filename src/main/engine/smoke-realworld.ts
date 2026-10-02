// Headless smoke test for the things real websites do: content inside iframes,
// cookie banners, invisible overlays that swallow clicks, the browser's own
// confirm() boxes, lazy "load more" lists, file uploads, reading links, saving
// rows to a CSV, and not downloading a file twice.
// Run with:  npm run smoke:realworld

import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { launch, close } from './browser';
import { runAction } from './actions';
import type { Emit } from './actions';
import { runFlow } from './runner';
import { serve, testSettings, Checks, quietEmit } from './testkit';
import type { Flow, Step } from '../../shared/types';

const PAGES: Record<string, string> = {
  // A button that only exists inside an iframe.
  '/frames': `<!doctype html><body><h1>Outer page</h1><iframe src="/inner" width="400" height="200"></iframe></body>`,
  '/inner': `<!doctype html><body><button id="go" onclick="this.textContent='Clicked in the frame'">Download Now</button></body>`,

  // A cookie banner covering the page, like most of the web.
  '/consent': `<!doctype html><body>
    <div id="cookie-banner" style="position:fixed;inset:0;background:#000a;z-index:9;display:flex;align-items:center;justify-content:center">
      <div><p>We value your privacy</p>
      <button onclick="document.getElementById('cookie-banner').remove()">Reject all</button>
      <button>Accept all</button></div>
    </div>
    <button id="real" onclick="this.textContent='Clicked'">Open the file</button>
  </body>`,

  // An invisible layer over the button: clicks land on the layer, not the button.
  '/overlay': `<!doctype html><body>
    <button id="real" onclick="this.textContent='Clicked'">Continue</button>
    <div style="position:fixed;inset:0;background:transparent;z-index:9"></div>
  </body>`,

  // A confirm() that blocks everything until it's answered.
  '/confirm': `<!doctype html><body>
    <button onclick="if (confirm('Are you sure?')) document.title='confirmed'">Delete</button>
  </body>`,

  // A list that grows every time you reach the bottom.
  '/lazy': `<!doctype html><body><div id="list"></div><script>
    let batch = 0;
    const add = () => { if (batch >= 3) return; batch++;
      for (let i = 0; i < 25; i++) { const d = document.createElement('p'); d.textContent = 'item ' + batch + '-' + i; d.style.height = '40px'; document.getElementById('list').append(d); } };
    add();
    addEventListener('scroll', () => { if (window.scrollY + window.innerHeight >= document.body.scrollHeight - 50) add(); });
  </script></body>`,

  // A file input that reports what was attached.
  '/upload': `<!doctype html><body>
    <label for="cv">Your CV</label>
    <input id="cv" type="file" onchange="document.getElementById('out').textContent = this.files[0].name">
    <p id="out">nothing</p>
  </body>`,

  // Links and prices to collect.
  '/list': `<!doctype html><body>
    <a id="first" href="/downloads/one.txt" data-sku="A-1">First file</a>
    <span id="price">  £ 12.50 </span>
  </body>`,
};

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'sr-rw-'));
  const t = new Checks();
  const srv = await serve((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/file') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="report.txt"' });
      res.end('fresh copy');
      return;
    }
    const body = PAGES[url];
    if (body == null) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body);
  });
  const emit: Emit = { log: (m) => console.log('   ' + m) };
  const step = (s: Omit<Step, 'id'>): Step => ({ id: Math.random().toString(36).slice(2), ...s });

  // ---- Page-level behaviour (one browser, driven action by action) ----
  const ctx = await launch({ headless: true, downloadDir: dir, timeoutMs: 6000, handleDialogs: true });
  try {
    // Content inside an iframe is found without the user knowing it's a frame.
    await ctx.page.goto(srv.base + '/frames');
    await runAction(ctx, step({ action: 'click', target: { by: 'text', text: 'Download Now' } }), emit);
    // The button lives in the frame, so the result is only visible in the frame.
    const framed = await ctx.page.frameLocator('iframe').locator('#go').innerText();
    t.check('clicked a button inside an iframe', framed === 'Clicked in the frame', framed);

    // An invisible overlay must not stop the click.
    await ctx.page.goto(srv.base + '/overlay');
    await runAction(ctx, step({ action: 'click', target: { by: 'text', text: 'Continue' } }), emit);
    t.check('clicked through an invisible overlay', (await ctx.page.locator('#real').innerText()) === 'Clicked');

    // confirm() is answered instead of hanging the step.
    await ctx.page.goto(srv.base + '/confirm');
    await runAction(ctx, step({ action: 'click', target: { by: 'text', text: 'Delete' } }), emit);
    t.check('answered the page’s confirm box', (await ctx.page.title()) === 'confirmed');

    // "Load more" lists: keep scrolling until nothing new arrives.
    await ctx.page.goto(srv.base + '/lazy');
    await runAction(ctx, step({ action: 'scroll', value: 'bottomAll' }), emit);
    t.check('scrolled until the list stopped growing', (await ctx.page.locator('p').count()) === 75);

    // Attach a file to an upload field.
    const cv = join(dir, 'cv.txt');
    writeFileSync(cv, 'hello');
    await ctx.page.goto(srv.base + '/upload');
    await runAction(ctx, step({ action: 'uploadFile', target: { by: 'placeholder', text: 'Your CV' }, fileName: cv }), emit);
    t.check('attached a file to an upload field', (await ctx.page.locator('#out').innerText()) === 'cv.txt');

    // Read a link and an attribute, not just text.
    await ctx.page.goto(srv.base + '/list');
    await runAction(ctx, step({ action: 'extractText', saveAs: 'link', target: { by: 'selector', selector: '#first' }, options: { extract: 'href' } }), emit);
    await runAction(
      ctx,
      step({ action: 'extractText', saveAs: 'sku', target: { by: 'selector', selector: '#first' }, options: { extract: 'attribute', attribute: 'data-sku' } }),
      emit
    );
    t.check('saved a link and an attribute', ctx.runVars.link.endsWith('/downloads/one.txt') && ctx.runVars.sku === 'A-1', ctx.runVars);

    // Collect rows into a CSV, with a header row from the template.
    ctx.runVars.price = '£ 12,50';
    ctx.csvHeaders = ['sku', 'price'];
    await runAction(ctx, step({ action: 'appendRow', value: 'A-1, £ 12,50', fileName: 'out.csv' }), emit);
    await runAction(ctx, step({ action: 'appendRow', value: 'B-2, £ 3.00', fileName: 'out.csv' }), emit);
    const csv = readFileSync(join(dir, 'out.csv'), 'utf8').trim().split('\n');
    t.check(
      'wrote a CSV with a header and quoted commas',
      csv.length === 3 && csv[0] === 'sku,price' && csv[1] === 'A-1,"£ 12,50"',
      csv
    );

    // A missing target explains itself instead of just timing out.
    ctx.stepTimeout = 800;
    const err = await runAction(ctx, step({ action: 'click', target: { by: 'text', text: 'First fil' } }), emit).then(
      () => '',
      (e: Error) => e.message
    );
    t.check('a not-found error suggests what the page does have', err.includes('First file'), err);
  } finally {
    await close(ctx);
  }

  // ---- Settings-level behaviour (through the runner) ----
  const flow = (steps: Step[]): Flow => ({ id: 'f', name: 'real world', steps, createdAt: 0, updatedAt: 0 });

  // A cookie banner is cleared after navigation, so the next step can click.
  {
    const res = await runFlow(
      flow([
        { id: 'g', action: 'goto', value: srv.base + '/consent' },
        { id: 'c', action: 'click', target: { by: 'text', text: 'Open the file' }, options: { timeoutMs: 4000 } },
      ]),
      testSettings(dir, { dismissConsent: true }),
      {},
      quietEmit,
      new AbortController().signal
    );
    t.check('dismissed a cookie banner and clicked the page behind it', res.ok, res.error);
  }

  // The same file isn't downloaded twice when "skip existing" is on.
  {
    const dir2 = mkdtempSync(join(tmpdir(), 'sr-rw2-'));
    const page = `<!doctype html><body><a href="/file">Get report</a></body>`;
    const srv2 = await serve((req, res) => {
      if ((req.url ?? '').startsWith('/file')) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="report.txt"' });
        res.end('fresh copy');
      } else res.writeHead(200, { 'Content-Type': 'text/html' }).end(page);
    });
    writeFileSync(join(dir2, 'report.txt'), 'the copy I already had');
    const res = await runFlow(
      flow([
        { id: 'g', action: 'goto', value: srv2.base + '/' },
        { id: 'd', action: 'download', target: { by: 'text', text: 'Get report' }, options: { timeoutMs: 5000 } },
      ]),
      testSettings(dir2, { skipExistingDownloads: true }),
      {},
      quietEmit,
      new AbortController().signal
    );
    t.check(
      'skipped a file that was already downloaded, without failing the step',
      res.ok && readFileSync(join(dir2, 'report.txt'), 'utf8') === 'the copy I already had' && !existsSync(join(dir2, 'report (1).txt')),
      res.error
    );
    await srv2.close();
    rmSync(dir2, { recursive: true, force: true });
  }

  // Downloads can be grouped per flow.
  {
    const dir3 = mkdtempSync(join(tmpdir(), 'sr-rw3-'));
    await runFlow(
      { id: 'f', name: 'My Flow', steps: [{ id: 's', action: 'screenshot', value: 'shot.png' }], createdAt: 0, updatedAt: 0 },
      testSettings(dir3, { downloadSubfolder: 'flow' }),
      {},
      quietEmit,
      new AbortController().signal
    );
    t.check('saved into a per-flow sub-folder', existsSync(join(dir3, 'My Flow', 'shot.png')));
    rmSync(dir3, { recursive: true, force: true });
  }

  await srv.close();
  rmSync(dir, { recursive: true, force: true });
  t.done();
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});

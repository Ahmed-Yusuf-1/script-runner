// One handler per action. Each takes the run context, the (already
// variable-substituted) step, and an `emit` for log lines. Throwing signals
// failure; the runner decides whether to retry, stop or continue based on the
// step's options.

import { promises as fs } from 'fs';
import { isAbsolute, join } from 'path';
import type { Locator, Page } from 'playwright';
import type { Step, Target } from '../../shared/types';
import { describeTarget } from '../../shared/actions';
import type { RunContext, LogFn } from './browser';
import { resolveTarget, suggestTargets } from './target';
import { clearOverlay } from './consent';
import { sleep, uniquePath, release, sanitizeFilename, csvRow, errorMessage } from './util';

export interface Emit {
  log: LogFn;
}

/**
 * Resolve a target to a single element, WAITING for it to appear and become
 * visible. This is what lets the engine find content that loaded dynamically
 * without a full page navigation (e.g. results injected via AJAX) instead of
 * giving up instantly.
 *
 * When it can't be found, the error says where we looked and what similar
 * buttons the page does have, which is usually enough to fix the step.
 */
async function locate(
  ctx: RunContext,
  target: Target,
  emit: Emit,
  what: string,
  /** File inputs are usually styled out of sight, so only wait for them to exist. */
  state: 'visible' | 'attached' = 'visible'
): Promise<Locator> {
  const page = ctx.page;
  const base = await resolveTarget(page, target, state === 'attached' ? { visibleOnly: false } : {});
  const idx = parseIndex(target.index); // 1-based, or undefined for "first"
  const chosen = idx != null ? base.nth(idx - 1) : base.first();
  const desc = describeTarget(target);
  try {
    await chosen.waitFor({ state, timeout: ctx.stepTimeout });
  } catch (err) {
    if (ctx.signal?.aborted) throw err;
    const n = await base.count().catch(() => 0);
    if (idx != null && idx > n) {
      throw new Error(`${what}: wanted item #${idx} but only ${n} match${n === 1 ? '' : 'es'} ${desc}.${await where(ctx)}`);
    }
    if (n > 0) {
      throw new Error(`${what}: found ${desc} but it never became visible within ${secs(ctx.stepTimeout)}.${await where(ctx)}`);
    }
    const hint = target.by === 'text' ? await didYouMean(page, target.text ?? '') : '';
    throw new Error(`${what}: couldn't find ${desc} within ${secs(ctx.stepTimeout)}.${hint}${await where(ctx)}`);
  }
  const n = await base.count();
  if (idx != null) {
    emit.log(`Using match #${idx} of ${n} for ${desc}`, 'debug');
  } else if (n > 1) {
    emit.log(`${n} matches for ${desc}; using the first (set “item #” to pick another).`, 'warn');
  }
  return chosen;
}

/** "Did you mean …" from what's actually on the page. */
async function didYouMean(page: Page, wanted: string): Promise<string> {
  const near = await suggestTargets(page, wanted).catch(() => []);
  if (!near.length) return '';
  return ` The page does have: ${near.map((t) => `“${t}”`).join(', ')}.`;
}

/** Where the run was when something failed — the single most useful clue. */
async function where(ctx: RunContext): Promise<string> {
  try {
    const url = ctx.page.url();
    return url && url !== 'about:blank' ? ` (on ${url})` : '';
  } catch {
    return '';
  }
}

const secs = (ms: number) => `${Math.round(ms / 100) / 10}s`;

/** Parse an "item #" into a 1-based index, or undefined for "the first match". */
function parseIndex(raw?: string): number | undefined {
  if (raw == null) return undefined;
  const t = raw.trim();
  if (t === '') return undefined;
  const n = parseInt(t, 10);
  return Number.isFinite(n) && n >= 1 ? n : undefined;
}

/**
 * For an "auto-increment item #" step: advance this step's own counter (1st
 * match, then 2nd, …) and write the concrete number into target.index so the
 * normal locate() logic picks the right one. The counter starts at `index`
 * (default 1) and lives on the run context, keyed by step id.
 */
function advanceAutoIndex(ctx: RunContext, step: Step): void {
  if (!step.target) return;
  const start = parseIndex(step.target.index) ?? 1;
  const prev = ctx.autoIndex.get(step.id);
  const next = prev === undefined ? start : prev + 1;
  ctx.autoIndex.set(step.id, next);
  step.target = { ...step.target, index: String(next) };
}

/**
 * Click, and keep trying when a real page gets in the way: scroll it into view,
 * clear whatever is covering it (cookie banner, modal, ad overlay), then force
 * the click, and finally click it from inside the page itself. Each fallback is
 * logged so the run log explains what happened.
 */
async function clickWithRecovery(ctx: RunContext, el: Locator, emit: Emit, what: string, kind: 'single' | 'double' | 'right' = 'single'): Promise<void> {
  const click = (opts: Parameters<Locator['click']>[0] = {}) =>
    kind === 'double' ? el.dblclick(opts) : el.click({ ...opts, button: kind === 'right' ? 'right' : 'left' });

  // Don't spend the whole step's budget on the first attempt: when something is
  // covering the element, Playwright retries internally until it times out, and
  // the recovery below is what actually gets the click through.
  const firstTry = Math.min(ctx.stepTimeout, 8000);
  try {
    await click({ timeout: firstTry });
    return;
  } catch (first) {
    if (ctx.signal?.aborted) throw first;
    // Playwright reports "intercepts pointer events" in the call log, which the
    // tidied message drops, so test the raw text as well.
    const raw = first instanceof Error ? first.message : String(first);
    const reason = errorMessage(first);
    const blocked = /intercept|not visible|outside of the viewport|stable|enabled|covered|timeout/i.test(raw);
    if (!blocked) throw first;
    emit.log(`${what}: the click didn't land (${reason.split('.')[0]}). Trying again.`, 'warn');

    await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await clearOverlay(ctx.page, emit.log).catch(() => {});
    try {
      await click({ timeout: 5000 });
      return;
    } catch {
      /* fall through to a forced click */
    }
    try {
      await click({ timeout: 5000, force: true });
      emit.log(`${what}: clicked through an overlay.`, 'debug');
      return;
    } catch {
      /* fall through to a DOM click */
    }
    // Last resort: ask the page to click the element itself. This works when an
    // invisible layer sits on top, which is common on ad-funded download sites.
    await el.evaluate((node) => (node as HTMLElement).click());
    emit.log(`${what}: used the page's own click as a last resort.`, 'debug');
  }
}

/**
 * Wait up to timeoutMs for a new download to START (from any tab). We watch the
 * "started" counter, not the finished list, so a multi-GB file that takes
 * minutes to save still counts as success the moment it begins.
 */
async function waitForDownloadStart(ctx: RunContext, beforeStarted: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (ctx.downloadsStarted > beforeStarted) return true;
    await sleep(150, ctx.signal);
  }
  return ctx.downloadsStarted > beforeStarted;
}

/** Wait for the page to settle after an action that may navigate. Never throws. */
async function settle(page: Page, state: 'domcontentloaded' | 'load' | 'networkidle' = 'domcontentloaded'): Promise<void> {
  await page.waitForLoadState(state, { timeout: 15_000 }).catch(() => {});
}

export async function runAction(ctx: RunContext, step: Step, emit: Emit): Promise<void> {
  await runActionInner(ctx, step, emit);

  // Universal optional "then wait" — pauses after ANY step if set.
  const after = step.options?.waitAfterMs;
  if (after && after > 0) {
    emit.log(`Waiting ${after}ms…`, 'debug');
    await sleep(after, ctx.signal); // works even if the tab closed; ends early on Stop
  }
}

async function runActionInner(ctx: RunContext, step: Step, emit: Emit): Promise<void> {
  const { page } = ctx;
  const target = step.target;

  switch (step.action) {
    case 'goto': {
      let url = (step.value ?? '').trim();
      if (!url) throw new Error('Go to: no link was provided.');
      // Add https:// only when there's no scheme at all (leave data:, file:, etc.).
      if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
      const waitUntil = step.options?.navWait ?? 'domcontentloaded';
      emit.log(`Going to ${url}`);
      try {
        await page.goto(url, { waitUntil, timeout: ctx.stepTimeout });
      } catch (err) {
        // A dropped connection or a slow first byte is usually temporary: one
        // retry saves the whole run on flaky networks and busy sites.
        const message = errorMessage(err);
        if (ctx.signal?.aborted || !/net::|ERR_|Timeout|timed out/i.test(message)) throw err;
        emit.log(`Couldn't load the page (${message.split('\n')[0]}). Trying once more…`, 'warn');
        await sleep(1500, ctx.signal);
        await page.goto(url, { waitUntil, timeout: ctx.stepTimeout });
      }
      await ctx.afterNavigation?.();
      return;
    }

    case 'back': {
      // page.goBack() can return null even on a successful navigation (e.g. for
      // data:/SPA history), so detect success by whether the URL changed.
      const before = page.url();
      emit.log('Going back to the previous page…');
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => null);
      const after = page.url();
      if (after === before) emit.log('Nothing to go back to (no earlier page in history).', 'warn');
      else emit.log(`Now on ${after}`);
      await ctx.afterNavigation?.();
      return;
    }

    case 'reload': {
      emit.log('Reloading the page…');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await ctx.afterNavigation?.();
      return;
    }

    case 'search': {
      const query = (step.value ?? '').trim();
      if (!query) throw new Error('Search: nothing to search for.');
      emit.log(`Searching Google for "${query}"`);
      await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
      await ctx.afterNavigation?.();
      // Dismiss a consent dialog if Google shows one.
      try {
        await page.getByRole('button', { name: /accept all|i agree|reject all/i }).first().click({ timeout: 2500 });
      } catch {
        /* no consent dialog */
      }
      const box = page.locator('textarea[name="q"], input[name="q"]').first();
      await box.fill(query);
      await box.press('Enter');
      await settle(ctx.page);
      return;
    }

    case 'fillField': {
      // Type into a text field / search box on the page we're already on.
      if (!target) throw new Error('Type into field: no field was specified.');
      const field = await locate(ctx, target, emit, 'Type into field');
      const text = step.value ?? '';
      const delay = step.options?.typeDelayMs ?? 0;
      emit.log(`Typing "${text}" into ${describeTarget(target)}`);
      if (delay > 0) {
        // Type like a person: some sites only enable their button on key events.
        await field.click({ timeout: 5000 }).catch(() => {});
        await field.fill('');
        await field.pressSequentially(text, { delay: Math.min(delay, 300) });
      } else {
        await field.fill(text);
      }
      if (step.options?.pressEnter ?? true) {
        emit.log('Pressing Enter', 'debug');
        await field.press('Enter');
        await settle(ctx.page);
      }
      return;
    }

    case 'click': {
      if (!target) throw new Error('Click: no element was specified.');
      if (target.autoIncrement) advanceAutoIndex(ctx, step);
      const el = await locate(ctx, step.target!, emit, 'Click');
      const kind = step.options?.clickType ?? 'single';
      emit.log(`${kind === 'double' ? 'Double-clicking' : kind === 'right' ? 'Right-clicking' : 'Clicking'} ${describeTarget(target)}`);
      await clickWithRecovery(ctx, el, emit, 'Click', kind);
      await settle(ctx.page);
      return;
    }

    case 'hover': {
      if (!target) throw new Error('Hover: no element was specified.');
      if (target.autoIncrement) advanceAutoIndex(ctx, step);
      const el = await locate(ctx, step.target!, emit, 'Hover');
      emit.log(`Hovering over ${describeTarget(target)}`);
      await el.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await el.hover();
      return;
    }

    case 'selectOption': {
      if (!target) throw new Error('Choose from dropdown: no dropdown was specified.');
      const choice = (step.value ?? '').trim();
      if (!choice) throw new Error('Choose from dropdown: no option was given.');
      const el = await locate(ctx, target, emit, 'Choose from dropdown');
      emit.log(`Choosing “${choice}” in ${describeTarget(target)}`);
      // Match the visible label first (what the user sees), then the value.
      const picked = await el.selectOption({ label: choice }).catch(() => null);
      if (!picked || picked.length === 0) {
        const byValue = await el.selectOption(choice).catch(() => null);
        if (!byValue || byValue.length === 0) {
          const options = await el
            .locator('option')
            .allInnerTexts()
            .catch(() => [] as string[]);
          const list = options.map((o) => o.trim()).filter(Boolean).slice(0, 8).join(', ');
          throw new Error(`Choose from dropdown: no option “${choice}”.${list ? ` Options: ${list}` : ''}`);
        }
      }
      await settle(ctx.page);
      return;
    }

    case 'pressKey': {
      const key = (step.value ?? '').trim() || 'Enter';
      emit.log(`Pressing key: ${key}`);
      await page.keyboard.press(key);
      return;
    }

    case 'scroll': {
      const dir = (step.value ?? 'down').trim().toLowerCase();
      if (dir === 'bottomall') {
        // Keep scrolling while the page keeps growing: "load more" lists, feeds,
        // and galleries that only render what you've scrolled past.
        emit.log('Scrolling to the bottom, loading more each time…');
        let previous = -1;
        for (let i = 0; i < 40; i++) {
          const height = await page.evaluate(() => {
            const el = document.scrollingElement ?? document.body;
            window.scrollTo({ top: el.scrollHeight });
            return el.scrollHeight;
          });
          if (height === previous) break;
          previous = height;
          await sleep(700, ctx.signal);
        }
        emit.log('Reached the bottom.', 'debug');
        return;
      }
      emit.log(`Scrolling ${dir === 'bottom' || dir === 'top' ? 'to the ' + dir : dir}`);
      await page.evaluate((d) => {
        const h = document.scrollingElement?.scrollHeight ?? document.body.scrollHeight;
        if (d === 'bottom') window.scrollTo({ top: h });
        else if (d === 'top') window.scrollTo({ top: 0 });
        else window.scrollBy({ top: (d === 'up' ? -1 : 1) * window.innerHeight * 0.9 });
      }, dir);
      await sleep(300, ctx.signal); // let lazy-loaded content kick in
      return;
    }

    case 'waitFor': {
      if (!target) throw new Error('Wait for element: no element was specified.');
      const state = step.options?.waitState ?? 'visible';
      const desc = describeTarget(target);
      emit.log(state === 'visible' ? `Waiting for ${desc} to appear…` : `Waiting for ${desc} to go away…`);
      if (state === 'visible') {
        await locate(ctx, target, emit, 'Wait for element');
      } else {
        const base = await resolveTarget(page, target);
        await base
          .first()
          .waitFor({ state: 'hidden', timeout: ctx.stepTimeout })
          .catch((err) => {
            if (ctx.signal?.aborted) throw err;
            throw new Error(`Wait for element: ${desc} was still there after ${secs(ctx.stepTimeout)}.`);
          });
      }
      return;
    }

    case 'waitForMe': {
      // Hand control back to the person: sign in, pick something, pass a check.
      const message = (step.value ?? '').trim() || 'Do what you need to in the browser window.';
      emit.log(`Paused for you: ${message}`, 'warn');
      if (!ctx.pauseForUser) {
        emit.log('This build can’t pause, so the step was skipped.', 'warn');
        return;
      }
      await ctx.pauseForUser(message);
      emit.log('Carrying on.', 'debug');
      return;
    }

    case 'assertText': {
      const text = (step.value ?? '').trim();
      if (!text) throw new Error('Check page text: no text was given.');
      const expect = step.options?.expect ?? 'present';
      const loc = page.getByText(text).first();
      if (expect === 'present') {
        await loc.waitFor({ state: 'visible', timeout: ctx.stepTimeout }).catch(async (err) => {
          if (ctx.signal?.aborted) throw err;
          throw new Error(`Check page text: “${text}” is not on the page.${await where(ctx)}`);
        });
        emit.log(`Found “${text}” on the page.`, 'success');
      } else {
        await loc.waitFor({ state: 'hidden', timeout: ctx.stepTimeout }).catch(async (err) => {
          if (ctx.signal?.aborted) throw err;
          throw new Error(`Check page text: “${text}” is on the page, but it shouldn't be.${await where(ctx)}`);
        });
        emit.log(`Confirmed “${text}” is not on the page.`, 'success');
      }
      return;
    }

    case 'extractText': {
      if (!target) throw new Error('Save text: no element was specified.');
      const name = (step.saveAs ?? '').trim();
      if (!/^\w+$/.test(name)) throw new Error('Save text: the variable needs a name (letters, digits or _).');
      if (target.autoIncrement) advanceAutoIndex(ctx, step);
      const el = await locate(ctx, step.target!, emit, 'Save text');
      const mode = step.options?.extract ?? 'text';
      let raw: string | null = '';
      if (mode === 'href') {
        // Resolve relative links against the page, so the variable is usable.
        raw = await el.evaluate((node) => (node as HTMLAnchorElement).href ?? node.getAttribute('href'));
      } else if (mode === 'value') {
        raw = await el.inputValue().catch(() => el.evaluate((node) => (node as HTMLInputElement).value ?? ''));
      } else if (mode === 'attribute') {
        const attr = (step.options?.attribute ?? '').trim();
        if (!attr) throw new Error('Save text: name the attribute to read (for example src).');
        raw = await el.getAttribute(attr);
      } else {
        raw = await el.evaluate((node) => {
          if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
            return node.value;
          }
          return (node as HTMLElement).innerText ?? node.textContent ?? '';
        });
      }
      const text = (raw ?? '').replace(/\s+/g, ' ').trim();
      if (!text) emit.log(`Nothing to read from ${describeTarget(target)} — {{${name}}} is empty.`, 'warn');
      ctx.runVars[name] = text;
      const shown = text.length > 80 ? text.slice(0, 77) + '…' : text;
      emit.log(`Saved {{${name}}} = “${shown}”`, 'success');
      return;
    }

    case 'appendRow': {
      // Collect results as the flow runs: one CSV row per pass.
      const cells = (step.value ?? '').split(',').map((c) => c.trim());
      if (!cells.some(Boolean)) throw new Error('Save a row: nothing to write.');
      const name = sanitizeFilename((step.fileName ?? '').trim() || 'results.csv', 'results.csv');
      const file = join(ctx.downloadDir, /\.(csv|txt|tsv)$/i.test(name) ? name : name + '.csv');
      await fs.mkdir(ctx.downloadDir, { recursive: true });
      const exists = await fs
        .access(file)
        .then(() => true)
        .catch(() => false);
      if (!exists && ctx.csvHeaders?.length) {
        await fs.writeFile(file, csvRow(ctx.csvHeaders) + '\n', 'utf-8');
      }
      await fs.appendFile(file, csvRow(cells) + '\n', 'utf-8');
      if (!ctx.savedRows.includes(file)) ctx.savedRows.push(file);
      emit.log(`Saved a row to ${file}`, 'success');
      return;
    }

    case 'uploadFile': {
      if (!target) throw new Error('Choose a file: no upload field was specified.');
      const path = (step.fileName ?? '').trim();
      if (!path) throw new Error('Choose a file: pick the file to attach.');
      const full = isAbsolute(path) ? path : join(ctx.downloadDir, path);
      await fs.access(full).catch(() => {
        throw new Error(`Choose a file: “${full}” doesn't exist.`);
      });
      const el = await locate(ctx, target, emit, 'Choose a file', 'attached');
      emit.log(`Attaching ${full}`);
      await el.setInputFiles(full);
      return;
    }

    case 'closeTab': {
      const closing = ctx.page;
      const others = ctx.context.pages().filter((p) => p !== closing && !p.isClosed());
      emit.log('Closing the current tab…');
      await closing.close().catch(() => {});
      ctx.page = others.length ? others[others.length - 1] : await ctx.context.newPage();
      await ctx.page.bringToFront().catch(() => {});
      let where = '';
      try {
        where = ctx.page.url();
      } catch {
        /* ignore */
      }
      emit.log(`Back on ${where || 'the previous tab'}.`);
      return;
    }

    case 'closeOtherTabs': {
      const keep = ctx.page;
      const others = ctx.context.pages().filter((p) => p !== keep && !p.isClosed());
      for (const p of others) await p.close().catch(() => {});
      emit.log(others.length ? `Closed ${others.length} other tab(s).` : 'No other tabs to close.');
      return;
    }

    case 'closeAd': {
      emit.log('Looking for an ad / skip / close button…');
      // Try the main page AND any iframes (ad overlays often live in iframes).
      const frames = page.frames();
      const skipText = /^\s*(skip ad|skip|continue to (the )?(site|website)|go to (the )?(website|site)|close|dismiss|no thanks|×|✕|x)\s*$/i;
      for (const f of frames) {
        const closers = [
          f.getByRole('button', { name: skipText }),
          f.getByRole('link', { name: skipText }),
          f.getByText(skipText),
          f.locator('[aria-label*="close" i], [class*="close" i], [id*="skip" i], [class*="skip" i]'),
        ];
        for (const c of closers) {
          try {
            const first = c.first();
            if (await first.isVisible({ timeout: 800 })) {
              await first.click({ timeout: 1500 });
              emit.log('Closed an ad / skipped.', 'success');
              return;
            }
          } catch {
            /* try next strategy */
          }
        }
      }
      // Cookie banners and consent walls count as "in the way" too.
      if (await clearOverlay(page, emit.log).catch(() => false)) return;
      emit.log('No ad found (that is okay).');
      return;
    }

    case 'wait': {
      const n = Number(step.value);
      const ms = Number.isFinite(n) && n >= 0 && (step.value ?? '').trim() !== '' ? n : 1000;
      emit.log(`Waiting ${ms}ms`);
      await sleep(ms, ctx.signal); // page-independent, and Stop ends it immediately
      return;
    }

    case 'screenshot': {
      const name = sanitizeFilename((step.value ?? '').trim() || 'screenshot.png', 'screenshot.png');
      const withExt = /\.(png|jpe?g)$/i.test(name) ? name : name + '.png';
      await fs.mkdir(ctx.downloadDir, { recursive: true });
      const path = await uniquePath(ctx.downloadDir, withExt);
      try {
        await page.screenshot({ path, fullPage: false });
      } finally {
        release(path);
      }
      ctx.screenshots.push({ path, filename: path.split(/[\\/]/).pop() ?? withExt });
      emit.log(`Saved screenshot to ${path}`, 'success');
      return;
    }

    case 'download':
    case 'downloadWait': {
      // Click the link/button and save whatever downloads — from this tab OR a
      // new tab the site pops open (captured by the page manager).
      const label = step.action === 'download' ? 'Download' : 'Download & wait';
      if (!target) throw new Error(`${label}: no link/button was specified.`);
      if (target.autoIncrement) advanceAutoIndex(ctx, step);
      const el = await locate(ctx, step.target!, emit, label);
      const waitMs = step.action === 'download' ? ctx.stepTimeout : step.options?.waitMs ?? 30000;
      const before = ctx.downloadsStarted;
      const skipped = ctx.downloadsSkipped;
      emit.log(`Clicking ${describeTarget(step.target)} and waiting up to ${secs(waitMs)} for the download to start…`);
      await clickWithRecovery(ctx, el, emit, label);
      const got = await waitForDownloadStart(ctx, before, waitMs);
      if (!got) {
        // A file that was already on disk counts as success, not a failure.
        if (ctx.downloadsSkipped > skipped) {
          emit.log('That file is already in the download folder, so it was skipped.', 'success');
          return;
        }
        throw new Error(
          `${label}: clicked ${describeTarget(step.target)} but no download started within ${secs(waitMs)}. ` +
            'The site may need another click first (e.g. a "Continue" step), a longer wait, or it opened the file in a blocked pop-up.' +
            (await where(ctx))
        );
      }
      emit.log('Download started (it keeps saving in the background).');
      return;
    }

    default:
      emit.log(`Unknown action "${(step as Step).action}" — skipping.`, 'warn');
  }
}

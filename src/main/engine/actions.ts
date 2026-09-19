// One handler per action. Each takes the run context, the (already
// variable-substituted) step, and an `emit` for log lines. Throwing signals
// failure; the runner decides whether to retry, stop or continue based on the
// step's options.

import { promises as fs } from 'fs';
import type { Locator, Page } from 'playwright';
import type { Step, Target } from '../../shared/types';
import { describeTarget } from '../../shared/actions';
import type { RunContext, LogFn } from './browser';
import { resolveTarget } from './target';
import { sleep, uniquePath, release, sanitizeFilename } from './util';

export interface Emit {
  log: LogFn;
}

/**
 * Resolve a target to a single element, WAITING for it to appear and become
 * visible. This is what lets the engine find content that loaded dynamically
 * without a full page navigation (e.g. results injected via AJAX) instead of
 * giving up instantly.
 */
async function locate(ctx: RunContext, target: Target, emit: Emit, what: string): Promise<Locator> {
  const page = ctx.page;
  const base = await resolveTarget(page, target);
  const idx = parseIndex(target.index); // 1-based, or undefined for "first"
  const chosen = idx != null ? base.nth(idx - 1) : base.first();
  const desc = describeTarget(target);
  try {
    await chosen.waitFor({ state: 'visible', timeout: ctx.stepTimeout });
  } catch (err) {
    if (ctx.signal?.aborted) throw err;
    const n = await base.count().catch(() => 0);
    if (idx != null && idx > n) {
      throw new Error(`${what}: wanted item #${idx} but only ${n} match${n === 1 ? '' : 'es'} ${desc}.`);
    }
    if (n > 0) {
      throw new Error(`${what}: found ${desc} but it never became visible within ${secs(ctx.stepTimeout)}.`);
    }
    throw new Error(`${what}: couldn't find ${desc} on the page within ${secs(ctx.stepTimeout)}.`);
  }
  const n = await base.count();
  if (idx != null) {
    emit.log(`Using match #${idx} of ${n} for ${desc}`, 'debug');
  } else if (n > 1) {
    emit.log(`${n} matches for ${desc}; using the first (set “item #” to pick another).`, 'warn');
  }
  return chosen;
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
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
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
      emit.log(`Going to ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
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
      return;
    }

    case 'reload': {
      emit.log('Reloading the page…');
      await page.reload({ waitUntil: 'domcontentloaded' });
      return;
    }

    case 'search': {
      const query = (step.value ?? '').trim();
      if (!query) throw new Error('Search: nothing to search for.');
      emit.log(`Searching Google for "${query}"`);
      await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
      // Dismiss a consent dialog if Google shows one.
      try {
        await page.getByRole('button', { name: /accept all|i agree/i }).click({ timeout: 2500 });
      } catch {
        /* no consent dialog */
      }
      const box = page.locator('textarea[name="q"], input[name="q"]').first();
      await box.fill(query);
      await box.press('Enter');
      await settle(page);
      return;
    }

    case 'fillField': {
      // Type into a text field / search box on the page we're already on.
      if (!target) throw new Error('Type into field: no field was specified.');
      const field = await locate(ctx, target, emit, 'Type into field');
      emit.log(`Typing "${step.value ?? ''}" into ${describeTarget(target)}`);
      await field.fill(step.value ?? '');
      if (step.options?.pressEnter ?? true) {
        emit.log('Pressing Enter', 'debug');
        await field.press('Enter');
        await settle(page);
      }
      return;
    }

    case 'click': {
      if (!target) throw new Error('Click: no element was specified.');
      if (target.autoIncrement) advanceAutoIndex(ctx, step);
      const el = await locate(ctx, step.target!, emit, 'Click');
      emit.log(`Clicking ${describeTarget(target)}`);
      await el.click();
      await settle(page);
      return;
    }

    case 'hover': {
      if (!target) throw new Error('Hover: no element was specified.');
      if (target.autoIncrement) advanceAutoIndex(ctx, step);
      const el = await locate(ctx, step.target!, emit, 'Hover');
      emit.log(`Hovering over ${describeTarget(target)}`);
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
      await settle(page);
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

    case 'assertText': {
      const text = (step.value ?? '').trim();
      if (!text) throw new Error('Check page text: no text was given.');
      const expect = step.options?.expect ?? 'present';
      const loc = page.getByText(text).first();
      if (expect === 'present') {
        await loc.waitFor({ state: 'visible', timeout: ctx.stepTimeout }).catch((err) => {
          if (ctx.signal?.aborted) throw err;
          throw new Error(`Check page text: “${text}” is not on the page.`);
        });
        emit.log(`Found “${text}” on the page.`, 'success');
      } else {
        await loc.waitFor({ state: 'hidden', timeout: ctx.stepTimeout }).catch((err) => {
          if (ctx.signal?.aborted) throw err;
          throw new Error(`Check page text: “${text}” is on the page, but it shouldn't be.`);
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
      const raw = await el.evaluate((node) => {
        if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
          return node.value;
        }
        return (node as HTMLElement).innerText ?? node.textContent ?? '';
      });
      const text = raw.replace(/\s+/g, ' ').trim();
      ctx.runVars[name] = text;
      const shown = text.length > 80 ? text.slice(0, 77) + '…' : text;
      emit.log(`Saved {{${name}}} = “${shown}”`, 'success');
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
      emit.log(`Clicking ${describeTarget(step.target)} and waiting up to ${secs(waitMs)} for the download to start…`);
      await el.click();
      const got = await waitForDownloadStart(ctx, before, waitMs);
      if (!got) {
        throw new Error(
          `${label}: clicked ${describeTarget(step.target)} but no download started within ${secs(waitMs)}. ` +
            'The site may need another click first (e.g. a "Continue" step), a longer wait, or it opened the file in a blocked pop-up.'
        );
      }
      emit.log('Download started (it keeps saving in the background).');
      return;
    }

    default:
      emit.log(`Unknown action "${(step as Step).action}" — skipping.`, 'warn');
  }
}

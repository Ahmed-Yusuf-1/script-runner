// One handler per action. Each takes the run context, the (already
// variable-substituted) step, and an `emit` for log lines. Throwing signals
// failure; the runner decides whether to stop or continue based on the step's
// onError policy.

import { join } from 'path';
import type { Locator, Page } from 'playwright';
import type { Step, Target } from '../../shared/types';
import type { RunContext } from './browser';
import { resolveTarget } from './target';

export interface Emit {
  log: (msg: string) => void;
}

/**
 * Resolve a target to a single element, WAITING for it to appear and become
 * visible. This is what lets the engine find content that loaded dynamically
 * without a full page navigation (e.g. results injected via AJAX) instead of
 * giving up instantly.
 */
async function locate(page: Page, target: Target, emit: Emit, what: string): Promise<Locator> {
  const base = await resolveTarget(page, target);
  const idx = parseIndex(target.index); // 1-based, or undefined for "first"
  const chosen = idx != null ? base.nth(idx - 1) : base.first();
  try {
    await chosen.waitFor({ state: 'visible' });
  } catch {
    const n = await base.count().catch(() => 0);
    if (idx != null && idx > n) {
      throw new Error(
        `${what}: wanted item #${idx} but only ${n} match${n === 1 ? '' : 'es'} "${target.text}".`
      );
    }
    const desc = target.by === 'searchbox' ? 'a search box' : `"${target.text ?? ''}"`;
    throw new Error(`${what}: couldn't find ${desc} on the page (it never appeared).`);
  }
  const n = await base.count();
  if (idx != null) {
    emit.log(`Using match #${idx} of ${n} for "${target.text}"`);
  } else if (n > 1) {
    emit.log(`⚠ ${n} matches for "${target.text}" — using the first (set “item #” to pick one).`);
  }
  return chosen;
}

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

/** A page-independent sleep (won't crash if the site closed the tab). */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait up to timeoutMs for a new download (from any tab) to be captured. */
async function waitForNewDownload(
  ctx: RunContext,
  before: number,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (ctx.downloads.length > before) return true;
    await sleep(200);
  }
  return ctx.downloads.length > before;
}

export async function runAction(ctx: RunContext, step: Step, emit: Emit): Promise<void> {
  await runActionInner(ctx, step, emit);

  // Universal optional "then wait" — pauses after ANY step if set.
  const after = step.options?.waitAfterMs;
  if (after && after > 0) {
    emit.log(`Waiting ${after}ms…`);
    await new Promise((r) => setTimeout(r, after)); // setTimeout: works even if the tab closed
  }
}

async function runActionInner(ctx: RunContext, step: Step, emit: Emit): Promise<void> {
  const { page } = ctx;

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
      if (after === before) emit.log('Nothing to go back to (no earlier page in history).');
      else emit.log(`Now on ${after}`);
      return;
    }

    case 'search': {
      const query = (step.value ?? '').trim();
      emit.log(`Searching Google for "${query}"`);
      await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
      // Dismiss a consent dialog if Google shows one.
      try {
        await page
          .getByRole('button', { name: /accept all|i agree/i })
          .click({ timeout: 2500 });
      } catch {
        /* no consent dialog */
      }
      const box = page.locator('textarea[name="q"], input[name="q"]').first();
      await box.fill(query);
      await box.press('Enter');
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      return;
    }

    case 'fillField': {
      // Type into a text field / search box on the page we're already on.
      if (!step.target) throw new Error('Type into field: no field was specified.');
      const field = await locate(page, step.target, emit, 'Type into field');
      emit.log(`Typing "${step.value ?? ''}" into the field`);
      await field.fill(step.value ?? '');
      if (step.options?.pressEnter ?? true) {
        emit.log('Pressing Enter');
        await field.press('Enter');
        await page.waitForLoadState('domcontentloaded').catch(() => {});
      }
      return;
    }

    case 'click': {
      if (!step.target) throw new Error('Click: no element was specified.');
      if (step.target.autoIncrement) advanceAutoIndex(ctx, step);
      const el = await locate(page, step.target, emit, 'Click');
      emit.log(`Clicking "${step.target.text}"`);
      await el.click();
      await page.waitForLoadState('domcontentloaded').catch(() => {});
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

    case 'closeAd': {
      emit.log('Looking for an ad / close button…');
      const closers = [
        page.getByRole('button', { name: /close|dismiss|no thanks|skip/i }),
        page.getByText(/^×$|^✕$|^x$/i),
        page.locator('[aria-label*="close" i]'),
      ];
      for (const c of closers) {
        try {
          if (await c.first().isVisible({ timeout: 1500 })) {
            await c.first().click({ timeout: 1500 });
            emit.log('Closed an ad.');
            return;
          }
        } catch {
          /* try next strategy */
        }
      }
      emit.log('No ad found (that is okay).');
      return;
    }

    case 'pressKey': {
      const key = (step.value ?? 'Enter').trim();
      emit.log(`Pressing key: ${key}`);
      await page.keyboard.press(key);
      return;
    }

    case 'wait': {
      const ms = Number(step.value) || 1000;
      emit.log(`Waiting ${ms}ms`);
      await sleep(ms); // page-independent, so a closed tab can't break a wait
      return;
    }

    case 'screenshot': {
      const name = (step.value ?? 'screenshot.png').trim() || 'screenshot.png';
      const path = join(ctx.downloadDir, name);
      await page.screenshot({ path });
      emit.log(`Saved screenshot to ${path}`);
      return;
    }

    case 'download': {
      // Click the link/button and save whatever downloads — from this tab OR a
      // new tab the site pops open (captured by the page manager).
      if (!step.target) throw new Error('Download: no link/button was specified.');
      if (step.target.autoIncrement) advanceAutoIndex(ctx, step);
      const el = await locate(page, step.target, emit, 'Download');
      const before = ctx.downloads.length;
      emit.log(`Clicking "${step.target.text}" and waiting for the download…`);
      await el.click();
      const got = await waitForNewDownload(ctx, before, ctx.defaultTimeout);
      if (!got) {
        throw new Error(
          `Download: clicked "${step.target.text}" but no file started downloading within ${Math.round(
            ctx.defaultTimeout / 1000
          )}s. The site may need another click first (e.g. a "Convert"/"Prepare" step), or it opened the file in a blocked pop-up.`
        );
      }
      emit.log(`Saved ${ctx.downloads[ctx.downloads.length - 1].filename}`);
      return;
    }

    case 'downloadWait': {
      // Like 'download', but YOU choose how long to wait for the file (the
      // "wait" field). Returns as soon as the file arrives. Good when the site
      // needs time to prepare the download, and for pacing a repeat loop.
      if (!step.target) throw new Error('Download & wait: no link/button was specified.');
      if (step.target.autoIncrement) advanceAutoIndex(ctx, step);
      const el = await locate(page, step.target, emit, 'Download & wait');
      const waitMs = step.options?.waitMs ?? 1000;
      const before = ctx.downloads.length;
      emit.log(`Clicking "${step.target.text}" and waiting up to ${waitMs}ms for the download…`);
      await el.click();
      const got = await waitForNewDownload(ctx, before, waitMs);
      if (!got) {
        throw new Error(
          `Download & wait: clicked "${step.target.text}" but no file arrived within ${waitMs}ms. Try a longer wait, or the file may open in a new tab/pop-up.`
        );
      }
      emit.log(`Saved ${ctx.downloads[ctx.downloads.length - 1].filename}`);
      return;
    }

    default:
      emit.log(`Unknown action "${(step as Step).action}" — skipping.`);
  }
}

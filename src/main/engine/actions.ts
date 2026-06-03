// One handler per action. Each takes the run context, the (already
// variable-substituted) step, and an `emit` for log lines. Throwing signals
// failure; the runner decides whether to stop or continue based on the step's
// onError policy.

import { join } from 'path';
import type { Step } from '../../shared/types';
import type { RunContext } from './browser';
import { resolveTarget } from './target';

export interface Emit {
  log: (msg: string) => void;
}

export async function runAction(ctx: RunContext, step: Step, emit: Emit): Promise<void> {
  const { page } = ctx;

  switch (step.action) {
    case 'goto': {
      let url = (step.value ?? '').trim();
      if (!url) throw new Error('Go to: no link was provided.');
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      emit.log(`Going to ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
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
      // NEW: type into a text field / search box on the page we're already on.
      if (!step.target) throw new Error('Type into field: no field was specified.');
      const locator = await resolveTarget(page, step.target);
      const count = await locator.count();
      if (count === 0) {
        throw new Error(
          step.target.by === 'searchbox'
            ? "Type into field: couldn't find a search box on this page."
            : `Type into field: couldn't find a field matching "${step.target.text}".`
        );
      }
      if (count > 1) {
        emit.log(`⚠ ${count} fields matched — using the first one.`);
      }
      const field = locator.first();
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
      const locator = await resolveTarget(page, step.target);
      const count = await locator.count();
      if (count === 0) {
        throw new Error(`Click: couldn't find anything that says "${step.target.text}".`);
      }
      if (count > 1) {
        emit.log(`⚠ ${count} matches for "${step.target.text}" — using the first one.`);
      }
      emit.log(`Clicking "${step.target.text}"`);
      await locator.first().click();
      await page.waitForLoadState('domcontentloaded').catch(() => {});
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
      await page.waitForTimeout(ms);
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
      if (!step.target) throw new Error('Download: no link/button was specified.');
      const locator = await resolveTarget(page, step.target);
      if ((await locator.count()) === 0) {
        throw new Error(`Download: couldn't find "${step.target.text}".`);
      }
      emit.log(`Clicking "${step.target.text}" and waiting for a download…`);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        locator.first().click(),
      ]);
      const dest = join(ctx.downloadDir, download.suggestedFilename());
      await download.saveAs(dest);
      emit.log(`Saved download to ${dest}`);
      return;
    }

    default:
      emit.log(`Unknown action "${(step as Step).action}" — skipping.`);
  }
}

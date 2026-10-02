// Two things that quietly break automations on real sites:
//
//   1. Cookie / consent banners, which cover the page until someone clicks them.
//   2. The browser's own alert() / confirm() / prompt() dialogs, which block the
//      page until they're answered.
//
// Both are handled here, best effort and never fatal. Consent banners are
// dismissed with the most privacy-preserving button available: "Reject all" is
// preferred over "Accept all", because the goal is to get the banner out of the
// way, not to opt in on the user's behalf.
//
// No Electron imports.

import type { BrowserContext, Dialog, Frame, Page } from 'playwright';
import type { LogLevel } from '../../shared/types';

type Log = (msg: string, level?: LogLevel) => void;

/** Buttons that dismiss a banner, best choice first. */
const REJECT = /^\s*(reject all|reject|decline all|decline|refuse all|refuse|only necessary|necessary only|essential only|use necessary cookies only|continue without accepting|deny)\s*$/i;
const ACCEPT = /^\s*(accept all|accept all cookies|allow all|accept cookies|i accept|accept|agree|i agree|agree and close|got it|ok, got it|understood|allow)\s*$/i;
const CLOSE_LABELS = /close|dismiss|no thanks/i;

/** Containers that usually hold a consent banner, so we don't click random page buttons. */
const BANNER_HINTS = [
  '[id*="cookie" i]',
  '[class*="cookie" i]',
  '[id*="consent" i]',
  '[class*="consent" i]',
  '[id*="gdpr" i]',
  '[class*="gdpr" i]',
  '[aria-label*="cookie" i]',
  '[aria-label*="consent" i]',
  '#onetrust-banner-sdk',
  '.fc-consent-root',
  '.qc-cmp2-container',
  '[data-testid*="cookie" i]',
  'dialog[open]',
  '[role="dialog"]',
  '[role="alertdialog"]',
];

/**
 * Look for a consent banner and dismiss it. Returns true if something was
 * clicked. Cheap enough to call after each navigation: it gives up quickly when
 * there's no banner.
 */
export async function dismissConsent(page: Page, log?: Log): Promise<boolean> {
  const scopes: (Page | Frame)[] = [page, ...page.frames().filter((f) => f !== page.mainFrame() && !f.isDetached())];

  for (const scope of scopes) {
    for (const hint of BANNER_HINTS) {
      const banner = scope.locator(hint).filter({ visible: true }).first();
      if (!(await banner.count().catch(() => 0))) continue;

      for (const name of [REJECT, ACCEPT]) {
        for (const role of ['button', 'link'] as const) {
          const button = banner.getByRole(role, { name }).filter({ visible: true }).first();
          if (!(await button.count().catch(() => 0))) continue;
          const label = (await button.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
          const clicked = await button
            .click({ timeout: 2500 })
            .then(() => true)
            .catch(() => false);
          if (clicked) {
            log?.(`Dismissed a cookie banner (“${label || 'consent'}”).`, 'debug');
            await page.waitForTimeout(250).catch(() => {});
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Try to clear whatever is covering an element: a consent banner, then a
 * generic close button on a modal or ad overlay. Returns true if anything was
 * clicked, so the caller can retry.
 */
export async function clearOverlay(page: Page, log?: Log): Promise<boolean> {
  if (await dismissConsent(page, log)) return true;

  const closers = [
    page.getByRole('button', { name: CLOSE_LABELS }),
    page.locator('[aria-label*="close" i], button[class*="close" i], [data-dismiss], .modal-close, .popup-close'),
  ];
  for (const closer of closers) {
    const first = closer.filter({ visible: true }).first();
    if (!(await first.count().catch(() => 0))) continue;
    const clicked = await first
      .click({ timeout: 1500 })
      .then(() => true)
      .catch(() => false);
    if (clicked) {
      log?.('Closed an overlay that was covering the page.', 'debug');
      return true;
    }
  }
  // Last resort: Escape closes many modals.
  await page.keyboard.press('Escape').catch(() => {});
  return false;
}

/**
 * Answer the browser's own dialogs so a flow can't hang on them. Playwright
 * dismisses dialogs by default, which silently cancels "are you sure?" prompts;
 * accepting is almost always what an automation wants.
 */
export function handleDialogs(context: BrowserContext, log?: Log): void {
  const onDialog = (dialog: Dialog) => {
    const type = dialog.type();
    const message = dialog.message().replace(/\s+/g, ' ').slice(0, 160);
    void (async () => {
      try {
        // beforeunload ("leave site?") must be accepted or navigation stalls.
        if (type === 'prompt') await dialog.accept('');
        else await dialog.accept();
        log?.(`Answered a ${type} from the page${message ? `: “${message}”` : ''}.`, 'debug');
      } catch {
        /* the page may have closed the dialog itself */
      }
    })();
  };

  context.on('page', (page) => page.on('dialog', onDialog));
  context.pages().forEach((page) => page.on('dialog', onDialog));
}

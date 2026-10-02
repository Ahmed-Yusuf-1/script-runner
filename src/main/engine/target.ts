// Turns a Target (how the user described an element) into a Playwright Locator.
// This is where the "describe the button text" and "main search box" ideas live.
//
// Text matching is CASE-INSENSITIVE on purpose: a user shouldn't have to match a
// button's exact casing (e.g. "Download MP3" should find a "Download Mp3" button).
// "exact" means the WHOLE text; "contains" means any part of it.
//
// Real pages hide things in iframes (embedded players, payment forms, download
// widgets), so if nothing matches in the page itself we look inside its frames
// too. Hidden elements are skipped where it's safe to do so, because a page
// often has several copies of a control (mobile menu, modal, footer) and only
// one of them is on screen.

import type { Page, Frame, Locator } from 'playwright';
import type { Target } from '../../shared/types';

/** Somewhere elements can be looked up: the page itself or one of its frames. */
type Scope = Page | Frame;

export interface ResolveOptions {
  /** Also look inside iframes (default true). */
  searchFrames?: boolean;
  /** Prefer elements that are actually on screen (default true). */
  visibleOnly?: boolean;
}

/**
 * Find the elements a Target describes. Returns a locator that may match
 * several elements; the caller picks the first or the Nth.
 *
 * When nothing matches yet (the element may still be loading) it returns the
 * main-page locator, so waiting on it still works.
 */
export async function resolveTarget(page: Page, target: Target, opts: ResolveOptions = {}): Promise<Locator> {
  const { searchFrames = true, visibleOnly = true } = opts;
  const main = await locatorIn(page, target, visibleOnly);
  if (await hasAny(main)) return main;

  if (searchFrames) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame() || frame.isDetached()) continue;
      const inFrame = await locatorIn(frame, target, visibleOnly).catch(() => null);
      if (inFrame && (await hasAny(inFrame))) return inFrame;
    }
  }
  return main;
}

async function hasAny(locator: Locator): Promise<boolean> {
  return (await locator.count().catch(() => 0)) > 0;
}

/** Keep only the elements that are actually on screen, if any are. */
async function preferVisible(locator: Locator, visibleOnly: boolean): Promise<Locator> {
  if (!visibleOnly) return locator;
  const visible = locator.filter({ visible: true });
  return (await hasAny(visible)) ? visible : locator;
}

async function locatorIn(scope: Scope, target: Target, visibleOnly: boolean): Promise<Locator> {
  switch (target.by) {
    case 'searchbox':
      return resolveSearchbox(scope);

    case 'placeholder': {
      // A field described by its placeholder, its label, or its accessible name.
      const name = nameMatcher(target.text ?? '', target.match);
      for (const candidate of [
        scope.getByPlaceholder(name),
        scope.getByLabel(name),
        scope.getByRole('textbox', { name }),
        scope.getByRole('combobox', { name }),
      ]) {
        const picked = await preferVisible(candidate, visibleOnly);
        if (await hasAny(picked)) return picked;
      }
      return scope.getByPlaceholder(name);
    }

    case 'selector': {
      const css = (target.selector ?? '').trim();
      if (!css) throw new Error('No CSS selector was given.');
      return preferVisible(scope.locator(css), visibleOnly);
    }

    case 'text':
    default: {
      const name = nameMatcher(target.text ?? '', target.match);
      // Prefer real controls by their accessible name, then anything with that
      // text. getByRole('button') already covers <input type="submit"> values.
      const candidates: Locator[] = [
        scope.getByRole('button', { name }),
        scope.getByRole('link', { name }),
        scope.getByRole('menuitem', { name }),
        scope.getByRole('tab', { name }),
        scope.getByRole('option', { name }),
        scope.getByRole('checkbox', { name }),
        scope.getByRole('radio', { name }),
        scope.getByTitle(name),
        scope.getByText(name),
      ];
      for (const candidate of candidates) {
        const picked = await preferVisible(candidate, visibleOnly);
        if (await hasAny(picked)) return picked;
      }
      return scope.getByText(name);
    }
  }
}

/**
 * Build a case-insensitive matcher.
 *  - exact (default): the whole text, ignoring surrounding whitespace & case.
 *  - contains: any part of the text, ignoring case.
 */
function nameMatcher(text: string, match?: 'exact' | 'contains'): RegExp {
  const body = escapeRegExp(text.trim());
  return match === 'contains' ? new RegExp(body, 'i') : new RegExp('^\\s*' + body + '\\s*$', 'i');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Auto-detect the main search box on an arbitrary site. Tries the most reliable
 * signals first and returns the first that matches a real, visible element —
 * hidden inputs (CSRF tokens, collapsed mobile search) are skipped.
 */
async function resolveSearchbox(scope: Scope): Promise<Locator> {
  const candidates: Locator[] = [
    scope.getByRole('searchbox'),
    scope.locator('input[type="search"]'),
    scope.getByPlaceholder(/search/i),
    scope.locator('input[name="q"], input[name="query"], input[name="search"], input#search, input#searchInput'),
    scope.locator('form[role="search"] input, form[action*="search" i] input[type="text"]'),
    scope.locator('input[type="text"], input:not([type]), textarea'),
  ];
  for (const c of candidates) {
    const visible = c.filter({ visible: true });
    if (await hasAny(visible)) return visible.first();
  }
  for (const c of candidates) {
    if (await hasAny(c)) return c.first();
  }
  // Last resort: the first input on the page.
  return scope.locator('input, textarea').first();
}

/**
 * When a target isn't found, look at what IS on the page so the error can say
 * "did you mean…". Returns the closest visible button/link texts.
 */
export async function suggestTargets(page: Page, wanted: string, limit = 4): Promise<string[]> {
  const want = wanted.trim().toLowerCase();
  if (!want) return [];
  const texts = new Set<string>();

  for (const scope of [page, ...page.frames().filter((f) => f !== page.mainFrame() && !f.isDetached())]) {
    const found = await scope
      .evaluate(() => {
        const out: string[] = [];
        const nodes = document.querySelectorAll<HTMLElement>(
          'button, a[href], [role="button"], [role="link"], [role="menuitem"], input[type="submit"], input[type="button"], summary'
        );
        for (const el of nodes) {
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue; // not rendered
          const label =
            (el as HTMLInputElement).value ||
            el.innerText ||
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            '';
          const text = label.replace(/\s+/g, ' ').trim();
          if (text && text.length <= 60) out.push(text);
          if (out.length > 400) break;
        }
        return out;
      })
      .catch(() => [] as string[]);
    found.forEach((t) => texts.add(t));
    if (texts.size > 400) break;
  }

  return [...texts]
    .map((text) => ({ text, score: similarity(want, text.toLowerCase()) }))
    .filter((c) => c.score > 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => c.text);
}

/** 0–1 similarity: substring matches score high, otherwise edit distance. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a) || a.includes(b)) return 0.9 - Math.min(0.3, Math.abs(a.length - b.length) / 60);
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  if (a.length > 80 || b.length > 80) return Math.max(a.length, b.length); // not worth it
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** Count matches so the engine can warn about / disambiguate ambiguous targets. */
export async function countMatches(locator: Locator): Promise<number> {
  return locator.count();
}

// Turns a Target (how the user described an element) into a Playwright Locator.
// This is where the "describe the button text" and "main search box" ideas live.
//
// Text matching is CASE-INSENSITIVE on purpose: a user shouldn't have to match a
// button's exact casing (e.g. "Download MP3" should find a "Download Mp3" button).
// "exact" means the WHOLE text; "contains" means any part of it.

import type { Page, Locator } from 'playwright';
import type { Target } from '../../shared/types';

export async function resolveTarget(page: Page, target: Target): Promise<Locator> {
  switch (target.by) {
    case 'searchbox':
      return resolveSearchbox(page);

    case 'placeholder': {
      // "field with this placeholder/label" (fillField).
      const name = nameMatcher(target.text ?? '', target.match);
      const byPlaceholder = page.getByPlaceholder(name);
      if ((await byPlaceholder.count()) > 0) return byPlaceholder;
      return page.getByLabel(name);
    }

    case 'selector':
      return page.locator(target.selector ?? '');

    case 'text':
    default: {
      const name = nameMatcher(target.text ?? '', target.match);
      // Prefer a real button / link by accessible name; fall back to any text.
      const byRole = page.getByRole('button', { name });
      if ((await byRole.count()) > 0) return byRole;
      const byLink = page.getByRole('link', { name });
      if ((await byLink.count()) > 0) return byLink;
      return page.getByText(name);
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
  return match === 'contains'
    ? new RegExp(body, 'i')
    : new RegExp('^\\s*' + body + '\\s*$', 'i');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Auto-detect the main search box on an arbitrary site. Tries the most reliable
 * signals first and returns the first that matches a real element.
 */
async function resolveSearchbox(page: Page): Promise<Locator> {
  const candidates: Locator[] = [
    page.getByRole('searchbox'),
    page.locator('input[type="search"]'),
    page.getByPlaceholder(/search/i),
    page.locator('input[name="q"], input[name="search"], input#search, input#searchInput'),
    page.locator('input[type="text"], textarea'),
  ];
  for (const c of candidates) {
    if ((await c.count()) > 0) return c.first();
  }
  // Last resort: the first input on the page.
  return page.locator('input, textarea').first();
}

/** Count matches so the engine can warn about / disambiguate ambiguous targets. */
export async function countMatches(locator: Locator): Promise<number> {
  return locator.count();
}

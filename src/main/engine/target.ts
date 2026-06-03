// Turns a Target (how the user described an element) into a Playwright Locator.
// This is where the "describe the button text" and "main search box" ideas live.

import type { Page, Locator } from 'playwright';
import type { Target } from '../../shared/types';

/**
 * Resolve a target to a locator. Async because some strategies (searchbox
 * auto-detect, placeholder→label fallback) probe the page to pick the first
 * strategy that actually matches something.
 */
export async function resolveTarget(page: Page, target: Target): Promise<Locator> {
  switch (target.by) {
    case 'searchbox':
      return resolveSearchbox(page);

    case 'placeholder': {
      // The new feature's "field with this placeholder/label" option.
      const exact = target.match !== 'contains';
      const byPlaceholder = page.getByPlaceholder(target.text ?? '', { exact });
      if ((await byPlaceholder.count()) > 0) return byPlaceholder;
      // Fall back to an associated <label>.
      return page.getByLabel(target.text ?? '', { exact });
    }

    case 'selector':
      return page.locator(target.selector ?? '');

    case 'text':
    default: {
      const exact = target.match !== 'contains';
      // Prefer a real button/link by accessible name; fall back to any text.
      const byRole = page.getByRole('button', { name: target.text ?? '', exact });
      if ((await byRole.count()) > 0) return byRole;
      const byLink = page.getByRole('link', { name: target.text ?? '', exact });
      if ((await byLink.count()) > 0) return byLink;
      return page.getByText(target.text ?? '', { exact });
    }
  }
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

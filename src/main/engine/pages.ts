// Page manager: captures downloads from ANY tab, and handles new tabs/pop-ups.
//
// When a click opens a NEW TAB:
//   - if it's a download → save the file (capture), don't switch;
//   - if it's a known ad host (and pop-up blocking is on) → close it;
//   - otherwise it's a real next page (e.g. filecrypt → datanodes) → FOLLOW it,
//     so the rest of the flow runs on that tab.
//
// Kept free of Electron imports so the engine stays testable headless.

import { join } from 'path';
import type { BrowserContext, Page, Download } from 'playwright';
import { isAdHost } from './adblock';

export interface DownloadRecord {
  path: string;
  filename: string;
}

export interface PageManagerOptions {
  downloadDir: string;
  blockPopupWindows: boolean;
  blockPopupTabs: boolean;
  /** Sites whose pop-ups are always allowed (never closed). */
  whitelist?: string[];
  log?: (msg: string) => void;
  /** Called when the engine should switch its active tab to a new page. */
  onActiveTab?: (page: Page) => void;
}

export function setupPageManager(
  context: BrowserContext,
  opts: PageManagerOptions
): DownloadRecord[] {
  const log = opts.log ?? (() => {});
  const downloads: DownloadRecord[] = [];
  const pagesThatDownloaded = new WeakSet<Page>();

  // Save every download from every page, wherever it happens.
  const capture = (page: Page) => {
    page.on('download', async (d: Download) => {
      pagesThatDownloaded.add(page);
      try {
        const dest = join(opts.downloadDir, d.suggestedFilename());
        await d.saveAs(dest);
        downloads.push({ path: dest, filename: d.suggestedFilename() });
        log(`Saved download: ${d.suggestedFilename()}`);
      } catch {
        /* ignore a failed/canceled download */
      }
    });
  };

  const whitelist = opts.whitelist ?? [];

  // Decide what to do with a tab that opened after launch.
  const handleNewTab = async (page: Page) => {
    // Give it a moment to start downloading or to load a URL we can judge.
    await Promise.race([
      page.waitForLoadState('domcontentloaded').catch(() => undefined),
      page.waitForTimeout(1500),
    ]);

    if (pagesThatDownloaded.has(page)) return; // a file download tab — leave it

    const url = safeUrl(page);
    const opener = await page.opener().catch(() => null);
    const openerUrl = opener ? safeUrl(opener) : '';

    let isPopup = false;
    try {
      isPopup = await page.evaluate(() => !window.menubar.visible);
    } catch {
      // Ignore evaluation error
    }

    if (isPopup) {
      if (opts.blockPopupWindows && (isAdHost(url) || url === 'about:blank' || url === '')) {
        await page.close().catch(() => {});
        log(`Blocked a pop-up window: ${url}`);
        return;
      }
    } else {
      // 1. Check if same-site: if yes, allow it
      if (openerUrl && isSameSite(url, openerUrl)) {
        opts.onActiveTab?.(page);
        log(`Allowed same-site tab: ${url}`);
        return;
      }

      // 2. Check if whitelisted: if yes, allow it
      if (matchesWhitelist(url, whitelist) || matchesWhitelist(openerUrl, whitelist)) {
        opts.onActiveTab?.(page);
        log(`Allowed whitelisted pop-up tab: ${url || openerUrl}`);
        return;
      }

      // 3. If blockPopupTabs is enabled, close any other new tab (cross-site and not whitelisted)
      if (opts.blockPopupTabs) {
        await page.close().catch(() => {});
        log(`Blocked a pop-up tab: ${url}`);
        return;
      }
    }

    // A real next page — make it the active tab so the flow continues here.
    opts.onActiveTab?.(page);
    log(`Switched to the new tab: ${url}`);
  };

  // Initial page(s): capture only.
  context.pages().forEach(capture);
  // New pages: capture + decide follow/close.
  context.on('page', (page) => {
    capture(page);
    void handleNewTab(page);
  });

  return downloads;
}

function safeUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return '';
  }
}

/** True if the URL's host matches any whitelist entry (loose, case-insensitive). */
function matchesWhitelist(url: string, whitelist: string[]): boolean {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  return whitelist.some((raw) => {
    const entry = raw
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    return entry.length > 0 && host.includes(entry);
  });
}

function isSameSite(url1: string, url2: string): boolean {
  try {
    const h1 = new URL(url1).hostname.toLowerCase();
    const h2 = new URL(url2).hostname.toLowerCase();
    if (!h1 || !h2) return false;
    return h1 === h2 || h1.endsWith('.' + h2) || h2.endsWith('.' + h1);
  } catch {
    return false;
  }
}

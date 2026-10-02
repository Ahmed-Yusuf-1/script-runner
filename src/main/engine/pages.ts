// Page manager: captures downloads from ANY tab, and handles new tabs/pop-ups.
//
// When a click opens a NEW TAB:
//   - if it's a download → save the file (capture), don't switch;
//   - if it's a known ad host (and pop-up blocking is on) → close it;
//   - otherwise it's a real next page (e.g. filecrypt → datanodes) → FOLLOW it,
//     so the rest of the flow runs on that tab.
//
// Kept free of Electron imports so the engine stays testable headless.

import { basename, join } from 'path';
import { promises as fs } from 'fs';
import type { BrowserContext, Page, Download } from 'playwright';
import type { LogLevel, SavedFile } from '../../shared/types';
import { isAdHost } from './adblock';
import { uniquePath, release, formatBytes, fileExists } from './util';

export interface PageManagerOptions {
  downloadDir: string;
  blockPopupWindows: boolean;
  blockPopupTabs: boolean;
  /** Sites whose pop-ups are always allowed (never closed). */
  whitelist?: string[];
  /** Don't download a file again when that name is already in the folder. */
  skipExisting?: boolean;
  log?: (msg: string, level?: LogLevel) => void;
  /** Called when the engine should switch its active tab to a new page. */
  onActiveTab?: (page: Page) => void;
  /** Called the moment a download begins. */
  onDownloadStart?: () => void;
  /** Called when a download has been fully written to disk. */
  onDownloadSaved?: (file: SavedFile) => void;
  /** Called when a download finishes saving (or fails). */
  onDownloadDone?: () => void;
  /** Called when a download was skipped because the file was already there. */
  onDownloadSkipped?: () => void;
}

export function setupPageManager(context: BrowserContext, opts: PageManagerOptions): void {
  const log = opts.log ?? (() => {});
  const pagesThatDownloaded = new WeakSet<Page>();

  // Save every download from every page, wherever it happens. The 'download'
  // event fires when the download STARTS; saving large files then streams in the
  // background — so we report "started" right away and "done" once saved.
  // Files never overwrite each other: a second "report.pdf" becomes "report (1).pdf".
  const capture = (page: Page) => {
    page.on('download', (d: Download) => {
      pagesThatDownloaded.add(page);
      const suggested = d.suggestedFilename();

      // Already got this one? Don't fetch it twice. Repeat loops over a list
      // then pick up where they left off instead of filling the folder with
      // "file (1)", "file (2)"…
      if (opts.skipExisting) {
        void (async () => {
          if (await fileExists(join(opts.downloadDir, suggested))) {
            await d.cancel().catch(() => {});
            log(`Skipped ${suggested}: it's already in the download folder.`, 'info');
            opts.onDownloadSkipped?.();
            return;
          }
          startSaving(d, suggested);
        })();
        return;
      }
      startSaving(d, suggested);
    });
  };

  /** Stream a download to disk under a free file name. */
  const startSaving = (d: Download, suggested: string) => {
    opts.onDownloadStart?.();
    log(`Download started: ${suggested}`);
    void (async () => {
      let dest = '';
      try {
        dest = await uniquePath(opts.downloadDir, suggested);
        await d.saveAs(dest); // resolves only when the whole file is written
        const bytes = await fs.stat(dest).then((st) => st.size).catch(() => undefined);
        const filename = basename(dest);
        opts.onDownloadSaved?.({ path: dest, filename, bytes });
        const renamed = filename !== suggested ? ` as ${filename}` : '';
        log(`Saved ${suggested}${renamed}${bytes != null ? ` (${formatBytes(bytes)})` : ''}`, 'success');
      } catch (err) {
        const reason = (await d.failure().catch(() => null)) ?? (err instanceof Error ? err.message : String(err));
        log(`Download of ${suggested} failed: ${String(reason).split('\n')[0]}`, 'warn');
      } finally {
        if (dest) release(dest);
        opts.onDownloadDone?.();
      }
    })();
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

    // Known ad host → always close, even if same-site/whitelisted. Catches the
    // pop-under ad tabs these download sites spawn alongside the real page.
    if ((opts.blockPopupTabs || opts.blockPopupWindows) && isAdHost(url)) {
      await page.close().catch(() => {});
      log(`Blocked an ad tab: ${url}`, 'warn');
      return;
    }

    let isPopup = false;
    try {
      isPopup = await page.evaluate(() => !window.menubar.visible);
    } catch {
      // Ignore evaluation error
    }

    if (isPopup) {
      if (opts.blockPopupWindows && (isAdHost(url) || url === 'about:blank' || url === '')) {
        await page.close().catch(() => {});
        log(`Blocked a pop-up window: ${url || 'about:blank'}`, 'warn');
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
        log(`Blocked a pop-up tab: ${url}`, 'warn');
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

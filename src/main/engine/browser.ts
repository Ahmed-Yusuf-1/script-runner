// Owns the Playwright browser lifecycle for a single run. Kept free of any
// Electron imports so it can be exercised by the headless smoke tests directly.

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { enableAdblock } from './adblock';
import { setupPageManager } from './pages';
import type { DownloadRecord } from './pages';

export interface RunContext {
  /** Null when using a persistent profile (close the context instead). */
  browser: Browser | null;
  context: BrowserContext;
  page: Page;
  downloadDir: string;
  /** Default action timeout (ms) — used when waiting for downloads, etc. */
  defaultTimeout: number;
  /** Live list of files that finished saving during the run (from any tab). */
  downloads: DownloadRecord[];
  /** Count of downloads that have STARTED (the event fired). */
  downloadsStarted: number;
  /** Downloads currently in progress (started but not yet fully saved). */
  activeDownloads: number;
  /** Per-step running counter for "auto-increment item #", keyed by step id. */
  autoIndex: Map<string, number>;
}

export interface LaunchOptions {
  headless: boolean;
  downloadDir: string;
  timeoutMs: number;
  /** Block ads via filter lists. */
  adblock?: boolean;
  /** Auto-close pop-up windows. */
  blockPopupWindows?: boolean;
  /** Auto-close pop-up tabs. */
  blockPopupTabs?: boolean;
  /** Sites whose pop-ups are always allowed (never closed). */
  popupWhitelist?: string[];
  /** Where to cache the ad-block engine. */
  cacheDir?: string;
  /** Keep a persistent browser profile at this directory (remembers cookies/logins). */
  profileDir?: string;
  /** Optional sink for engine log lines (ad-block status, downloads, etc.). */
  log?: (msg: string) => void;
}


export async function launch(opts: LaunchOptions): Promise<RunContext> {
  let browser: Browser | null = null;
  let context: BrowserContext;

  if (opts.profileDir) {
    // Persistent profile: cookies, logins and "I am a human" tokens survive runs.
    context = await chromium.launchPersistentContext(opts.profileDir, {
      headless: opts.headless,
      acceptDownloads: true,
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled'],
    });
  } else {
    browser = await chromium.launch({
      headless: opts.headless,
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled'],
    });
    context = await browser.newContext({ acceptDownloads: true });
  }
  context.setDefaultTimeout(opts.timeoutMs);
  const page = context.pages()[0] ?? (await context.newPage());

  const ctx: RunContext = {
    browser,
    context,
    page,
    downloadDir: opts.downloadDir,
    defaultTimeout: opts.timeoutMs,
    downloads: [],
    downloadsStarted: 0,
    activeDownloads: 0,
    autoIndex: new Map(),
  };

  // Always capture downloads (from any tab); follow real new tabs; close ad
  // pop-ups only if asked. onActiveTab switches the engine's active page.
  ctx.downloads = setupPageManager(context, {
    downloadDir: opts.downloadDir,
    blockPopupWindows: opts.blockPopupWindows ?? false,
    blockPopupTabs: opts.blockPopupTabs ?? false,
    whitelist: opts.popupWhitelist ?? [],
    log: opts.log,
    onActiveTab: (p) => {
      ctx.page = p;
    },
    onDownloadStart: () => {
      ctx.downloadsStarted += 1;
      ctx.activeDownloads += 1;
    },
    onDownloadDone: () => {
      ctx.activeDownloads = Math.max(0, ctx.activeDownloads - 1);
    },
  });

  await enableAdblock(context, {
    enabled: opts.adblock ?? false,
    cacheDir: opts.cacheDir,
    log: opts.log,
  }).catch((e) => opts.log?.('Ad blocker setup failed: ' + (e?.message ?? e)));

  return ctx;
}

export async function close(ctx: RunContext): Promise<void> {
  try {
    // Persistent profile has no top-level browser — close the context.
    if (ctx.browser) await ctx.browser.close();
    else await ctx.context.close();
  } catch {
    /* already closed (e.g. user pressed Stop) — ignore */
  }
}

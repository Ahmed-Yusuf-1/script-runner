// Owns the Playwright browser lifecycle for a single run. Kept free of any
// Electron imports so it can be exercised by the headless smoke tests directly.

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { LogLevel, SavedFile } from '../../shared/types';
import { enableAdblock } from './adblock';
import { setupPageManager } from './pages';

export type LogFn = (msg: string, level?: LogLevel) => void;

export interface RunContext {
  /** Null when using a persistent profile (close the context instead). */
  browser: Browser | null;
  context: BrowserContext;
  page: Page;
  downloadDir: string;
  /** Default action timeout (ms) — used when waiting for downloads, etc. */
  defaultTimeout: number;
  /** Timeout for the step that's running (its override, or the default). */
  stepTimeout: number;
  /** Live list of files that finished saving during the run (from any tab). */
  downloads: SavedFile[];
  /** Count of downloads that have STARTED (the event fired). */
  downloadsStarted: number;
  /** Downloads currently in progress (started but not yet fully saved). */
  activeDownloads: number;
  /** Per-step running counter for "auto-increment item #", keyed by step id. */
  autoIndex: Map<string, number>;
  /** Variables produced during the run ("Save text as variable"). */
  runVars: Record<string, string>;
  /** Screenshots taken during the run (by steps or on error). */
  screenshots: SavedFile[];
  /** Aborted when the user presses Stop. */
  signal?: AbortSignal;
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
  /** Pause (ms) before every browser action, so a visible run is easy to follow. */
  slowMoMs?: number;
  /** Optional sink for engine log lines (ad-block status, downloads, etc.). */
  log?: LogFn;
  signal?: AbortSignal;
}

const LAUNCH_ARGS = {
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled'],
};

export async function launch(opts: LaunchOptions): Promise<RunContext> {
  let browser: Browser | null = null;
  let context: BrowserContext;
  const slowMo = opts.slowMoMs && opts.slowMoMs > 0 ? opts.slowMoMs : undefined;

  try {
    if (opts.profileDir) {
      // Persistent profile: cookies, logins and "I am a human" tokens survive runs.
      context = await chromium.launchPersistentContext(opts.profileDir, {
        headless: opts.headless,
        acceptDownloads: true,
        slowMo,
        ...LAUNCH_ARGS,
      });
    } else {
      browser = await chromium.launch({ headless: opts.headless, slowMo, ...LAUNCH_ARGS });
      context = await browser.newContext({ acceptDownloads: true });
    }
  } catch (err) {
    throw new Error(explainLaunchError(err, !!opts.profileDir));
  }
  context.setDefaultTimeout(opts.timeoutMs);
  const page = context.pages()[0] ?? (await context.newPage());

  const ctx: RunContext = {
    browser,
    context,
    page,
    downloadDir: opts.downloadDir,
    defaultTimeout: opts.timeoutMs,
    stepTimeout: opts.timeoutMs,
    downloads: [],
    downloadsStarted: 0,
    activeDownloads: 0,
    autoIndex: new Map(),
    runVars: {},
    screenshots: [],
    signal: opts.signal,
  };

  // Always capture downloads (from any tab); follow real new tabs; close ad
  // pop-ups only if asked. onActiveTab switches the engine's active page.
  setupPageManager(context, {
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
    onDownloadSaved: (file) => {
      ctx.downloads.push(file);
    },
    onDownloadDone: () => {
      ctx.activeDownloads = Math.max(0, ctx.activeDownloads - 1);
    },
  });

  await enableAdblock(context, {
    enabled: opts.adblock ?? false,
    cacheDir: opts.cacheDir,
    log: opts.log,
  }).catch((e) => opts.log?.('Ad blocker setup failed: ' + (e?.message ?? e), 'warn'));

  return ctx;
}

/** Turn the most common launch failures into something a user can act on. */
function explainLaunchError(err: unknown, persistent: boolean): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Executable doesn't exist|browserType\.launch.*install/i.test(msg)) {
    return 'The automation browser (Chromium) is not installed. From the project folder, run: npx playwright install chromium';
  }
  if (persistent && /ProcessSingleton|profile.*in use|user data directory is already in use/i.test(msg)) {
    return 'The saved browser profile is in use by another run or Chromium window. Close it and try again, or turn off "Remember logins" in Settings.';
  }
  return 'Could not start the browser: ' + msg.split('\n')[0];
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

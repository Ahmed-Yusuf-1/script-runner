// Owns the Playwright browser lifecycle for a single run. Kept free of any
// Electron imports so it can be exercised by the headless smoke tests directly.

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { LogLevel, SavedFile } from '../../shared/types';
import { enableAdblock } from './adblock';
import { setupPageManager } from './pages';
import { dismissConsent, handleDialogs } from './consent';

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
  /** Downloads skipped because the file was already in the folder. */
  downloadsSkipped: number;
  /** CSV files this run appended rows to. */
  savedRows: string[];
  /** Column names to write when a "Save a row" step creates a new CSV. */
  csvHeaders?: string[];
  /** Called after each navigation: clears cookie banners when that's turned on. */
  afterNavigation?: () => Promise<void>;
  /** Hand control to the person until they press Resume (the "Pause for me" step). */
  pauseForUser?: (message: string) => Promise<void>;
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
  /** Accept or close cookie / consent banners automatically. */
  dismissConsent?: boolean;
  /** Answer the page's own alert / confirm dialogs instead of leaving them open. */
  handleDialogs?: boolean;
  /** Don't load images, media or fonts (faster, lighter runs). */
  blockImages?: boolean;
  /** Skip a download when that file name is already in the download folder. */
  skipExistingDownloads?: boolean;
  /** Browser window size. Both 0 = Playwright's default. */
  viewportWidth?: number;
  viewportHeight?: number;
  /** Override the browser's user agent. */
  userAgent?: string;
  /** Proxy server for the automation browser, e.g. http://127.0.0.1:8080. */
  proxy?: string;
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
  const viewport =
    opts.viewportWidth && opts.viewportHeight && opts.viewportWidth > 0 && opts.viewportHeight > 0
      ? { width: Math.round(opts.viewportWidth), height: Math.round(opts.viewportHeight) }
      : undefined;
  const userAgent = opts.userAgent?.trim() || undefined;
  const proxy = opts.proxy?.trim() ? { server: opts.proxy.trim() } : undefined;

  try {
    if (opts.profileDir) {
      // Persistent profile: cookies, logins and "I am a human" tokens survive runs.
      context = await chromium.launchPersistentContext(opts.profileDir, {
        headless: opts.headless,
        acceptDownloads: true,
        slowMo,
        proxy,
        userAgent,
        ...(viewport ? { viewport } : {}),
        ...LAUNCH_ARGS,
      });
    } else {
      browser = await chromium.launch({ headless: opts.headless, slowMo, proxy, ...LAUNCH_ARGS });
      context = await browser.newContext({ acceptDownloads: true, userAgent, ...(viewport ? { viewport } : {}) });
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
    downloadsSkipped: 0,
    savedRows: [],
    screenshots: [],
    signal: opts.signal,
  };

  if (opts.handleDialogs ?? true) handleDialogs(context, opts.log);
  if (opts.dismissConsent ?? true) {
    ctx.afterNavigation = async () => {
      await dismissConsent(ctx.page, opts.log).catch(() => false);
    };
  }

  // Always capture downloads (from any tab); follow real new tabs; close ad
  // pop-ups only if asked. onActiveTab switches the engine's active page.
  setupPageManager(context, {
    downloadDir: opts.downloadDir,
    blockPopupWindows: opts.blockPopupWindows ?? false,
    blockPopupTabs: opts.blockPopupTabs ?? false,
    whitelist: opts.popupWhitelist ?? [],
    skipExisting: opts.skipExistingDownloads ?? false,
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
    onDownloadSkipped: () => {
      ctx.downloadsSkipped += 1;
    },
  });

  await enableAdblock(context, {
    enabled: opts.adblock ?? false,
    cacheDir: opts.cacheDir,
    log: opts.log,
  }).catch((e) => opts.log?.('Ad blocker setup failed: ' + (e?.message ?? e), 'warn'));

  if (opts.blockImages) {
    // Images, video and fonts are most of a page's bytes and none of its logic.
    // Registered after the ad blocker so this handler runs first; anything we
    // don't abort falls through to the blocker's own rules.
    const blockHeavy = (page: Page) =>
      void page
        .route('**/*', (route) => {
          const type = route.request().resourceType();
          if (type === 'image' || type === 'media' || type === 'font') void route.abort();
          else void route.fallback();
        })
        .catch(() => {});
    context.pages().forEach(blockHeavy);
    context.on('page', blockHeavy);
    opts.log?.('Images and media are blocked for this run.', 'debug');
  }

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

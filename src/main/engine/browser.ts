// Owns the Playwright browser lifecycle for a single run. Kept free of any
// Electron imports so it can be exercised by the headless smoke test directly.

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';

export interface RunContext {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  downloadDir: string;
}

export interface LaunchOptions {
  headless: boolean;
  downloadDir: string;
  timeoutMs: number;
}

export async function launch(opts: LaunchOptions): Promise<RunContext> {
  const browser = await chromium.launch({ headless: opts.headless });
  const context = await browser.newContext({ acceptDownloads: true });
  context.setDefaultTimeout(opts.timeoutMs);
  const page = await context.newPage();
  return { browser, context, page, downloadDir: opts.downloadDir };
}

export async function close(ctx: RunContext): Promise<void> {
  try {
    await ctx.browser.close();
  } catch {
    /* already closed (e.g. user pressed Stop) — ignore */
  }
}

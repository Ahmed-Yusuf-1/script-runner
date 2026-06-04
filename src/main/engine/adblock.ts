// Network-level ad/tracker blocking for the automation browser, via the
// Ghostery filter-list engine (cached to disk) with a small built-in domain
// list as an offline fallback. Pop-up handling and download capture live in
// pages.ts so they can coordinate. Kept free of Electron imports.

import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { readFile, writeFile, mkdir } from 'fs/promises';
import type { BrowserContext, Page } from 'playwright';

export interface AdblockOptions {
  enabled: boolean;
  cacheDir?: string;
  log?: (msg: string) => void;
}

export async function enableAdblock(context: BrowserContext, opts: AdblockOptions): Promise<void> {
  if (!opts.enabled) return;
  const log = opts.log ?? (() => {});

  try {
    const { PlaywrightBlocker } = await import('@ghostery/adblocker-playwright');
    const cacheDir = opts.cacheDir ?? defaultCacheDir();
    await mkdir(cacheDir, { recursive: true }).catch(() => {});
    log('Ad blocker: loading filter lists…');
    const blocker = await PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: join(cacheDir, 'adblocker-engine.bin'),
      read: async (p) => readFile(p),
      write: async (p, data) => writeFile(p, data),
    });
    const enable = (page: Page) => void blocker.enableBlockingInPage(page).catch(() => {});
    context.pages().forEach(enable);
    context.on('page', enable);
    log('Ad blocker: filter lists active.');
    return;
  } catch {
    log('Ad blocker: filter lists unavailable — using built-in domain list.');
  }

  // Fallback: abort requests to well-known ad / pop-up / tracker hosts.
  await context.route('**/*', (route) => {
    if (isAdHost(route.request().url())) {
      void route.abort();
      return;
    }
    void route.continue();
  });
}

const AD_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com',
  'google-analytics.com', 'adnxs.com', 'amazon-adsystem.com', 'taboola.com', 'outbrain.com',
  'popads.net', 'popcash.net', 'propellerads.com', 'propu.sh', 'adsterra.com', 'exoclick.com',
  'exosrv.com', 'juicyads.com', 'poptm.com', 'onclickads.net', 'mgid.com', 'revcontent.com',
  'criteo.com', 'pubmatic.com', 'rubiconproject.com', 'openx.net', 'scorecardresearch.com',
  'moatads.com', 'zedo.com', 'adcash.com', 'hilltopads.net', 'clickadu.com', 'a-ads.com',
  'bidvertiser.com', 'smartadserver.com', 'yllix.com', 'admaven.com', 'clksite.com',
];

export function isAdHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return AD_HOSTS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

function defaultCacheDir(): string {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || homedir() || tmpdir();
  return join(base, 'script-runner');
}

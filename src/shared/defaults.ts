// The default settings, as plain data. The main process supplies the download
// folder (it's the only part that depends on the operating system), so this
// module stays importable from the UI and from tests.

import type { Settings } from './types';

export function defaultSettings(downloadDir: string): Settings {
  return {
    headless: false,
    downloadDir,
    timeoutMs: 15000,
    adblock: true,
    blockPopupWindows: true,
    blockPopupTabs: true,
    popupWhitelist: [],
    persistentSession: true,
    slowMoMs: 0,
    screenshotOnError: true,
    theme: 'system',

    dismissConsent: true,
    handleDialogs: true,
    blockImages: false,

    skipExistingDownloads: false,
    downloadWaitMs: 15 * 60_000,
    downloadSubfolder: 'none',

    maxRunMs: 0,
    keepAwake: true,
    notifyOnFinish: true,

    viewportWidth: 0,
    viewportHeight: 0,
    userAgent: '',
    proxy: '',
  };
}

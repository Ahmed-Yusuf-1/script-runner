// App settings: per preset when one is active, otherwise settings.json.

import { app } from 'electron';
import type { Settings } from '../../shared/types';
import { normalizeSettings } from '../../shared/normalize';
import { paths } from './paths';
import { readJson, writeJsonAtomic, quarantine, withLock } from './fsutil';
import { getActivePresetId, readPreset, updatePreset } from './presets';

export function defaultSettings(): Settings {
  return {
    headless: false,
    downloadDir: app.getPath('downloads'),
    timeoutMs: 15000,
    adblock: true,
    blockPopupWindows: true,
    blockPopupTabs: true,
    popupWhitelist: [],
    persistentSession: true,
    slowMoMs: 0,
    screenshotOnError: true,
    theme: 'system',
  };
}

export async function getSettings(): Promise<Settings> {
  const presetId = await getActivePresetId();
  if (presetId) {
    const preset = await readPreset(presetId);
    if (preset) return preset.settings; // already normalized
  }
  const file = paths.settingsFile();
  const r = await readJson(file);
  if (r.ok) return normalizeSettings(r.value, defaultSettings());
  if (!r.missing) await quarantine(file); // unreadable: keep a copy, start fresh
  return defaultSettings();
}

export async function saveSettings(raw: Settings): Promise<Settings> {
  const settings = normalizeSettings(raw, defaultSettings());
  const presetId = await getActivePresetId();
  if (presetId) {
    const saved = await updatePreset(presetId, (p) => {
      p.settings = settings;
    });
    if (saved) return settings;
  }
  await withLock('settings', () => writeJsonAtomic(paths.settingsFile(), settings));
  return settings;
}

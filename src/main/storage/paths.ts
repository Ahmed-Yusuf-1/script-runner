// Where each kind of app data lives, all under Electron's per-user data folder.

import { app, BrowserWindow, dialog } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import { join } from 'path';

const root = () => app.getPath('userData');

export const paths = {
  root,
  flowsDir: () => join(root(), 'flows'),
  flowFile: (id: string) => join(root(), 'flows', `${id}.json`),
  presetsDir: () => join(root(), 'presets'),
  presetFile: (id: string) => join(root(), 'presets', `${id}.json`),
  settingsFile: () => join(root(), 'settings.json'),
  activePresetFile: () => join(root(), 'active-preset.json'),
  historyDir: () => join(root(), 'history'),
  historyIndex: () => join(root(), 'history', 'index.json'),
  historyFile: (id: string) => join(root(), 'history', `${id}.json`),
  /** Must match the runner: join(cacheDir, 'browser-profile') with cacheDir = userData. */
  profileDir: () => join(root(), 'browser-profile'),
  windowState: () => join(root(), 'window-state.json'),
};

/** Show a save dialog attached to the focused window when there is one. */
export async function showSave(options: SaveDialogOptions): Promise<string | undefined> {
  const win = BrowserWindow.getFocusedWindow();
  const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  return r.canceled ? undefined : r.filePath;
}

/** Show an open dialog attached to the focused window when there is one. */
export async function showOpen(options: OpenDialogOptions): Promise<string[]> {
  const win = BrowserWindow.getFocusedWindow();
  const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return r.canceled ? [] : r.filePaths;
}

/** A file-name-safe version of a user-facing name, for default export names. */
export function slug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'export'
  );
}

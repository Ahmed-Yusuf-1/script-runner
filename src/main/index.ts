// Electron main entry: creates the window, wires up IPC, manages app lifecycle.

import { app, BrowserWindow, Menu, shell, nativeTheme, screen } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { join } from 'path';
import { registerIpc, shutdown, applyTheme } from './ipc';
import { getSettings } from './storage/settings';
import { paths } from './storage/paths';
import { readJson, writeJsonAtomic } from './storage/fsutil';

if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(process.resourcesPath, 'playwright-browsers');
}

const REPO_URL = 'https://github.com/Ahmed-Yusuf-1/script-runner';
let mainWindow: BrowserWindow | null = null;

// One app instance at a time: a second launch focuses the existing window
// instead of fighting over the same data files and browser profile.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  void app.whenReady().then(start);
}

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

async function loadWindowState(): Promise<WindowState> {
  const fallback: WindowState = { width: 1280, height: 860 };
  const r = await readJson<WindowState>(paths.windowState());
  if (!r.ok || typeof r.value?.width !== 'number' || typeof r.value?.height !== 'number') return fallback;
  const s = r.value;
  // Only restore the position if it's still on a connected display.
  if (typeof s.x === 'number' && typeof s.y === 'number') {
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      s.x! < a.x + a.width - 100 && s.x! + s.width > a.x + 100 && s.y! >= a.y - 10 && s.y! < a.y + a.height - 100
    );
    if (!visible) return { width: s.width, height: s.height, maximized: s.maximized };
  }
  return s;
}

function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const b = maximized ? win.getNormalBounds() : win.getBounds();
    void writeJsonAtomic(paths.windowState(), { ...b, maximized }).catch(() => {});
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('close', save);
}

async function createWindow(): Promise<void> {
  const settings = await getSettings();
  applyTheme(settings);
  const state = await loadWindowState();

  const win = new BrowserWindow({
    ...state,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'Script Runner',
    autoHideMenuBar: true,
    // Match the UI's background so there's no flash before it paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0e12' : '#f6f6f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs Node (require electron) for the bridge
      spellcheck: false,
    },
  });
  mainWindow = win;
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  trackWindowState(win);
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  // The app window never navigates away or opens windows of its own; https
  // links (e.g. "Learn more") open in the system browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });

  // electron-vite serves the renderer from a dev URL in dev, and from a built
  // file in production.
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) await win.loadURL(devUrl);
  else await win.loadFile(join(__dirname, '../renderer/index.html'));
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Open data folder', click: () => void shell.openPath(paths.root()) },
        { label: 'Project page', click: () => void shell.openExternal(REPO_URL) },
        { label: 'Report a problem', click: () => void shell.openExternal(`${REPO_URL}/issues`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function start(): Promise<void> {
  registerIpc();
  buildMenu();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}

// Stop a run cleanly (closing its browser) before quitting.
let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  void shutdown().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

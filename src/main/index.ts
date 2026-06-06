// Electron main entry: creates the window, wires up IPC, manages app lifecycle.

import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { registerIpc } from './ipc';

if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(process.resourcesPath, 'playwright-browsers');
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1150,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs Node (require electron) for the bridge
    },
  });

  // electron-vite serves the renderer from a dev URL in dev, and from a built
  // file in production.
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

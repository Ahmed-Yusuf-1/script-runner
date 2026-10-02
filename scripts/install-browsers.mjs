// Downloads Chromium into ./playwright-browsers so electron-builder can bundle
// it into the installer. The packaged app points PLAYWRIGHT_BROWSERS_PATH at
// that folder (see src/main/index.ts), so users need nothing installed.
//
// It fails loudly: an installer that ships without a browser looks fine until
// someone presses Run.

import { execFileSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'playwright-browsers'); // absolute: a relative value is resolved inconsistently

console.log(`Downloading Chromium into ${dest}`);
execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'install', 'chromium'], {
  stdio: 'inherit',
  cwd: root,
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: dest },
});

if (!existsSync(dest)) {
  console.error(`\nChromium was not downloaded: ${dest} does not exist.`);
  process.exit(1);
}
const entries = readdirSync(dest).filter((name) => name.startsWith('chromium'));
if (entries.length === 0) {
  console.error(`\nNo chromium* folder in ${dest}. The installer would ship without a browser.`);
  process.exit(1);
}

const size = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
    const path = join(dir, entry.name);
    try {
      return total + (entry.isDirectory() ? size(path) : statSync(path).size);
    } catch {
      return total; // a symlink or a file that vanished mid-walk
    }
  }, 0);

const mb = Math.round(size(dest) / 1024 / 1024);
if (mb < 50) {
  console.error(`\n${dest} is only ${mb} MB — that is not a complete Chromium.`);
  process.exit(1);
}
console.log(`Chromium ready: ${entries.join(', ')} (${mb} MB)`);

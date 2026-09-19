// Helpers for the headless smoke tests: default settings, a throwaway local
// web server, and PASS/FAIL reporting. Not bundled into the app.

import { createServer } from 'http';
import type { IncomingMessage, ServerResponse, Server } from 'http';
import type { AddressInfo } from 'net';
import type { Settings } from '../../shared/types';

export function testSettings(downloadDir: string, overrides: Partial<Settings> = {}): Settings {
  return {
    headless: true,
    downloadDir,
    timeoutMs: 15000,
    adblock: false,
    blockPopupWindows: false,
    blockPopupTabs: false,
    popupWhitelist: [],
    persistentSession: false,
    slowMoMs: 0,
    screenshotOnError: false,
    theme: 'system',
    ...overrides,
  };
}

/** Serve HTML pages from a path → html map (or a custom handler) on a random port. */
export async function serve(
  routes: Record<string, string> | ((req: IncomingMessage, res: ServerResponse) => void)
): Promise<{ base: string; server: Server; close: () => Promise<void> }> {
  const handler =
    typeof routes === 'function'
      ? routes
      : (req: IncomingMessage, res: ServerResponse) => {
          const body = routes[(req.url ?? '/').split('?')[0]];
          if (body == null) {
            res.writeHead(404).end('not found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body);
        };
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    server,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}

/** Collects named checks and prints PASS/FAIL for each; sets a failing exit code. */
export class Checks {
  private failed = 0;
  check(name: string, ok: boolean, detail?: unknown): void {
    if (ok) console.log(`PASS: ${name}`);
    else {
      this.failed++;
      console.error(`FAIL: ${name}`, detail ?? '');
    }
  }
  done(): void {
    if (this.failed) {
      console.error(`${this.failed} check(s) failed`);
      process.exitCode = 1;
    }
  }
}

export const quietEmit = {
  log: (m: string, level?: string) => console.log(`   ${level && level !== 'info' ? `[${level}] ` : ''}${m}`),
  status: () => {},
};

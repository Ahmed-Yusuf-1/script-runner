// Tells the renderer's TypeScript about the bridge exposed by preload.
import type { ScriptRunnerApi } from '@shared/api';

declare global {
  interface Window {
    api: ScriptRunnerApi;
  }
}

export {};

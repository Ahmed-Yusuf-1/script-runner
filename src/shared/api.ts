// The contract between the GUI and the main process. Implemented in preload,
// consumed by the renderer as `window.api`.

import type { Flow, Settings, RunResult, StepStatus } from './types';

export interface ScriptRunnerApi {
  listFlows(): Promise<Flow[]>;
  saveFlow(flow: Flow): Promise<void>;
  deleteFlow(id: string): Promise<void>;

  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;

  // ---- Presets ----
  listPresets(): Promise<{ id: string; name: string }[]>;
  getActivePresetId(): Promise<string | null>;
  selectPreset(id: string | null): Promise<void>;
  createPreset(name: string): Promise<string>;
  deletePreset(id: string): Promise<void>;
  importPreset(): Promise<string | null>;
  exportPreset(id: string | null): Promise<boolean>;

  runFlow(flow: Flow, vars: Record<string, string>): Promise<RunResult>;
  stopFlow(): Promise<{ ok: boolean }>;

  /** Subscribe to live log lines. Returns an unsubscribe function. */
  onLog(cb: (msg: string) => void): () => void;
  /** Subscribe to per-step status updates. Returns an unsubscribe function. */
  onStatus(cb: (status: StepStatus) => void): () => void;
}

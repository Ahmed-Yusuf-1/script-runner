// The contract between the GUI and the main process. Implemented in preload,
// consumed by the renderer as `window.api`.

import type {
  Flow,
  Settings,
  RunResult,
  StepStatus,
  LogEntry,
  RunProgress,
  RunOptions,
  RunRecord,
  RunSummary,
} from './types';

export interface PresetInfo {
  id: string;
  name: string;
}

export interface UpdateCheck {
  current: string;
  latest: string | null;
  url: string | null;
  newer: boolean;
}

export interface AppInfo {
  version: string;
  platform: string;
  electron: string;
  chrome: string;
  dataDir: string;
}

/** What the main process knows about the current run (survives a UI reload). */
export interface RunState {
  running: boolean;
  paused: boolean;
  flowId?: string;
  progress?: RunProgress;
}

export interface ScriptRunnerApi {
  // ---- Flows ----
  listFlows(): Promise<Flow[]>;
  /** Saves and returns the flow as stored (normalized, with a new updatedAt). */
  saveFlow(flow: Flow): Promise<Flow>;
  deleteFlow(id: string): Promise<void>;
  exportFlow(flow: Flow): Promise<boolean>;
  /** Pick flow/preset files and import their flows. Returns what was imported. */
  importFlows(): Promise<Flow[]>;

  // ---- Settings ----
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  /** Folder picker. Returns the chosen folder, or null if cancelled. */
  pickFolder(current?: string): Promise<string | null>;
  /** File picker, for the "Choose a file" step. Returns the path, or null. */
  pickFile(current?: string): Promise<string | null>;
  /** Delete the saved browser profile (cookies and logins). */
  clearBrowserProfile(): Promise<void>;

  // ---- Presets ----
  listPresets(): Promise<PresetInfo[]>;
  getActivePresetId(): Promise<string | null>;
  selectPreset(id: string | null): Promise<void>;
  createPreset(name: string): Promise<string>;
  renamePreset(id: string, name: string): Promise<void>;
  deletePreset(id: string): Promise<void>;
  importPreset(): Promise<string | null>;
  exportPreset(id: string | null): Promise<boolean>;

  // ---- Running ----
  runFlow(flow: Flow, vars: Record<string, string>, options?: RunOptions): Promise<RunResult>;
  stopFlow(): Promise<void>;
  pauseFlow(): Promise<void>;
  resumeFlow(): Promise<void>;
  getRunState(): Promise<RunState>;
  /** Subscribe to live log lines (delivered in small batches). Returns an unsubscribe function. */
  onLog(cb: (entries: LogEntry[]) => void): () => void;
  /** Subscribe to per-step status updates. Returns an unsubscribe function. */
  onStatus(cb: (status: StepStatus) => void): () => void;
  /** Subscribe to run progress. Returns an unsubscribe function. */
  onProgress(cb: (progress: RunProgress) => void): () => void;

  // ---- History ----
  listRuns(): Promise<RunSummary[]>;
  getRun(id: string): Promise<RunRecord | null>;
  deleteRun(id: string): Promise<void>;
  clearRuns(): Promise<void>;

  // ---- Files & app ----
  /** Open the download folder in the system file manager. */
  openDownloads(): Promise<void>;
  /** Open a file the app saved (download or screenshot) with its default app. */
  openFile(path: string): Promise<void>;
  /** Reveal a file the app saved in the system file manager. */
  showInFolder(path: string): Promise<void>;
  /** Ask where to save some text (e.g. a run log) and write it. */
  saveTextFile(defaultName: string, text: string): Promise<boolean>;
  appInfo(): Promise<AppInfo>;
  /** Ask GitHub whether a newer release exists. Never throws. */
  checkUpdate(): Promise<UpdateCheck>;
  /** Open a link in the system browser (https only). */
  openExternal(url: string): Promise<void>;
}

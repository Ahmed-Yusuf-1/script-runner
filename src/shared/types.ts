// The single source of truth for the data model. Imported by both the engine
// (main process) and the GUI (renderer), so the two can't drift apart.
//
// Compatibility rule: every field added after v0.1 is optional or gets a default
// in normalize.ts, so flows, presets and settings saved by older versions load.

/** Bumped when the saved shape changes in a way normalize.ts has to migrate. */
export const SCHEMA_VERSION = 2;

export type Action =
  | 'goto' // navigate to a URL
  | 'back' // go back to the previous page
  | 'reload' // reload the current page
  | 'search' // open Google and search
  | 'fillField' // type into a text field / search box on the current page
  | 'click' // click an element
  | 'hover' // move the mouse over an element (opens hover menus)
  | 'selectOption' // pick an option in a <select> dropdown
  | 'pressKey' // press a keyboard key (Enter, Escape, …)
  | 'scroll' // scroll the page
  | 'waitFor' // wait until an element / text appears (or disappears)
  | 'assertText' // check the page shows (or doesn't show) some text
  | 'extractText' // read an element's text into a {{variable}}
  | 'closeAd' // best-effort: dismiss a popup/ad
  | 'closeTab' // close the current tab and return to the previous one
  | 'closeOtherTabs' // close every tab except the current one (clears pop-unders)
  | 'wait' // pause for N milliseconds
  | 'screenshot' // capture the page
  | 'download' // click something and save the file it downloads
  | 'downloadWait'; // same as download, with its own time limit for the file to start

/** How to locate an element on the page. */
export interface Target {
  by: 'text' | 'placeholder' | 'searchbox' | 'selector';
  /** What the user typed: visible text, or a placeholder/label. */
  text?: string;
  /** For text matching: whole-text vs. partial. Defaults to exact. */
  match?: 'exact' | 'contains';
  /** A CSS selector, used when `by` is 'selector'. */
  selector?: string;
  /**
   * When several elements match (e.g. many "Download Mp3" buttons), pick the
   * Nth one (1-based). Supports {{variables}} so a Repeat counter can advance it
   * (1st button, then 2nd, …). Blank/invalid = the first match.
   */
  index?: string;
  /**
   * Auto-advance the item number each time this step runs: 1st match, then 2nd,
   * then 3rd … Each step keeps its own counter (reset per run). When on, `index`
   * is the starting number (default 1).
   */
  autoIncrement?: boolean;
}

export interface StepOptions {
  /** fillField: press Enter after typing (most search boxes need this). */
  pressEnter?: boolean;
  /** What to do if this step fails (after any retries). Defaults to 'stop'. */
  onError?: 'stop' | 'continue';
  /** Override the default per-step timeout (ms). */
  timeoutMs?: number;
  /** downloadWait: how long (ms) to wait for the download to start. */
  waitMs?: number;
  /** Optional pause AFTER this step finishes (ms). Blank/0 = no pause. */
  waitAfterMs?: number;
  /** Extra attempts after a failure before the step counts as failed. */
  retries?: number;
  /** waitFor: wait for the element to appear (default) or to go away. */
  waitState?: 'visible' | 'hidden';
  /** assertText: the text must be on the page (default) or must not be. */
  expect?: 'present' | 'absent';
}

/** One step in a flow. */
export interface Step {
  id: string;
  action: Action;
  /** URL / query / text-to-type / milliseconds / file name, depending on action. */
  value?: string;
  /** For actions that act on an element. */
  target?: Target;
  /** extractText: the variable name the text is saved into (no braces). */
  saveAs?: string;
  /** A disabled step is kept in the flow but skipped when it runs. */
  disabled?: boolean;
  /** Free-form note shown on the step card. */
  note?: string;
  options?: StepOptions;
}

/**
 * Optional repeat loop. Repeats a CHOSEN RANGE of steps a set number of times.
 * Steps before the range run once first; steps after it run once at the end.
 * Each pass exposes an auto-incrementing counter (e.g. {{n}}) so the repeated
 * steps can fetch file 1, then 2, then 3, …
 */
export interface RepeatConfig {
  enabled: boolean;
  /** 1-based: first step of the repeated section. */
  fromStep: number;
  /** 1-based, inclusive: last step of the repeated section. */
  toStep: number;
  /** How many times to run that section. */
  times: number;
  /** Variable name made available each pass, e.g. "n". */
  counterName: string;
  /** Counter value on the first pass. */
  counterStart: number;
  /** How much the counter changes each pass. */
  counterStep: number;
  /** Optional pause between passes, in milliseconds. */
  delayMs: number;
  /**
   * Wait for any download to finish saving before starting the next pass, so it
   * never starts the next download while one is still in progress.
   */
  waitForDownloads: boolean;
}

/** A saved automation. */
export interface Flow {
  id: string;
  name: string;
  /**
   * Configurable input fields. Steps reference them with {{name}} placeholders,
   * and the Inputs panel lets the user fill them before running, so one flow is
   * reusable with different inputs (e.g. a different search query each time).
   */
  variables?: Record<string, string>;
  /** Optional repeat loop with an auto-incrementing counter. */
  repeat?: RepeatConfig;
  steps: Step[];
  createdAt: number;
  updatedAt: number;
  /** Shape version this flow was saved with. */
  schemaVersion?: number;
}

/** A self-contained preset profile. */
export interface Preset {
  id: string;
  name: string;
  settings: Settings;
  flows: Flow[];
}

export type Theme = 'system' | 'dark' | 'light';

/** App-wide settings (per preset when a preset is active). */
export interface Settings {
  headless: boolean;
  downloadDir: string;
  timeoutMs: number;
  /** Block ads/trackers in the automation browser via filter lists. */
  adblock: boolean;
  /** Auto-close pop-up windows. */
  blockPopupWindows: boolean;
  /** Auto-close pop-up tabs (new tabs). */
  blockPopupTabs: boolean;
  /**
   * Sites whose pop-ups/new tabs are always allowed through (never closed by the
   * pop-up blocker). Matched against the new tab's host or the site that opened
   * it. e.g. ["datanodes.to", "filecrypt.cc"].
   */
  popupWhitelist: string[];
  /**
   * Keep a persistent browser profile (cookies, logins, "I am a human" tokens)
   * across runs, so checks solved once are remembered.
   */
  persistentSession: boolean;
  /** Pause (ms) Playwright adds before every browser action, for watching runs. */
  slowMoMs: number;
  /** Save a screenshot of the page when a step fails. */
  screenshotOnError: boolean;
  /** UI theme. */
  theme: Theme;
}

// ---- Running ----

/** Live status of a step during a run, streamed to the UI. */
export type StepState = 'running' | 'ok' | 'warn' | 'error' | 'skipped';
export interface StepStatus {
  id: string;
  state: StepState;
  message?: string;
  /** 1-based attempt number while retrying. */
  attempt?: number;
  /** Total attempts allowed (1 + retries). */
  attempts?: number;
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'debug';
export interface LogEntry {
  ts: number;
  level: LogLevel;
  msg: string;
}

/** What to run. Omit both for the whole flow. Indexes are 0-based. */
export interface RunOptions {
  /** Start at this step (the steps before it are skipped). */
  startAt?: number;
  /** Run only this one step. */
  only?: number;
}

/** Streamed while a run is in progress. */
export interface RunProgress {
  runId: string;
  startedAt: number;
  /** 0-based index of the step currently running (-1 before the first). */
  stepIndex: number;
  stepCount: number;
  /** 1-based repeat pass, when inside the repeated range. */
  pass?: number;
  passes?: number;
  downloadsStarted: number;
  downloadsSaved: number;
  paused: boolean;
}

export type RunStatus = 'ok' | 'warn' | 'error' | 'stopped';

/** Per-step outcome in a finished run (repeated steps are aggregated). */
export interface StepResult {
  id: string;
  index: number;
  action: Action;
  state: StepState;
  /** How many times the step ran (a repeated step runs once per pass). */
  runs: number;
  failures: number;
  totalMs: number;
  message?: string;
}

export interface SavedFile {
  filename: string;
  path: string;
  bytes?: number;
}

/** A finished run, kept in Run history. */
export interface RunRecord {
  id: string;
  flowId: string;
  flowName: string;
  presetName?: string;
  startedAt: number;
  endedAt: number;
  status: RunStatus;
  error?: string;
  vars: Record<string, string>;
  steps: StepResult[];
  downloads: SavedFile[];
  screenshots: SavedFile[];
  log: LogEntry[];
  /** True when older log lines were dropped to keep the record small. */
  logTruncated?: boolean;
}

/** A RunRecord without the heavy fields, for listing. */
export type RunSummary = Omit<RunRecord, 'log' | 'steps' | 'vars'> & {
  stepCount: number;
  failures: number;
};

/** Result of a run. */
export interface RunResult {
  ok: boolean;
  error?: string;
  status?: RunStatus;
  record?: RunRecord;
}

export { ACTION_LABELS } from './actions';

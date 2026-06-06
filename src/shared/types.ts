// The single source of truth for the data model. Imported by both the engine
// (main process) and the GUI (renderer). Beginner mode and, later, recorder mode
// both produce a Flow that looks exactly like this.

export type Action =
  | 'goto' // navigate to a URL
  | 'back' // go back to the previous page
  | 'search' // open Google and search
  | 'fillField' // type into a text field / search box on the CURRENT page (NEW)
  | 'click' // click an element
  | 'closeAd' // best-effort: dismiss a popup/ad
  | 'closeTab' // close the current tab and return to the previous one
  | 'closeOtherTabs' // close every tab except the current one (clears pop-unders)
  | 'pressKey' // press a keyboard key (Enter, Escape, …)
  | 'wait' // pause for N milliseconds
  | 'screenshot' // capture the page
  | 'download' // click something and save the file it downloads
  | 'downloadWait'; // same as download, then wait N ms — handy in a repeat loop

/** How to locate an element on the page. */
export interface Target {
  by: 'text' | 'placeholder' | 'searchbox' | 'selector';
  /** What the user typed: visible text, or a placeholder/label. */
  text?: string;
  /** For text matching: whole-text vs. partial. Defaults to exact. */
  match?: 'exact' | 'contains';
  /** A CSS selector captured by the picker/recorder (later phases). */
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

/** One step in a flow. */
export interface Step {
  id: string;
  action: Action;
  /** URL / query / text-to-type / milliseconds / file name, depending on action. */
  value?: string;
  /** For click, fillField, download. */
  target?: Target;
  options?: {
    /** fillField: press Enter after typing (most search boxes need this). */
    pressEnter?: boolean;
    /** What to do if this step fails. Defaults to 'stop'. */
    onError?: 'stop' | 'continue';
    /** Override the default per-step timeout. */
    timeoutMs?: number;
    /** downloadWait: milliseconds to wait after the download finishes. */
    waitMs?: number;
    /** Optional pause AFTER this step finishes (ms). Blank/0 = no pause. */
    waitAfterMs?: number;
  };
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
   * and the Run panel lets the user fill them before running — so one flow is
   * reusable with different inputs (e.g. a different search query each time).
   */
  variables?: Record<string, string>;
  /** Optional repeat loop with an auto-incrementing counter. */
  repeat?: RepeatConfig;
  steps: Step[];
  createdAt: number;
  updatedAt: number;
}

/** A self-contained preset profile. */
export interface Preset {
  id: string;
  name: string;
  settings: Settings;
  flows: Flow[];
}

/** App-wide settings. */
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
}

/** Live status of a step during a run, streamed to the UI. */
export type StepState = 'running' | 'ok' | 'warn' | 'error' | 'skipped';
export interface StepStatus {
  id: string;
  state: StepState;
  message?: string;
}

/** Result of a run. */
export interface RunResult {
  ok: boolean;
  error?: string;
}

/** Human-readable labels for each action, used by the GUI dropdown. */
export const ACTION_LABELS: Record<Action, string> = {
  goto: 'Go to (link)',
  back: 'Go back (previous page)',
  search: 'Search Google for…',
  fillField: 'Type into a field on this page',
  click: 'Click element that says…',
  closeAd: 'Close ad (best effort)',
  closeTab: 'Close current tab',
  closeOtherTabs: 'Close other tabs (clear pop-ups)',
  pressKey: 'Press a key',
  wait: 'Wait (ms)',
  screenshot: 'Screenshot',
  download: 'Download (click & save file)',
  downloadWait: 'Download & wait',
};

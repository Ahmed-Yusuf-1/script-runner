// The single source of truth for the data model. Imported by both the engine
// (main process) and the GUI (renderer). Beginner mode and, later, recorder mode
// both produce a Flow that looks exactly like this.

export type Action =
  | 'goto' // navigate to a URL
  | 'search' // open Google and search
  | 'fillField' // type into a text field / search box on the CURRENT page (NEW)
  | 'click' // click an element
  | 'closeAd' // best-effort: dismiss a popup/ad
  | 'pressKey' // press a keyboard key (Enter, Escape, …)
  | 'wait' // pause for N milliseconds
  | 'screenshot' // capture the page
  | 'download'; // click something and save the file it downloads

/** How to locate an element on the page. */
export interface Target {
  by: 'text' | 'placeholder' | 'searchbox' | 'selector';
  /** What the user typed: visible text, or a placeholder/label. */
  text?: string;
  /** For text matching: whole-text vs. partial. Defaults to exact. */
  match?: 'exact' | 'contains';
  /** A CSS selector captured by the picker/recorder (later phases). */
  selector?: string;
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
  };
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
  steps: Step[];
  createdAt: number;
  updatedAt: number;
}

/** App-wide settings. */
export interface Settings {
  headless: boolean;
  downloadDir: string;
  timeoutMs: number;
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
  search: 'Search Google for…',
  fillField: 'Type into a field on this page',
  click: 'Click element that says…',
  closeAd: 'Close ad (best effort)',
  pressKey: 'Press a key',
  wait: 'Wait (ms)',
  screenshot: 'Screenshot',
  download: 'Download (click & save file)',
};

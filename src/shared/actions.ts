// Metadata for every action: how it's labelled and grouped in the picker, which
// icon it uses, and which inputs it needs. The UI builds step cards from this,
// and validate.ts uses it to check a flow before it runs.

import type { Action, Step, Target } from './types';

export type ActionGroup = 'Navigate' | 'Interact' | 'Wait & check' | 'Tabs & pop-ups' | 'Files';

export const ACTION_GROUPS: ActionGroup[] = [
  'Navigate',
  'Interact',
  'Wait & check',
  'Tabs & pop-ups',
  'Files',
];

/** Which element picker the step shows. */
export type TargetKind =
  | 'element' // visible text or CSS selector (click, hover, …)
  | 'field' // main search box, placeholder/label, or selector
  | 'select' // a dropdown by its label, or a selector
  | 'file'; // a "choose file" input

export interface ActionMeta {
  label: string;
  group: ActionGroup;
  /** Icon name from the renderer's icon set. */
  icon: string;
  /** One line shown in the picker and on steps that have no inputs. */
  description: string;
  target?: TargetKind;
  /** The main value input, when the action has one. */
  value?: {
    placeholder: string;
    kind: 'url' | 'text' | 'ms' | 'key' | 'filename' | 'choice';
    required?: boolean;
    choices?: { value: string; label: string }[];
  };
  /** Actions that can use "item #" and auto-increment when several elements match. */
  pickNth?: boolean;
}

export const ACTION_META: Record<Action, ActionMeta> = {
  goto: {
    label: 'Go to link',
    group: 'Navigate',
    icon: 'globe',
    description: 'Open a web address in the current tab.',
    value: { placeholder: 'example.com or https://…', kind: 'url', required: true },
  },
  back: {
    label: 'Go back',
    group: 'Navigate',
    icon: 'arrowLeft',
    description: 'Go back to the previous page.',
  },
  reload: {
    label: 'Reload page',
    group: 'Navigate',
    icon: 'refresh',
    description: 'Reload the current page.',
  },
  search: {
    label: 'Search Google',
    group: 'Navigate',
    icon: 'search',
    description: 'Open Google and search for something.',
    value: { placeholder: 'what to search for', kind: 'text', required: true },
  },
  fillField: {
    label: 'Type into a field',
    group: 'Interact',
    icon: 'type',
    description: 'Type text into a field on the current page.',
    target: 'field',
    value: { placeholder: 'text to type', kind: 'text' },
  },
  click: {
    label: 'Click',
    group: 'Interact',
    icon: 'pointer',
    description: 'Click a button, link or any element.',
    target: 'element',
    pickNth: true,
  },
  hover: {
    label: 'Hover',
    group: 'Interact',
    icon: 'hover',
    description: 'Move the mouse over an element, for menus that open on hover.',
    target: 'element',
    pickNth: true,
  },
  selectOption: {
    label: 'Choose from dropdown',
    group: 'Interact',
    icon: 'list',
    description: 'Pick an option in a dropdown list.',
    target: 'select',
    value: { placeholder: 'option to choose', kind: 'text', required: true },
  },
  pressKey: {
    label: 'Press a key',
    group: 'Interact',
    icon: 'keyboard',
    description: 'Press a keyboard key or shortcut.',
    value: { placeholder: 'Enter, Escape, Tab, Control+A…', kind: 'key' },
  },
  scroll: {
    label: 'Scroll',
    group: 'Interact',
    icon: 'scroll',
    description: 'Scroll the page, for example to load more results.',
    value: {
      placeholder: 'direction',
      kind: 'choice',
      choices: [
        { value: 'down', label: 'down one screen' },
        { value: 'up', label: 'up one screen' },
        { value: 'bottom', label: 'to the bottom' },
        { value: 'bottomAll', label: 'to the bottom, loading more' },
        { value: 'top', label: 'to the top' },
      ],
    },
  },
  waitFor: {
    label: 'Wait for element',
    group: 'Wait & check',
    icon: 'clock',
    description: 'Wait until something appears on the page (or goes away).',
    target: 'element',
  },
  assertText: {
    label: 'Check page text',
    group: 'Wait & check',
    icon: 'checkCircle',
    description: 'Fail the step unless the page shows (or doesn’t show) some text.',
    value: { placeholder: 'text that should be on the page', kind: 'text', required: true },
  },
  extractText: {
    label: 'Save text as variable',
    group: 'Wait & check',
    icon: 'braces',
    description: 'Read an element’s text, link or attribute into a {{variable}}.',
    target: 'element',
    pickNth: true,
  },
  appendRow: {
    label: 'Save a row to a file',
    group: 'Files',
    icon: 'table',
    description: 'Append values to a CSV file — one row each time this step runs.',
    value: { placeholder: '{{title}}, {{price}}  (one cell per comma)', kind: 'text', required: true },
  },
  uploadFile: {
    label: 'Choose a file',
    group: 'Files',
    icon: 'paperclip',
    description: 'Attach a file from your computer to an upload field.',
    target: 'file',
  },
  waitForMe: {
    label: 'Pause for me',
    group: 'Wait & check',
    icon: 'hand',
    description: 'Stop and wait while you do something in the browser yourself, then press Resume.',
    value: { placeholder: 'what to do, e.g. sign in and tick the box', kind: 'text' },
  },
  wait: {
    label: 'Wait',
    group: 'Wait & check',
    icon: 'hourglass',
    description: 'Pause for a fixed time.',
    value: { placeholder: '1000', kind: 'ms' },
  },
  closeAd: {
    label: 'Close ad',
    group: 'Tabs & pop-ups',
    icon: 'shield',
    description: 'Look for a skip / close button on an ad overlay and press it.',
  },
  closeTab: {
    label: 'Close this tab',
    group: 'Tabs & pop-ups',
    icon: 'tabClose',
    description: 'Close the current tab and return to the previous one.',
  },
  closeOtherTabs: {
    label: 'Close other tabs',
    group: 'Tabs & pop-ups',
    icon: 'tabs',
    description: 'Keep this tab and close every other one (clears pop-unders).',
  },
  screenshot: {
    label: 'Screenshot',
    group: 'Files',
    icon: 'camera',
    description: 'Save a picture of the page to the download folder.',
    value: { placeholder: 'screenshot.png', kind: 'filename' },
  },
  download: {
    label: 'Download',
    group: 'Files',
    icon: 'download',
    description: 'Click a link or button and save the file it downloads.',
    target: 'element',
    pickNth: true,
  },
  downloadWait: {
    label: 'Download & wait',
    group: 'Files',
    icon: 'downloadClock',
    description: 'Like Download, with your own time limit for the file to start.',
    target: 'element',
    pickNth: true,
  },
};

export const ACTIONS = Object.keys(ACTION_META) as Action[];

/** Human-readable labels for each action (kept for older imports). */
export const ACTION_LABELS: Record<Action, string> = Object.fromEntries(
  ACTIONS.map((a) => [a, ACTION_META[a].label])
) as Record<Action, string>;

/** The default target a step gets when its action is switched to `action`. */
export function defaultTarget(action: Action, prev?: Target): Target | undefined {
  const kind = ACTION_META[action].target;
  if (!kind) return undefined;
  const keep = { text: prev?.text ?? '', selector: prev?.selector, match: prev?.match ?? 'exact' } as const;
  if (kind === 'field') {
    const by = prev?.by === 'placeholder' || prev?.by === 'selector' ? prev.by : 'searchbox';
    return { by, ...keep };
  }
  if (kind === 'select' || kind === 'file') {
    const by = prev?.by === 'selector' ? 'selector' : 'placeholder';
    return { by, ...keep };
  }
  const by = prev?.by === 'selector' ? 'selector' : 'text';
  return {
    by,
    ...keep,
    index: ACTION_META[action].pickNth ? prev?.index : undefined,
    autoIncrement: ACTION_META[action].pickNth ? prev?.autoIncrement : undefined,
  };
}

/** Switch a step to another action, keeping whatever inputs still apply. */
export function changeAction(step: Step, action: Action): Step {
  const meta = ACTION_META[action];
  const prevMeta = ACTION_META[step.action];
  const next: Step = { ...step, action, target: defaultTarget(action, step.target) };
  // Keep the value only when both actions use the same kind of value.
  if (!meta.value || meta.value.kind !== prevMeta.value?.kind) next.value = defaultValue(action);
  if (action !== 'extractText') delete next.saveAs;
  else next.saveAs = step.saveAs ?? 'text';
  if (action !== 'appendRow' && action !== 'uploadFile') delete next.fileName;
  else if (action === 'appendRow') next.fileName = step.fileName ?? 'results.csv';
  const options = { ...(step.options ?? {}) };
  if (action === 'fillField') options.pressEnter = options.pressEnter ?? true;
  if (action === 'downloadWait') options.waitMs = options.waitMs ?? 30000;
  if (action === 'click') options.clickType = options.clickType ?? 'single';
  next.options = options;
  return next;
}

function defaultValue(action: Action): string {
  switch (action) {
    case 'wait':
      return '1000';
    case 'scroll':
      return 'down';
    case 'pressKey':
      return 'Enter';
    default:
      return '';
  }
}

/** A short, human description of what the step targets, for logs and history. */
export function describeTarget(t?: Target): string {
  if (!t) return '';
  switch (t.by) {
    case 'searchbox':
      return 'the main search box';
    case 'selector':
      return `\`${t.selector ?? ''}\``;
    case 'placeholder':
      return `the field “${t.text ?? ''}”`;
    default:
      return `“${t.text ?? ''}”`;
  }
}

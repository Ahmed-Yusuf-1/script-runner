// Variable substitution. Step values can contain {{name}} placeholders that are
// replaced at run time. Values come from (in order of precedence):
//   1. variables saved by an earlier "Save text as variable" step,
//   2. the Repeat counter (e.g. {{n}}),
//   3. the flow's Inputs,
//   4. built-ins: {{date}}, {{time}}, {{datetime}}, {{timestamp}}.
// Shared so the engine and the UI use identical logic.

import type { Step } from './types';

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/** A valid variable name: letters, digits and underscores. */
export const VARIABLE_NAME = /^\w+$/;

export const BUILTIN_VARIABLES: { name: string; description: string }[] = [
  { name: 'date', description: 'Today, as 2026-09-19' },
  { name: 'time', description: 'The time the run started, as 14-02-11' },
  { name: 'datetime', description: 'Date and time, as 2026-09-19_14-02-11' },
  { name: 'timestamp', description: 'Seconds since 1970, as 1789821731' },
];
const BUILTIN_NAMES = new Set(BUILTIN_VARIABLES.map((b) => b.name));

export function isBuiltin(name: string): boolean {
  return BUILTIN_NAMES.has(name);
}

/** Built-in values for a run that starts at `now`. File-name safe. */
export function builtinValues(now: Date = new Date()): Record<string, string> {
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const time = `${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`;
  return {
    date,
    time,
    datetime: `${date}_${time}`,
    timestamp: String(Math.floor(now.getTime() / 1000)),
  };
}

export function substitute(
  text: string | undefined,
  vars: Record<string, string>
): string | undefined {
  if (text == null) return text;
  return text.replace(PLACEHOLDER, (_m, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : ''
  );
}

/** Returns a copy of the step with {{vars}} resolved in every text input. */
export function applyVariables(step: Step, vars: Record<string, string>): Step {
  return {
    ...step,
    value: substitute(step.value, vars),
    target: step.target
      ? {
          ...step.target,
          text: substitute(step.target.text, vars),
          selector: substitute(step.target.selector, vars),
          index: substitute(step.target.index, vars),
        }
      : undefined,
  };
}

function scanInto(names: Set<string>, t?: string): void {
  if (!t) return;
  for (const m of t.matchAll(PLACEHOLDER)) names.add(m[1]);
}

/** Finds all {{names}} referenced anywhere in a flow's steps. */
export function collectVariableNames(steps: Step[]): string[] {
  const names = new Set<string>();
  for (const s of steps) {
    scanInto(names, s.value);
    scanInto(names, s.target?.text);
    scanInto(names, s.target?.selector);
    scanInto(names, s.target?.index);
  }
  return [...names];
}

/** Variables that "Save text as variable" steps produce while the flow runs. */
export function producedVariables(steps: Step[]): string[] {
  const out = new Set<string>();
  for (const s of steps) {
    if (s.action === 'extractText' && s.saveAs && VARIABLE_NAME.test(s.saveAs)) out.add(s.saveAs);
  }
  return [...out];
}

/**
 * The {{names}} a user should fill in as Inputs: referenced by a step, and not
 * a built-in, the repeat counter, or produced by an earlier step.
 */
export function inputVariableNames(steps: Step[], counterName?: string): string[] {
  const produced = new Set(producedVariables(steps));
  return collectVariableNames(steps).filter(
    (n) => !isBuiltin(n) && n !== counterName && !produced.has(n)
  );
}

/** Input names that are used by an enabled step but have no value yet. */
export function findMissing(
  steps: Step[],
  vars: Record<string, string>,
  counterName?: string
): string[] {
  const used = inputVariableNames(
    steps.filter((s) => !s.disabled),
    counterName
  );
  return used.filter((n) => (vars[n] ?? '').trim() === '');
}

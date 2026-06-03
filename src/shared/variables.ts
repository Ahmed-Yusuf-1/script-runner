// Variable substitution. Lets step values contain {{name}} placeholders that get
// replaced with the flow's variable values at run time. Shared so the engine and
// (potentially) the UI preview use identical logic.

import type { Step } from './types';

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

export function substitute(
  text: string | undefined,
  vars: Record<string, string>
): string | undefined {
  if (text == null) return text;
  return text.replace(PLACEHOLDER, (_m, key: string) =>
    key in vars ? vars[key] : ''
  );
}

/** Returns a copy of the step with {{vars}} resolved in value and target text. */
export function applyVariables(step: Step, vars: Record<string, string>): Step {
  return {
    ...step,
    value: substitute(step.value, vars),
    target: step.target
      ? { ...step.target, text: substitute(step.target.text, vars) }
      : undefined,
  };
}

/** Finds all {{names}} referenced anywhere in a flow's steps. */
export function collectVariableNames(steps: Step[]): string[] {
  const names = new Set<string>();
  const scan = (t?: string) => {
    if (!t) return;
    for (const m of t.matchAll(PLACEHOLDER)) names.add(m[1]);
  };
  for (const s of steps) {
    scan(s.value);
    scan(s.target?.text);
  }
  return [...names];
}

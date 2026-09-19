// Checks a flow before it runs, so mistakes (an empty link, a click with no
// target, a missing input) show up on the step card instead of failing halfway
// through a run. Errors block the run; warnings are shown but don't.

import type { Flow, Step } from './types';
import { ACTION_META } from './actions';
import { VARIABLE_NAME, findMissing } from './variables';
import { normalizeRepeat } from './repeat';

export interface Issue {
  level: 'error' | 'warning';
  message: string;
  /** The step the issue is about, when it's about one. */
  stepId?: string;
}

export function validateStep(step: Step): Issue[] {
  const issues: Issue[] = [];
  const meta = ACTION_META[step.action];
  const err = (message: string) => issues.push({ level: 'error', message, stepId: step.id });
  const warn = (message: string) => issues.push({ level: 'warning', message, stepId: step.id });

  if (!meta) {
    err(`Unknown action “${step.action}”.`);
    return issues;
  }

  if (meta.value?.required && !(step.value ?? '').trim()) {
    err(step.action === 'goto' ? 'Enter a link to go to.' : `Fill in: ${meta.value.placeholder}.`);
  }

  if (meta.target) {
    const t = step.target;
    if (!t) err('Choose which element this step uses.');
    else if (t.by === 'selector' && !(t.selector ?? '').trim()) err('Enter a CSS selector.');
    else if ((t.by === 'text' || t.by === 'placeholder') && !(t.text ?? '').trim()) {
      err(t.by === 'text' ? 'Enter the text of the element.' : 'Enter the field’s placeholder or label.');
    }
    const idx = (t?.index ?? '').trim();
    if (idx && !idx.includes('{{') && !/^\d+$/.test(idx)) warn('“Item #” should be a whole number.');
  }

  if (step.action === 'wait') {
    const ms = Number(step.value);
    if ((step.value ?? '').trim() && (!Number.isFinite(ms) || ms < 0)) err('Wait time must be a number of milliseconds.');
  }

  if (step.action === 'extractText' && !VARIABLE_NAME.test(step.saveAs ?? '')) {
    err('Give the variable a name made of letters, digits or _.');
  }

  if (step.action === 'screenshot' && /[\\/]/.test(step.value ?? '')) {
    warn('Folders in the file name are ignored; the screenshot is saved in the download folder.');
  }

  const o = step.options ?? {};
  if (o.timeoutMs != null && (!(o.timeoutMs > 0) || o.timeoutMs > 3_600_000)) {
    warn('Time limit should be between 1 ms and 1 hour.');
  }
  if (o.retries != null && (o.retries < 0 || o.retries > 10)) warn('Retries should be 0–10.');
  return issues;
}

export function validateFlow(flow: Flow): Issue[] {
  const issues: Issue[] = [];
  const enabled = flow.steps.filter((s) => !s.disabled);
  if (flow.steps.length === 0) {
    issues.push({ level: 'error', message: 'Add at least one step.' });
    return issues;
  }
  if (enabled.length === 0) {
    issues.push({ level: 'error', message: 'Every step is disabled.' });
  }
  for (const s of enabled) issues.push(...validateStep(s));

  const repeat = flow.repeat?.enabled ? normalizeRepeat(flow.repeat, flow.steps.length) : null;
  if (repeat && repeat.times === 0) {
    issues.push({ level: 'warning', message: 'Repeat is on but set to 0 times, so the repeated steps are skipped.' });
  }

  for (const name of findMissing(flow.steps, flow.variables ?? {}, repeat?.counterName)) {
    issues.push({ level: 'warning', message: `The input {{${name}}} is empty.` });
  }
  return issues;
}

/** Group issues by step id for the step cards. */
export function issuesByStep(issues: Issue[]): Record<string, Issue[]> {
  const out: Record<string, Issue[]> = {};
  for (const i of issues) {
    if (!i.stepId) continue;
    (out[i.stepId] ??= []).push(i);
  }
  return out;
}

import type { Action, Flow, Step } from '@shared/types';
import { SCHEMA_VERSION } from '@shared/types';
import { changeAction } from '@shared/actions';

export const uid = () => crypto.randomUUID();

export function newFlow(name = 'Untitled flow'): Flow {
  const now = Date.now();
  return { id: uid(), name, variables: {}, steps: [], createdAt: now, updatedAt: now, schemaVersion: SCHEMA_VERSION };
}

export function newStep(action: Action = 'goto'): Step {
  return changeAction({ id: uid(), action: 'goto', value: '' }, action);
}

/** A copy of a step with a new id (and its own auto-increment counter). */
export function copyStep(step: Step): Step {
  return { ...structuredClone(step), id: uid() };
}

/** A copy of a flow with new ids, for "Duplicate". */
export function copyFlow(flow: Flow, name = `${flow.name} (copy)`): Flow {
  const now = Date.now();
  return { ...structuredClone(flow), id: uid(), name, steps: flow.steps.map(copyStep), createdAt: now, updatedAt: now };
}

/** A stable string of what the user edits, for "unsaved changes" checks. */
export function snapshot(flow: Flow): string {
  const { updatedAt: _u, createdAt: _c, schemaVersion: _v, ...rest } = flow;
  return JSON.stringify(rest);
}

export function demoFlow(): Flow {
  const f = newFlow('Example: search Wikipedia');
  f.variables = { query: 'Playwright' };
  f.steps = [
    { id: uid(), action: 'goto', value: 'en.wikipedia.org' },
    { id: uid(), action: 'fillField', value: '{{query}}', target: { by: 'searchbox' }, options: { pressEnter: true } },
    { id: uid(), action: 'waitFor', target: { by: 'selector', selector: '#firstHeading' } },
    { id: uid(), action: 'extractText', saveAs: 'title', target: { by: 'selector', selector: '#firstHeading' } },
    { id: uid(), action: 'screenshot', value: '{{title}} {{date}}.png' },
  ];
  return f;
}

// ---- Keeping the repeat range on the same steps when steps move ----

/** Insert `step` at 0-based `index`, keeping the repeat range around the same steps. */
export function insertStep(flow: Flow, index: number, step: Step): Flow {
  const steps = [...flow.steps];
  steps.splice(index, 0, step);
  const r = flow.repeat;
  if (!r) return { ...flow, steps };
  const pos = index + 1; // 1-based position of the new step
  let { fromStep, toStep } = r;
  if (pos <= fromStep && flow.steps.length > 0) {
    fromStep += 1;
    toStep += 1;
  } else if (pos <= toStep + 1 && pos > fromStep) {
    toStep += 1; // inserted inside (or at the end of) the range: it joins the range
  }
  return { ...flow, steps, repeat: { ...r, fromStep, toStep } };
}

/** Remove the step at 0-based `index`, keeping the repeat range around the same steps. */
export function removeStepAt(flow: Flow, index: number): Flow {
  const steps = flow.steps.filter((_, i) => i !== index);
  const r = flow.repeat;
  if (!r) return { ...flow, steps };
  const pos = index + 1;
  let { fromStep, toStep } = r;
  if (pos < fromStep) {
    fromStep -= 1;
    toStep -= 1;
  } else if (pos <= toStep) {
    toStep = Math.max(fromStep, toStep - 1);
  }
  return { ...flow, steps, repeat: { ...r, fromStep: Math.max(1, fromStep), toStep: Math.max(1, toStep) } };
}

/** Move a step to a new 0-based index. The repeat range stays on the same positions. */
export function moveStep(flow: Flow, from: number, to: number): Flow {
  if (from === to || from < 0 || to < 0 || from >= flow.steps.length || to >= flow.steps.length) return flow;
  const steps = [...flow.steps];
  const [s] = steps.splice(from, 1);
  steps.splice(to, 0, s);
  return { ...flow, steps };
}

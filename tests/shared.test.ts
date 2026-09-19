// Unit tests for the shared model: variables, repeat, validation, normalization
// and action switching. Pure logic — no browser. Run with:  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Flow, Step } from '../src/shared/types';
import {
  substitute,
  applyVariables,
  collectVariableNames,
  inputVariableNames,
  findMissing,
  builtinValues,
  producedVariables,
} from '../src/shared/variables';
import { normalizeRepeat, counterAt, MAX_REPEAT_TIMES } from '../src/shared/repeat';
import { validateFlow, validateStep, issuesByStep } from '../src/shared/validate';
import { normalizeFlow, normalizeSettings, normalizeStep } from '../src/shared/normalize';
import { changeAction, ACTIONS, ACTION_META, ACTION_GROUPS, describeTarget } from '../src/shared/actions';

const flow = (steps: Step[], extra: Partial<Flow> = {}): Flow => ({ id: 'f', name: 'F', steps, createdAt: 0, updatedAt: 0, ...extra });

// ---- variables ----

test('substitute replaces known names, blanks unknown ones, tolerates spaces', () => {
  assert.equal(substitute('a {{x}} b {{ y }} c {{z}}', { x: '1', y: '2' }), 'a 1 b 2 c ');
  assert.equal(substitute(undefined, {}), undefined);
});

test('substitute does not read inherited object properties', () => {
  assert.equal(substitute('{{toString}}{{constructor}}', {}), '');
});

test('applyVariables resolves value, target text, selector and index', () => {
  const s = applyVariables(
    { id: '1', action: 'click', value: '{{v}}', target: { by: 'selector', text: '{{t}}', selector: '#i{{n}}', index: '{{n}}' } },
    { v: 'V', t: 'T', n: '3' }
  );
  assert.equal(s.value, 'V');
  assert.deepEqual([s.target?.text, s.target?.selector, s.target?.index], ['T', '#i3', '3']);
});

test('input variables exclude built-ins, the counter and extracted names', () => {
  const steps: Step[] = [
    { id: '1', action: 'goto', value: 'x/{{q}}/{{date}}/{{n}}' },
    { id: '2', action: 'extractText', saveAs: 'title', target: { by: 'text', text: 'a' } },
    { id: '3', action: 'screenshot', value: '{{title}}.png' },
  ];
  assert.deepEqual(collectVariableNames(steps).sort(), ['date', 'n', 'q', 'title']);
  assert.deepEqual(producedVariables(steps), ['title']);
  assert.deepEqual(inputVariableNames(steps, 'n'), ['q']);
});

test('findMissing ignores disabled steps and filled inputs', () => {
  const steps: Step[] = [
    { id: '1', action: 'goto', value: '{{a}}' },
    { id: '2', action: 'goto', value: '{{b}}', disabled: true },
    { id: '3', action: 'goto', value: '{{c}}' },
  ];
  assert.deepEqual(findMissing(steps, { c: 'x' }), ['a']);
  assert.deepEqual(findMissing(steps, { a: '  ' , c: 'x' }), ['a']);
});

test('built-in values are file-name safe', () => {
  const b = builtinValues(new Date(2026, 8, 19, 14, 2, 11));
  assert.equal(b.date, '2026-09-19');
  assert.equal(b.time, '14-02-11');
  assert.equal(b.datetime, '2026-09-19_14-02-11');
  assert.match(b.timestamp, /^\d+$/);
});

// ---- repeat ----

test('normalizeRepeat clamps the range to the flow', () => {
  const r = normalizeRepeat({ enabled: true, fromStep: 0, toStep: 99, times: 2 }, 4);
  assert.deepEqual([r.fromStep, r.toStep], [1, 4]);
  const r2 = normalizeRepeat({ fromStep: 3, toStep: 1 }, 4);
  assert.deepEqual([r2.fromStep, r2.toStep], [3, 3]);
});

test('normalizeRepeat migrates the v0.1 from/to/step shape', () => {
  const r = normalizeRepeat({ from: 5, to: 20, step: 5 }, 2);
  assert.equal(r.times, 4);
  assert.equal(r.counterStart, 5);
  assert.equal(r.counterStep, 5);
});

test('normalizeRepeat survives garbage and caps huge counts', () => {
  const r = normalizeRepeat({ times: 'lots' as unknown as number, counterName: '{{bad name}}', delayMs: -5 }, 3);
  assert.equal(r.times, 3);
  assert.equal(r.counterName, 'badname');
  assert.equal(r.delayMs, 0);
  assert.equal(normalizeRepeat({ times: 1e12 }, 1).times, MAX_REPEAT_TIMES);
});

test('counterAt steps by the configured amount', () => {
  const r = normalizeRepeat({ counterStart: 10, counterStep: -2 }, 1);
  assert.deepEqual([0, 1, 2].map((p) => counterAt(r, p)), [10, 8, 6]);
});

// ---- validation ----

test('validation flags empty links, targets, selectors and variable names', () => {
  const msgs = (s: Step) => validateStep(s).filter((i) => i.level === 'error').length;
  assert.equal(msgs({ id: '1', action: 'goto', value: ' ' }), 1);
  assert.equal(msgs({ id: '2', action: 'click', target: { by: 'text', text: '' } }), 1);
  assert.equal(msgs({ id: '3', action: 'click', target: { by: 'selector', selector: '' } }), 1);
  assert.equal(msgs({ id: '4', action: 'extractText', saveAs: 'bad name', target: { by: 'text', text: 'x' } }), 1);
  assert.equal(msgs({ id: '5', action: 'fillField', target: { by: 'searchbox' } }), 0);
  assert.equal(msgs({ id: '6', action: 'back' }), 0);
});

test('validateFlow: empty flow, all disabled, and disabled steps are not checked', () => {
  assert.equal(validateFlow(flow([]))[0].level, 'error');
  assert.ok(validateFlow(flow([{ id: '1', action: 'back', disabled: true }])).some((i) => i.message.includes('disabled')));
  assert.equal(
    validateFlow(flow([{ id: '1', action: 'back' }, { id: '2', action: 'goto', value: '', disabled: true }])).length,
    0
  );
});

test('validateFlow warns about empty inputs and groups issues by step', () => {
  const issues = validateFlow(flow([{ id: 's', action: 'goto', value: '{{site}}' }], { variables: {} }));
  assert.ok(issues.some((i) => i.level === 'warning' && i.message.includes('{{site}}')));
  const bad = validateFlow(flow([{ id: 's', action: 'goto', value: '' }]));
  assert.equal(issuesByStep(bad).s.length, 1);
});

// ---- normalization ----

test('normalizeFlow fills defaults and drops unknown actions', () => {
  const f = normalizeFlow({ steps: [{ action: 'goto', value: 'x' }, { action: 'teleport' }, null, 'nope'] })!;
  assert.equal(f.name, 'Untitled flow');
  assert.equal(f.steps.length, 1);
  assert.ok(f.steps[0].id);
  assert.ok(f.id);
});

test('normalizeFlow rejects things that are not flows', () => {
  assert.equal(normalizeFlow(null), null);
  assert.equal(normalizeFlow({ name: 'x' }), null);
  assert.equal(normalizeFlow([]), null);
});

test('normalizeFlow makes duplicate step ids unique', () => {
  const f = normalizeFlow({ steps: [{ id: 'a', action: 'back' }, { id: 'a', action: 'back' }] })!;
  assert.notEqual(f.steps[0].id, f.steps[1].id);
});

test('normalizeStep keeps v0.1 fields and converts numeric values', () => {
  const s = normalizeStep({
    id: '1',
    action: 'downloadWait',
    value: 5,
    target: { by: 'text', text: 'Get', index: 2, autoIncrement: true, match: 'contains' },
    options: { onError: 'continue', waitMs: '3000', timeoutMs: -1, retries: 99, junk: true },
  })!;
  assert.equal(s.value, '5');
  assert.deepEqual(s.target, { by: 'text', text: 'Get', index: '2', autoIncrement: true, match: 'contains' });
  assert.deepEqual(s.options, { onError: 'continue', waitMs: 3000, retries: 10 });
});

test('normalizeSettings migrates blockPopups and rejects bad values', () => {
  const d = {
    headless: false,
    downloadDir: '/dl',
    timeoutMs: 15000,
    adblock: true,
    blockPopupWindows: true,
    blockPopupTabs: true,
    popupWhitelist: [],
    persistentSession: true,
    slowMoMs: 0,
    screenshotOnError: true,
    theme: 'system' as const,
  };
  const s = normalizeSettings({ blockPopups: false, timeoutMs: 5, theme: 'neon', popupWhitelist: [' a.com ', 3, ''], downloadDir: '  ' }, d);
  assert.equal(s.blockPopupWindows, false);
  assert.equal(s.blockPopupTabs, false);
  assert.equal(s.timeoutMs, 15000);
  assert.equal(s.theme, 'system');
  assert.deepEqual(s.popupWhitelist, ['a.com']);
  assert.equal(s.downloadDir, '/dl');
  assert.deepEqual(normalizeSettings('garbage', d), d);
});

// ---- actions ----

test('every action has metadata in a known group', () => {
  for (const a of ACTIONS) {
    assert.ok(ACTION_META[a].label, a);
    assert.ok(ACTION_GROUPS.includes(ACTION_META[a].group), a);
  }
});

test('changeAction keeps the target text and sets sensible defaults', () => {
  const click: Step = { id: '1', action: 'click', target: { by: 'text', text: 'Go', index: '2' } };
  const dl = changeAction(click, 'downloadWait');
  assert.equal(dl.target?.text, 'Go');
  assert.equal(dl.target?.index, '2');
  assert.equal(dl.options?.waitMs, 30000);
  const fill = changeAction(click, 'fillField');
  assert.equal(fill.target?.by, 'searchbox');
  assert.equal(fill.options?.pressEnter, true);
  const wait = changeAction(click, 'wait');
  assert.equal(wait.target, undefined);
  assert.equal(wait.value, '1000');
  const ex = changeAction(click, 'extractText');
  assert.equal(ex.saveAs, 'text');
  assert.equal(changeAction(ex, 'click').saveAs, undefined);
});

test('describeTarget reads naturally', () => {
  assert.equal(describeTarget({ by: 'searchbox' }), 'the main search box');
  assert.equal(describeTarget({ by: 'text', text: 'Go' }), '“Go”');
});

// The inputs on a step card, driven by ACTION_META: which element the step
// targets, and the step's main value.

import { useEffect, useRef, useState } from 'react';
import type { Step, Target, StepOptions } from '@shared/types';
import { ACTION_META } from '@shared/actions';

export type StepPatch = (s: Step) => Step;
export type OnPatch = (patch: StepPatch, coalesceKey?: string) => void;

const setTarget = (patch: Partial<Target>): StepPatch => (s) => ({ ...s, target: { ...(s.target ?? { by: 'text' }), ...patch } });
export const setOptions = (patch: Partial<StepOptions>): StepPatch => (s) => ({ ...s, options: { ...(s.options ?? {}), ...patch } });

/** A number input that shows seconds and stores milliseconds. */
export function SecondsInput({
  ms,
  onChange,
  placeholder,
  label,
  className = 'input num',
  disabled,
}: {
  ms: number | undefined;
  onChange: (ms: number | undefined) => void;
  placeholder?: string;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  const shown = ms == null ? '' : String(Math.round(ms) / 1000);
  const [text, setText] = useState(shown);
  const focused = useRef(false);
  // Follow outside changes (undo, another field), but never rewrite what's being typed ("1." → "1").
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  return (
    <span className="unit-input">
      <input
        className={className}
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => {
          const t = e.target.value.replace(',', '.');
          setText(t);
          if (t.trim() === '') onChange(undefined);
          else {
            const n = Number(t);
            if (Number.isFinite(n) && n >= 0) onChange(Math.round(n * 1000));
          }
        }}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(shown);
        }}
      />
      <span className="unit">s</span>
    </span>
  );
}

interface Props {
  step: Step;
  onPatch: OnPatch;
  disabled?: boolean;
}

export function StepFields({ step, onPatch, disabled }: Props) {
  const meta = ACTION_META[step.action];
  const t = step.target;
  const key = (field: string) => `${step.id}:${field}`;
  const fields: JSX.Element[] = [];

  // ---- Target ----
  if (meta.target) {
    const by = t?.by ?? 'text';
    const options =
      meta.target === 'field'
        ? [
            ['searchbox', 'Main search box'],
            ['placeholder', 'Field labelled'],
            ['selector', 'CSS selector'],
          ]
        : meta.target === 'select'
          ? [
              ['placeholder', 'Dropdown labelled'],
              ['selector', 'CSS selector'],
            ]
          : [
              ['text', 'Text'],
              ['selector', 'CSS selector'],
            ];
    fields.push(
      <select
        key="by"
        className="input by-select"
        value={by}
        aria-label="Find the element by"
        disabled={disabled}
        onChange={(e) => onPatch(setTarget({ by: e.target.value as Target['by'] }))}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    );
    if (by === 'selector') {
      fields.push(
        <input
          key="selector"
          className="input grow mono"
          placeholder="#download, .btn-primary, button[type=submit]"
          value={t?.selector ?? ''}
          aria-label="CSS selector"
          spellCheck={false}
          disabled={disabled}
          onChange={(e) => onPatch(setTarget({ selector: e.target.value }), key('selector'))}
        />
      );
    } else if (by !== 'searchbox') {
      fields.push(
        <input
          key="text"
          className="input grow"
          placeholder={
            by === 'placeholder'
              ? meta.target === 'select'
                ? 'the dropdown’s label'
                : 'placeholder or label, e.g. Email'
              : step.action === 'waitFor'
                ? 'text that should appear'
                : 'the text on it, e.g. Download'
          }
          value={t?.text ?? ''}
          aria-label={by === 'placeholder' ? 'Placeholder or label' : 'Element text'}
          disabled={disabled}
          onChange={(e) => onPatch(setTarget({ text: e.target.value }), key('text'))}
        />
      );
      fields.push(
        <select
          key="match"
          className="input match-select"
          value={t?.match ?? 'exact'}
          aria-label="How to match the text"
          disabled={disabled}
          onChange={(e) => onPatch(setTarget({ match: e.target.value as 'exact' | 'contains' }))}
        >
          <option value="exact">whole text</option>
          <option value="contains">contains</option>
        </select>
      );
    }
    if (meta.pickNth) {
      fields.push(
        <input
          key="index"
          className="input num mono"
          placeholder={t?.autoIncrement ? 'start' : 'item #'}
          value={t?.index ?? ''}
          aria-label="Which match to use (1 = first)"
          title="Which match to use when several elements match (1 = first). Accepts {{n}}."
          disabled={disabled}
          onChange={(e) => onPatch(setTarget({ index: e.target.value }), key('index'))}
        />
      );
    }
  }

  // ---- Value ----
  const v = meta.value;
  if (v) {
    if (v.kind === 'choice') {
      fields.push(
        <select
          key="value"
          className="input"
          value={step.value || v.choices?.[0]?.value}
          aria-label={v.placeholder}
          disabled={disabled}
          onChange={(e) => onPatch((s) => ({ ...s, value: e.target.value }))}
        >
          {v.choices?.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      );
    } else if (v.kind === 'ms') {
      const n = Number(step.value);
      fields.push(
        <SecondsInput
          key="value"
          ms={(step.value ?? '').trim() === '' || !Number.isFinite(n) ? undefined : n}
          placeholder="1"
          label="Seconds to wait"
          className="input num"
          disabled={disabled}
          onChange={(ms) => onPatch((s) => ({ ...s, value: ms == null ? '' : String(ms) }), key('value'))}
        />
      );
    } else {
      fields.push(
        <input
          key="value"
          className={'input grow' + (v.kind === 'url' || v.kind === 'filename' || v.kind === 'key' ? ' mono' : '')}
          placeholder={v.placeholder}
          value={step.value ?? ''}
          aria-label={v.placeholder}
          spellCheck={v.kind === 'text'}
          disabled={disabled}
          onChange={(e) => onPatch((s) => ({ ...s, value: e.target.value }), key('value'))}
        />
      );
    }
  }

  if (step.action === 'appendRow') {
    fields.push(
      <label key="file" className="saveas">
        <span>in</span>
        <input
          className="input mono"
          style={{ width: 150 }}
          value={step.fileName ?? ''}
          placeholder="results.csv"
          aria-label="File to save the row in"
          spellCheck={false}
          disabled={disabled}
          onChange={(e) => onPatch((s) => ({ ...s, fileName: e.target.value }), key('file'))}
        />
      </label>
    );
  }

  if (step.action === 'uploadFile') {
    fields.push(
      <span key="file" className="row gap-sm grow">
        <input
          className="input grow mono"
          value={step.fileName ?? ''}
          placeholder="the file to attach"
          aria-label="File to attach"
          spellCheck={false}
          disabled={disabled}
          onChange={(e) => onPatch((s) => ({ ...s, fileName: e.target.value }), key('file'))}
        />
        <button
          type="button"
          className="btn sm"
          disabled={disabled}
          onClick={async () => {
            const picked = await window.api.pickFile(step.fileName);
            if (picked) onPatch((s) => ({ ...s, fileName: picked }));
          }}
        >
          Browse…
        </button>
      </span>
    );
  }

  if (step.action === 'extractText') {
    const mode = step.options?.extract ?? 'text';
    fields.push(
      <select
        key="extract"
        className="input"
        style={{ width: 132 }}
        value={mode}
        aria-label="What to read from the element"
        disabled={disabled}
        onChange={(e) => onPatch(setOptions({ extract: e.target.value as 'text' | 'href' | 'value' | 'attribute' }))}
      >
        <option value="text">its text</option>
        <option value="href">its link</option>
        <option value="value">its value</option>
        <option value="attribute">an attribute</option>
      </select>
    );
    if (mode === 'attribute') {
      fields.push(
        <input
          key="attr"
          className="input mono"
          style={{ width: 110 }}
          value={step.options?.attribute ?? ''}
          placeholder="src"
          aria-label="Attribute name"
          spellCheck={false}
          disabled={disabled}
          onChange={(e) => onPatch(setOptions({ attribute: e.target.value }), key('attr'))}
        />
      );
    }
    fields.push(
      <label key="saveAs" className="saveas">
        <span>save as</span>
        <span className="var-input">
          <span aria-hidden="true">{'{{'}</span>
          <input
            className="input mono"
            value={step.saveAs ?? ''}
            placeholder="name"
            aria-label="Variable name"
            spellCheck={false}
            disabled={disabled}
            onChange={(e) => onPatch((s) => ({ ...s, saveAs: e.target.value.replace(/[^\w]/g, '') }), key('saveAs'))}
          />
          <span aria-hidden="true">{'}}'}</span>
        </span>
      </label>
    );
  }

  if (step.action === 'fillField') {
    fields.push(
      <label key="enter" className="inline-check">
        <input
          type="checkbox"
          checked={step.options?.pressEnter ?? true}
          disabled={disabled}
          onChange={(e) => onPatch(setOptions({ pressEnter: e.target.checked }))}
        />
        press Enter
      </label>
    );
  }

  if (!fields.length) {
    return <span className="step-desc">{meta.description}</span>;
  }
  return <>{fields}</>;
}

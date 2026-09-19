// One step in the editor: status chip, action picker, inputs, a summary of its
// options, a menu of step actions, and an expandable "options" section.

import { memo } from 'react';
import type { Step, StepStatus } from '@shared/types';
import { ACTION_META } from '@shared/actions';
import type { Issue } from '@shared/validate';
import { changeAction } from '@shared/actions';
import { ActionPicker } from './ActionPicker';
import { StepFields, SecondsInput, setOptions } from './StepFields';
import type { OnPatch } from './StepFields';
import { Icon } from './ui/Icon';
import { Menu } from './ui/Menu';
import { Switch } from './ui/Switch';
import { comboLabel } from '../hooks/useShortcuts';

export interface StepCardProps {
  step: Step;
  index: number;
  total: number;
  status?: StepStatus;
  issues?: Issue[];
  selected: boolean;
  expanded: boolean;
  /** While a run is going the flow can't be edited. */
  locked: boolean;
  /** This step is the one currently running. */
  current: boolean;
  dropHint?: 'before' | 'after' | null;
  onPatch: (id: string, ...args: Parameters<OnPatch>) => void;
  onSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onDuplicate: (id: string) => void;
  onInsertBelow: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRunOnly: (index: number) => void;
  onRunFrom: (index: number) => void;
  onDragStart: (id: string) => void;
  onDragOverCard: (id: string, e: React.DragEvent) => void;
  onDropCard: (id: string, e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function optionTags(step: Step): string[] {
  const o = step.options ?? {};
  const tags: string[] = [];
  if (o.retries) tags.push(`retry ${o.retries}×`);
  if (o.timeoutMs) tags.push(`limit ${o.timeoutMs / 1000} s`);
  if (step.action === 'downloadWait') tags.push(`file within ${(o.waitMs ?? 30000) / 1000} s`);
  if (o.waitAfterMs) tags.push(`then wait ${o.waitAfterMs / 1000} s`);
  if (o.onError === 'continue') tags.push('continues on error');
  if (step.target?.autoIncrement) tags.push('next match each run');
  if (step.action === 'waitFor' && o.waitState === 'hidden') tags.push('until gone');
  if (step.action === 'assertText' && o.expect === 'absent') tags.push('must be absent');
  return tags;
}

function statusLabel(s?: StepStatus): string {
  switch (s?.state) {
    case 'running':
      return s.attempts && s.attempts > 1 ? `Running, attempt ${s.attempt} of ${s.attempts}` : 'Running';
    case 'ok':
      return s.message ?? 'Succeeded';
    case 'error':
      return 'Failed';
    case 'warn':
      return 'Warning';
    case 'skipped':
      return s.message ?? 'Skipped';
    default:
      return 'Not run yet';
  }
}

export const StepCard = memo(function StepCard(p: StepCardProps) {
  const { step, index, total, status, issues = [], selected, expanded, locked, current } = p;
  const meta = ACTION_META[step.action];
  const patch: OnPatch = (fn, key) => p.onPatch(step.id, fn, key);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const tags = optionTags(step);
  const state = status?.state ?? 'idle';
  const o = step.options ?? {};

  const cls = [
    'step-card',
    `state-${state}`,
    selected && 'selected',
    expanded && 'expanded',
    step.disabled && 'disabled',
    current && 'current',
    errors.length && !step.disabled && 'invalid',
    p.dropHint && `drop-${p.dropHint}`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      data-step-id={step.id}
      onMouseDown={() => !selected && p.onSelect(step.id)}
      onFocusCapture={() => !selected && p.onSelect(step.id)}
      onDragOver={(e) => p.onDragOverCard(step.id, e)}
      onDrop={(e) => p.onDropCard(step.id, e)}
    >
      <div className="step-main">
        <span
          className="grip"
          draggable={!locked}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/x-step-id', step.id);
            const card = (e.currentTarget as HTMLElement).closest('.step-card');
            if (card) e.dataTransfer.setDragImage(card, 20, 20);
            p.onDragStart(step.id);
          }}
          onDragEnd={p.onDragEnd}
          title={locked ? undefined : 'Drag to reorder'}
          aria-hidden="true"
        >
          <Icon name="grip" />
        </span>
        <span className={`step-num state-${state}`} title={statusLabel(status)} aria-label={`Step ${index + 1}: ${statusLabel(status)}`}>
          {state === 'ok' ? <Icon name="check" size={13} /> : state === 'error' ? <Icon name="x" size={13} /> : index + 1}
        </span>
        <ActionPicker value={step.action} onChange={(a) => patch((s) => changeAction(s, a))} disabled={locked} />
        <div className="step-fields">
          <StepFields step={step} onPatch={patch} disabled={locked} />
        </div>
        {!expanded && tags.length > 0 && (
          <div className="step-tags">
            {tags.slice(0, 2).map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
            {tags.length > 2 && (
              <span className="tag" title={tags.slice(2).join(', ')}>
                +{tags.length - 2}
              </span>
            )}
          </div>
        )}
        {step.disabled && (
          <span className="tag">
            <Icon name="eyeOff" size={13} />
            Disabled
          </span>
        )}
        {step.note && !expanded && (
          <span className="note-dot" title={step.note}>
            <Icon name="note" size={14} />
          </span>
        )}
        <button
          className={'btn icon ghost expand-btn' + (expanded ? ' on' : '')}
          onClick={() => p.onToggleExpand(step.id)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide step options' : 'Show step options'}
          title="Step options"
        >
          <Icon name="sliders" />
        </button>
        <Menu
          width={240}
          items={[
            { label: 'Run only this step', icon: 'play', onSelect: () => p.onRunOnly(index), disabled: locked },
            { label: 'Run from here', icon: 'skipTo', onSelect: () => p.onRunFrom(index), disabled: locked },
            { separator: true },
            { label: 'Duplicate', icon: 'copy', hint: comboLabel('mod+d'), onSelect: () => p.onDuplicate(step.id), disabled: locked },
            { label: 'Add step below', icon: 'insertBelow', onSelect: () => p.onInsertBelow(step.id), disabled: locked },
            {
              label: step.disabled ? 'Enable step' : 'Disable step',
              icon: step.disabled ? 'eye' : 'eyeOff',
              onSelect: () => patch((s) => ({ ...s, disabled: !s.disabled || undefined })),
              disabled: locked,
            },
            { separator: true },
            { label: 'Move up', icon: 'arrowUp', hint: comboLabel('alt+arrowup'), onSelect: () => p.onMove(step.id, -1), disabled: locked || index === 0 },
            { label: 'Move down', icon: 'arrowDown', hint: comboLabel('alt+arrowdown'), onSelect: () => p.onMove(step.id, 1), disabled: locked || index === total - 1 },
            { separator: true },
            { label: 'Delete step', icon: 'trash', danger: true, onSelect: () => p.onDelete(step.id), disabled: locked },
          ]}
          trigger={(t) => (
            <button {...t} className="btn icon ghost" aria-label={`More actions for step ${index + 1}`}>
              <Icon name="more" />
            </button>
          )}
        />
      </div>

      {status?.state === 'running' && status.attempts && status.attempts > 1 && (
        <div className="step-live">Attempt {status.attempt} of {status.attempts}</div>
      )}
      {status?.state === 'error' && status.message && (
        <div className="step-msg error" role="alert">
          <Icon name="alertCircle" size={14} />
          <span>{status.message}</span>
        </div>
      )}
      {!locked && !step.disabled && (errors.length > 0 || warnings.length > 0) && !status && (
        <div className={'step-msg ' + (errors.length ? 'invalid' : 'warning')}>
          <Icon name={errors.length ? 'alertCircle' : 'alert'} size={14} />
          <span>{[...errors, ...warnings].map((i) => i.message).join(' ')}</span>
        </div>
      )}

      {expanded && (
        <div className="step-options">
          <label className="field">
            <span className="field-label">Time limit</span>
            <SecondsInput
              ms={o.timeoutMs}
              placeholder="default"
              label="Time limit in seconds"
              disabled={locked}
              onChange={(ms) => patch(setOptions({ timeoutMs: ms || undefined }), `${step.id}:timeout`)}
            />
          </label>
          <label className="field">
            <span className="field-label">Retries</span>
            <select
              className="input"
              value={o.retries ?? 0}
              disabled={locked}
              onChange={(e) => patch(setOptions({ retries: Number(e.target.value) || undefined }))}
            >
              {[0, 1, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'None' : `${n} time${n === 1 ? '' : 's'}`}
                </option>
              ))}
            </select>
          </label>
          {step.action !== 'wait' && (
            <label className="field">
              <span className="field-label">Then wait</span>
              <SecondsInput
                ms={o.waitAfterMs}
                placeholder="0"
                label="Wait after this step, in seconds"
                disabled={locked}
                onChange={(ms) => patch(setOptions({ waitAfterMs: ms || undefined }), `${step.id}:after`)}
              />
            </label>
          )}
          <label className="field">
            <span className="field-label">If it fails</span>
            <select
              className="input"
              value={o.onError ?? 'stop'}
              disabled={locked}
              onChange={(e) => patch(setOptions({ onError: e.target.value as 'stop' | 'continue' }))}
            >
              <option value="stop">Stop the run</option>
              <option value="continue">Continue</option>
            </select>
          </label>

          {step.action === 'downloadWait' && (
            <label className="field">
              <span className="field-label">Wait for the file</span>
              <SecondsInput
                ms={o.waitMs ?? 30000}
                label="Seconds to wait for the download to start"
                disabled={locked}
                onChange={(ms) => patch(setOptions({ waitMs: ms ?? 30000 }), `${step.id}:waitMs`)}
              />
            </label>
          )}
          {step.action === 'waitFor' && (
            <label className="field">
              <span className="field-label">Wait until it</span>
              <select
                className="input"
                value={o.waitState ?? 'visible'}
                disabled={locked}
                onChange={(e) => patch(setOptions({ waitState: e.target.value as 'visible' | 'hidden' }))}
              >
                <option value="visible">appears</option>
                <option value="hidden">goes away</option>
              </select>
            </label>
          )}
          {step.action === 'assertText' && (
            <label className="field">
              <span className="field-label">The text must</span>
              <select
                className="input"
                value={o.expect ?? 'present'}
                disabled={locked}
                onChange={(e) => patch(setOptions({ expect: e.target.value as 'present' | 'absent' }))}
              >
                <option value="present">be on the page</option>
                <option value="absent">not be on the page</option>
              </select>
            </label>
          )}
          {meta.pickNth && (
            <div className="field switch-field">
              <span className="field-label">Next match each run</span>
              <Switch
                label="Use the next match each time this step runs"
                checked={!!step.target?.autoIncrement}
                disabled={locked}
                onChange={(on) => patch((s) => ({ ...s, target: { ...(s.target ?? { by: 'text' }), autoIncrement: on || undefined } }))}
              />
            </div>
          )}

          <label className="field span-all">
            <span className="field-label">Note</span>
            <input
              className="input"
              value={step.note ?? ''}
              placeholder="Why this step is here (optional)"
              disabled={locked}
              onChange={(e) => patch((s) => ({ ...s, note: e.target.value || undefined }), `${step.id}:note`)}
            />
          </label>
        </div>
      )}
    </div>
  );
});

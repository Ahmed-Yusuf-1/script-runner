import { memo } from 'react';
import type { Step, Action, Target, StepStatus } from '@shared/types';
import { ACTION_LABELS } from '@shared/types';

interface Props {
  index: number;
  total: number;
  step: Step;
  status?: StepStatus;
  onUpdate: (id: string, patch: Partial<Step>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}

const ACTIONS = Object.keys(ACTION_LABELS) as Action[];

export const StepRow = memo(function StepRow({ index, total, step, status, onUpdate, onRemove, onMove }: Props) {
  const { id } = step;

  const setTarget = (patch: Partial<Target>) =>
    onUpdate(id, { target: { ...(step.target ?? { by: 'text' }), ...patch } as Target });

  const setOptions = (patch: Partial<NonNullable<Step['options']>>) =>
    onUpdate(id, { options: { ...(step.options ?? {}), ...patch } });

  const handleActionChange = (action: Action) => {
    const patch: Partial<Step> = { action };
    if (action === 'click' || action === 'download') {
      patch.target = { by: 'text', text: step.target?.text ?? '', match: step.target?.match ?? 'exact' };
    } else if (action === 'fillField') {
      const by = step.target?.by === 'placeholder' ? 'placeholder' : 'searchbox';
      patch.target = { by, text: step.target?.text ?? '', match: step.target?.match ?? 'exact' };
      patch.options = { ...(step.options ?? {}), pressEnter: step.options?.pressEnter ?? true };
    } else if (action === 'downloadWait') {
      patch.target = { by: 'text', text: step.target?.text ?? '', match: step.target?.match ?? 'exact' };
      patch.options = { ...(step.options ?? {}), waitMs: step.options?.waitMs ?? 1000 };
    } else {
      patch.target = undefined;
    }
    onUpdate(id, patch);
  };

  return (
    <div className={'step-row state-' + (status?.state ?? 'idle')}>
      <div className="step-grip">
        <button className="icon-btn" disabled={index === 0} onClick={() => onMove(id, -1)} title="Move up">
          ▲
        </button>
        <span className="step-num">{index + 1}</span>
        <button
          className="icon-btn"
          disabled={index === total - 1}
          onClick={() => onMove(id, 1)}
          title="Move down"
        >
          ▼
        </button>
      </div>

      <div className="step-body">
        <div className="step-line">
          <select
            className="action-select"
            value={step.action}
            onChange={(e) => handleActionChange(e.target.value as Action)}
          >
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </select>

          {renderFields()}

          {step.action !== 'wait' && step.action !== 'downloadWait' && (
            <label className="check" title="Optional: pause this long after this step (blank = no pause)">
              then wait
              <input
                className="num-sm"
                type="number"
                placeholder="0"
                value={step.options?.waitAfterMs ?? ''}
                onChange={(e) =>
                  setOptions({
                    waitAfterMs: e.target.value === '' ? undefined : Number(e.target.value) || 0,
                  })
                }
              />
              ms
            </label>
          )}

          <select
            className="onerror"
            value={step.options?.onError ?? 'stop'}
            onChange={(e) => setOptions({ onError: e.target.value as 'stop' | 'continue' })}
            title="What to do if this step fails"
          >
            <option value="stop">on error: stop</option>
            <option value="continue">on error: continue</option>
          </select>

          <span className={'status-badge ' + (status?.state ?? '')} title={status?.message}>
            {statusText(status)}
          </span>

          <button className="icon-btn danger" onClick={() => onRemove(id)} title="Delete step">
            ✕
          </button>
        </div>

        {status?.state === 'error' && status.message && (
          <div className="step-error">{status.message}</div>
        )}
      </div>
    </div>
  );

  function renderFields() {
    switch (step.action) {
      case 'goto':
        return (
          <input
            className="grow"
            placeholder="example.com  or  https://…"
            value={step.value ?? ''}
            onChange={(e) => onUpdate(id, { value: e.target.value })}
          />
        );

      case 'search':
        return (
          <input
            className="grow"
            placeholder="e.g. Inception movie   (supports {{variables}})"
            value={step.value ?? ''}
            onChange={(e) => onUpdate(id, { value: e.target.value })}
          />
        );

      case 'fillField':
        return (
          <>
            <select
              value={step.target?.by === 'placeholder' ? 'placeholder' : 'searchbox'}
              onChange={(e) => setTarget({ by: e.target.value as Target['by'] })}
              title="Which field on the page?"
            >
              <option value="searchbox">the main search box</option>
              <option value="placeholder">field with placeholder/label…</option>
            </select>
            {step.target?.by === 'placeholder' && (
              <input
                placeholder="placeholder or label text"
                value={step.target?.text ?? ''}
                onChange={(e) => setTarget({ text: e.target.value })}
              />
            )}
            <input
              className="grow"
              placeholder="text to type   (supports {{variables}})"
              value={step.value ?? ''}
              onChange={(e) => onUpdate(id, { value: e.target.value })}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={step.options?.pressEnter ?? true}
                onChange={(e) => setOptions({ pressEnter: e.target.checked })}
              />
              press Enter
            </label>
          </>
        );

      case 'click':
      case 'download':
        return (
          <>
            <input
              className="grow"
              placeholder={
                step.action === 'download'
                  ? 'the download link/button text'
                  : 'the button/link text, e.g. Download This Now'
              }
              value={step.target?.text ?? ''}
              onChange={(e) => setTarget({ text: e.target.value })}
            />
            <select
              value={step.target?.match ?? 'exact'}
              onChange={(e) => setTarget({ match: e.target.value as 'exact' | 'contains' })}
            >
              <option value="exact">whole text (any case)</option>
              <option value="contains">contains text</option>
            </select>
            <input
              className="num-sm"
              placeholder={step.target?.autoIncrement ? 'start #' : 'item #'}
              value={step.target?.index ?? ''}
              onChange={(e) => setTarget({ index: e.target.value })}
              title="Which one to use when several match (1 = first). Use {{n}}, or tick ↑ to auto-advance."
            />
            <label className="check" title="Move to the next matching item each time this step runs">
              <input
                type="checkbox"
                checked={step.target?.autoIncrement ?? false}
                onChange={(e) => setTarget({ autoIncrement: e.target.checked })}
              />
              ↑ each run
            </label>
          </>
        );

      case 'downloadWait':
        return (
          <>
            <input
              className="grow"
              placeholder="the download link/button text"
              value={step.target?.text ?? ''}
              onChange={(e) => setTarget({ text: e.target.value })}
            />
            <select
              value={step.target?.match ?? 'exact'}
              onChange={(e) => setTarget({ match: e.target.value as 'exact' | 'contains' })}
            >
              <option value="exact">whole text (any case)</option>
              <option value="contains">contains text</option>
            </select>
            <input
              className="num-sm"
              placeholder={step.target?.autoIncrement ? 'start #' : 'item #'}
              value={step.target?.index ?? ''}
              onChange={(e) => setTarget({ index: e.target.value })}
              title="Which one to use when several match (1 = first). Use {{n}}, or tick ↑ to auto-advance."
            />
            <label className="check" title="Move to the next matching item each time this step runs">
              <input
                type="checkbox"
                checked={step.target?.autoIncrement ?? false}
                onChange={(e) => setTarget({ autoIncrement: e.target.checked })}
              />
              ↑ each run
            </label>
            <label className="check">
              wait
              <input
                className="num-sm"
                type="number"
                value={step.options?.waitMs ?? 1000}
                onChange={(e) => setOptions({ waitMs: Number(e.target.value) || 0 })}
              />
              ms
            </label>
          </>
        );

      case 'pressKey':
        return (
          <input
            className="grow"
            placeholder="Enter, Escape, Tab, ArrowDown…"
            value={step.value ?? ''}
            onChange={(e) => onUpdate(id, { value: e.target.value })}
          />
        );

      case 'wait':
        return (
          <input
            className="grow"
            type="number"
            placeholder="1000"
            value={step.value ?? ''}
            onChange={(e) => onUpdate(id, { value: e.target.value })}
          />
        );

      case 'screenshot':
        return (
          <input
            className="grow"
            placeholder="result.png"
            value={step.value ?? ''}
            onChange={(e) => onUpdate(id, { value: e.target.value })}
          />
        );

      case 'back':
        return <span className="muted grow">Navigates back to the previous page.</span>;

      case 'closeAd':
        return <span className="muted grow">Tries to find and close a popup/ad.</span>;

      case 'closeTab':
        return (
          <span className="muted grow">Closes this tab and returns to the previous one.</span>
        );

      case 'closeOtherTabs':
        return (
          <span className="muted grow">
            Closes every other tab (clears pop-up ads), keeping this one.
          </span>
        );

      default:
        return null;
    }
  }
});

function statusText(status?: StepStatus): string {
  switch (status?.state) {
    case 'running':
      return '…';
    case 'ok':
      return '✓';
    case 'warn':
      return '⚠';
    case 'error':
      return '✕';
    case 'skipped':
      return '–';
    default:
      return '';
  }
}

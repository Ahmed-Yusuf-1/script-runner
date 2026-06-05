import type { RepeatConfig } from '@shared/types';
import { normalizeRepeat } from '@shared/repeat';

interface Props {
  repeat?: RepeatConfig;
  stepCount: number;
  onChange: (repeat: RepeatConfig) => void;
}

export function RepeatPanel({ repeat, stepCount, onChange }: Props) {
  const r = normalizeRepeat(repeat, stepCount);
  const set = (patch: Partial<RepeatConfig>) =>
    onChange(normalizeRepeat({ ...r, ...patch }, stepCount));

  const toggle = (on: boolean) =>
    onChange(
      normalizeRepeat({ ...r, enabled: on, fromStep: 1, toStep: Math.max(1, stepCount) }, stepCount)
    );

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Repeat</h2>
        <label className="check">
          <input type="checkbox" checked={r.enabled} onChange={(e) => toggle(e.target.checked)} />
          repeat some steps
        </label>
      </div>

      {!r.enabled ? (
        <div className="empty pad">
          Turn on to run a chosen range of steps several times — with an auto-incrementing number
          you can drop into any step (great for files numbered 1…100).
        </div>
      ) : (
        <div className="repeat-form">
          <div className="repeat-row">
            <span className="repeat-label">Repeat steps</span>
            <input
              className="num-sm"
              type="number"
              min={1}
              max={stepCount}
              value={r.fromStep}
              onChange={(e) => set({ fromStep: Number(e.target.value) || 1 })}
            />
            <span className="repeat-label">to</span>
            <input
              className="num-sm"
              type="number"
              min={1}
              max={stepCount}
              value={r.toStep}
              onChange={(e) => set({ toStep: Number(e.target.value) || 1 })}
            />
            <span className="muted small">(of {stepCount})</span>
          </div>

          <div className="repeat-row">
            <span className="repeat-label">How many times</span>
            <input
              className="num-sm"
              type="number"
              min={0}
              value={r.times}
              onChange={(e) => set({ times: Number(e.target.value) || 0 })}
            />
          </div>

          <div className="repeat-row">
            <span className="repeat-label">Number</span>
            <input
              className="num-sm"
              value={r.counterName}
              onChange={(e) => set({ counterName: e.target.value })}
              title="Use this as {{name}} inside the repeated steps"
            />
            <span className="muted small">= <code>{'{{' + r.counterName + '}}'}</code></span>
            <span className="repeat-label">, first value</span>
            <input
              className="num-sm"
              type="number"
              value={r.counterStart}
              onChange={(e) => set({ counterStart: Number(e.target.value) || 0 })}
            />
            <span className="repeat-label">goes up by</span>
            <input
              className="num-sm"
              type="number"
              value={r.counterStep}
              onChange={(e) => set({ counterStep: Number(e.target.value) || 0 })}
            />
            <span className="muted small">each repeat</span>
          </div>

          <div className="muted small repeat-tip">
            Drop <code>{'{{' + r.counterName + '}}'}</code> into any step. Tip: to download many
            buttons with the <i>same</i> name, put it in a Download step's <b>item #</b> — pass 1
            presses the 1st, pass 2 the 2nd, and so on.
          </div>

          <div className="repeat-row">
            <span className="repeat-label">Pause between repeats</span>
            <input
              className="num-sm"
              type="number"
              min={0}
              value={r.delayMs}
              onChange={(e) => set({ delayMs: Number(e.target.value) || 0 })}
            />
            <span className="muted small">ms</span>
          </div>

          <div className="repeat-row">
            <label className="check" title="Don't start the next repeat until the current download has finished saving">
              <input
                type="checkbox"
                checked={r.waitForDownloads}
                onChange={(e) => set({ waitForDownloads: e.target.checked })}
              />
              wait for each download to finish before the next repeat
            </label>
          </div>

          <div className="repeat-summary">{summary(r, stepCount)}</div>
        </div>
      )}
    </section>
  );
}

function summary(r: RepeatConfig, stepCount: number): string {
  if (r.times <= 0) return 'Set “how many times” to 1 or more to run the repeat.';

  const before = r.fromStep > 1 ? `Steps 1–${r.fromStep - 1} run once, then ` : '';
  const after = r.toStep < stepCount ? `, then steps ${r.toStep + 1}–${stepCount} run once` : '';

  const last = r.counterStart + (r.times - 1) * r.counterStep;
  const seq =
    r.times === 1
      ? `${r.counterStart}`
      : `${r.counterStart}, ${r.counterStart + r.counterStep}, … ${last}`;
  const counter = `{{${r.counterName}}} = ${seq}`;

  const pause = r.delayMs > 0 ? `, pausing ${r.delayMs}ms between` : '';
  const range = r.fromStep === r.toStep ? `step ${r.fromStep}` : `steps ${r.fromStep}–${r.toStep}`;

  return `${before}${range} run ${r.times}× (${counter})${pause}${after}.`;
}

import type { RepeatConfig } from '@shared/types';
import { normalizeRepeat, MAX_REPEAT_TIMES } from '@shared/repeat';
import { Icon } from './ui/Icon';
import { Switch } from './ui/Switch';
import { SecondsInput } from './StepFields';

interface Props {
  repeat?: RepeatConfig;
  stepCount: number;
  locked: boolean;
  onChange: (repeat: RepeatConfig, coalesceKey?: string) => void;
}

const int = (s: string, fallback: number) => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
};

export function RepeatPanel({ repeat, stepCount, locked, onChange }: Props) {
  const r = normalizeRepeat(repeat, stepCount);
  const set = (patch: Partial<RepeatConfig>, key?: string) => onChange(normalizeRepeat({ ...r, ...patch }, stepCount), key);
  const toggle = (on: boolean) =>
    onChange(normalizeRepeat({ ...r, enabled: on, ...(on && !repeat ? { fromStep: 1, toStep: Math.max(1, stepCount) } : {}) }, stepCount));
  const noSteps = stepCount === 0;

  return (
    <section className="panel" aria-labelledby="repeat-title">
      <div className="panel-head">
        <Icon name="repeat" className="accent-icon" />
        <h3 id="repeat-title">Repeat</h3>
        <span className="spacer" />
        <Switch label="Repeat some steps" checked={r.enabled} onChange={toggle} disabled={locked || noSteps} />
      </div>

      {!r.enabled ? (
        <p className="panel-hint">
          Run a range of steps several times, with a counter like <code className="var">{'{{n}}'}</code> you can use in any
          step. Handy for files numbered 1 to 100.
        </p>
      ) : (
        <>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Steps</span>
              <span className="row gap-sm">
                <input
                  className="input num"
                  type="number"
                  min={1}
                  max={stepCount}
                  value={r.fromStep}
                  disabled={locked}
                  aria-label="First repeated step"
                  onChange={(e) => set({ fromStep: int(e.target.value, 1) }, 'rep:from')}
                />
                <span className="muted">to</span>
                <input
                  className="input num"
                  type="number"
                  min={1}
                  max={stepCount}
                  value={r.toStep}
                  disabled={locked}
                  aria-label="Last repeated step"
                  onChange={(e) => set({ toStep: int(e.target.value, 1) }, 'rep:to')}
                />
              </span>
            </label>
            <label className="field">
              <span className="field-label">Times</span>
              <input
                className="input"
                type="number"
                min={0}
                max={MAX_REPEAT_TIMES}
                value={r.times}
                disabled={locked}
                onChange={(e) => set({ times: int(e.target.value, 0) }, 'rep:times')}
              />
            </label>
            <label className="field">
              <span className="field-label">Counter</span>
              <span className="var-input">
                <span aria-hidden="true">{'{{'}</span>
                <input
                  className="input mono"
                  value={r.counterName}
                  disabled={locked}
                  aria-label="Counter name"
                  onChange={(e) => set({ counterName: e.target.value }, 'rep:name')}
                />
                <span aria-hidden="true">{'}}'}</span>
              </span>
            </label>
            <label className="field">
              <span className="field-label">Start, step</span>
              <span className="row gap-sm">
                <input
                  className="input num"
                  type="number"
                  value={r.counterStart}
                  disabled={locked}
                  aria-label="Counter's first value"
                  onChange={(e) => set({ counterStart: int(e.target.value, 0) }, 'rep:start')}
                />
                <input
                  className="input num"
                  type="number"
                  value={r.counterStep}
                  disabled={locked}
                  aria-label="Counter's increase per repeat"
                  onChange={(e) => set({ counterStep: int(e.target.value, 0) }, 'rep:step')}
                />
              </span>
            </label>
            <label className="field">
              <span className="field-label">Pause between</span>
              <SecondsInput
                ms={r.delayMs || undefined}
                placeholder="0"
                label="Pause between repeats, in seconds"
                disabled={locked}
                onChange={(ms) => set({ delayMs: ms ?? 0 }, 'rep:delay')}
              />
            </label>
            <label className="inline-check field-check" title="Don't start the next repeat until downloads finish saving">
              <input
                type="checkbox"
                checked={r.waitForDownloads}
                disabled={locked}
                onChange={(e) => set({ waitForDownloads: e.target.checked })}
              />
              Wait for downloads
            </label>
          </div>
          <p className="summary">{summary(r, stepCount)}</p>
        </>
      )}
    </section>
  );
}

function summary(r: RepeatConfig, stepCount: number) {
  if (r.times <= 0) return 'Set “Times” to 1 or more to run the repeated steps.';
  const range = r.fromStep === r.toStep ? `step ${r.fromStep}` : `steps ${r.fromStep}–${r.toStep}`;
  const lead =
    r.fromStep === 1
      ? range.charAt(0).toUpperCase() + range.slice(1)
      : `${r.fromStep === 2 ? 'Step 1 runs' : `Steps 1–${r.fromStep - 1} run`} once, then ${range}`;
  const last = r.counterStart + (r.times - 1) * r.counterStep;
  const seq =
    r.times === 1
      ? `${r.counterStart}`
      : r.times === 2
        ? `${r.counterStart}, ${last}`
        : `${r.counterStart}, ${r.counterStart + r.counterStep} … ${last}`;
  const pause = r.delayMs > 0 ? `, pausing ${r.delayMs / 1000} s between` : '';
  const after =
    r.toStep < stepCount
      ? `, then ${r.toStep + 1 === stepCount ? `step ${stepCount} runs` : `steps ${r.toStep + 1}–${stepCount} run`} once`
      : '';
  return (
    <>
      {lead} {r.fromStep === r.toStep ? 'runs' : 'run'} {r.times === 1 ? 'once' : `${r.times}×`} with <code className="var">{`{{${r.counterName}}}`}</code> = {seq}
      {pause}
      {after}.
    </>
  );
}

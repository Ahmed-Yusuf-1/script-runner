import type { Step } from '@shared/types';
import { collectVariableNames } from '@shared/variables';

interface Props {
  variables: Record<string, string>;
  steps: Step[];
  /** Names handled automatically (e.g. the repeat counter) — hidden here. */
  exclude?: string[];
  onChange: (variables: Record<string, string>) => void;
}

export function VariablesPanel({ variables, steps, exclude = [], onChange }: Props) {
  const names = collectVariableNames(steps).filter((n) => !exclude.includes(n));
  const hiddenCounter = collectVariableNames(steps).filter((n) => exclude.includes(n));
  const setVal = (name: string, value: string) =>
    onChange({ ...variables, [name]: value });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Fields</h2>
        <span className="muted small">filled before each run</span>
      </div>

      {names.length === 0 ? (
        <div className="empty pad">
          Put <code>{'{{name}}'}</code> in any step (for example <code>{'{{query}}'}</code> in a
          search) and a fillable field will appear here — so one flow works for many inputs.
        </div>
      ) : (
        <div className="vars">
          {names.map((n) => (
            <label key={n} className="var-row">
              <span className="var-name">{'{{' + n + '}}'}</span>
              <input
                value={variables[n] ?? ''}
                onChange={(e) => setVal(n, e.target.value)}
                placeholder={`value for ${n}`}
              />
            </label>
          ))}
        </div>
      )}

      {hiddenCounter.map((n) => (
        <div key={n} className="muted small" style={{ marginTop: 6 }}>
          <code>{'{{' + n + '}}'}</code> is filled automatically by Repeat each pass.
        </div>
      ))}
    </section>
  );
}

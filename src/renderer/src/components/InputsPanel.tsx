import type { Step } from '@shared/types';
import { BUILTIN_VARIABLES, inputVariableNames, producedVariables } from '@shared/variables';
import { Icon } from './ui/Icon';

interface Props {
  variables: Record<string, string>;
  steps: Step[];
  counterName?: string;
  locked: boolean;
  onChange: (variables: Record<string, string>, coalesceKey?: string) => void;
}

export function InputsPanel({ variables, steps, counterName, locked, onChange }: Props) {
  const names = inputVariableNames(steps, counterName);
  const produced = producedVariables(steps);

  return (
    <section className="panel" aria-labelledby="inputs-title">
      <div className="panel-head">
        <Icon name="braces" className="accent-icon" />
        <h3 id="inputs-title">Inputs</h3>
        <span className="spacer" />
        <span className="muted small">used when the flow runs</span>
      </div>

      {names.length === 0 ? (
        <p className="panel-hint">
          Write <code className="var">{'{{name}}'}</code> in any step, for example <code className="var">{'{{query}}'}</code> in a
          search, and a field appears here so one flow works with different inputs.
        </p>
      ) : (
        <div className="vars">
          {names.map((n) => {
            const empty = !(variables[n] ?? '').trim();
            return (
              <label key={n} className="var-row">
                <code className="var" title={`{{${n}}}`}>
                  {n}
                </code>
                <input
                  className={'input grow' + (empty ? ' is-empty' : '')}
                  value={variables[n] ?? ''}
                  placeholder="empty"
                  disabled={locked}
                  aria-label={`Value for ${n}`}
                  onChange={(e) => onChange({ ...variables, [n]: e.target.value }, `var:${n}`)}
                />
              </label>
            );
          })}
        </div>
      )}

      <div className="builtins">
        {counterName && (
          <span title="Filled in by Repeat on each pass">
            <code className="var">{`{{${counterName}}}`}</code> repeat counter
          </span>
        )}
        {produced.map((n) => (
          <span key={n} title="Saved by a “Save text as variable” step">
            <code className="var">{`{{${n}}}`}</code> saved by a step
          </span>
        ))}
        <span className="builtins-list">
          Built in:
          {BUILTIN_VARIABLES.map((b) => (
            <code key={b.name} className="var" title={b.description}>
              {`{{${b.name}}}`}
            </code>
          ))}
        </span>
      </div>
    </section>
  );
}

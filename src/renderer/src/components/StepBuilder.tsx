import type { Step, StepStatus } from '@shared/types';
import { StepRow } from './StepRow';

interface Props {
  steps: Step[];
  statuses: Record<string, StepStatus>;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Step>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}

export function StepBuilder({ steps, statuses, onAdd, onUpdate, onRemove, onMove }: Props) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Steps</h2>
        <button className="ghost" onClick={onAdd}>
          + Add step
        </button>
      </div>

      {steps.length === 0 && (
        <div className="empty pad">No steps yet. Click “Add step” to begin.</div>
      )}

      <div className="steps">
        {steps.map((step, i) => (
          <StepRow
            key={step.id}
            index={i}
            total={steps.length}
            step={step}
            status={statuses[step.id]}
            onUpdate={(patch) => onUpdate(step.id, patch)}
            onRemove={() => onRemove(step.id)}
            onMove={(dir) => onMove(step.id, dir)}
          />
        ))}
      </div>
    </section>
  );
}

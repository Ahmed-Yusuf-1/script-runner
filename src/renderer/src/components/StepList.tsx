// The list of step cards: drag-and-drop reordering, the bracket that marks the
// repeated range, validation summary, and the empty state.

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { RepeatConfig, Step, StepStatus } from '@shared/types';
import type { Issue } from '@shared/validate';
import { normalizeRepeat } from '@shared/repeat';
import { StepCard } from './StepCard';
import type { StepCardProps } from './StepCard';
import { Icon } from './ui/Icon';
import { plural } from '../lib/format';

type Handlers = Pick<
  StepCardProps,
  'onPatch' | 'onSelect' | 'onToggleExpand' | 'onDuplicate' | 'onInsertBelow' | 'onDelete' | 'onMove' | 'onRunOnly' | 'onRunFrom'
>;

interface Props extends Handlers {
  steps: Step[];
  repeat?: RepeatConfig;
  statuses: Record<string, StepStatus>;
  issues: Record<string, Issue[]>;
  flowIssues: Issue[];
  selectedId: string | null;
  expanded: Set<string>;
  locked: boolean;
  currentId: string | null;
  onAdd: () => void;
  onReorder: (id: string, toIndex: number) => void;
  onLoadExample: () => void;
}

export function StepList(props: Props) {
  const { steps, statuses, issues, selectedId, expanded, locked, currentId } = props;
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);

  const repeat = props.repeat?.enabled ? normalizeRepeat(props.repeat, steps.length) : null;
  const errorCount = props.flowIssues.filter((i) => i.level === 'error').length;
  const warnCount = props.flowIssues.filter((i) => i.level === 'warning').length;
  const disabledCount = steps.filter((s) => s.disabled).length;

  const onDragOverCard = useCallback(
    (id: string, e: React.DragEvent) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
      setDrop((d) => (d?.id === id && d.pos === pos ? d : { id, pos }));
    },
    [dragId]
  );

  const onDropCard = useCallback(
    (id: string, e: React.DragEvent) => {
      e.preventDefault();
      const moving = dragId ?? e.dataTransfer.getData('text/x-step-id');
      if (moving && drop && moving !== id) {
        const from = steps.findIndex((s) => s.id === moving);
        let to = steps.findIndex((s) => s.id === id) + (drop.pos === 'after' ? 1 : 0);
        if (from < to) to -= 1;
        if (from !== to) props.onReorder(moving, to);
      }
      setDragId(null);
      setDrop(null);
    },
    [dragId, drop, steps, props]
  );

  const onDragEnd = useCallback(() => {
    setDragId(null);
    setDrop(null);
  }, []);

  const card = (step: Step, i: number) => (
    <StepCard
      key={step.id}
      step={step}
      index={i}
      total={steps.length}
      status={statuses[step.id]}
      issues={issues[step.id]}
      selected={selectedId === step.id}
      expanded={expanded.has(step.id)}
      locked={locked}
      current={currentId === step.id}
      dropHint={drop?.id === step.id && dragId !== step.id ? drop.pos : null}
      onPatch={props.onPatch}
      onSelect={props.onSelect}
      onToggleExpand={props.onToggleExpand}
      onDuplicate={props.onDuplicate}
      onInsertBelow={props.onInsertBelow}
      onDelete={props.onDelete}
      onMove={props.onMove}
      onRunOnly={props.onRunOnly}
      onRunFrom={props.onRunFrom}
      onDragStart={setDragId}
      onDragOverCard={onDragOverCard}
      onDropCard={onDropCard}
      onDragEnd={onDragEnd}
    />
  );

  let body: ReactNode;
  if (steps.length === 0) {
    body = (
      <div className="empty-steps">
        <div className="empty-icon">
          <Icon name="layers" size={26} />
        </div>
        <h3>No steps yet</h3>
        <p>
          A flow is a list of steps, like <em>go to a link</em>, <em>click “Download”</em> or <em>type into the search box</em>.
          They run top to bottom in a real browser.
        </p>
        <div className="row gap">
          <button className="btn primary" onClick={props.onAdd} disabled={locked}>
            <Icon name="plus" />
            Add the first step
          </button>
          <button className="btn" onClick={props.onLoadExample} disabled={locked}>
            Load an example
          </button>
        </div>
      </div>
    );
  } else if (repeat && repeat.times > 0) {
    const from = repeat.fromStep - 1;
    const to = repeat.toStep - 1;
    body = (
      <>
        {steps.slice(0, from).map((s, i) => card(s, i))}
        <div className="repeat-group" aria-label={`Steps ${repeat.fromStep} to ${repeat.toStep} repeat ${repeat.times} times`}>
          <div className="repeat-bracket" aria-hidden="true">
            <span>×{repeat.times}</span>
          </div>
          <div className="repeat-steps">{steps.slice(from, to + 1).map((s, i) => card(s, from + i))}</div>
        </div>
        {steps.slice(to + 1).map((s, i) => card(s, to + 1 + i))}
      </>
    );
  } else {
    body = steps.map((s, i) => card(s, i));
  }

  return (
    <section className="steps-section" aria-label="Steps">
      <div className="section-head">
        <h2>Steps</h2>
        <span className="muted small">
          {plural(steps.length, 'step')}
          {disabledCount > 0 && ` · ${disabledCount} disabled`}
        </span>
        <span className="spacer" />
        {steps.length > 0 &&
          !locked &&
          (errorCount > 0 ? (
            <span className="tag tag-error">
              <Icon name="alertCircle" size={13} />
              {plural(errorCount, 'problem')} to fix
            </span>
          ) : warnCount > 0 ? (
            <span className="tag tag-warn" title={props.flowIssues.map((i) => i.message).join('\n')}>
              <Icon name="alert" size={13} />
              {plural(warnCount, 'warning')}
            </span>
          ) : (
            <span className="tag tag-ok">
              <Icon name="check" size={13} />
              Ready to run
            </span>
          ))}
        {locked && <span className="muted small">Editing is locked while the flow runs</span>}
        {steps.length > 0 && (
          <button className="btn" onClick={props.onAdd} disabled={locked}>
            <Icon name="plus" />
            Add step
          </button>
        )}
      </div>
      {props.flowIssues.some((i) => !i.stepId && i.level === 'error') && steps.length > 0 && !locked && (
        <div className="banner error">
          <Icon name="alertCircle" size={15} />
          {props.flowIssues
            .filter((i) => !i.stepId && i.level === 'error')
            .map((i) => i.message)
            .join(' ')}
        </div>
      )}
      <div className={'steps' + (dragId ? ' dragging' : '')}>{body}</div>
      {steps.length > 0 && !locked && (
        <button className="btn add-step-bottom" onClick={props.onAdd}>
          <Icon name="plus" />
          Add a step
        </button>
      )}
    </section>
  );
}

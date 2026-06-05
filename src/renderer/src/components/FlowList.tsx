import type { Flow } from '@shared/types';

interface Props {
  flows: Flow[];
  currentId: string;
  onSelect: (flow: Flow) => void;
  onDelete: (id: string) => void;
}

export function FlowList({ flows, currentId, onSelect, onDelete }: Props) {
  return (
    <div className="flow-list">
      <div className="section-label">Saved flows</div>
      {flows.length === 0 && <div className="empty">None yet — Save one to see it here.</div>}
      {flows.map((f) => (
        <div
          key={f.id}
          className={'flow-item' + (f.id === currentId ? ' active' : '')}
          onClick={() => onSelect(f)}
        >
          <span className="flow-item-name">{f.name}</span>
          <button
            className="icon-btn"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(f.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

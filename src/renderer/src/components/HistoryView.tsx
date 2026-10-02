// Run history: every finished run with its result, and the details of the one
// you pick (steps, files, log), with Re-run, open files and delete.

import { useEffect, useMemo, useState } from 'react';
import type { RunRecord, RunStatus, RunSummary, StepResult } from '@shared/types';
import { ACTION_META } from '@shared/actions';
import { Icon } from './ui/Icon';
import { useDialogs, useToast } from './ui/Dialogs';
import { bytes, clock, duration, plural, when } from '../lib/format';

interface Props {
  runs: RunSummary[];
  flowExists: (flowId: string) => boolean;
  onRefresh: () => Promise<void>;
  onRunAgain: (record: RunRecord) => void;
  busy: boolean;
}

const STATUS: Record<RunStatus, { label: string; icon: string; cls: string }> = {
  ok: { label: 'Succeeded', icon: 'check', cls: 'ok' },
  warn: { label: 'Finished with problems', icon: 'alert', cls: 'warn' },
  error: { label: 'Failed', icon: 'x', cls: 'error' },
  stopped: { label: 'Stopped', icon: 'stop', cls: 'muted' },
};

function resultText(r: RunSummary): string {
  if (r.status === 'error') return r.error ?? 'Failed';
  if (r.status === 'stopped') return 'Stopped by you';
  const files = r.downloads.length;
  const shots = r.screenshots.length;
  const rows = r.dataFiles?.length ?? 0;
  const parts = [
    files ? plural(files, 'file') + ' saved' : '',
    rows ? plural(rows, 'data file') : '',
    shots ? plural(shots, 'screenshot') : '',
  ].filter(Boolean);
  const base = parts.join(', ') || 'Completed';
  return r.status === 'warn' ? `${base}; ${plural(r.failures, 'step')} failed and continued` : base;
}

export function HistoryView({ runs, flowExists, onRefresh, onRunAgain, busy }: Props) {
  const dialogs = useDialogs();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | RunStatus>('all');
  const [selected, setSelected] = useState<string | null>(runs[0]?.id ?? null);
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [showLog, setShowLog] = useState(false);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return runs.filter((r) => (status === 'all' || r.status === status) && (!q || r.flowName.toLowerCase().includes(q)));
  }, [runs, query, status]);

  useEffect(() => {
    if (!selected && list[0]) setSelected(list[0].id);
  }, [list, selected]);

  useEffect(() => {
    let live = true;
    setRecord(null);
    setShowLog(false);
    if (selected) void window.api.getRun(selected).then((r) => live && setRecord(r));
    return () => {
      live = false;
    };
  }, [selected]);

  const fail = (err: unknown) => toast.error(err instanceof Error ? err.message : String(err));

  const clearAll = async () => {
    const ok = await dialogs.confirm({
      title: 'Clear run history?',
      message: 'This removes the record of every run. Downloaded files and screenshots are kept.',
      confirmLabel: 'Clear history',
      danger: true,
    });
    if (!ok) return;
    await window.api.clearRuns().catch(fail);
    setSelected(null);
    await onRefresh();
  };

  const remove = async (id: string) => {
    await window.api.deleteRun(id).catch(fail);
    setSelected(null);
    await onRefresh();
  };

  return (
    <div className="history">
      <header className="topbar">
        <div className="crumbs">
          <h1 className="page-title">Run history</h1>
          <span className="muted small">{runs.length ? `${plural(runs.length, 'run')} · the last 200 are kept` : ''}</span>
        </div>
        <div className="topbar-actions">
          <label className="search">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Filter by flow" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter by flow" />
          </label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Filter by result">
            <option value="all">All results</option>
            <option value="ok">Succeeded</option>
            <option value="warn">With problems</option>
            <option value="error">Failed</option>
            <option value="stopped">Stopped</option>
          </select>
          <button className="btn danger-text" onClick={clearAll} disabled={!runs.length}>
            <Icon name="trash" />
            Clear history
          </button>
        </div>
      </header>

      {runs.length === 0 ? (
        <div className="empty-page">
          <div className="empty-icon">
            <Icon name="history" size={26} />
          </div>
          <h3>No runs yet</h3>
          <p>Each time you run a flow, the result, the files it saved and its log are kept here.</p>
        </div>
      ) : (
        <div className="history-body">
          <div className="history-table" role="table" aria-label="Runs">
            <div className="history-row head" role="row">
              <span role="columnheader" aria-label="Result" />
              <span role="columnheader">Flow</span>
              <span role="columnheader">Started</span>
              <span role="columnheader">Took</span>
              <span role="columnheader">Result</span>
            </div>
            {list.length === 0 && <div className="empty-list pad">No runs match the filter.</div>}
            {list.map((r) => {
              const s = STATUS[r.status];
              return (
                <button
                  key={r.id}
                  role="row"
                  className={'history-row' + (selected === r.id ? ' on' : '')}
                  onClick={() => setSelected(r.id)}
                  aria-selected={selected === r.id}
                >
                  <span role="cell" className={'status-chip ' + s.cls} title={s.label}>
                    <Icon name={s.icon} size={13} />
                  </span>
                  <span role="cell" className="ellipsis strong">
                    {r.flowName}
                  </span>
                  <span role="cell" className="muted">
                    {when(r.startedAt)}
                  </span>
                  <span role="cell" className="muted mono small">
                    {duration(r.endedAt - r.startedAt)}
                  </span>
                  <span role="cell" className="muted ellipsis" title={resultText(r)}>
                    {resultText(r)}
                  </span>
                </button>
              );
            })}
          </div>

          <aside className="history-detail" aria-label="Run details">
            {!record ? (
              <div className="empty-list pad">{selected ? 'Loading…' : 'Pick a run to see its details.'}</div>
            ) : (
              <RunDetail
                record={record}
                showLog={showLog}
                onToggleLog={() => setShowLog((v) => !v)}
                canRerun={flowExists(record.flowId) && !busy}
                onRunAgain={() => onRunAgain(record)}
                onDelete={() => remove(record.id)}
                onError={fail}
              />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function RunDetail({
  record,
  showLog,
  onToggleLog,
  canRerun,
  onRunAgain,
  onDelete,
  onError,
}: {
  record: RunRecord;
  showLog: boolean;
  onToggleLog: () => void;
  canRerun: boolean;
  onRunAgain: () => void;
  onDelete: () => void;
  onError: (e: unknown) => void;
}) {
  const s = STATUS[record.status];
  const failures = record.steps.reduce((n, x) => n + x.failures, 0);
  const stepRuns = record.steps.reduce((n, x) => n + x.runs, 0);
  const files = [...record.downloads, ...(record.dataFiles ?? []), ...record.screenshots];
  const vars = Object.entries(record.vars ?? {});

  return (
    <div className="run-detail">
      <div className="run-detail-head">
        <span className={'tag tag-' + (s.cls === 'muted' ? 'plain' : s.cls)}>
          <Icon name={s.icon} size={12} />
          {s.label}
        </span>
        <h2>{record.flowName}</h2>
        <p className="muted small">
          {new Date(record.startedAt).toLocaleString()} to {clock(record.endedAt)}
          {record.presetName ? ` · preset ${record.presetName}` : ''}
        </p>
        {vars.length > 0 && (
          <p className="muted small">
            Inputs:{' '}
            {vars.map(([k, v], i) => (
              <span key={k}>
                {i > 0 && ', '}
                <code className="var">{k}</code> = {v || <em>empty</em>}
              </span>
            ))}
          </p>
        )}
        {record.error && (
          <div className="banner error">
            <Icon name="alertCircle" size={15} />
            {record.error}
          </div>
        )}
      </div>

      <div className="stats">
        <div className="stat">
          <span className="field-label">Took</span>
          <span className="stat-value">{duration(record.endedAt - record.startedAt)}</span>
        </div>
        <div className="stat">
          <span className="field-label">Steps run</span>
          <span className="stat-value">{stepRuns}</span>
        </div>
        <div className="stat">
          <span className="field-label">Files</span>
          <span className="stat-value">{record.downloads.length}</span>
        </div>
        <div className="stat">
          <span className="field-label">Errors</span>
          <span className={'stat-value' + (failures ? ' error-text' : '')}>{failures}</span>
        </div>
      </div>

      <div className="detail-section">
        <div className="field-label">Steps</div>
        {record.steps.map((st) => (
          <StepLine key={st.id} st={st} />
        ))}
      </div>

      {files.length > 0 && (
        <div className="detail-section">
          <div className="field-label">Files saved</div>
          {files.slice(0, 50).map((f) => (
            <div key={f.path} className="file-row compact">
              <Icon name={record.screenshots.includes(f) ? 'image' : (record.dataFiles ?? []).includes(f) ? 'table' : 'file'} size={14} />
              <button className="link-btn file-name" title={f.path} onClick={() => window.api.openFile(f.path).catch(onError)}>
                {f.filename}
              </button>
              <span className="muted small">{bytes(f.bytes)}</span>
              <button className="btn icon ghost sm" aria-label={`Show ${f.filename} in folder`} onClick={() => window.api.showInFolder(f.path).catch(onError)}>
                <Icon name="folder" size={14} />
              </button>
            </div>
          ))}
          {files.length > 50 && <div className="muted small">and {files.length - 50} more</div>}
        </div>
      )}

      {showLog && (
        <div className="detail-section">
          <div className="field-label">Log{record.logTruncated ? ' (older lines were trimmed)' : ''}</div>
          <div className="console-log inline">
            {record.log.map((l, i) => (
              <div key={i} className={'log-line lvl-' + l.level}>
                <span className="log-time">{clock(l.ts)}</span>
                <span className="log-msg">{l.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="detail-actions">
        <button className="btn" onClick={() => window.api.openDownloads().catch(onError)}>
          <Icon name="folder" />
          Open folder
        </button>
        <button className="btn" onClick={onToggleLog}>
          <Icon name="terminal" />
          {showLog ? 'Hide log' : 'View log'}
        </button>
        <button className="btn icon ghost" onClick={onDelete} aria-label="Delete this run from history" title="Delete from history">
          <Icon name="trash" />
        </button>
        <span className="spacer" />
        <button
          className="btn primary"
          onClick={onRunAgain}
          disabled={!canRerun}
          title={canRerun ? 'Run this flow again with the same inputs' : 'The flow no longer exists, or a run is in progress'}
        >
          <Icon name="play" />
          Run again
        </button>
      </div>
    </div>
  );
}

function StepLine({ st }: { st: StepResult }) {
  const label = ACTION_META[st.action]?.label ?? st.action;
  const icon = st.state === 'ok' ? 'check' : st.state === 'error' ? 'x' : 'moreH';
  return (
    <div className={'step-line state-' + st.state} title={st.message}>
      <span className="step-num sm">{st.index + 1}</span>
      <span className="grow ellipsis">
        {label}
        {st.runs > 1 && <span className="muted"> ×{st.runs}</span>}
        {st.failures > 0 && <span className="error-text"> · {plural(st.failures, 'failure')}</span>}
      </span>
      <span className="muted mono small">{st.runs ? duration(st.totalMs) : '–'}</span>
      <Icon name={icon} size={14} className={'state-icon ' + st.state} />
    </div>
  );
}

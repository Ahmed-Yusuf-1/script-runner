// The run console docked under the editor: a live, level-coloured log with
// timestamps and filters, and the files the last run saved. Resizable and
// collapsible; its size is remembered.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LogEntry, LogLevel, RunResult, RunProgress, SavedFile } from '@shared/types';
import { Icon } from './ui/Icon';
import { useToast } from './ui/Dialogs';
import { bytes, clock, duration, plural, stopwatch } from '../lib/format';

type Filter = 'all' | 'normal' | 'problems' | 'errors';
const FILTERS: Record<Filter, { label: string; test: (l: LogLevel) => boolean }> = {
  all: { label: 'All messages', test: () => true },
  normal: { label: 'Hide details', test: (l) => l !== 'debug' },
  problems: { label: 'Warnings and errors', test: (l) => l === 'warn' || l === 'error' },
  errors: { label: 'Errors only', test: (l) => l === 'error' },
};

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, v: string) {
    try {
      localStorage.setItem(key, v);
    } catch {
      /* storage unavailable */
    }
  },
};

interface Props {
  logs: LogEntry[];
  running: boolean;
  paused: boolean;
  progress: RunProgress | null;
  lastResult: RunResult | null;
  onClear: () => void;
  flowName: string;
}

export function Console({ logs, running, paused, progress, lastResult, onClear, flowName }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<'log' | 'files'>('log');
  const [filter, setFilter] = useState<Filter>(() => (store.get('console.filter') as Filter) || 'normal');
  const [height, setHeight] = useState(() => Number(store.get('console.height')) || 240);
  const [collapsed, setCollapsed] = useState(() => store.get('console.collapsed') === '1');
  const [stick, setStick] = useState(true);
  const [now, setNow] = useState(Date.now());
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => store.set('console.filter', filter), [filter]);
  useEffect(() => store.set('console.height', String(height)), [height]);
  useEffect(() => store.set('console.collapsed', collapsed ? '1' : '0'), [collapsed]);

  // Tick the stopwatch while running.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [running]);

  // Open the console when a run starts.
  useEffect(() => {
    if (running) {
      setCollapsed(false);
      setTab('log');
      setStick(true);
    }
  }, [running]);

  const shown = useMemo(() => logs.filter((l) => FILTERS[filter].test(l.level)), [logs, filter]);
  const hiddenCount = logs.length - shown.length;

  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  }, [shown, stick, tab, collapsed]);

  const record = lastResult?.record;
  const files: (SavedFile & { kind: 'download' | 'screenshot' | 'data' })[] = [
    ...(record?.downloads ?? []).map((f) => ({ ...f, kind: 'download' as const })),
    ...(record?.dataFiles ?? []).map((f) => ({ ...f, kind: 'data' as const })),
    ...(record?.screenshots ?? []).map((f) => ({ ...f, kind: 'screenshot' as const })),
  ];

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const max = Math.max(160, window.innerHeight - 260);
    const move = (ev: PointerEvent) => setHeight(Math.min(max, Math.max(120, startH + (startY - ev.clientY))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const asText = () =>
    logs.map((l) => `${clock(l.ts)}  ${l.level.toUpperCase().padEnd(7)} ${l.msg}`).join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      toast.success('Log copied');
    } catch {
      toast.error('Couldn’t copy to the clipboard');
    }
  };

  const save = async () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const name = `${flowName.replace(/[^\w\- ]+/g, '').trim() || 'run'} ${stamp}.log`;
    try {
      if (await window.api.saveTextFile(name, asText())) toast.success('Log saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const openDownloads = () =>
    window.api.openDownloads().catch((err) => toast.error(err instanceof Error ? err.message : String(err)));

  let pill: JSX.Element | null = null;
  if (running && progress) {
    pill = paused ? (
      <span className="tag tag-warn">
        <Icon name="pause" size={12} />
        Paused · {stopwatch(now - progress.startedAt)}
      </span>
    ) : (
      <span className="tag tag-accent">
        <span className="live-dot" />
        Running · {stopwatch(now - progress.startedAt)}
      </span>
    );
  } else if (running) {
    pill = (
      <span className="tag tag-accent">
        <span className="live-dot" />
        Starting…
      </span>
    );
  } else if (record) {
    const took = duration(record.endedAt - record.startedAt);
    pill =
      record.status === 'ok' ? (
        <span className="tag tag-ok">
          <Icon name="check" size={12} />
          Finished in {took}
        </span>
      ) : record.status === 'warn' ? (
        <span className="tag tag-warn">
          <Icon name="alert" size={12} />
          Finished with problems · {took}
        </span>
      ) : record.status === 'stopped' ? (
        <span className="tag">
          <Icon name="stop" size={12} />
          Stopped after {took}
        </span>
      ) : (
        <span className="tag tag-error">
          <Icon name="x" size={12} />
          Failed after {took}
        </span>
      );
  } else if (lastResult && !lastResult.ok) {
    pill = (
      <span className="tag tag-error">
        <Icon name="x" size={12} />
        Couldn’t run
      </span>
    );
  }

  return (
    <section className={'console' + (collapsed ? ' collapsed' : '')} style={collapsed ? undefined : { height }} aria-label="Run console">
      {!collapsed && <div className="console-resize" onPointerDown={startResize} aria-hidden="true" />}
      <div className="console-head">
        <button
          className="btn ghost console-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Show console' : 'Hide console'}
        >
          <Icon name={collapsed ? 'chevronUp' : 'chevronDown'} />
          <Icon name="terminal" />
          <span>Console</span>
        </button>
        {pill}
        {!collapsed && (
          <div className="segmented" role="tablist" aria-label="Console view">
            <button role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>
              Log
            </button>
            <button role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>
              Files
              <span className="count">{running && progress ? progress.downloadsSaved : files.length}</span>
            </button>
          </div>
        )}
        <span className="spacer" />
        {!collapsed && tab === 'log' && (
          <>
            <select className="input sm" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Which messages to show">
              {(Object.keys(FILTERS) as Filter[]).map((f) => (
                <option key={f} value={f}>
                  {FILTERS[f].label}
                </option>
              ))}
            </select>
            <button className="btn icon ghost" onClick={copy} disabled={!logs.length} aria-label="Copy log" title="Copy log">
              <Icon name="copy" />
            </button>
            <button className="btn icon ghost" onClick={save} disabled={!logs.length} aria-label="Save log to a file" title="Save log to a file">
              <Icon name="download" />
            </button>
            <button className="btn icon ghost" onClick={onClear} disabled={!logs.length || running} aria-label="Clear log" title="Clear log">
              <Icon name="trash" />
            </button>
          </>
        )}
        <button className="btn sm" onClick={openDownloads}>
          <Icon name="folder" />
          Open downloads
        </button>
      </div>

      {!collapsed && tab === 'log' && (
        <div
          className="console-log"
          ref={logRef}
          role="log"
          aria-live="off"
          onScroll={(e) => {
            const el = e.currentTarget;
            setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
          }}
        >
          {shown.length === 0 ? (
            <div className="console-empty">
              {logs.length ? `All ${plural(hiddenCount, 'message')} are hidden by the filter.` : 'Run the flow to see what it does here, step by step.'}
            </div>
          ) : (
            shown.map((l, i) => (
              <div key={i} className={'log-line lvl-' + l.level}>
                <span className="log-time">{clock(l.ts)}</span>
                <span className="log-msg">{l.msg}</span>
              </div>
            ))
          )}
          {!stick && shown.length > 0 && (
            <button
              className="btn sm jump-latest"
              onClick={() => {
                setStick(true);
              }}
            >
              <Icon name="arrowDown" size={14} />
              Latest
            </button>
          )}
        </div>
      )}

      {!collapsed && tab === 'files' && (
        <div className="console-files">
          {running ? (
            <div className="console-empty">
              {progress ? `${plural(progress.downloadsSaved, 'file')} saved so far. The list appears when the run ends.` : 'Starting…'}
            </div>
          ) : files.length === 0 ? (
            <div className="console-empty">Files the run downloads or screenshots it takes appear here.</div>
          ) : (
            files.map((f) => (
              <div key={f.path} className="file-row">
                <Icon name={f.kind === 'screenshot' ? 'image' : f.kind === 'data' ? 'table' : 'file'} />
                <span className="file-name" title={f.path}>
                  {f.filename}
                </span>
                <span className="muted small">{bytes(f.bytes)}</span>
                <button className="btn sm ghost" onClick={() => window.api.openFile(f.path).catch((e) => toast.error(String(e.message ?? e)))}>
                  Open
                </button>
                <button
                  className="btn sm ghost"
                  onClick={() => window.api.showInFolder(f.path).catch((e) => toast.error(String(e.message ?? e)))}
                >
                  Show in folder
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

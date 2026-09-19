import { useEffect, useState } from 'react';
import type { RunProgress } from '@shared/types';
import { Icon } from './ui/Icon';
import { Menu } from './ui/Menu';
import { comboLabel } from '../hooks/useShortcuts';
import { stopwatch } from '../lib/format';

interface Props {
  presetName: string;
  name: string;
  onName: (name: string) => void;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  running: boolean;
  /** A run of another flow is going (this one can't run until it ends). */
  busyElsewhere: boolean;
  paused: boolean;
  progress: RunProgress | null;
  selectedIndex: number | null;
  onRun: () => void;
  onRunFrom: (index: number) => void;
  onRunOnly: (index: number) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function Topbar(p: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!p.running) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [p.running]);

  const pr = p.progress;
  const pct =
    pr && pr.stepCount > 0 && pr.stepIndex >= 0
      ? pr.passes && pr.pass
        ? Math.min(99, ((pr.pass - 1) / pr.passes) * 100 + (1 / pr.passes) * 100 * 0.5)
        : Math.min(99, (pr.stepIndex / pr.stepCount) * 100)
      : 2;

  return (
    <header className="topbar">
      <div className="crumbs">
        <span className="crumb-preset">{p.presetName}</span>
        <Icon name="chevronRight" size={14} className="muted-icon" />
        <input
          className="flow-name"
          value={p.name}
          onChange={(e) => p.onName(e.target.value)}
          placeholder="Name this flow"
          aria-label="Flow name"
          spellCheck={false}
          maxLength={120}
        />
        {p.dirty && !p.running && (
          <span className="tag tag-warn">
            <span className="dot dot-warn" />
            Unsaved
          </span>
        )}
        {p.running && (
          <span className={'tag ' + (p.paused ? 'tag-warn' : 'tag-accent')}>
            <span className={'dot ' + (p.paused ? 'dot-warn' : 'dot-accent pulse')} />
            {p.paused ? 'Paused' : 'Running'}
          </span>
        )}
      </div>

      {p.running ? (
        <div className="run-controls">
          {pr && (
            <div className="run-stats" aria-live="polite">
              {pr.pass && pr.passes ? (
                <span>
                  Pass <b>{pr.pass}</b> of {pr.passes}
                </span>
              ) : null}
              {pr.stepIndex >= 0 && (
                <span>
                  Step <b>{pr.stepIndex + 1}</b> of {pr.stepCount}
                </span>
              )}
              {pr.downloadsStarted > 0 && (
                <span className="with-icon">
                  <Icon name="download" size={14} />
                  {pr.downloadsSaved} saved
                  {pr.downloadsStarted > pr.downloadsSaved ? `, ${pr.downloadsStarted - pr.downloadsSaved} saving` : ''}
                </span>
              )}
              <span className="mono strong">{stopwatch(now - pr.startedAt)}</span>
            </div>
          )}
          {p.paused ? (
            <button className="btn" onClick={p.onResume}>
              <Icon name="play" />
              Resume
            </button>
          ) : (
            <button className="btn" onClick={p.onPause} title="Pause after the current step">
              <Icon name="pause" />
              Pause
            </button>
          )}
          <button className="btn danger" onClick={p.onStop}>
            <Icon name="stop" />
            Stop
            <kbd className="kbd">{comboLabel('mod+.')}</kbd>
          </button>
        </div>
      ) : (
        <div className="topbar-actions">
          <button className="btn icon ghost" onClick={p.onUndo} disabled={!p.canUndo} aria-label="Undo" title={`Undo (${comboLabel('mod+z')})`}>
            <Icon name="undo" />
          </button>
          <button
            className="btn icon ghost"
            onClick={p.onRedo}
            disabled={!p.canRedo}
            aria-label="Redo"
            title={`Redo (${comboLabel('mod+shift+z')})`}
          >
            <Icon name="redo" />
          </button>
          <span className="divider" />
          <button className="btn" onClick={p.onSave} disabled={!p.dirty}>
            <Icon name="save" />
            Save
            <kbd className="kbd">{comboLabel('mod+s')}</kbd>
          </button>
          <div className="split">
            <button className="btn primary" onClick={p.onRun} disabled={p.busyElsewhere} title={p.busyElsewhere ? 'Another flow is running' : undefined}>
              <Icon name="play" />
              Run
              <kbd className="kbd on-accent">{comboLabel('mod+enter')}</kbd>
            </button>
            <Menu
              width={250}
              items={[
                { label: 'Run whole flow', icon: 'play', onSelect: p.onRun },
                {
                  label: p.selectedIndex != null ? `Run from step ${p.selectedIndex + 1}` : 'Run from selected step',
                  icon: 'skipTo',
                  onSelect: () => p.selectedIndex != null && p.onRunFrom(p.selectedIndex),
                  disabled: p.selectedIndex == null,
                },
                {
                  label: p.selectedIndex != null ? `Run only step ${p.selectedIndex + 1}` : 'Run only selected step',
                  icon: 'pointer',
                  onSelect: () => p.selectedIndex != null && p.onRunOnly(p.selectedIndex),
                  disabled: p.selectedIndex == null,
                },
              ]}
              trigger={(t) => (
                <button {...t} className="btn primary split-caret" aria-label="More ways to run" disabled={p.busyElsewhere}>
                  <Icon name="chevronDown" />
                </button>
              )}
            />
          </div>
        </div>
      )}
      {p.running && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className={'progress-bar' + (p.paused ? ' paused' : '')} style={{ width: `${pct}%` }} />
        </div>
      )}
    </header>
  );
}

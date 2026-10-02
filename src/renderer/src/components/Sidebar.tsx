import { forwardRef, useMemo, useState } from 'react';
import type { Flow, RunSummary, RunStatus } from '@shared/types';
import type { PresetInfo } from '@shared/api';
import { Icon, Logo } from './ui/Icon';
import { Menu } from './ui/Menu';
import { comboLabel } from '../hooks/useShortcuts';
import { plural, relative } from '../lib/format';

export type View = 'editor' | 'history';

interface Props {
  version: string;
  flows: Flow[];
  currentId: string;
  /** The open flow has unsaved changes. */
  dirty: boolean;
  /** The open flow isn't saved at all yet. */
  unsavedNew: boolean;
  currentName: string;
  runs: RunSummary[];
  runningFlowId: string | null;
  view: View;
  presets: PresetInfo[];
  activePresetId: string | null;
  onNew: () => void;
  onImport: () => void;
  onSelectFlow: (flow: Flow) => void;
  onDuplicateFlow: (flow: Flow) => void;
  onExportFlow: (flow: Flow) => void;
  onDeleteFlow: (flow: Flow) => void;
  onView: (view: View) => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onSelectPreset: (id: string | null) => void;
  onCreatePreset: () => void;
  onRenamePreset: () => void;
  onImportPreset: () => void;
  onExportPreset: () => void;
  onDeletePreset: () => void;
}

const STATUS_DOT: Record<RunStatus, string> = { ok: 'dot-ok', warn: 'dot-warn', error: 'dot-error', stopped: 'dot-muted' };
const STATUS_WORD: Record<RunStatus, string> = { ok: 'ran', warn: 'had problems', error: 'failed', stopped: 'stopped' };

export const Sidebar = forwardRef<HTMLInputElement, Props>(function Sidebar(p, searchRef) {
  const [query, setQuery] = useState('');
  const lastRun = useMemo(() => {
    const m = new Map<string, RunSummary>();
    for (const r of p.runs) if (!m.has(r.flowId)) m.set(r.flowId, r); // runs are newest first
    return m;
  }, [p.runs]);

  const q = query.trim().toLowerCase();
  const list = q ? p.flows.filter((f) => f.name.toLowerCase().includes(q)) : p.flows;
  const presetName = p.presets.find((x) => x.id === p.activePresetId)?.name ?? 'Default profile';

  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo />
        <div className="brand-text">
          <span className="brand-name">Script Runner</span>
          {p.version && <span className="brand-version">v{p.version}</span>}
        </div>
      </div>

      <Menu
        align="start"
        width={236}
        items={[
          { heading: 'Switch preset' },
          { label: 'Default profile', checked: p.activePresetId === null, onSelect: () => p.onSelectPreset(null) },
          ...p.presets.map((x) => ({ label: x.name, checked: x.id === p.activePresetId, onSelect: () => p.onSelectPreset(x.id) })),
          { separator: true },
          { label: 'New preset from current…', icon: 'plus', onSelect: p.onCreatePreset },
          ...(p.activePresetId ? [{ label: 'Rename preset…', icon: 'pencil', onSelect: p.onRenamePreset }] : []),
          { label: 'Import preset…', icon: 'upload', onSelect: p.onImportPreset },
          { label: 'Export this preset…', icon: 'download', onSelect: p.onExportPreset },
          ...(p.activePresetId ? [{ separator: true } as const, { label: 'Delete preset…', icon: 'trash', danger: true, onSelect: p.onDeletePreset }] : []),
        ]}
        trigger={(t) => (
          <button {...t} className="preset-switcher" title="Presets bundle their own flows and settings">
            <span className="preset-badge">{presetName.charAt(0).toUpperCase()}</span>
            <span className="preset-text">
              <span className="preset-label">Preset</span>
              <span className="preset-name">{presetName}</span>
            </span>
            <Icon name="chevronDown" className="muted-icon" />
          </button>
        )}
      />

      <div className="row gap-sm">
        <button className="btn primary grow" onClick={p.onNew}>
          <Icon name="plus" />
          New flow
          <kbd className="kbd on-accent">{comboLabel('mod+n')}</kbd>
        </button>
        <button className="btn icon" onClick={p.onImport} aria-label="Import flows from a file" title="Import flows from a file">
          <Icon name="upload" />
        </button>
      </div>

      <label className="search">
        <Icon name="search" size={15} />
        <input
          ref={searchRef}
          className="input"
          placeholder="Search flows"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          aria-label="Search flows"
        />
      </label>

      <div className="section-label">
        <span>Flows</span>
        <span>{p.flows.length}</span>
      </div>

      <nav className="flow-list" aria-label="Saved flows">
        {p.unsavedNew && (
          <div className="flow-item active" aria-current="true">
            <span className="flow-item-name">
              {p.currentName || 'Untitled flow'}
              <span className="dirty-dot" title="Not saved yet" />
            </span>
            <span className="flow-item-meta">not saved yet</span>
          </div>
        )}
        {list.length === 0 && !p.unsavedNew && (
          <div className="empty-list">{q ? `No flow matches “${query}”.` : 'Saved flows show up here.'}</div>
        )}
        {list.map((f) => {
          const active = f.id === p.currentId;
          const run = lastRun.get(f.id);
          const running = p.runningFlowId === f.id;
          return (
            <div key={f.id} className={'flow-item' + (active ? ' active' : '')}>
              <button className="flow-item-main" onClick={() => p.onSelectFlow(f)} aria-current={active ? 'true' : undefined}>
                <span className="flow-item-name">
                  {active ? p.currentName || 'Untitled flow' : f.name}
                  {active && p.dirty && <span className="dirty-dot" title="Unsaved changes" />}
                </span>
                <span className="flow-item-meta">
                  <span className={'dot ' + (running ? 'dot-accent pulse' : run ? STATUS_DOT[run.status] : 'dot-muted')} />
                  {plural(f.steps.length, 'step')} ·{' '}
                  {running ? 'running now' : run ? `${STATUS_WORD[run.status]} ${relative(run.startedAt)}` : 'never run'}
                </span>
              </button>
              <Menu
                items={[
                  { label: 'Duplicate', icon: 'copy', onSelect: () => p.onDuplicateFlow(f) },
                  { label: 'Export to file…', icon: 'download', onSelect: () => p.onExportFlow(f) },
                  { separator: true },
                  { label: 'Delete…', icon: 'trash', danger: true, onSelect: () => p.onDeleteFlow(f) },
                ]}
                trigger={(t) => (
                  <button {...t} className="btn icon ghost sm flow-item-more" aria-label={`More actions for ${f.name}`}>
                    <Icon name="moreH" />
                  </button>
                )}
              />
            </div>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <button className={'nav-item' + (p.view === 'editor' ? ' on' : '')} onClick={() => p.onView('editor')}>
          <Icon name="layers" />
          Editor
        </button>
        <button className={'nav-item' + (p.view === 'history' ? ' on' : '')} onClick={() => p.onView('history')}>
          <Icon name="history" />
          Run history
          {p.runs.length > 0 && <span className="tag sm">{p.runs.length}</span>}
        </button>
        <button className="nav-item" onClick={p.onSettings}>
          <Icon name="sliders" />
          Settings
          <kbd className="kbd">{comboLabel('mod+,')}</kbd>
        </button>
        <button className="nav-item" onClick={p.onShortcuts}>
          <Icon name="keyboard" />
          Shortcuts
          <kbd className="kbd">?</kbd>
        </button>
      </div>
    </aside>
  );
});

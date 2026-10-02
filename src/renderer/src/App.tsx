// App shell: owns the saved flows, the flow being edited (with undo/redo and
// unsaved-changes tracking), presets, settings, run history and the live run,
// and wires them to the sidebar, editor, console and dialogs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Flow, RunOptions, RunRecord, RunSummary, Settings, Step, Theme } from '@shared/types';
import type { PresetInfo } from '@shared/api';
import { validateFlow, issuesByStep } from '@shared/validate';
import { normalizeFlow } from '@shared/normalize';
import { Sidebar } from './components/Sidebar';
import type { View } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { StepList } from './components/StepList';
import { RepeatPanel } from './components/RepeatPanel';
import { InputsPanel } from './components/InputsPanel';
import { Console } from './components/Console';
import { HistoryView } from './components/HistoryView';
import { SettingsDialog } from './components/SettingsDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import type { StepPatch } from './components/StepFields';
import { useDialogs, useToast } from './components/ui/Dialogs';
import { useUndoable } from './hooks/useUndoable';
import { useShortcuts } from './hooks/useShortcuts';
import { useRun } from './hooks/useRun';
import { copyFlow, copyStep, demoFlow, insertStep, moveStep, newFlow, newStep, removeStepAt, snapshot } from './lib/flow';
import { Icon } from './components/ui/Icon';
import { clearDraft, loadDraft, saveDraft } from './lib/draft';
import { plural } from './lib/format';

const LAST_FLOW_KEY = 'lastFlowId';
const remember = (id: string) => {
  try {
    localStorage.setItem(LAST_FLOW_KEY, id);
  } catch {
    /* storage unavailable */
  }
};
const recall = (): string | null => {
  try {
    return localStorage.getItem(LAST_FLOW_KEY);
  } catch {
    return null;
  }
};

/** Snapshot of the normalized flow, so cosmetic differences don't count as edits. */
const norm = (f: Flow) => snapshot(normalizeFlow(f) ?? f);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const byNewest = (a: Flow, b: Flow) => b.updatedAt - a.updatedAt;

function resolveTheme(t: Theme): 'dark' | 'light' {
  if (t !== 'system') return t;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function App() {
  const dialogs = useDialogs();
  const toast = useToast();
  const run = useRun();

  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);

  const ed = useUndoable<Flow>(newFlow);
  const flow = ed.value;
  // These are stable across renders, so step cards can skip re-rendering when
  // an unrelated field changes (it matters once a flow has many steps).
  const { set: editFlow, reset: resetFlow, undo: undoEdit, redo: redoEdit } = ed;
  const [savedSnap, setSavedSnap] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [scrollTo, setScrollTo] = useState<string | null>(null);

  const [view, setView] = useState<View>('editor');
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [themePreview, setThemePreview] = useState<Theme | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const clipboard = useRef<Step | null>(null);

  // ---- Derived state ----
  const currentSnap = useMemo(() => norm(flow), [flow]);
  const blankSnap = useMemo(() => norm({ ...newFlow(), id: flow.id }), [flow.id]);
  const dirty = savedSnap === null ? currentSnap !== blankSnap : currentSnap !== savedSnap;
  const isSaved = savedSnap !== null;
  const issues = useMemo(() => validateFlow(flow), [flow]);
  const stepIssues = useMemo(() => issuesByStep(issues), [issues]);
  const runningHere = run.running && run.flowId === flow.id;
  const busyElsewhere = run.running && run.flowId !== flow.id;
  const statuses = run.flowId === flow.id ? run.statuses : {};
  const currentStepId =
    runningHere && run.progress && run.progress.stepIndex >= 0 ? flow.steps[run.progress.stepIndex]?.id ?? null : null;
  const selectedIndex = selectedId ? flow.steps.findIndex((s) => s.id === selectedId) : -1;
  const presetName = presets.find((p) => p.id === activePresetId)?.name ?? 'Default profile';

  // ---- Theme ----
  const theme = themePreview ?? settings?.theme ?? 'system';
  useEffect(() => {
    const apply = () => (document.documentElement.dataset.theme = resolveTheme(theme));
    apply();
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  // ---- Loading ----
  const refreshRuns = useCallback(async () => {
    setRuns(await window.api.listRuns().catch(() => []));
  }, []);

  const openFlowNow = useCallback(
    (f: Flow | null) => {
      const next = f ? structuredClone(f) : newFlow();
      resetFlow(next);
      setSavedSnap(f ? norm(f) : null);
      setSelectedId(null);
      setExpanded(new Set());
      if (f) remember(f.id);
    },
    [resetFlow]
  );

  const loadProfile = useCallback(
    async (preferId?: string | null) => {
      const [s, list, pl, active] = await Promise.all([
        window.api.getSettings(),
        window.api.listFlows(),
        window.api.listPresets(),
        window.api.getActivePresetId(),
      ]);
      setSettings(s);
      setFlows(list);
      setPresets(pl);
      setActivePresetId(active);
      openFlowNow(list.find((f) => f.id === preferId) ?? list[0] ?? null);
    },
    [openFlowNow]
  );

  useEffect(() => {
    void (async () => {
      try {
        const [info] = await Promise.all([window.api.appInfo(), loadProfile(recall()), refreshRuns()]);
        setVersion(info.version);
        // Unsaved work from a crash or a forced quit is offered back.
        const draft = loadDraft();
        if (draft) {
          const restore = await dialogs.confirm({
            title: `Restore unsaved changes to “${draft.flow.name}”?`,
            message: 'Script Runner closed before these changes were saved.',
            confirmLabel: 'Restore',
            cancelLabel: 'Discard',
          });
          if (restore) {
            resetFlow(draft.flow);
            setSavedSnap(draft.savedSnap);
            setView('editor');
            toast.info('Restored your unsaved changes. Save them to keep them.');
          } else {
            clearDraft();
          }
        }
      } catch (err) {
        toast.error('Couldn’t load your data: ' + errMsg(err));
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a copy of unsaved work, so a crash or a power cut can't lose it.
  useEffect(() => {
    if (!loaded) return;
    if (!dirty) {
      clearDraft();
      return;
    }
    const t = window.setTimeout(() => saveDraft({ flow, savedSnap, at: Date.now() }), 800);
    return () => window.clearTimeout(t);
  }, [flow, dirty, savedSnap, loaded]);

  // Warn before closing the window with unsaved changes (the main process asks).
  useEffect(() => {
    window.onbeforeunload = dirty ? () => false : null;
    return () => {
      window.onbeforeunload = null;
    };
  }, [dirty]);

  // Scroll a newly added step into view and focus its first field.
  useEffect(() => {
    if (!scrollTo) return;
    const el = document.querySelector<HTMLElement>(`[data-step-id="${scrollTo}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    el?.querySelector<HTMLElement>('.step-fields input, .step-fields select')?.focus();
    setScrollTo(null);
  }, [scrollTo, flow.steps]);

  // ---- Saving & switching ----
  const save = useCallback(async (): Promise<boolean> => {
    const toSave = { ...flow, name: flow.name.trim() || 'Untitled flow' };
    try {
      const saved = await window.api.saveFlow(toSave);
      if (toSave.name !== flow.name) editFlow((f) => ({ ...f, name: toSave.name }));
      setSavedSnap(norm(saved));
      setFlows((prev) => [saved, ...prev.filter((f) => f.id !== saved.id)].sort(byNewest));
      remember(saved.id);
      clearDraft();
      return true;
    } catch (err) {
      toast.error('Couldn’t save: ' + errMsg(err));
      return false;
    }
  }, [flow, editFlow, toast]);

  /** Ask what to do with unsaved changes. Resolves true if it's OK to move on. */
  const confirmLeave = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    const choice = await dialogs.choose({
      title: `Save changes to “${flow.name.trim() || 'Untitled flow'}”?`,
      message: 'Your changes will be lost if you don’t save them.',
      choices: [
        { value: 'discard', label: 'Don’t save', variant: 'danger' },
        { value: 'save', label: 'Save', variant: 'primary' },
      ],
    });
    if (choice === 'save') return save();
    return choice === 'discard';
  }, [dirty, dialogs, flow.name, save]);

  const openFlow = useCallback(
    async (f: Flow) => {
      if (f.id === flow.id) {
        setView('editor');
        return;
      }
      if (!(await confirmLeave())) return;
      openFlowNow(f);
      setView('editor');
    },
    [flow.id, confirmLeave, openFlowNow]
  );

  const createNew = useCallback(async () => {
    if (!(await confirmLeave())) return;
    openFlowNow(null);
    setView('editor');
  }, [confirmLeave, openFlowNow]);

  const loadExample = useCallback(async () => {
    if (!(await confirmLeave())) return;
    const f = demoFlow();
    resetFlow(f);
    setSavedSnap(null);
    setSelectedId(null);
    setExpanded(new Set());
    setView('editor');
  }, [confirmLeave, resetFlow]);

  const deleteFlow = useCallback(
    async (f: Flow) => {
      const ok = await dialogs.confirm({
        title: `Delete “${f.name}”?`,
        message: 'The flow is removed from this preset. Its run history is kept.',
        confirmLabel: 'Delete flow',
        danger: true,
      });
      if (!ok) return;
      try {
        await window.api.deleteFlow(f.id);
        const rest = flows.filter((x) => x.id !== f.id);
        setFlows(rest);
        if (f.id === flow.id) openFlowNow(rest[0] ?? null);
        toast.success(`Deleted “${f.name}”`);
      } catch (err) {
        toast.error('Couldn’t delete: ' + errMsg(err));
      }
    },
    [dialogs, flows, flow.id, openFlowNow, toast]
  );

  const duplicateFlow = useCallback(
    async (f: Flow) => {
      const source = f.id === flow.id ? flow : f;
      const copy = copyFlow(source);
      try {
        const saved = await window.api.saveFlow(copy);
        setFlows((prev) => [saved, ...prev].sort(byNewest));
        if (await confirmLeave()) openFlowNow(saved);
        toast.success(`Created “${saved.name}”`);
      } catch (err) {
        toast.error('Couldn’t duplicate: ' + errMsg(err));
      }
    },
    [flow, confirmLeave, openFlowNow, toast]
  );

  const exportFlow = useCallback(
    async (f: Flow) => {
      try {
        if (await window.api.exportFlow(f.id === flow.id ? flow : f)) toast.success('Flow exported');
      } catch (err) {
        toast.error('Couldn’t export: ' + errMsg(err));
      }
    },
    [flow, toast]
  );

  const importFlows = useCallback(async () => {
    try {
      const imported = await window.api.importFlows();
      if (!imported.length) return;
      setFlows((prev) => [...imported, ...prev].sort(byNewest));
      toast.success(`Imported ${plural(imported.length, 'flow')}`);
      if (await confirmLeave()) openFlowNow(imported[0]);
    } catch (err) {
      toast.error('Couldn’t import: ' + errMsg(err));
    }
  }, [confirmLeave, openFlowNow, toast]);

  // ---- Presets ----
  const switchPreset = useCallback(
    async (id: string | null) => {
      if (id === activePresetId) return;
      if (!(await confirmLeave())) return;
      try {
        await window.api.selectPreset(id);
        await loadProfile();
        setView('editor');
      } catch (err) {
        toast.error(errMsg(err));
      }
    },
    [activePresetId, confirmLeave, loadProfile, toast]
  );

  const createPreset = useCallback(async () => {
    if (!(await confirmLeave())) return;
    const name = await dialogs.prompt({
      title: 'New preset',
      message: 'A preset keeps its own flows and settings. The new one starts as a copy of what you have now.',
      label: 'Name',
      placeholder: 'e.g. Media downloads',
      confirmLabel: 'Create preset',
    });
    if (!name) return;
    try {
      await window.api.createPreset(name);
      await loadProfile(flow.id);
      toast.success(`Switched to “${name}”`);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }, [confirmLeave, dialogs, loadProfile, flow.id, toast]);

  const renamePreset = useCallback(async () => {
    if (!activePresetId) return;
    const name = await dialogs.prompt({ title: 'Rename preset', label: 'Name', initial: presetName, confirmLabel: 'Rename' });
    if (!name || name === presetName) return;
    try {
      await window.api.renamePreset(activePresetId, name);
      setPresets(await window.api.listPresets());
    } catch (err) {
      toast.error(errMsg(err));
    }
  }, [activePresetId, dialogs, presetName, toast]);

  const deletePreset = useCallback(async () => {
    if (!activePresetId) return;
    const ok = await dialogs.confirm({
      title: `Delete the preset “${presetName}”?`,
      message: 'Its flows and settings are deleted. You’ll switch back to the default profile. Run history is kept.',
      confirmLabel: 'Delete preset',
      danger: true,
    });
    if (!ok) return;
    try {
      await window.api.deletePreset(activePresetId);
      await loadProfile();
      toast.success(`Deleted “${presetName}”`);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }, [activePresetId, dialogs, presetName, loadProfile, toast]);

  const importPreset = useCallback(async () => {
    if (!(await confirmLeave())) return;
    try {
      const id = await window.api.importPreset();
      if (id) {
        await loadProfile();
        toast.success('Preset imported');
      }
    } catch (err) {
      toast.error('Couldn’t import: ' + errMsg(err));
    }
  }, [confirmLeave, loadProfile, toast]);

  const exportPreset = useCallback(async () => {
    try {
      if (await window.api.exportPreset(activePresetId)) toast.success('Preset exported');
    } catch (err) {
      toast.error('Couldn’t export: ' + errMsg(err));
    }
  }, [activePresetId, toast]);

  // ---- Step editing ----
  const patchStep = useCallback(
    (id: string, fn: StepPatch, coalesce?: string) =>
      editFlow((f) => ({ ...f, steps: f.steps.map((s) => (s.id === id ? fn(s) : s)) }), { coalesce }),
    [editFlow]
  );

  const addStepAt = useCallback(
    (index: number, step: Step) => {
      editFlow((f) => insertStep(f, index, step));
      setSelectedId(step.id);
      setScrollTo(step.id);
    },
    [editFlow]
  );

  const addStep = useCallback(() => {
    addStepAt(flow.steps.length, newStep(flow.steps.length ? 'click' : 'goto'));
  }, [addStepAt, flow.steps.length]);

  const insertBelow = useCallback(
    (id: string) => {
      const i = flow.steps.findIndex((s) => s.id === id);
      addStepAt(i + 1, newStep('click'));
    },
    [addStepAt, flow.steps]
  );

  const duplicateStep = useCallback(
    (id: string) => {
      const i = flow.steps.findIndex((s) => s.id === id);
      if (i >= 0) addStepAt(i + 1, copyStep(flow.steps[i]));
    },
    [addStepAt, flow.steps]
  );

  const deleteStep = useCallback(
    (id: string) => {
      const i = flow.steps.findIndex((s) => s.id === id);
      if (i < 0) return;
      editFlow((f) => removeStepAt(f, i));
      if (selectedId === id) setSelectedId(flow.steps[i + 1]?.id ?? flow.steps[i - 1]?.id ?? null);
      toast.info(`Deleted step ${i + 1}`, { action: { label: 'Undo', onClick: undoEdit } });
    },
    [editFlow, undoEdit, flow.steps, selectedId, toast]
  );

  const moveBy = useCallback(
    (id: string, dir: -1 | 1) => {
      const i = flow.steps.findIndex((s) => s.id === id);
      editFlow((f) => moveStep(f, i, i + dir));
    },
    [editFlow, flow.steps]
  );

  const reorder = useCallback(
    (id: string, to: number) => {
      const i = flow.steps.findIndex((s) => s.id === id);
      editFlow((f) => moveStep(f, i, to));
    },
    [editFlow, flow.steps]
  );

  const copySelectedStep = useCallback(() => {
    const step = flow.steps.find((s) => s.id === selectedId);
    if (!step) return;
    clipboard.current = structuredClone(step);
    void navigator.clipboard?.writeText(JSON.stringify({ type: 'script-runner-step', step }, null, 2)).catch(() => {});
    toast.info('Step copied');
  }, [flow.steps, selectedId, toast]);

  const pasteStep = useCallback(async () => {
    let step: Step | null = clipboard.current;
    try {
      const text = await navigator.clipboard?.readText();
      const parsed = text ? JSON.parse(text) : null;
      if (parsed?.type === 'script-runner-step' && parsed.step) {
        const normalized = normalizeFlow({ steps: [parsed.step] });
        if (normalized?.steps[0]) step = normalized.steps[0];
      }
    } catch {
      /* the clipboard holds something else; fall back to the copied step */
    }
    if (!step) return;
    const at = selectedIndex >= 0 ? selectedIndex + 1 : flow.steps.length;
    addStepAt(at, copyStep(step));
  }, [addStepAt, flow.steps.length, selectedIndex]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ---- Running ----
  const startRun = useCallback(
    async (opts?: RunOptions, target: Flow = flow, vars: Record<string, string> = flow.variables ?? {}) => {
      if (run.running) return;
      const problems = validateFlow(target).filter((i) => i.level === 'error');
      const relevant =
        opts?.only != null
          ? problems.filter((i) => i.stepId === target.steps[opts.only!]?.id)
          : opts?.startAt != null
            ? problems.filter((i) => !i.stepId || target.steps.findIndex((s) => s.id === i.stepId) >= opts.startAt!)
            : problems;
      if (relevant.length) {
        const first = relevant.find((i) => i.stepId)?.stepId;
        if (first) {
          setSelectedId(first);
          setScrollTo(first);
        }
        toast.error(`Fix ${plural(relevant.length, 'problem')} before running: ${relevant[0].message}`);
        return;
      }
      const res = await run.start(target, vars, opts);
      void refreshRuns();
      const rec = res.record;
      if (!rec) {
        if (!res.ok) toast.error(res.error ?? 'The run failed.');
        return;
      }
      const files = rec.downloads.length;
      const openAction = files ? { label: 'Open folder', onClick: () => void window.api.openDownloads() } : undefined;
      if (rec.status === 'ok') toast.success(`Finished${files ? `: ${plural(files, 'file')} saved` : ''}`, { action: openAction });
      else if (rec.status === 'warn') toast.warn('Finished, but some steps failed. See the console for details.', { action: openAction });
      else if (rec.status === 'stopped') toast.info('Run stopped');
      else toast.error(res.error ?? 'The run failed.');
    },
    [flow, run, refreshRuns, toast]
  );

  const runOnly = useCallback((i: number) => void startRun({ only: i }), [startRun]);
  const runFrom = useCallback((i: number) => void startRun({ startAt: i }), [startRun]);

  const runAgain = useCallback(
    async (record: RunRecord) => {
      const f = flows.find((x) => x.id === record.flowId);
      if (!f) return;
      if (f.id !== flow.id) {
        if (!(await confirmLeave())) return;
        openFlowNow(f);
      }
      setView('editor');
      void startRun(undefined, f.id === flow.id ? flow : f, { ...(f.variables ?? {}), ...record.vars });
    },
    [flows, flow, confirmLeave, openFlowNow, startRun]
  );

  // ---- Settings ----
  const saveSettings = useCallback(
    async (s: Settings) => {
      try {
        const saved = await window.api.saveSettings(s);
        setSettings(saved);
        setThemePreview(null);
        setShowSettings(false);
        toast.success('Settings saved');
      } catch (err) {
        toast.error('Couldn’t save settings: ' + errMsg(err));
      }
    },
    [toast]
  );

  // ---- Keyboard shortcuts ----
  const editing = view === 'editor' && !runningHere;
  useShortcuts({
    'mod+s': () => view === 'editor' && dirty && void save(),
    'mod+n': () => void createNew(),
    'mod+enter': () => view === 'editor' && void startRun(),
    'mod+shift+enter': () => view === 'editor' && selectedIndex >= 0 && runFrom(selectedIndex),
    'mod+.': () => run.running && run.stop(),
    'mod+z': () => editing && undoEdit(),
    'mod+shift+z': () => editing && redoEdit(),
    'mod+y': () => editing && redoEdit(),
    'mod+d': () => editing && selectedId && duplicateStep(selectedId),
    'mod+c': () => editing && selectedId && copySelectedStep(),
    'mod+v': () => editing && void pasteStep(),
    'alt+arrowup': () => editing && selectedId && moveBy(selectedId, -1),
    'alt+arrowdown': () => editing && selectedId && moveBy(selectedId, 1),
    'mod+,': () => setShowSettings(true),
    'mod+f': () => searchRef.current?.focus(),
    '?': () => setShowShortcuts(true),
  });

  if (!loaded) {
    return (
      <div className="boot">
        <div className="boot-spinner" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        ref={searchRef}
        version={version}
        flows={flows}
        currentId={flow.id}
        currentName={flow.name}
        dirty={dirty}
        unsavedNew={!isSaved && (dirty || flows.length === 0)}
        runs={runs}
        runningFlowId={run.running ? run.flowId : null}
        view={view}
        presets={presets}
        activePresetId={activePresetId}
        onNew={() => void createNew()}
        onImport={() => void importFlows()}
        onSelectFlow={(f) => void openFlow(f)}
        onDuplicateFlow={(f) => void duplicateFlow(f)}
        onExportFlow={(f) => void exportFlow(f)}
        onDeleteFlow={(f) => void deleteFlow(f)}
        onView={(v) => {
          setView(v);
          if (v === 'history') void refreshRuns();
        }}
        onSettings={() => setShowSettings(true)}
        onShortcuts={() => setShowShortcuts(true)}
        onSelectPreset={(id) => void switchPreset(id)}
        onCreatePreset={() => void createPreset()}
        onRenamePreset={() => void renamePreset()}
        onImportPreset={() => void importPreset()}
        onExportPreset={() => void exportPreset()}
        onDeletePreset={() => void deletePreset()}
      />

      <main className="main">
        {view === 'editor' ? (
          <>
            <Topbar
              presetName={presetName}
              name={flow.name}
              onName={(name) => editFlow((f) => ({ ...f, name }), { coalesce: 'name' })}
              dirty={dirty}
              canUndo={ed.canUndo && !runningHere}
              canRedo={ed.canRedo && !runningHere}
              onUndo={undoEdit}
              onRedo={redoEdit}
              onSave={() => void save()}
              running={runningHere}
              busyElsewhere={busyElsewhere}
              paused={run.paused}
              progress={runningHere ? run.progress : null}
              selectedIndex={selectedIndex >= 0 ? selectedIndex : null}
              onRun={() => void startRun()}
              onRunFrom={runFrom}
              onRunOnly={runOnly}
              onPause={run.pause}
              onResume={run.resume}
              onStop={run.stop}
            />
            {runningHere && run.paused && (
              <div className="pause-banner" role="status">
                <Icon name="hand" size={18} />
                <div className="pause-text">
                  <strong>Paused for you</strong>
                  <span>{run.progress?.pauseReason ?? 'The run continues when you press Resume.'}</span>
                </div>
                <button className="btn primary" onClick={run.resume}>
                  <Icon name="play" />
                  Resume
                </button>
              </div>
            )}
            <div className="workspace">
              <div className="editor-grid">
                <StepList
                  steps={flow.steps}
                  repeat={flow.repeat}
                  statuses={statuses}
                  issues={stepIssues}
                  flowIssues={issues}
                  selectedId={selectedId}
                  expanded={expanded}
                  locked={runningHere}
                  currentId={currentStepId}
                  onPatch={patchStep}
                  onSelect={setSelectedId}
                  onToggleExpand={toggleExpand}
                  onDuplicate={duplicateStep}
                  onInsertBelow={insertBelow}
                  onDelete={deleteStep}
                  onMove={moveBy}
                  onRunOnly={runOnly}
                  onRunFrom={runFrom}
                  onAdd={addStep}
                  onReorder={reorder}
                  onLoadExample={() => void loadExample()}
                />
                <div className="rail">
                  <RepeatPanel
                    repeat={flow.repeat}
                    stepCount={flow.steps.length}
                    locked={runningHere}
                    onChange={(repeat, coalesce) => editFlow((f) => ({ ...f, repeat }), { coalesce })}
                  />
                  <InputsPanel
                    variables={flow.variables ?? {}}
                    steps={flow.steps}
                    counterName={flow.repeat?.enabled ? flow.repeat.counterName : undefined}
                    locked={runningHere}
                    onChange={(variables, coalesce) => editFlow((f) => ({ ...f, variables }), { coalesce })}
                  />
                </div>
              </div>
            </div>
            <Console
              logs={run.flowId === flow.id || run.running ? run.logs : []}
              running={run.running}
              paused={run.paused}
              progress={run.progress}
              lastResult={run.flowId === flow.id ? run.lastResult : null}
              onClear={run.clearLogs}
              flowName={flow.name}
            />
          </>
        ) : (
          <HistoryView
            runs={runs}
            flowExists={(id) => flows.some((f) => f.id === id)}
            onRefresh={refreshRuns}
            onRunAgain={(r) => void runAgain(r)}
            busy={run.running}
          />
        )}
      </main>

      {showSettings && settings && (
        <SettingsDialog
          settings={settings}
          presetName={presetName}
          running={run.running}
          onClose={() => {
            setThemePreview(null);
            setShowSettings(false);
          }}
          onSave={saveSettings}
          onPreviewTheme={setThemePreview}
        />
      )}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

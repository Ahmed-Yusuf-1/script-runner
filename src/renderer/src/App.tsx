import { useEffect, useState, useCallback } from 'react';
import type { Flow, Step, Settings, StepStatus } from '@shared/types';
import { FlowList } from './components/FlowList';
import { StepBuilder } from './components/StepBuilder';
import { VariablesPanel } from './components/VariablesPanel';
import { RepeatPanel } from './components/RepeatPanel';
import { RunPanel } from './components/RunPanel';
import { SettingsDialog } from './components/Settings';

const uid = () => crypto.randomUUID();

function newFlow(): Flow {
  return {
    id: uid(),
    name: 'Untitled flow',
    variables: {},
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function App() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [flow, setFlow] = useState<Flow>(newFlow);
  const [statuses, setStatuses] = useState<Record<string, StepStatus>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [presets, setPresets] = useState<{ id: string; name: string }[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  // Load saved flows, settings, and presets, then subscribe to live run events.
  useEffect(() => {
    window.api.listFlows().then(setFlows);
    window.api.getSettings().then(setSettings);
    window.api.listPresets().then(setPresets);
    window.api.getActivePresetId().then(setActivePresetId);
    const offLog = window.api.onLog((msg) => setLogs((prev) => [...prev, msg]));
    const offStatus = window.api.onStatus((s) =>
      setStatuses((prev) => ({ ...prev, [s.id]: s }))
    );
    return () => {
      offLog();
      offStatus();
    };
  }, []);

  const patchFlow = useCallback((patch: Partial<Flow>) => {
    setFlow((f) => ({ ...f, ...patch }));
  }, []);

  // ---- Presets ----
  const refreshPresets = useCallback(async () => {
    const list = await window.api.listPresets();
    setPresets(list);
    const activeId = await window.api.getActivePresetId();
    setActivePresetId(activeId);
  }, []);

  const handleSelectPreset = useCallback(async (id: string | null) => {
    await window.api.selectPreset(id);
    setActivePresetId(id);
    const updatedSettings = await window.api.getSettings();
    setSettings(updatedSettings);
    const updatedFlows = await window.api.listFlows();
    setFlows(updatedFlows);
    if (updatedFlows.length > 0) {
      setFlow(structuredClone(updatedFlows[0]));
      setStatuses({});
    } else {
      setFlow(newFlow());
      setStatuses({});
    }
  }, []);

  const handleCreatePreset = useCallback(async () => {
    const name = prompt('Enter a name for the new preset profile (this will copy your current settings and scripts):');
    if (!name || !name.trim()) return;
    const newId = await window.api.createPreset(name.trim());
    await refreshPresets();
    await handleSelectPreset(newId);
  }, [refreshPresets, handleSelectPreset]);

  const handleDeletePreset = useCallback(async (id: string) => {
    if (!confirm('Are you sure you want to delete this preset profile? All saved scripts and settings for this profile will be deleted.')) return;
    await window.api.deletePreset(id);
    await refreshPresets();
    await handleSelectPreset(null);
  }, [refreshPresets, handleSelectPreset]);

  const handleExportPreset = useCallback(async () => {
    await window.api.exportPreset(activePresetId);
  }, [activePresetId]);

  const handleImportPreset = useCallback(async () => {
    const newId = await window.api.importPreset();
    if (newId) {
      await refreshPresets();
      await handleSelectPreset(newId);
    }
  }, [refreshPresets, handleSelectPreset]);

  // ---- Step editing ----
  const addStep = useCallback(() => {
    setFlow((f) => ({
      ...f,
      steps: [...f.steps, { id: uid(), action: 'goto', value: '' }],
    }));
  }, []);

  const updateStep = useCallback((id: string, patch: Partial<Step>) => {
    setFlow((f) => ({
      ...f,
      steps: f.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }, []);

  const removeStep = useCallback((id: string) => {
    setFlow((f) => ({
      ...f,
      steps: f.steps.filter((s) => s.id !== id),
    }));
  }, []);

  const moveStep = useCallback((id: string, dir: -1 | 1) => {
    setFlow((f) => {
      const i = f.steps.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= f.steps.length) return f;
      const steps = [...f.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...f, steps };
    });
  }, []);

  // ---- Flow management ----
  const refreshFlows = useCallback(() => {
    window.api.listFlows().then(setFlows);
  }, []);

  const saveCurrent = useCallback(async () => {
    await window.api.saveFlow(flow);
    setFlows((prev) => {
      const index = prev.findIndex((f) => f.id === flow.id);
      const updated = [...prev];
      if (index >= 0) {
        updated[index] = flow;
      } else {
        updated.unshift(flow);
      }
      return updated.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }, [flow]);

  const selectFlow = useCallback((f: Flow) => {
    setFlow(structuredClone(f));
    setStatuses({});
  }, []);

  const createNew = useCallback(() => {
    setFlow(newFlow());
    setStatuses({});
  }, []);

  const deleteFlow = useCallback(async (id: string) => {
    await window.api.deleteFlow(id);
    setFlow((f) => {
      if (f.id === id) return newFlow();
      return f;
    });
    setFlows((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const loadDemo = useCallback(() => {
    setFlow({
      id: uid(),
      name: 'Demo: search Wikipedia',
      variables: { query: 'Playwright' },
      steps: [
        { id: uid(), action: 'goto', value: 'en.wikipedia.org' },
        {
          id: uid(),
          action: 'fillField',
          value: '{{query}}',
          target: { by: 'searchbox' },
          options: { pressEnter: true },
        },
        { id: uid(), action: 'wait', value: '1500' },
        { id: uid(), action: 'screenshot', value: 'result.png' },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setStatuses({});
  }, []);

  // ---- Running ----
  const run = useCallback(async () => {
    if (!flow.steps.length) {
      setLogs(['Add at least one step first.']);
      return;
    }
    setLogs([]);
    setStatuses({});
    setRunning(true);
    try {
      const res = await window.api.runFlow(flow, flow.variables ?? {});
      if (!res.ok) setLogs((prev) => [...prev, `Run ended with an error: ${res.error}`]);
    } finally {
      setRunning(false);
    }
  }, [flow]);

  const stop = useCallback(() => {
    window.api.stopFlow();
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">⚙ Script Runner</div>
        <button className="primary block" onClick={createNew}>
          + New flow
        </button>
        <button className="ghost block" onClick={loadDemo}>
          Load demo
        </button>

        <div className="section-label">Preset Profile</div>
        <div className="preset-selector-row">
          <select
            value={activePresetId || ''}
            onChange={(e) => handleSelectPreset(e.target.value || null)}
            className="preset-select"
          >
            <option value="">Default Profile</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="preset-actions-row">
          <button className="icon-btn" title="Save Current as New Preset" onClick={handleCreatePreset}>
            ＋ Save As
          </button>
          <button className="icon-btn" title="Import Preset File" onClick={handleImportPreset}>
            📥 Import
          </button>
          <button className="icon-btn" title="Export Current Preset" onClick={handleExportPreset}>
            📤 Export
          </button>
          {activePresetId && (
            <button className="icon-btn danger" title="Delete Preset" onClick={() => handleDeletePreset(activePresetId)}>
              🗑 Delete
            </button>
          )}
        </div>

        <FlowList
          flows={flows}
          currentId={flow.id}
          onSelect={selectFlow}
          onDelete={deleteFlow}
        />
        <button className="ghost block settings-btn" onClick={() => setShowSettings(true)}>
          ⚙ Settings
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <input
            className="flow-name"
            value={flow.name}
            onChange={(e) => patchFlow({ name: e.target.value })}
            placeholder="Flow name"
          />
          <button className="primary" onClick={saveCurrent}>
            Save
          </button>
        </header>

        <div className="content">
          <StepBuilder
            steps={flow.steps}
            statuses={statuses}
            onAdd={addStep}
            onUpdate={updateStep}
            onRemove={removeStep}
            onMove={moveStep}
          />

          <RepeatPanel
            repeat={flow.repeat}
            stepCount={flow.steps.length}
            onChange={(repeat) => patchFlow({ repeat })}
          />

          <VariablesPanel
            variables={flow.variables ?? {}}
            steps={flow.steps}
            exclude={flow.repeat?.enabled ? [flow.repeat.counterName] : []}
            onChange={(variables) => patchFlow({ variables })}
          />

          <RunPanel
            running={running}
            logs={logs}
            onRun={run}
            onStop={stop}
          />
        </div>
      </main>

      {showSettings && settings && (
        <SettingsDialog
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={async (s) => {
            await window.api.saveSettings(s);
            setSettings(s);
            setShowSettings(false);
          }}
        />
      )}
    </div>
  );
}

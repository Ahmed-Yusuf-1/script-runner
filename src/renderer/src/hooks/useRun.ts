// Live run state for the UI: log lines, per-step status, progress, and the
// run/stop/pause controls. Reattaches to a run that's still going if the UI
// reloads mid-run.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Flow, LogEntry, RunOptions, RunProgress, RunResult, StepStatus } from '@shared/types';

const MAX_LOG = 5000;

export interface RunApi {
  logs: LogEntry[];
  statuses: Record<string, StepStatus>;
  progress: RunProgress | null;
  running: boolean;
  paused: boolean;
  /** Id of the flow that's running (or ran last). */
  flowId: string | null;
  lastResult: RunResult | null;
  start: (flow: Flow, vars: Record<string, string>, opts?: RunOptions) => Promise<RunResult>;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  clearLogs: () => void;
  /** Forget statuses (e.g. when opening another flow). */
  resetStatuses: () => void;
}

export function useRun(): RunApi {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [statuses, setStatuses] = useState<Record<string, StepStatus>>({});
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const owning = useRef(false);

  useEffect(() => {
    const offLog = window.api.onLog((entries) =>
      setLogs((prev) => {
        const next = prev.concat(entries);
        return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
      })
    );
    const offStatus = window.api.onStatus((s) => setStatuses((prev) => ({ ...prev, [s.id]: s })));
    const offProgress = window.api.onProgress(setProgress);

    // A run may still be going from before a reload: follow it until it ends.
    let poll: number | undefined;
    void window.api.getRunState().then((st) => {
      if (!st.running) return;
      setRunning(true);
      setFlowId(st.flowId ?? null);
      if (st.progress) setProgress(st.progress);
      poll = window.setInterval(async () => {
        const s = await window.api.getRunState();
        if (!s.running && !owning.current) {
          setRunning(false);
          window.clearInterval(poll);
        }
      }, 1000);
    });

    return () => {
      offLog();
      offStatus();
      offProgress();
      if (poll) window.clearInterval(poll);
    };
  }, []);

  const start = useCallback(async (flow: Flow, vars: Record<string, string>, opts?: RunOptions) => {
    setLogs([]);
    setStatuses({});
    setProgress(null);
    setLastResult(null);
    setRunning(true);
    setFlowId(flow.id);
    owning.current = true;
    try {
      const res = await window.api.runFlow(flow, vars, opts);
      setLastResult(res);
      return res;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLogs((prev) => [...prev, { ts: Date.now(), level: 'error', msg: message }]);
      const res: RunResult = { ok: false, status: 'error', error: message };
      setLastResult(res);
      return res;
    } finally {
      owning.current = false;
      setRunning(false);
      setProgress((p) => (p ? { ...p, paused: false, stepIndex: -1 } : p));
    }
  }, []);

  const stop = useCallback(() => void window.api.stopFlow(), []);
  const pause = useCallback(() => void window.api.pauseFlow(), []);
  const resume = useCallback(() => void window.api.resumeFlow(), []);
  const clearLogs = useCallback(() => setLogs([]), []);
  const resetStatuses = useCallback(() => setStatuses({}), []);

  return {
    logs,
    statuses,
    progress,
    running,
    paused: running && !!progress?.paused,
    flowId,
    lastResult,
    start,
    stop,
    pause,
    resume,
    clearLogs,
    resetStatuses,
  };
}

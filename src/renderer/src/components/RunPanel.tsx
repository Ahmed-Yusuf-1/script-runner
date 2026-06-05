import { useEffect, useRef } from 'react';

interface Props {
  running: boolean;
  logs: string[];
  onRun: () => void;
  onStop: () => void;
}

export function RunPanel({ running, logs, onRun, onStop }: Props) {
  const logRef = useRef<HTMLDivElement>(null);

  // Keep the log scrolled to the newest line.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  return (
    <section className="panel run-panel">
      <div className="panel-head">
        <h2>Run</h2>
        <div className="run-buttons">
          <button className="primary" onClick={onRun} disabled={running}>
            {running ? 'Running…' : '▶ Run'}
          </button>
          <button className="danger" onClick={onStop} disabled={!running}>
            ⏹ Stop
          </button>
        </div>
      </div>
      <div className="log" ref={logRef}>
        {logs.length === 0 ? (
          <span className="muted">Logs will appear here when you run a flow.</span>
        ) : (
          logs.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    </section>
  );
}

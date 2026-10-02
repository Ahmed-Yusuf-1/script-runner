// State with undo/redo. Rapid edits with the same `coalesce` key (typing in one
// field) merge into a single undo step, so Undo reverts a word, not a letter.

import { useCallback, useRef, useState } from 'react';

interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const LIMIT = 200;
const COALESCE_MS = 1200;

export interface Undoable<T> {
  value: T;
  set: (next: T | ((prev: T) => T), opts?: { coalesce?: string }) => void;
  /** Replace the value and forget history (e.g. when opening another flow). */
  reset: (value: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useUndoable<T>(initial: T | (() => T)): Undoable<T> {
  const [h, setH] = useState<History<T>>(() => ({
    past: [],
    present: typeof initial === 'function' ? (initial as () => T)() : initial,
    future: [],
  }));
  const last = useRef<{ key?: string; at: number }>({ at: 0 });

  const set = useCallback((next: T | ((prev: T) => T), opts?: { coalesce?: string }) => {
    const now = Date.now();
    const merge = !!opts?.coalesce && last.current.key === opts.coalesce && now - last.current.at < COALESCE_MS;
    last.current = { key: opts?.coalesce, at: now };
    setH((s) => {
      const value = typeof next === 'function' ? (next as (p: T) => T)(s.present) : next;
      if (Object.is(value, s.present)) return s;
      if (merge) return { past: s.past, present: value, future: [] };
      return { past: [...s.past, s.present].slice(-LIMIT), present: value, future: [] };
    });
  }, []);

  const reset = useCallback((value: T) => {
    last.current = { at: 0 };
    setH({ past: [], present: value, future: [] });
  }, []);

  const undo = useCallback(() => {
    last.current = { at: 0 };
    setH((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s));
  }, []);

  const redo = useCallback(() => {
    last.current = { at: 0 };
    setH((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s));
  }, []);

  return { value: h.present, set, reset, undo, redo, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}

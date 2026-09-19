// Global keyboard shortcuts. Combos are written like "mod+s", "mod+shift+z",
// "alt+arrowup" or "?" ("mod" is Ctrl, or Cmd on macOS).
// Bare keys (no mod/alt) are ignored while typing in a field, and nothing fires
// while a dialog is open (dialogs handle their own keys).

import { useEffect, useRef } from 'react';

export type Bindings = Record<string, (e: KeyboardEvent) => void>;

export const isMac = navigator.platform.toLowerCase().includes('mac');
export const MOD = isMac ? '⌘' : 'Ctrl';

function comboOf(e: KeyboardEvent): string {
  const key = e.key.toLowerCase();
  if (key === '?') return '?';
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(key === ' ' ? 'space' : key);
  return parts.join('+');
}

function isTyping(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export function useShortcuts(bindings: Bindings): void {
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (document.querySelector('.modal-backdrop, .menu')) return;
      const combo = comboOf(e);
      const fn = ref.current[combo];
      if (!fn) return;
      const bare = !combo.includes('mod') && !combo.includes('alt');
      if (bare && isTyping(document.activeElement)) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Human-readable label for a combo, e.g. "mod+shift+z" → "Ctrl Shift Z". */
export function comboLabel(combo: string): string {
  return combo
    .split('+')
    .map((p) =>
      p === 'mod'
        ? MOD
        : p === 'shift'
          ? isMac
            ? '⇧'
            : 'Shift'
          : p === 'alt'
            ? isMac
              ? '⌥'
              : 'Alt'
            : p === 'enter'
              ? '↵'
              : p === 'arrowup'
                ? '↑'
                : p === 'arrowdown'
                  ? '↓'
                  : p.length === 1
                    ? p.toUpperCase()
                    : p[0].toUpperCase() + p.slice(1)
    )
    .join(' ');
}

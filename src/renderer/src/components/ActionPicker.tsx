// The action dropdown on a step card: grouped, searchable, keyboard-navigable,
// with an icon and a one-line description for each action.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Action } from '@shared/types';
import { ACTION_GROUPS, ACTION_META, ACTIONS } from '@shared/actions';
import { Icon } from './ui/Icon';

/** Actions in the order they're displayed (by group), so arrow keys follow the list. */
const ORDERED: Action[] = ACTION_GROUPS.flatMap((g) => ACTIONS.filter((a) => ACTION_META[a].group === g));

interface Props {
  value: Action;
  onChange: (action: Action) => void;
  disabled?: boolean;
}

export function ActionPicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const meta = ACTION_META[value];

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ORDERED.filter((a) => {
      if (!q) return true;
      const m = ACTION_META[a];
      return (m.label + ' ' + m.description + ' ' + m.group).toLowerCase().includes(q);
    });
  }, [query]);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const maxHeight = Math.min(460, Math.max(below, above));
    const top = below >= Math.min(460, above) ? r.bottom + 4 : Math.max(8, r.top - 4 - maxHeight);
    setPos({ top, left: Math.min(r.left, window.innerWidth - 348), maxHeight });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(Math.max(0, ORDERED.indexOf(value)));
    const onDown = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, value]);

  useEffect(() => {
    pop.current?.querySelector('.picker-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (a: Action) => {
    setOpen(false);
    btn.current?.focus();
    if (a !== value) onChange(a);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[active]) choose(matches[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="action-picker"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Action: ${meta.label}. Change action`}
        disabled={disabled}
        title={meta.description}
      >
        <Icon name={meta.icon} className="accent-icon" />
        <span className="action-picker-label">{meta.label}</span>
        <Icon name="chevronDown" className="muted-icon" />
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            className="picker-pop"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, maxHeight: pos?.maxHeight }}
            onKeyDown={onKeyDown}
          >
            <div className="picker-search">
              <Icon name="search" size={15} />
              <input
                autoFocus
                placeholder="Find an action"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                aria-label="Find an action"
                aria-controls="action-list"
                aria-activedescendant={matches[active] ? `act-${matches[active]}` : undefined}
              />
            </div>
            <div className="picker-list" role="listbox" id="action-list" aria-label="Actions">
              {matches.length === 0 && <div className="picker-empty">No action matches “{query}”.</div>}
              {ACTION_GROUPS.map((g) => {
                const inGroup = matches.filter((a) => ACTION_META[a].group === g);
                if (!inGroup.length) return null;
                return (
                  <div key={g} role="group" aria-label={g}>
                    <div className="picker-group">{g}</div>
                    {inGroup.map((a) => {
                      const m = ACTION_META[a];
                      const i = matches.indexOf(a);
                      return (
                        <div
                          key={a}
                          id={`act-${a}`}
                          role="option"
                          aria-selected={a === value}
                          className={'picker-item' + (i === active ? ' active' : '') + (a === value ? ' current' : '')}
                          onMouseEnter={() => setActive(i)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => choose(a)}
                        >
                          <span className="picker-icon">
                            <Icon name={m.icon} />
                          </span>
                          <span className="picker-text">
                            <span className="picker-label">{m.label}</span>
                            <span className="picker-desc">{m.description}</span>
                          </span>
                          {a === value && <Icon name="check" className="accent-icon" />}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

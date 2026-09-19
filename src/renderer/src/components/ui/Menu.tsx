// A dropdown menu: a trigger button plus a popover list of actions. Closes on
// outside click, Escape, or picking an item; arrow keys move between items.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export type MenuItem =
  | {
      label: string;
      icon?: string;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
      hint?: string;
      checked?: boolean;
    }
  | { separator: true }
  | { heading: string };

interface Props {
  items: MenuItem[];
  /** Renders the trigger. Spread the given props onto a <button>. */
  trigger: (props: {
    onClick: () => void;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    ref: (el: HTMLButtonElement | null) => void;
  }) => ReactNode;
  align?: 'start' | 'end';
  width?: number;
}

export function Menu({ items, trigger, align = 'end', width = 220 }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  const pop = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = pop.current?.offsetHeight ?? 0;
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    let left = align === 'end' ? r.right - width : r.left;
    left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
    setPos({ top, left });
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    const first = pop.current?.querySelector<HTMLButtonElement>('button:not([disabled])');
    first?.focus();
    const onDown = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = [...(pop.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        const next = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
        next?.focus();
      } else if (e.key === 'Tab') {
        setOpen(false);
      }
    };
    const onScroll = (e: Event) => {
      if (!pop.current?.contains(e.target as Node)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <>
      {trigger({
        onClick: () => setOpen((o) => !o),
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        ref: (el) => {
          btn.current = el;
        },
      })}
      {open &&
        createPortal(
          <div
            ref={pop}
            className="menu"
            role="menu"
            style={{ width, top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          >
            {items.map((item, i) => {
              if ('separator' in item) return <div key={i} className="menu-sep" role="separator" />;
              if ('heading' in item)
                return (
                  <div key={i} className="menu-heading">
                    {item.heading}
                  </div>
                );
              return (
                <button
                  key={i}
                  role="menuitem"
                  className={'menu-item' + (item.danger ? ' danger' : '')}
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  <span className="menu-icon">
                    {item.checked ? <Icon name="check" /> : item.icon ? <Icon name={item.icon} /> : null}
                  </span>
                  <span className="menu-label">{item.label}</span>
                  {item.hint && <kbd className="kbd">{item.hint}</kbd>}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}

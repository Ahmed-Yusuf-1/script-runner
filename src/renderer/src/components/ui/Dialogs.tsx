// App-wide confirm / prompt / choice dialogs and toast notifications, as
// promise-returning functions:
//   const ok = await dialogs.confirm({ title: 'Delete flow?', danger: true });
//   const name = await dialogs.prompt({ title: 'Name', initial: 'x' });
//   toast.success('Saved');
// (window.prompt isn't supported in Electron, and confirm() blocks the app.)

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { Icon } from './Icon';

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  message?: ReactNode;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Return an error message to block submitting, or null when valid. */
  validate?: (value: string) => string | null;
}

interface ChoiceOptions<T extends string> {
  title: string;
  message?: ReactNode;
  choices: { value: T; label: string; variant?: 'primary' | 'danger' | 'default' }[];
}

type ToastKind = 'info' | 'success' | 'warn' | 'error';
interface ToastOptions {
  action?: { label: string; onClick: () => void };
  duration?: number;
}
interface ToastItem extends ToastOptions {
  id: number;
  kind: ToastKind;
  message: string;
}

interface DialogsApi {
  confirm(o: ConfirmOptions): Promise<boolean>;
  prompt(o: PromptOptions): Promise<string | null>;
  choose<T extends string>(o: ChoiceOptions<T>): Promise<T | null>;
}

interface ToastApi {
  show(kind: ToastKind, message: string, o?: ToastOptions): void;
  info(message: string, o?: ToastOptions): void;
  success(message: string, o?: ToastOptions): void;
  warn(message: string, o?: ToastOptions): void;
  error(message: string, o?: ToastOptions): void;
}

type Pending =
  | { kind: 'confirm'; o: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; o: PromptOptions; resolve: (v: string | null) => void }
  | { kind: 'choose'; o: ChoiceOptions<string>; resolve: (v: string | null) => void };

const DialogsContext = createContext<DialogsApi | null>(null);
const ToastContext = createContext<ToastApi | null>(null);

export function useDialogs(): DialogsApi {
  const v = useContext(DialogsContext);
  if (!v) throw new Error('useDialogs outside DialogProvider');
  return v;
}

export function useToast(): ToastApi {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast outside DialogProvider');
  return v;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Pending[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback((p: Pending) => setQueue((q) => [...q, p]), []);
  const settle = useCallback(() => setQueue((q) => q.slice(1)), []);

  const dialogs = useMemo<DialogsApi>(
    () => ({
      confirm: (o) => new Promise((resolve) => push({ kind: 'confirm', o, resolve })),
      prompt: (o) => new Promise((resolve) => push({ kind: 'prompt', o, resolve })),
      choose: <T extends string>(o: ChoiceOptions<T>) =>
        new Promise<T | null>((resolve) =>
          push({ kind: 'choose', o: o as ChoiceOptions<string>, resolve: resolve as (v: string | null) => void })
        ),
    }),
    [push]
  );

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useMemo<ToastApi>(() => {
    const show = (kind: ToastKind, message: string, o: ToastOptions = {}) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, kind, message, ...o }]);
      const ms = o.duration ?? (kind === 'error' ? 8000 : o.action ? 6000 : 3500);
      window.setTimeout(() => dismiss(id), ms);
    };
    return {
      show,
      info: (m, o) => show('info', m, o),
      success: (m, o) => show('success', m, o),
      warn: (m, o) => show('warn', m, o),
      error: (m, o) => show('error', m, o),
    };
  }, [dismiss]);

  const current = queue[0];

  return (
    <DialogsContext.Provider value={dialogs}>
      <ToastContext.Provider value={toast}>
        {children}
        {current?.kind === 'confirm' && (
          <ConfirmDialog
            o={current.o}
            onDone={(v) => {
              current.resolve(v);
              settle();
            }}
          />
        )}
        {current?.kind === 'prompt' && (
          <PromptDialog
            o={current.o}
            onDone={(v) => {
              current.resolve(v);
              settle();
            }}
          />
        )}
        {current?.kind === 'choose' && (
          <ChoiceDialog
            o={current.o}
            onDone={(v) => {
              current.resolve(v);
              settle();
            }}
          />
        )}
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={'toast toast-' + t.kind}>
              <Icon
                name={t.kind === 'success' ? 'checkCircle' : t.kind === 'error' ? 'alertCircle' : t.kind === 'warn' ? 'alert' : 'info'}
              />
              <span className="toast-msg">{t.message}</span>
              {t.action && (
                <button
                  className="btn sm"
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button className="btn icon ghost sm" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      </ToastContext.Provider>
    </DialogsContext.Provider>
  );
}

function ConfirmDialog({ o, onDone }: { o: ConfirmOptions; onDone: (v: boolean) => void }) {
  return (
    <Modal
      title={o.title}
      onClose={() => onDone(false)}
      width={420}
      footer={
        <>
          <button className="btn" onClick={() => onDone(false)}>
            {o.cancelLabel ?? 'Cancel'}
          </button>
          <button className={'btn ' + (o.danger ? 'danger-solid' : 'primary')} onClick={() => onDone(true)}>
            {o.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      {o.message && <div className="dialog-message">{o.message}</div>}
    </Modal>
  );
}

function PromptDialog({ o, onDone }: { o: PromptOptions; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(o.initial ?? '');
  const [touched, setTouched] = useState(false);
  const error = o.validate ? o.validate(value) : value.trim() ? null : 'This can’t be empty.';
  const submit = () => {
    setTouched(true);
    if (!error) onDone(value.trim());
  };
  return (
    <Modal
      title={o.title}
      onClose={() => onDone(null)}
      width={440}
      footer={
        <>
          <button className="btn" onClick={() => onDone(null)}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={touched && !!error}>
            {o.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      {o.message && <div className="dialog-message">{o.message}</div>}
      <label className="field">
        {o.label && <span className="field-label">{o.label}</span>}
        <input
          className="input"
          value={value}
          placeholder={o.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          onFocus={(e) => e.target.select()}
          aria-invalid={touched && !!error}
        />
        {touched && error && <span className="field-error">{error}</span>}
      </label>
    </Modal>
  );
}

function ChoiceDialog({ o, onDone }: { o: ChoiceOptions<string>; onDone: (v: string | null) => void }) {
  return (
    <Modal
      title={o.title}
      onClose={() => onDone(null)}
      width={460}
      footer={
        <>
          <button className="btn" onClick={() => onDone(null)}>
            Cancel
          </button>
          {o.choices.map((c) => (
            <button
              key={c.value}
              className={'btn ' + (c.variant === 'primary' ? 'primary' : c.variant === 'danger' ? 'danger' : '')}
              onClick={() => onDone(c.value)}
            >
              {c.label}
            </button>
          ))}
        </>
      }
    >
      {o.message && <div className="dialog-message">{o.message}</div>}
    </Modal>
  );
}

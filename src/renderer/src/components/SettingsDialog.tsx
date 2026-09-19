import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Settings, Theme } from '@shared/types';
import type { AppInfo } from '@shared/api';
import { Modal } from './ui/Modal';
import { Icon } from './ui/Icon';
import { Switch } from './ui/Switch';
import { useDialogs, useToast } from './ui/Dialogs';
import { SecondsInput } from './StepFields';

type Section = 'general' | 'browser' | 'blocking' | 'data';
const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: 'sliders' },
  { id: 'browser', label: 'Browser', icon: 'browser' },
  { id: 'blocking', label: 'Pop-ups & ads', icon: 'shield' },
  { id: 'data', label: 'Data & about', icon: 'database' },
];

interface Props {
  settings: Settings;
  presetName: string;
  running: boolean;
  onClose: () => void;
  onSave: (s: Settings) => Promise<void>;
  /** Live preview while the dialog is open. */
  onPreviewTheme: (t: Theme) => void;
}

function Row({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <span className="setting-title">{title}</span>
        {desc && <span className="setting-desc">{desc}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export function SettingsDialog({ settings, presetName, running, onClose, onSave, onPreviewTheme }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [section, setSection] = useState<Section>('general');
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogs = useDialogs();
  const toast = useToast();
  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));
  const changed = JSON.stringify(draft) !== JSON.stringify(settings);

  useEffect(() => {
    void window.api.appInfo().then(setInfo);
  }, []);

  const close = async () => {
    if (changed) {
      const ok = await dialogs.confirm({ title: 'Discard your changes to settings?', confirmLabel: 'Discard', danger: true });
      if (!ok) return;
    }
    onPreviewTheme(settings.theme);
    onClose();
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  const pickFolder = async () => {
    const dir = await window.api.pickFolder(draft.downloadDir);
    if (dir) set({ downloadDir: dir });
  };

  const clearProfile = async () => {
    const ok = await dialogs.confirm({
      title: 'Clear saved logins?',
      message: 'Cookies, sign-ins and “I’m not a robot” checks the automation browser remembered will be deleted. You’ll need to sign in to sites again.',
      confirmLabel: 'Clear logins',
      danger: true,
    });
    if (!ok) return;
    try {
      await window.api.clearBrowserProfile();
      toast.success('Saved logins cleared');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal
      title="Settings"
      subtitle={<span className="tag">Preset: {presetName}</span>}
      onClose={close}
      width={820}
      className="settings-modal"
      initialFocus=".settings-nav button.on"
      footer={
        <>
          <span className="muted small grow">Changes apply from the next run.</span>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={!changed || saving}>
            Save settings
          </button>
        </>
      }
    >
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button key={s.id} className={section === s.id ? 'on' : ''} onClick={() => setSection(s.id)} aria-current={section === s.id ? 'page' : undefined}>
              <Icon name={s.icon} />
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {section === 'general' && (
            <>
              <Row title="Theme" desc="Follow your system, or pick one.">
                <div className="segmented" role="radiogroup" aria-label="Theme">
                  {(
                    [
                      ['system', 'System', 'monitor'],
                      ['dark', 'Dark', 'moon'],
                      ['light', 'Light', 'sun'],
                    ] as const
                  ).map(([v, l, icon]) => (
                    <button
                      key={v}
                      role="radio"
                      aria-checked={draft.theme === v}
                      className={draft.theme === v ? 'on' : ''}
                      onClick={() => {
                        set({ theme: v });
                        onPreviewTheme(v);
                      }}
                    >
                      <Icon name={icon} size={14} />
                      {l}
                    </button>
                  ))}
                </div>
              </Row>
              <Row title="Download folder" desc="Downloads, screenshots and failure screenshots are saved here.">
                <div className="row gap-sm">
                  <input
                    className="input mono small-text folder-input"
                    value={draft.downloadDir}
                    onChange={(e) => set({ downloadDir: e.target.value })}
                    aria-label="Download folder"
                    spellCheck={false}
                  />
                  <button className="btn" onClick={pickFolder}>
                    Browse…
                  </button>
                </div>
              </Row>
              <Row title="Step time limit" desc="How long a step waits for the page before it fails. Each step can override it.">
                <SecondsInput
                  ms={draft.timeoutMs}
                  label="Step time limit in seconds"
                  onChange={(ms) => set({ timeoutMs: ms && ms >= 1000 ? ms : 15000 })}
                />
              </Row>
              <Row title="Screenshot when a step fails" desc="Saved to “Script Runner errors” in the download folder and listed in Run history.">
                <Switch label="Screenshot when a step fails" checked={draft.screenshotOnError} onChange={(v) => set({ screenshotOnError: v })} />
              </Row>
            </>
          )}

          {section === 'browser' && (
            <>
              <Row title="Show the browser while it runs" desc="Turn off to run in the background (headless). Showing it helps when building a flow.">
                <Switch label="Show the browser while it runs" checked={!draft.headless} onChange={(v) => set({ headless: !v })} />
              </Row>
              <Row title="Slow motion" desc="Adds a pause before every browser action so you can follow along. 0 is full speed.">
                <span className="unit-input">
                  <input
                    className="input num"
                    type="number"
                    min={0}
                    max={5000}
                    step={50}
                    value={draft.slowMoMs}
                    aria-label="Slow motion in milliseconds"
                    onChange={(e) => set({ slowMoMs: Math.max(0, Math.min(5000, Number(e.target.value) || 0)) })}
                  />
                  <span className="unit">ms</span>
                </span>
              </Row>
              <Row
                title="Remember logins between runs"
                desc="Keeps cookies and sign-ins in a private browser profile, so you only sign in once."
              >
                <Switch label="Remember logins between runs" checked={draft.persistentSession} onChange={(v) => set({ persistentSession: v })} />
              </Row>
              <Row title="Saved logins" desc="Sign out of every site in the automation browser.">
                <button className="btn danger-text" onClick={clearProfile} disabled={running}>
                  Clear saved logins
                </button>
              </Row>
            </>
          )}

          {section === 'blocking' && (
            <>
              <Row title="Block ads and trackers" desc="Uses the full Ghostery filter lists, cached on disk, with a built-in list as a fallback.">
                <Switch label="Block ads and trackers" checked={draft.adblock} onChange={(v) => set({ adblock: v })} />
              </Row>
              <Row title="Close pop-up windows" desc="Closes blank and ad pop-up windows as they open.">
                <Switch label="Close pop-up windows" checked={draft.blockPopupWindows} onChange={(v) => set({ blockPopupWindows: v })} />
              </Row>
              <Row
                title="Close pop-up tabs"
                desc="Closes new tabs opened by another site. Tabs on the same site, and real downloads, are always kept."
              >
                <Switch label="Close pop-up tabs" checked={draft.blockPopupTabs} onChange={(v) => set({ blockPopupTabs: v })} />
              </Row>
              <div className="setting-block">
                <span className="setting-title">Always allow these sites</span>
                <span className="setting-desc">One site per line. New tabs to or from these sites are never closed.</span>
                <textarea
                  className="input mono"
                  rows={5}
                  value={draft.popupWhitelist.join('\n')}
                  placeholder={'example.com\ndownloads.example.org'}
                  spellCheck={false}
                  onChange={(e) => set({ popupWhitelist: e.target.value.split(/\n/).map((s) => s.trim()) })}
                  onBlur={() => set({ popupWhitelist: draft.popupWhitelist.filter(Boolean) })}
                />
              </div>
            </>
          )}

          {section === 'data' && (
            <>
              <Row title="Where your data lives" desc={<span className="mono small-text break">{info?.dataDir ?? '…'}</span>}>
                <span />
              </Row>
              <Row title="Version" desc={info ? `Script Runner ${info.version} · Electron ${info.electron} · Chromium ${info.chrome}` : '…'}>
                <button className="btn" onClick={() => void window.api.openExternal('https://github.com/Ahmed-Yusuf-1/script-runner')}>
                  <Icon name="external" />
                  Project page
                </button>
              </Row>
              <p className="setting-desc">
                Script Runner drives a real browser on your behalf. Only automate sites and accounts you’re allowed to, and respect each
                site’s terms and rate limits.
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

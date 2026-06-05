import { useState } from 'react';
import type { Settings } from '@shared/types';

interface Props {
  settings: Settings;
  onClose: () => void;
  onSave: (settings: Settings) => void;
}

export function SettingsDialog({ settings, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <label className="setting">
          <input
            type="checkbox"
            checked={draft.headless}
            onChange={(e) => setDraft({ ...draft, headless: e.target.checked })}
          />
          Run browser hidden (headless)
        </label>

        <label className="setting">
          <input
            type="checkbox"
            checked={draft.adblock}
            onChange={(e) => setDraft({ ...draft, adblock: e.target.checked })}
          />
          Block ads &amp; trackers (filter lists)
        </label>

        <label className="setting">
          <input
            type="checkbox"
            checked={draft.blockPopupWindows}
            onChange={(e) => setDraft({ ...draft, blockPopupWindows: e.target.checked })}
          />
          Block pop-up windows
        </label>

        <label className="setting">
          <input
            type="checkbox"
            checked={draft.blockPopupTabs}
            onChange={(e) => setDraft({ ...draft, blockPopupTabs: e.target.checked })}
          />
          Block pop-up tabs
        </label>

        <label className="setting col">
          <span>Always allow pop-up tabs from these sites (one per line)</span>
          <textarea
            rows={3}
            value={draft.popupWhitelist.join('\n')}
            placeholder={'datanodes.to\nfilecrypt.cc'}
            onChange={(e) =>
              setDraft({
                ...draft,
                popupWhitelist: e.target.value
                  .split(/[\n,]+/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>

        <label className="setting">
          <input
            type="checkbox"
            checked={draft.persistentSession}
            onChange={(e) => setDraft({ ...draft, persistentSession: e.target.checked })}
          />
          Remember logins &amp; checks (keep browser profile)
        </label>

        <label className="setting col">
          <span>Download / screenshot folder</span>
          <input
            value={draft.downloadDir}
            onChange={(e) => setDraft({ ...draft, downloadDir: e.target.value })}
          />
        </label>

        <label className="setting col">
          <span>Default step timeout (ms)</span>
          <input
            type="number"
            value={draft.timeoutMs}
            onChange={(e) => setDraft({ ...draft, timeoutMs: Number(e.target.value) || 15000 })}
          />
        </label>

        <div className="modal-buttons">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={() => onSave(draft)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

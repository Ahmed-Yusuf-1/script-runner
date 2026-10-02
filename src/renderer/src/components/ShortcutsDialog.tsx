import { Modal } from './ui/Modal';
import { comboLabel } from '../hooks/useShortcuts';

export const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: 'Flows',
    items: [
      ['mod+s', 'Save the flow'],
      ['mod+n', 'New flow'],
      ['mod+f', 'Search flows'],
      ['mod+,', 'Settings'],
    ],
  },
  {
    group: 'Running',
    items: [
      ['mod+enter', 'Run the flow'],
      ['mod+shift+enter', 'Run from the selected step'],
      ['mod+.', 'Stop the run'],
    ],
  },
  {
    group: 'Editing',
    items: [
      ['mod+z', 'Undo'],
      ['mod+shift+z', 'Redo'],
      ['mod+d', 'Duplicate the selected step'],
      ['mod+c', 'Copy the selected step'],
      ['mod+v', 'Paste a step'],
      ['alt+arrowup', 'Move the selected step up'],
      ['alt+arrowdown', 'Move the selected step down'],
      ['?', 'Show these shortcuts'],
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width={520}>
      <div className="shortcuts">
        {SHORTCUTS.map((g) => (
          <div key={g.group} className="shortcut-group">
            <div className="field-label">{g.group}</div>
            {g.items.map(([combo, label]) => (
              <div key={combo} className="shortcut-row">
                <span>{label}</span>
                <span className="keys">
                  {comboLabel(combo)
                    .split(' ')
                    .map((k) => (
                      <kbd key={k} className="kbd">
                        {k}
                      </kbd>
                    ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}

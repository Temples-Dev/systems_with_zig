interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ["Ctrl", "Enter"], description: "Run / Test code" },
  { keys: ["Cmd/Ctrl", "K"], description: "Open search palette" },
  { keys: ["?"], description: "Open this keyboard reference" },
  { keys: ["Esc"], description: "Close any modal" },
  { keys: ["↑", "↓"], description: "Navigate search results" },
  { keys: ["↵"], description: "Open selected search result" },
];

export function KeyboardShortcuts({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-sm mx-4 rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <span className="text-sm font-semibold text-foreground">Keyboard Shortcuts</span>
          <kbd className="text-[10px] font-mono bg-secondary text-muted-foreground border border-border px-1.5 py-0.5 rounded">
            ESC
          </kbd>
        </div>
        <ul className="py-2">
          {SHORTCUTS.map((s) => (
            <li key={s.description} className="flex items-center justify-between px-5 py-2.5">
              <span className="text-sm text-foreground">{s.description}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-secondary text-foreground border border-border">
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <div className="px-5 py-3 border-t border-border">
          <p className="text-[10px] text-muted-foreground">
            Press <kbd className="font-mono bg-secondary border border-border px-1 rounded">?</kbd> anywhere to toggle this panel
          </p>
        </div>
      </div>
    </div>
  );
}

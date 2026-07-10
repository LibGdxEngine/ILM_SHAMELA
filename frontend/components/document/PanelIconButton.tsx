'use client';

interface PanelIconButtonProps {
  onClick: () => void;
  label: string;
  icon: 'pin' | 'close' | 'history' | 'trash' | 'plus';
  /** Pin only: filled/active styling when pinned. */
  active?: boolean;
  disabled?: boolean;
}

/**
 * Small icon button for reader side-panel chrome (pin / close / history / trash
 * / plus). Shared by the advanced-search panel and the assistant so both read
 * identically. Only the pin icon uses the filled `active` styling.
 */
export default function PanelIconButton({ onClick, label, icon, active, disabled }: PanelIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={icon === 'pin' ? Boolean(active) : undefined}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        color: icon === 'pin' && active ? 'var(--rr-brand)' : 'var(--rr-ink-3)',
        background: icon === 'pin' && active ? 'rgba(176,125,43,0.12)' : 'transparent',
      }}
    >
      {icon === 'pin' && (
        // A pushpin; rotated slightly when unpinned to read as "loose".
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          style={{ transform: active ? 'none' : 'rotate(45deg)' }}
        >
          <path d="M12 17v5" />
          <path d="M9 10.8V4h6v6.8l2 2.2H7l2-2.2Z" />
        </svg>
      )}
      {icon === 'close' && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      )}
      {icon === 'history' && (
        // Clock face with a counter-clockwise arrow = conversation history.
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 3v5h5" />
          <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
          <path d="M12 7v5l4 2" />
        </svg>
      )}
      {icon === 'trash' && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      )}
      {icon === 'plus' && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      )}
    </button>
  );
}

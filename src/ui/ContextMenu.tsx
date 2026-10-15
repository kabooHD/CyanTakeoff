import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type MenuItem =
  | { sep: true }
  | { label: string; action?: () => void; shortcut?: string; disabled?: boolean; checked?: boolean; sep?: false };

export function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <div className="menu-list" role="menu">
      {items.map((it, i) =>
        it.sep ? <div key={i} className="menu-sep" /> : (
          <button key={i} role="menuitem" className="menu-item" disabled={it.disabled}
            onClick={() => { onClose(); it.action?.(); }}>
            <span className="menu-check">{it.checked ? '✓' : ''}</span>
            <span className="menu-label">{it.label}</span>
            <span className="menu-shortcut">{it.shortcut}</span>
          </button>
        ))}
    </div>
  );
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(x, innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, innerHeight - r.height - 4)) });
  }, [x, y]);
  useEffect(() => {
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', esc); };
  }, [onClose]);
  return (
    <div ref={ref} className="context-menu" style={{ left: pos.x, top: pos.y }}>
      <MenuList items={items} onClose={onClose} />
    </div>
  );
}

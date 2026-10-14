// Help > Find Tools + Commands (Revu): type part of a command's name and run
// it. The menu bar registers its items on every render (so disabled states
// and checkmarks are current); tools come from the tool list.
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useApp } from '../model/store';
import { TOOLS } from '../tools/tools';
import { rankCommands, type CommandEntry } from '../model/commandSearch';
import { effectiveCombo } from './commands';
import type { MenuItem } from './ContextMenu';

export const useCommandFinder = create<{ open: boolean }>(() => ({ open: false }));
export const openCommandFinder = () => useCommandFinder.setState({ open: true });

let menuEntries: CommandEntry[] = [];
/** Called by the menu bar with its current menus. */
export function registerMenus(menus: Record<string, MenuItem[]>) {
  const out: CommandEntry[] = [];
  for (const [menu, items] of Object.entries(menus)) {
    for (const it of items) {
      if (it.sep || !it.action) continue;
      const run = it.action;
      out.push({ label: it.label.replace(/…$/, ''), path: menu, shortcut: it.shortcut, disabled: it.disabled, run });
    }
  }
  menuEntries = out;
}

const TOOL_GROUP: Record<string, string> = { navigate: 'Tools', markup: 'Tools > Markup', measure: 'Tools > Measure', form: 'Tools > Form' };

function allEntries(): CommandEntry[] {
  const s = useApp.getState();
  const noDoc = !s.docs.length;
  const tools: CommandEntry[] = TOOLS.filter((t) => !['viewport', 'space', 'legend', 'visual-pick', 'region-pick', 'caret'].includes(t.id)).map((t) => ({
    label: t.name, path: TOOL_GROUP[t.group] ?? 'Tools', shortcut: effectiveCombo(`tool:${t.id}`, s.customKeys) || undefined, disabled: noDoc, run: () => useApp.getState().setTool(t.id),
  }));
  const seen = new Set(menuEntries.map((e) => `${e.path}:${e.label}`));
  return [...menuEntries, ...tools.filter((t) => !seen.has(`${t.path}:${t.label}`))];
}

export function CommandFinderDialog() {
  const open = useCommandFinder((x) => x.open);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => box.current?.focus(), 0); } }, [open]);
  if (!open) return null;
  const close = () => useCommandFinder.setState({ open: false });
  const hits = rankCommands(allEntries(), q);
  const run = (e: CommandEntry | undefined) => { if (!e || e.disabled) return; close(); e.run(); };
  const cur = Math.min(sel, Math.max(0, hits.length - 1));
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal command-finder" role="dialog" aria-label="Find Tools + Commands" onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(cur + 1, hits.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(cur - 1, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); run(hits[cur]); }
      }}>
        <input ref={box} aria-label="Find tools and commands" placeholder="Find tools + commands" value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} />
        <div className="command-list" role="listbox" aria-label="Commands">
          {hits.map((h, i) => (
            <div key={`${h.path}:${h.label}`} role="option" aria-selected={i === cur} aria-disabled={h.disabled || undefined}
              className={`command-row${i === cur ? ' selected' : ''}${h.disabled ? ' disabled' : ''}`}
              onMouseEnter={() => setSel(i)} onClick={() => run(h)}>
              <span className="command-label">{h.label}</span>
              <span className="command-path">{h.path}</span>
              <span className="menu-shortcut">{h.shortcut}</span>
            </div>
          ))}
          {!hits.length && <div className="muted small" style={{ padding: 8 }}>No command matches "{q}".</div>}
        </div>
      </div>
    </div>
  );
}

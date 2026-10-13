// Revu menu equivalents: Keyboard Shortcuts editor and Profiles (saved
// workspace setups: panels, snaps, tool defaults, Tool Chest, shortcuts).
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useApp } from '../model/store';
import { comboFromEvent } from '../tools/tools';
import { allCommands, effectiveCombo, usersOf } from './commands';
import { pickFile } from './toolActions';

export const usePrefsDialog = create<{ open: 'keys' | 'profiles' | null }>(() => ({ open: null }));
const close = () => usePrefsDialog.setState({ open: null });

export function PrefsDialogs() {
  const open = usePrefsDialog((x) => x.open);
  if (open === 'keys') return <KeysDialog />;
  if (open === 'profiles') return <ProfilesDialog />;
  return null;
}

function Frame({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

function KeysDialog() {
  const s = useApp();
  const [q, setQ] = useState('');
  const [capture, setCapture] = useState<string | null>(null);
  const custom = s.customKeys;
  // Capture the next key combination for the command being changed.
  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      if (e.key === 'Escape') { setCapture(null); return; }
      const combo = comboFromEvent(e);
      const others = usersOf(combo, custom).filter((x) => x.id !== capture);
      if (others.length && !confirm(`${combo} is used by ${others.map((x) => x.label).join(', ')}. Reassign it?`)) { setCapture(null); return; }
      const next = { ...custom, [capture]: combo };
      for (const o of others) next[o.id] = ''; // Revu "Reassign": the other command loses it
      s.setCustomKeys(next);
      setCapture(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capture, custom, s]);
  const cmds = allCommands().filter((c) => !q || `${c.group} ${c.label}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Frame title="Keyboard Shortcuts" wide>
      <div className="scale-dialog">
        <input aria-label="Filter commands" placeholder="Filter commands" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="keys-list">
          <table className="cc-list">
            <thead><tr><th>Group</th><th>Command</th><th>Shortcut</th><th /></tr></thead>
            <tbody>
              {cmds.map((c) => {
                const cur = effectiveCombo(c.id, custom);
                return (
                  <tr key={c.id} className={c.id in custom ? 'custom' : ''}>
                    <td className="muted">{c.group}</td><td>{c.label}</td>
                    <td>{capture === c.id ? <em>Press keys… (Esc cancels)</em> : <kbd>{cur || '—'}</kbd>}</td>
                    <td className="cc-actions">
                      <button onClick={() => setCapture(c.id)} aria-label={`Change shortcut for ${c.label}`}>Change</button>
                      <button disabled={!(c.id in custom)} onClick={() => { const n = { ...custom }; delete n[c.id]; s.setCustomKeys(n); }}>Reset</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="modal-actions">
          <button disabled={!Object.keys(custom).length} onClick={() => s.setCustomKeys({})}>Reset All</button>
          <span className="spacer" />
          <button className="primary" onClick={close}>Close</button>
        </div>
      </div>
    </Frame>
  );
}

// ---------------- Profiles ----------------

const LS = 'cyantakeoff:profiles';
interface Profile {
  name: string;
  left: unknown; right: unknown; markupsList: boolean; toggles: unknown;
  toolDefaults: unknown; toolSets: unknown; customKeys: Record<string, string>;
}
const load = (): Profile[] => { try { return JSON.parse(localStorage.getItem(LS) ?? '[]'); } catch { return []; } };
const store = (p: Profile[]) => { try { localStorage.setItem(LS, JSON.stringify(p)); } catch { /* storage unavailable */ } };

function capture(name: string): Profile {
  const s = useApp.getState();
  return { name, left: s.left, right: s.right, markupsList: s.markupsList, toggles: s.toggles, toolDefaults: s.toolDefaults, toolSets: s.toolSets, customKeys: s.customKeys };
}

export function applyProfile(p: Profile) {
  const s = useApp.getState();
  useApp.setState({ toggles: p.toggles as never, toolDefaults: p.toolDefaults as never, toolSets: p.toolSets as never });
  s.setCustomKeys(p.customKeys ?? {});
  s.setPanels({ left: p.left as never, right: p.right as never, markupsList: p.markupsList });
  s.setStatus(`Profile "${p.name}" applied`);
}

function ProfilesDialog() {
  const [list, setList] = useState(load);
  const save = (l: Profile[]) => { setList(l); store(l); };
  return (
    <Frame title="Profiles">
      <div className="scale-dialog">
        <p className="muted small">A profile saves your workspace: open panels, snaps, tool defaults, Tool Chest and keyboard shortcuts.</p>
        <table className="cc-list">
          <tbody>
            {list.map((p, i) => (
              <tr key={i}>
                <td>{p.name}</td>
                <td className="cc-actions">
                  <button onClick={() => { applyProfile(p); close(); }}>Apply</button>
                  <button onClick={() => save(list.map((x, k) => (k === i ? capture(p.name) : x)))}>Update</button>
                  <button onClick={() => {
                    const href = URL.createObjectURL(new Blob([JSON.stringify({ format: 'cyantakeoff-profile', version: 1, ...p })], { type: 'application/json' }));
                    Object.assign(document.createElement('a'), { href, download: `${p.name}.ctprofile.json` }).click();
                  }}>Export</button>
                  <button onClick={() => save(list.filter((_, k) => k !== i))}>Delete</button>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td className="muted">No saved profiles.</td></tr>}
          </tbody>
        </table>
        <div className="modal-actions">
          <button onClick={() => { const n = prompt('Profile name', 'My Profile'); if (n) save([...list.filter((x) => x.name !== n), capture(n)]); }}>Save Current…</button>
          <button onClick={async () => {
            const f = await pickFile('.json,application/json');
            if (!f) return;
            try { const p = JSON.parse(await f.text()); if (p.format !== 'cyantakeoff-profile') throw new Error(); save([...list, p]); }
            catch { useApp.getState().setStatus(`${f.name} is not a CyanTakeoff profile`); }
          }}>Import…</button>
          <span className="spacer" />
          <button className="primary" onClick={close}>Close</button>
        </div>
      </div>
    </Frame>
  );
}

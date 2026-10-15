// File Access panel (Revu, Alt+A) and the start page's recent list: reopen
// recent files (with file access the browser asks once for permission),
// pin, remove, clear.
import { useEffect } from 'react';
import { useApp } from '../model/store';
import { clearRecent, forgetFile, loadRecent, pinFile, useRecent, type RecentFile } from '../model/recent';
import { loadSession, sessionFiles, usePendingSession } from '../model/session';
import { openFile, openSample } from './actions';

export const SAMPLE_NAME = 'Sample Floor Plan.pdf';

export async function reopen(r: RecentFile) {
  const s = useApp.getState();
  const open = s.docs.find((d) => d.name === r.name);
  if (open) { s.setActive(open.id); return; }
  if (r.name === SAMPLE_NAME && !r.handle) { await openSample(); return; }
  if (!r.handle) { s.setStatus(`${r.name} was opened without file access; open it again with File > Open.`); await openFile(); return; }
  try {
    const h = r.handle as FileSystemFileHandle & { queryPermission?: (o: object) => Promise<string>; requestPermission?: (o: object) => Promise<string> };
    if (h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      const p = await h.requestPermission?.({ mode: 'readwrite' });
      if (p !== 'granted' && (await h.queryPermission({ mode: 'read' })) !== 'granted') { s.setStatus(`No permission to open ${r.name}`); return; }
    }
    const f = await h.getFile();
    await s.openBytes(new Uint8Array(await f.arrayBuffer()), f.name, h);
  } catch {
    s.setStatus(`${r.name} could not be opened (moved or deleted?).`);
  }
}

/**
 * Reopen Files from Last Session on Startup: the sample and files whose
 * access is still granted open now; the others wait in the File Access
 * panel for a click (a browser asks for file access on a gesture).
 */
export async function reopenLastSession() {
  const s = useApp.getState();
  await loadRecent();
  const { files, missing } = sessionFiles(loadSession(), useRecent.getState().list, SAMPLE_NAME);
  const pending: RecentFile[] = [];
  for (const r of files) {
    const h = r.handle as (FileSystemFileHandle & { queryPermission?: (o: object) => Promise<string> }) | undefined;
    const granted = !h ? r.name === SAMPLE_NAME : h.queryPermission ? (await h.queryPermission({ mode: 'read' }).catch(() => 'prompt')) === 'granted' : false;
    if (granted) await reopen(r); else pending.push(r);
  }
  usePendingSession.setState({ pending });
  if (pending.length) { s.setPanels({ left: 'files' }); s.setStatus(`${pending.length} file${pending.length === 1 ? '' : 's'} from the last session can be reopened from the File Access panel.`); }
  if (missing.length) s.setStatus(`${missing.join(', ')} from the last session ${missing.length === 1 ? 'was' : 'were'} opened without file access: open ${missing.length === 1 ? 'it' : 'them'} again with File > Open.`);
}

/** The File Access panel's button for the files still waiting (needs the click). */
function PendingSession() {
  const pending = usePendingSession((x) => x.pending);
  if (!pending.length) return null;
  const go = async () => { usePendingSession.setState({ pending: [] }); for (const r of pending) await reopen(r); };
  return <button className="primary" onClick={go}>Reopen last session ({pending.length})</button>;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
};

export function RecentList({ limit }: { limit?: number }) {
  const list = useRecent((x) => x.list);
  useEffect(() => { loadRecent(); }, []);
  const shown = limit ? list.slice(0, limit) : list;
  if (!shown.length) return <p className="muted small">No recent files yet.</p>;
  return (
    <div className="recent-list" role="list" aria-label="Recent files">
      {shown.map((r) => (
        <div key={r.name} role="listitem" className="space-row recent-row" title={r.handle ? r.name : `${r.name} (opened without file access)`} onDoubleClick={() => reopen(r)}>
          <button className="recent-name" onClick={() => reopen(r)}>{r.name}</button>
          <span className="muted">{when(r.opened)}</span>
          <button className={`recent-pin ${r.pinned ? 'on' : ''}`} title={r.pinned ? 'Unpin' : 'Pin to the top'} onClick={() => pinFile(r.name, !r.pinned)}>📌</button>
          <button className="recent-x" title="Remove from the list" onClick={() => forgetFile(r.name)}>×</button>
        </div>
      ))}
    </div>
  );
}

export function FileAccessPanel() {
  return (
    <div className="spaces-panel">
      <div className="prop-actions">
        <button onClick={openFile}>Open…</button>
        <button onClick={() => clearRecent()}>Clear Recent</button>
        <PendingSession />
      </div>
      <div className="links-head">Recent Files</div>
      <RecentList />
      <p className="muted small">Kept in this browser only. Files opened with File &gt; Open (Chrome, Edge) reopen and save in place.</p>
    </div>
  );
}

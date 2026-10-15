// Edit > Undo History (Revu): the unsaved steps, newest first; pick one to
// undo back to it.
import { create } from 'zustand';
import { useApp, type UndoEntry } from '../model/store';

export const useUndoHistory = create<{ open: boolean }>(() => ({ open: false }));

/** A short description of an undo step. */
export function describeUndo(e: UndoEntry): string {
  if (Array.isArray(e)) return 'Markups';
  if ('doc' in e) return 'Pages / document';
  return 'Scale and viewports';
}

export function UndoHistoryDialog() {
  const open = useUndoHistory((x) => x.open);
  const d = useApp((s) => s.docs.find((x) => x.id === s.activeId));
  if (!open || !d) return null;
  const close = () => useUndoHistory.setState({ open: false });
  const steps = [...d.undo].reverse();
  const undoTo = (n: number) => { close(); const s = useApp.getState(); for (let i = 0; i < n; i++) s.undo(); s.setStatus(`Undid ${n} step${n === 1 ? '' : 's'}`); };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Undo History" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">Undo History</div>
        <div className="scale-dialog">
          {!steps.length && <p className="muted">Nothing to undo.</p>}
          <div className="keys-list" style={{ maxHeight: 320, overflow: 'auto' }}>
            {steps.map((e, i) => (
              <div key={i} className="form-row">
                <span>{i + 1}. {describeUndo(e)}</span>
                <button aria-label={`Undo to step ${i + 1}`} onClick={() => undoTo(i + 1)}>Undo to here</button>
              </div>
            ))}
          </div>
          <div className="modal-actions"><span className="spacer" /><button onClick={close}>Close</button></div>
        </div>
      </div>
    </div>
  );
}

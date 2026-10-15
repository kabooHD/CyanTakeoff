// "Files: This document / All open documents" for dialogs that can run as a
// batch (Revu's Batch menu runs the same commands over many files). The
// Batch menu sets a hint so the dialog opens with every document chosen.
import { useApp, type DocState } from '../model/store';

let hint = false;
export const batchHint = {
  set() { hint = true; },
  /** Read and clear the hint (a dialog's initial "all documents" state). */
  take() { const v = hint; hint = false; return v; },
};

export function FilesRow({ all, setAll }: { all: boolean; setAll: (v: boolean) => void }) {
  const n = useApp((s) => s.docs.length);
  if (n < 2) return null;
  return (
    <div className="form-row"><span>Files</span>
      <select aria-label="Files" value={all ? 'all' : 'this'} onChange={(e) => setAll(e.target.value === 'all')}>
        <option value="this">This document</option><option value="all">All open documents ({n})</option>
      </select>
    </div>
  );
}

/** The documents a dialog applies to: the active one first, then the other open ones when `all`. */
export function targets(d: DocState, all: boolean): DocState[] {
  const docs = useApp.getState().docs;
  return all ? [d, ...docs.filter((x) => x.id !== d.id)] : [d];
}

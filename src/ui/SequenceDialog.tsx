// Tool Chest > Sequence > Define: how a tool numbers the markups it places.
import { useState } from 'react';
import { create } from 'zustand';
import { useApp } from '../model/store';
import { DEFAULT_SEQUENCE, formatSequence, type SequenceDef } from '../model/sequence';
import type { ToolPreset } from '../model/types';

export const useSequenceDialog = create<{ toolId: string | null }>(() => ({ toolId: null }));

/** Change one Tool Chest tool (and the active tool, if it is that one). */
export function updateTool(id: string, fn: (p: ToolPreset) => ToolPreset) {
  const s = useApp.getState();
  s.setToolSets(s.toolSets.map((set) => ({ ...set, tools: set.tools.map((p) => (p.id === id ? fn(p) : p)) })));
  if (s.preset?.id === id) useApp.setState({ preset: fn(s.preset) });
}

export function SequenceDialog() {
  const id = useSequenceDialog((x) => x.toolId);
  const tool = useApp((s) => s.toolSets.flatMap((t) => t.tools).find((p) => p.id === id));
  if (!id || !tool) return null;
  return <SequenceForm tool={tool} />;
}

function SequenceForm({ tool }: { tool: ToolPreset }) {
  const [d, setD] = useState<SequenceDef>(tool.sequence ?? DEFAULT_SEQUENCE);
  const close = () => useSequenceDialog.setState({ toolId: null });
  const set = (p: Partial<SequenceDef>) => setD({ ...d, ...p });
  const sample = [0, 1, 2].map((i) => formatSequence(d, d.start + i * (d.step || 1))).join(', ') + ', …';
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Sequence" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">Sequence: {tool.name}</div>
        <div className="scale-dialog">
          <div className="form-row"><span>Format</span>
            <select aria-label="Format" value={d.format} onChange={(e) => set({ format: e.target.value as SequenceDef['format'] })}>
              <option value="number">1, 2, 3</option><option value="upper">A, B, C</option><option value="lower">a, b, c</option>
            </select>
          </div>
          <div className="form-row"><span>Start</span><input aria-label="Start" type="number" min={0} value={d.start} onChange={(e) => set({ start: Math.max(0, Math.floor(+e.target.value)) })} /></div>
          <div className="form-row"><span>Increment</span><input aria-label="Increment" type="number" min={1} value={d.step} onChange={(e) => set({ step: Math.max(1, Math.floor(+e.target.value)) })} /></div>
          {d.format === 'number' && <div className="form-row"><span>Digits</span><input aria-label="Digits" type="number" min={1} max={8} value={d.digits} onChange={(e) => set({ digits: Math.max(1, Math.min(8, Math.floor(+e.target.value))) })} /></div>}
          <div className="form-row"><span>Prefix</span><input aria-label="Prefix" value={d.prefix} onChange={(e) => set({ prefix: e.target.value })} /></div>
          <div className="form-row"><span>Suffix</span><input aria-label="Suffix" value={d.suffix} onChange={(e) => set({ suffix: e.target.value })} /></div>
          <div className="form-row"><span>Preview</span><span aria-label="Sequence preview">{sample}</span></div>
          <p className="muted small">Each markup placed with this tool takes the next value. Text boxes and callouts show it as their text; other markups show it as their label.</p>
          <div className="modal-actions"><span className="spacer" />
            <button className="primary" onClick={() => { updateTool(tool.id, (p) => ({ ...p, sequence: { ...d, run: tool.sequence?.run ?? 1 } })); close(); }}>OK</button>
            <button onClick={close}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Signatures: draw or type a signature, keep it for reuse, and place it on
// the drawing as an image markup (subject "Signature").
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useApp } from '../model/store';

const LS = 'cyantakeoff:signature';
export const useSignature = create<{ open: boolean }>(() => ({ open: false }));

/** The saved signature image (PNG data URL with its size), if any. */
export function savedSignature(): { url: string; w: number; h: number } | null {
  try { return JSON.parse(localStorage.getItem(LS) ?? 'null'); } catch { return null; }
}

/** Start placing the signature: the next click puts it on the page. */
export function placeSignature(sig: { url: string; w: number; h: number }) {
  useApp.setState({ pendingImage: { ...sig, subject: 'Signature' } });
  useApp.getState().setTool('image');
  useApp.getState().setStatus('Click on the drawing to place your signature.');
}

export function SignatureDialog() {
  const open = useSignature((x) => x.open);
  return open ? <SignatureForm /> : null;
}

function SignatureForm() {
  const ref = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [name, setName] = useState(useApp.getState().author);
  const [inked, setInked] = useState(false);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const close = () => useSignature.setState({ open: false });
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (mode === 'type' && name) {
      ctx.fillStyle = '#0a1f5c';
      ctx.font = 'italic 52px "Brush Script MT", "Segoe Script", cursive';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, 16, c.height / 2, c.width - 32);
    }
  }, [mode, name]);
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * ref.current!.width, y: ((e.clientY - r.top) / r.height) * ref.current!.height };
  };
  const done = () => {
    const c = ref.current!;
    // Trim to the ink so the placed image is tight.
    const ctx = c.getContext('2d')!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 <= x0) return;
    const t = Object.assign(document.createElement('canvas'), { width: x1 - x0 + 8, height: y1 - y0 + 8 });
    t.getContext('2d')!.drawImage(c, x0 - 4, y0 - 4, t.width, t.height, 0, 0, t.width, t.height);
    const sig = { url: t.toDataURL('image/png'), w: t.width / 3, h: t.height / 3 };
    try { localStorage.setItem(LS, JSON.stringify(sig)); } catch { /* storage unavailable */ }
    close();
    placeSignature(sig);
  };
  const saved = savedSignature();
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Signature" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">Signature</div>
        <div className="scale-dialog">
          <div className="form-row scale-modes">
            <label><input type="radio" checked={mode === 'draw'} onChange={() => setMode('draw')} /> Draw</label>
            <label><input type="radio" checked={mode === 'type'} onChange={() => setMode('type')} /> Type</label>
            {mode === 'type' && <input aria-label="Signature name" value={name} onChange={(e) => setName(e.target.value)} />}
          </div>
          <canvas ref={ref} width={600} height={160} className="signature-pad" aria-label="Signature pad"
            onPointerDown={(e) => { if (mode !== 'draw') return; drawing.current = pos(e); (e.target as Element).setPointerCapture(e.pointerId); }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const p = pos(e), ctx = ref.current!.getContext('2d')!;
              ctx.strokeStyle = '#0a1f5c'; ctx.lineWidth = 3; ctx.lineCap = 'round';
              ctx.beginPath(); ctx.moveTo(drawing.current.x, drawing.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
              drawing.current = p; setInked(true);
            }}
            onPointerUp={() => { drawing.current = null; }} />
          <p className="muted small">An image signature, like Revu's signature stamps. Certificate-based digital signatures are not supported yet.</p>
          <div className="modal-actions">
            <button onClick={() => { ref.current!.getContext('2d')!.clearRect(0, 0, 600, 160); setInked(false); }}>Clear</button>
            {saved && <button onClick={() => { close(); placeSignature(saved); }}>Use Saved</button>}
            <span className="spacer" />
            <button className="primary" disabled={mode === 'draw' ? !inked : !name.trim()} onClick={done}>Place</button>
            <button onClick={close}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

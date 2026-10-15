// Sketch to Scale bar (Revu's measurements dialog): after the first click,
// type Length (Tab) Rotation (Enter) per side for polygons and polylines,
// Enter twice or C to close; Length, Width, Rotation then Enter for a
// rectangle or ellipse. Lengths are in the page's scale units (inches
// without a scale); rotation is degrees counter-clockwise, relative to the
// page or to the previous side.
import { useEffect, useRef, useState } from 'react';
import type { MarkupType, Pt, Scale } from '../model/types';
import { nextPoint, parseLengthInput, sketchEllipse, sketchPt, sketchRectangle, type SketchKind } from '../model/sketch';
import { unitLabel } from '../model/measure';
import { useApp } from '../model/store';

export function SketchBar({ kind, points, scale, onPoint, onCommit, onFinish, onCancel }: {
  kind: SketchKind; points: Pt[]; scale: Scale | null;
  onPoint: (p: Pt) => void; onCommit: (type: MarkupType, points: Pt[]) => void; onFinish: () => void; onCancel: () => void;
}) {
  const [len, setLen] = useState('');
  const [wid, setWid] = useState('');
  const [rot, setRot] = useState('0');
  const [relative, setRelative] = useState(() => useApp.getState().prefs.sketchRotation === 'relative');
  const [lastAngle, setLastAngle] = useState(0);
  const lenRef = useRef<HTMLInputElement>(null);
  const shape = kind === 'rectangle' || kind === 'ellipse';
  const unit = scale ? unitLabel(scale.unit) : 'in';
  // The first click puts the text cursor in Length (Revu).
  useEffect(() => { if (points.length) lenRef.current?.focus(); }, [points.length]);
  const l = parseLengthInput(len, scale?.unit ?? null), w = parseLengthInput(wid, scale?.unit ?? null), r = Number(rot) || 0;
  const commit = () => {
    const anchor = points[0];
    if (!anchor) return;
    if (shape) {
      if (l === null || w === null || l <= 0 || w <= 0) return;
      const pw = sketchPt(l, scale), ph = sketchPt(w, scale, true);
      if (kind === 'rectangle') {
        onCommit(r % 360 ? 'polygon' : 'rectangle', r % 360 ? sketchRectangle(anchor, pw, ph, r) : [anchor, { x: anchor.x + pw, y: anchor.y + ph }]);
      } else {
        // Preferences > Sketch > Ellipse mode: Radius doubles the typed values.
        const k = useApp.getState().prefs.ellipseMode === 'radius' ? 2 : 1;
        onCommit(r % 360 ? 'polygon' : 'ellipse', r % 360 ? sketchEllipse(anchor, pw * k, ph * k, r) : [anchor, { x: anchor.x + pw * k, y: anchor.y + ph * k }]);
      }
      return;
    }
    // A side: Length then Rotation. Enter with no length closes (Enter twice, as in Revu).
    if (l === null) { onFinish(); return; }
    if (l <= 0) return;
    const angle = relative ? lastAngle + r : r;
    onPoint(nextPoint(points[points.length - 1], sketchPt(l, scale), angle));
    setLastAngle(angle);
    setLen('');
    if (relative) setRot('0');
    lenRef.current?.focus();
  };
  const keys = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    else if (!shape && e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); onFinish(); }
  };
  const names: Record<SketchKind, string> = { polygon: 'Polygon', polyline: 'Polyline', rectangle: 'Rectangle', ellipse: 'Ellipse' };
  return (
    <div className="fill-bar" role="toolbar" aria-label="Sketch to Scale" onKeyDown={keys}>
      <strong>{names[kind]} Sketch</strong>
      {!points.length ? <span className="muted small">Click the first point on the drawing.</span> : (
        <>
          <label>{kind === 'ellipse' ? 'Width' : 'Length'} <input ref={lenRef} aria-label="Sketch length" value={len} onChange={(e) => setLen(e.target.value)} style={{ width: 70 }} placeholder={unit} /></label>
          {shape && <label>{kind === 'ellipse' ? 'Length' : 'Width'} <input aria-label="Sketch width" value={wid} onChange={(e) => setWid(e.target.value)} style={{ width: 70 }} placeholder={unit} /></label>}
          <label>Rotation <input aria-label="Sketch rotation" type="number" step="any" value={rot} onChange={(e) => setRot(e.target.value)} style={{ width: 60 }} />°</label>
          {!shape && <label><input type="checkbox" checked={relative} onChange={(e) => setRelative(e.target.checked)} /> Relative to last side</label>}
          <span className="muted small">{shape ? 'Enter places it' : `${points.length} point${points.length === 1 ? '' : 's'} · Enter adds a side, Enter again or C closes`}</span>
        </>
      )}
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}

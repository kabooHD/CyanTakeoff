import { calloutAttach } from '../pdf/save';
import { arcPoints, arcThrough, bounds, centroid, cloudSegments, measure, rectCorners, rectPairs } from '../model/measure';
import type { Cutout, Markup, Pt } from '../model/types';

const pts = (p: Pt[]) => p.map((q) => `${q.x},${q.y}`).join(' ');

export function cloudPath(points: Pt[], width: number) {
  const segs = cloudSegments(points, Math.max(14, width * 8));
  if (!segs.length) return '';
  return segs.map(([p0, c1, c2, p1], i) =>
    `${i ? '' : `M${p0.x},${p0.y}`}C${c1.x},${c1.y} ${c2.x},${c2.y} ${p1.x},${p1.y}`).join('') + 'Z';
}

function arrowHead(from: Pt, to: Pt, size: number) {
  const ang = Math.atan2(to.y - from.y, to.x - from.x), s = 0.45;
  const a = { x: to.x - size * Math.cos(ang - s), y: to.y - size * Math.sin(ang - s) };
  const b = { x: to.x - size * Math.cos(ang + s), y: to.y - size * Math.sin(ang + s) };
  return `${a.x},${a.y} ${to.x},${to.y} ${b.x},${b.y}`;
}

const polyPath = (P: Pt[]) => P.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('') + 'Z';

/** SVG subpath for a cutout (polygon or ellipse). */
export function cutoutPath(c: Cutout): string {
  if (c.kind === 'polygon') return polyPath(c.points);
  const [a, b] = c.points;
  const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  return `M${cx - rx},${cy}A${rx},${ry} 0 1 0 ${cx + rx},${cy}A${rx},${ry} 0 1 0 ${cx - rx},${cy}Z`;
}

/** Points shown as edit handles for a markup. */
export function handlePoints(m: Markup): Pt[] {
  if (m.type === 'highlight' && m.points.length > 2) return [];
  if (['rectangle', 'ellipse', 'highlight', 'textbox', 'typewriter', 'stamp', 'image', 'link'].includes(m.type)) {
    return [m.points[0], m.points[1]];
  }
  if (m.type === 'strikeout' || m.type === 'underline' || m.type === 'squiggly' || m.type === 'flag' || m.type === 'attachment') return [];
  return m.points;
}

/** Rectangle for a text box placed beside a cloud or at a point. */
export const boxOf = (a: Pt, b: Pt) => bounds([a, b]);

/** Line along the bottom/middle of a text rectangle, or a wave for squiggly. */
function textLine(type: Markup['type'], a: Pt, b: Pt): string {
  const r = bounds([a, b]);
  if (type === 'strikeout') return `M${r.minX},${r.minY + r.h / 2}H${r.maxX}`;
  if (type === 'underline') return `M${r.minX},${r.maxY - r.h * 0.08}H${r.maxX}`;
  const amp = Math.max(1, r.h * 0.08), step = Math.max(2, r.h * 0.2);
  let d = `M${r.minX},${r.maxY - amp}`;
  for (let x = r.minX, k = 0; x < r.maxX; x += step, k++) d += `L${Math.min(x + step, r.maxX)},${r.maxY - amp + (k % 2 ? -amp : amp)}`;
  return d;
}

export const STAMP_COLORS: Record<string, string> = {
  APPROVED: '#008000', 'NOT APPROVED': '#c00000', REJECTED: '#c00000', REVIEWED: '#0050c0', 'REVISE AND RESUBMIT': '#c06000',
  DRAFT: '#606060', VOID: '#c00000', 'FOR CONSTRUCTION': '#008000', 'AS BUILT': '#0050c0', CONFIDENTIAL: '#c00000',
};

export function MarkupShape({ m, ghost }: { m: Markup; ghost?: boolean }) {
  const st = m.style;
  const P = m.points;
  const common = {
    stroke: st.width > 0 ? st.color : 'none',
    strokeWidth: st.width,
    strokeOpacity: st.opacity,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeDasharray: st.lineStyle === 'dashed' ? `${st.width * 4} ${st.width * 3}` : st.lineStyle === 'dotted' ? `${st.width} ${st.width * 2}` : undefined,
    fill: st.fill ?? 'none',
    fillOpacity: st.fillOpacity,
    opacity: ghost ? 0.7 : 1,
  };
  const c = common;
  const meas = measure(m);
  let label: { at: Pt; text: string } | null = null;
  if (meas && m.type !== 'count' && P.length > 1) {
    const at = m.type === 'length' || m.type === 'polylength' || m.type === 'radius' || m.type === 'diameter' || m.type === 'dimension'
      ? { x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 - 3 }
      : m.type === 'angle' && P[1] ? { x: P[1].x + 8, y: P[1].y - 8 }
        : centroid(P);
    label = { at, text: meas.text };
  }

  let shape: React.ReactNode = null;
  switch (m.type) {
    case 'dimension': {
      if (P.length < 2) break;
      const size = Math.max(7, st.width * 5);
      const ang = Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x) + Math.PI / 2;
      const ext = (p: Pt) => <line key={`e${p.x},${p.y}`} {...c} x1={p.x + Math.cos(ang) * 8} y1={p.y + Math.sin(ang) * 8} x2={p.x - Math.cos(ang) * 8} y2={p.y - Math.sin(ang) * 8} />;
      shape = <><line {...c} x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} />
        <polyline {...c} fill="none" points={arrowHead(P[1], P[0], size)} />
        <polyline {...c} fill="none" points={arrowHead(P[0], P[1], size)} />{ext(P[0])}{ext(P[1])}</>;
      break;
    }
    case 'arc':
      if (P.length < 2) break;
      shape = <polyline {...c} fill="none" points={pts(P.length > 2 ? arcThrough(P[0], P[1], P[2]) : P)} />;
      break;
    case 'typewriter': {
      const b = bounds(P.length > 1 ? [P[0], P[1]] : [P[0], { x: P[0].x + 120, y: P[0].y + 20 }]);
      shape = <foreignObject x={b.minX} y={b.minY} width={Math.max(b.w, 20)} height={Math.max(b.h, st.fontSize * 1.4)}>
        <div className="markup-text typewriter" style={{ fontSize: st.fontSize, color: st.color }}>{m.text}</div>
      </foreignObject>;
      break;
    }
    case 'cloudplus': {
      if (P.length < 2) break;
      const cloud = rectCorners(P[0], P[1]);
      let extra: React.ReactNode = null;
      if (P.length >= 4) {
        const b = bounds([P[2], P[3]]);
        const cb = bounds(cloud);
        const target = { x: b.minX + b.w / 2, y: b.minY + b.h / 2 };
        const from = { x: Math.max(cb.minX, Math.min(cb.maxX, target.x)), y: Math.max(cb.minY, Math.min(cb.maxY, target.y)) };
        const to = calloutAttach(from, P[2], P[3]);
        extra = <>
          <line {...c} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
          <rect {...c} x={b.minX} y={b.minY} width={b.w} height={b.h} />
          <foreignObject x={b.minX} y={b.minY} width={b.w} height={b.h}>
            <div className="markup-text" style={{ fontSize: st.fontSize, color: st.color }}>{m.text}</div>
          </foreignObject>
        </>;
      }
      shape = <><path {...c} fill="none" d={cloudPath(cloud, st.width)} />{extra}</>;
      break;
    }
    case 'flag': {
      const p = P[0];
      shape = <g>
        <line x1={p.x} y1={p.y} x2={p.x} y2={p.y + 20} stroke="#000" strokeWidth={1.2} />
        <path d={`M${p.x},${p.y}L${p.x + 14},${p.y + 4}L${p.x},${p.y + 9}Z`} fill={st.fill ?? st.color} stroke={st.color} strokeWidth={0.75} />
      </g>;
      break;
    }
    case 'attachment': {
      const p = P[0];
      shape = <g>
        <rect x={p.x} y={p.y} width={18} height={18} fill="#fff" stroke={st.color} strokeWidth={0.75} rx={2} />
        <path d={`M${p.x + 11},${p.y + 5}v8a2.5 2.5 0 01-5 0v-9a1.6 1.6 0 013.2 0v8`} fill="none" stroke={st.color} strokeWidth={1} />
      </g>;
      break;
    }
    case 'stamp': {
      if (P.length < 2) break;
      const b = bounds(P);
      const fs = Math.min(b.h * 0.42, (b.w * 1.6) / Math.max(4, (m.text ?? '').length));
      shape = <g>
        <rect x={b.minX} y={b.minY} width={b.w} height={b.h} rx={6} fill="none" stroke={st.color} strokeWidth={st.width} strokeOpacity={st.opacity} />
        <text x={b.minX + b.w / 2} y={b.minY + b.h * 0.48} textAnchor="middle" dominantBaseline="middle" fontSize={fs}
          fontWeight="bold" fill={st.color} fillOpacity={st.opacity} fontFamily="Helvetica, Arial, sans-serif">{m.text}</text>
        <text x={b.minX + b.w / 2} y={b.minY + b.h * 0.82} textAnchor="middle" dominantBaseline="middle" fontSize={Math.max(5, fs * 0.38)}
          fill={st.color} fillOpacity={st.opacity} fontFamily="Helvetica, Arial, sans-serif">{`${m.author} ${new Date(m.created).toLocaleDateString()}`}</text>
      </g>;
      break;
    }
    case 'image': {
      if (P.length < 2 || !m.image) break;
      const b = bounds(P);
      shape = <image href={m.image} x={b.minX} y={b.minY} width={b.w} height={b.h} preserveAspectRatio="none" opacity={st.opacity} />;
      break;
    }
    case 'link': {
      if (P.length < 2) break;
      const b = bounds(P);
      shape = <rect x={b.minX} y={b.minY} width={b.w} height={b.h} fill="#0066ff" fillOpacity={0.06} stroke={st.color} strokeWidth={0.75} strokeDasharray="4 3" />;
      break;
    }
    case 'strikeout': case 'underline': case 'squiggly':
      shape = <>{rectPairs(P).map(([a, b], i) => <path key={i} {...c} fill="none" strokeWidth={Math.max(st.width, 0.8)} d={textLine(m.type, a, b)} />)}</>;
      break;
    case 'line': case 'length':
      if (P.length < 2) break;
      shape = <line {...c} x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} />;
      if (m.type === 'length') {
        const ang = Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x) + Math.PI / 2;
        const t = (p: Pt) => <line key={`${p.x},${p.y}`} {...c} x1={p.x + Math.cos(ang) * 5} y1={p.y + Math.sin(ang) * 5} x2={p.x - Math.cos(ang) * 5} y2={p.y - Math.sin(ang) * 5} />;
        shape = <>{shape}{t(P[0])}{t(P[1])}</>;
      }
      break;
    case 'arrow':
      if (P.length < 2) break;
      shape = <><line {...c} x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} />
        <polyline {...c} fill="none" points={arrowHead(P[0], P[1], Math.max(8, st.width * 5))} /></>;
      break;
    case 'polyline': case 'polylength': case 'perimeter': case 'pen':
      shape = <polyline {...c} fill="none" points={pts(P)} />;
      break;
    case 'polygon': case 'area': case 'volume':
      shape = m.cutouts?.length
        ? <path {...c} fillRule="evenodd" d={polyPath(P) + m.cutouts.map(cutoutPath).join('')} />
        : <polygon {...c} points={pts(P)} />;
      break;
    case 'cloud':
      shape = <path {...c} d={cloudPath(P, st.width)} />;
      break;
    case 'rectangle': case 'highlight': {
      if (P.length < 2) break;
      if (m.type === 'highlight' && P.length > 2) {
        shape = <>{rectPairs(P).map(([a, b], i) => { const r = bounds([a, b]); return <rect key={i} {...c} stroke="none" x={r.minX} y={r.minY} width={r.w} height={r.h} style={{ mixBlendMode: 'multiply' }} />; })}</>;
        break;
      }
      const b = bounds(P);
      shape = <rect {...c} x={b.minX} y={b.minY} width={b.w} height={b.h}
        style={m.type === 'highlight' ? { mixBlendMode: 'multiply' } : undefined}
        stroke={m.type === 'highlight' ? 'none' : c.stroke} />;
      break;
    }
    case 'ellipse': {
      if (P.length < 2) break;
      const b = bounds(P);
      shape = <ellipse {...c} cx={b.minX + b.w / 2} cy={b.minY + b.h / 2} rx={b.w / 2} ry={b.h / 2} />;
      break;
    }
    case 'radius': case 'diameter': {
      if (P.length < 2) break;
      if (m.type === 'radius' && P.length > 2) {
        shape = <polyline {...c} fill="none" points={pts([P[0], ...arcPoints(P[0], P[1], P[2], -1)])} />;
        break;
      }
      const r = Math.hypot(P[1].x - P[0].x, P[1].y - P[0].y);
      const c0 = m.type === 'radius' ? P[0] : { x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 };
      shape = <><circle {...c} fill="none" cx={c0.x} cy={c0.y} r={m.type === 'radius' ? r : r / 2} />
        <line {...c} x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} /></>;
      break;
    }
    case 'angle':
      shape = <polyline {...c} fill="none" points={pts(P)} />;
      break;
    case 'count':
      shape = <>{P.map((p, i) => <circle key={i} {...c} cx={p.x} cy={p.y} r={5} />)}</>;
      break;
    case 'note': {
      const p = P[0];
      shape = <g>
        <rect x={p.x} y={p.y} width={18} height={18} fill={st.fill ?? '#ffd400'} stroke="#000" strokeWidth={0.75} />
        {[5, 9, 13].map((d) => <line key={d} x1={p.x + 4} x2={p.x + 14} y1={p.y + d} y2={p.y + d} stroke="#000" strokeWidth={0.75} />)}
      </g>;
      break;
    }
    case 'textbox': case 'callout': {
      const box = m.type === 'callout' ? [P[1], P[2]] : [P[0], P[1]];
      if (!box[1]) break;
      const b = bounds(box);
      const leader = m.type === 'callout'
        ? (() => {
          const at = calloutAttach(P[0], box[0], box[1]);
          return <><line {...c} x1={P[0].x} y1={P[0].y} x2={at.x} y2={at.y} />
            <polyline {...c} fill="none" points={arrowHead(at, P[0], Math.max(8, st.width * 5))} /></>;
        })()
        : null;
      shape = <>
        {leader}
        <rect {...c} x={b.minX} y={b.minY} width={b.w} height={b.h} />
        <foreignObject x={b.minX} y={b.minY} width={b.w} height={b.h}>
          <div className="markup-text" style={{ fontSize: st.fontSize, color: st.color }}>{m.text}</div>
        </foreignObject>
      </>;
      break;
    }
  }
  return (
    <g data-id={m.id}>
      {shape}
      {label && (
        <text x={label.at.x} y={label.at.y} fontSize={m.style.fontSize} fill={st.color}
          textAnchor="middle" dominantBaseline="middle" className="measure-label">{label.text}</text>
      )}
    </g>
  );
}

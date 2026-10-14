import { hasCurves, svgPath } from '../model/curves';
import { captionText, segmentValues } from '../model/measureDisplay';
import { HATCH_TYPES, fillOutline, hatchLineWidth, hatchTileWH, isSimpleStyle, lineDash, lineStyleOf, strokeOutline, styledStroke, type LineStyleDef } from '../model/lineStyles';
import { calloutAttach } from '../pdf/save';
import { arcPoints, arcThrough, bounds, centroid, cloudSegments, measure, rectCorners, rectPairs } from '../model/measure';
import type { Cutout, Markup, MarkupStyle, MarkupType, Pt } from '../model/types';
import { useEffect } from 'react';
import { openCapturePreview } from './Capture';
import { cssFamily, fitFontSize, shapeOutline, textStyleOf } from '../model/textStyle';
import { textWidth } from './quickCommands';
import { useApp } from '../model/store';
import { LEGEND_HEADERS, legendLayout, legendRows } from '../model/legend';

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

const polyPath = (P: Pt[], closed = true) => P.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('') + (closed ? 'Z' : '');

/** SVG subpath for a cutout (polygon or ellipse). */
export function cutoutPath(c: Cutout): string {
  if (c.kind === 'polygon') return hasCurves(c.handles) ? svgPath(c.points, c.handles, true) : polyPath(c.points);
  const [a, b] = c.points;
  const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  return `M${cx - rx},${cy}A${rx},${ry} 0 1 0 ${cx + rx},${cy}A${rx},${ry} 0 1 0 ${cx - rx},${cy}Z`;
}

/** Points shown as edit handles for a markup. */
export function handlePoints(m: Markup): Pt[] {
  if ((m.type === 'highlight' || m.type === 'redaction') && m.points.length > 2) return [];
  if (m.type === 'redaction') return [m.points[0], m.points[1]];
  if (['rectangle', 'ellipse', 'highlight', 'textbox', 'typewriter', 'stamp', 'image', 'link'].includes(m.type)) {
    return [m.points[0], m.points[1]];
  }
  if (m.type === 'strikeout' || m.type === 'underline' || m.type === 'squiggly' || m.type === 'flag' || m.type === 'attachment' || m.type === 'legend') return [];
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

const TEXTUAL = new Set(['textbox', 'callout', 'typewriter', 'cloudplus']);

export function MarkupShape({ m, ghost }: { m: Markup; ghost?: boolean }) {
  const replyIndicators = useApp((st) => !!st.toggles.replyIndicators);
  const showAuthorDate = useApp((st) => st.prefs.showAuthorDate);
  const st = m.style;
  const P = m.points;
  // Line style: simple ones are a dash pattern; others (parallel lines, text) are drawn along the outline.
  const def = lineStyleOf(st);
  const styled = !isSimpleStyle(def) && st.width > 0 ? strokeOutline(m) : null;
  const dash = lineDash(def, st.width);
  const hatchArea = st.hatch && HATCH_TYPES.has(m.type) ? fillOutline(m) : null;
  const common = {
    stroke: st.width > 0 ? st.color : 'none',
    strokeWidth: st.width,
    strokeOpacity: st.opacity,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeDasharray: dash?.join(' '),
    fill: hatchArea ? 'none' : st.fill ?? 'none',
    fillOpacity: st.fillOpacity,
    opacity: ghost ? 0.7 : 1,
  };
  const c = common;
  /** Props for the element that carries a styled outline (drawn separately when styled). */
  const cm = styled ? { ...c, stroke: 'none' } : c;
  const meas = measure(m);
  let label: { at: Pt; text: string } | null = null;
  const caption = captionText(m, meas);
  if (meas && caption && m.type !== 'count' && P.length > 1) {
    const at = m.type === 'length' || m.type === 'polylength' || m.type === 'radius' || m.type === 'diameter' || m.type === 'dimension'
      ? { x: (P[0].x + P[1].x) / 2, y: (P[0].y + P[1].y) / 2 - 3 }
      : m.type === 'angle' && P[1] ? { x: P[1].x + 8, y: P[1].y - 8 }
        : centroid(P);
    label = { at, text: caption };
  }
  const segments = meas && m.display?.segments ? segmentValues(m) : [];
  const centroidAt = meas && m.display?.centroid && P.length > 2 ? centroid(P) : null;

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
      shape = <polyline {...cm} fill="none" points={pts(P.length > 2 ? arcThrough(P[0], P[1], P[2]) : P)} />;
      break;
    case 'typewriter': {
      const b = bounds(P.length > 1 ? [P[0], P[1]] : [P[0], { x: P[0].x + 120, y: P[0].y + 20 }]);
      shape = <foreignObject x={b.minX} y={b.minY} width={Math.max(b.w, 20)} height={Math.max(b.h, st.fontSize * 1.4)}>
        <div className="markup-text typewriter" style={textCss(m, b.w, b.h)}>{m.text}</div>
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
            <div className="markup-text" style={textCss(m, b.w, b.h)}>{m.text}</div>
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
          fill={st.color} fillOpacity={st.opacity} fontFamily="Helvetica, Arial, sans-serif">{m.subtitle ?? `${m.author} ${new Date(m.created).toLocaleDateString()}`}</text>
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
    case 'redaction':
      shape = <>{rectPairs(P).map(([a, b], i) => { const r = bounds([a, b]); return <rect key={i} {...c} x={r.minX} y={r.minY} width={r.w} height={r.h} />; })}</>;
      break;
    case 'strikeout': case 'underline': case 'squiggly':
      shape = <>{rectPairs(P).map(([a, b], i) => <path key={i} {...c} fill="none" strokeWidth={Math.max(st.width, 0.8)} d={textLine(m.type, a, b)} />)}</>;
      break;
    case 'caret': {
      // Insertion mark: a small open caret ^ at the bottom of its box.
      const b = bounds(P);
      shape = <path {...c} fill="none" strokeWidth={Math.max(st.width, 1)} strokeLinejoin="miter" d={`M ${b.minX} ${b.maxY} L ${b.minX + b.w / 2} ${b.minY} L ${b.maxX} ${b.maxY}`} />;
      break;
    }
    case 'legend':
      shape = <LegendShape m={m} />;
      break;
    case 'line': case 'length':
      if (P.length < 2) break;
      shape = <line {...cm} x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} />;
      if (m.type === 'length') {
        const ang = Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x) + Math.PI / 2;
        const t = (p: Pt) => <line key={`${p.x},${p.y}`} {...c} x1={p.x + Math.cos(ang) * 5} y1={p.y + Math.sin(ang) * 5} x2={p.x - Math.cos(ang) * 5} y2={p.y - Math.sin(ang) * 5} />;
        shape = <>{shape}{t(P[0])}{t(P[1])}</>;
      }
      break;
    case 'arrow':
      if (P.length < 2) break;
      shape = <><line {...cm} x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} />
        <polyline {...c} fill="none" points={arrowHead(P[0], P[1], Math.max(8, st.width * 5))} /></>;
      break;
    case 'polyline': case 'polylength': case 'perimeter': case 'pen':
      shape = hasCurves(m.handles) && m.type !== 'pen'
        ? <path {...cm} fill="none" d={svgPath(P, m.handles, false)} />
        : <polyline {...cm} fill="none" points={pts(P)} />;
      break;
    case 'polygon': case 'area': case 'volume':
      shape = m.cutouts?.length || hasCurves(m.handles)
        ? <path {...cm} fillRule="evenodd" d={(hasCurves(m.handles) ? svgPath(P, m.handles, true) : polyPath(P)) + (m.cutouts ?? []).map(cutoutPath).join('')} />
        : <polygon {...cm} points={pts(P)} />;
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
      shape = <rect {...cm} x={b.minX} y={b.minY} width={b.w} height={b.h}
        style={m.type === 'highlight' ? { mixBlendMode: 'multiply' } : undefined}
        stroke={m.type === 'highlight' ? 'none' : cm.stroke} />;
      break;
    }
    case 'ellipse': {
      if (P.length < 2) break;
      const b = bounds(P);
      shape = <ellipse {...cm} cx={b.minX + b.w / 2} cy={b.minY + b.h / 2} rx={b.w / 2} ry={b.h / 2} />;
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
        {st.shape === 'circle' ? <ellipse {...c} cx={b.minX + b.w / 2} cy={b.minY + b.h / 2} rx={b.w / 2} ry={b.h / 2} />
          : shapeOutline(st.shape ?? 'rectangle', b) ? <polygon {...c} points={pts(shapeOutline(st.shape ?? 'rectangle', b)!)} />
          : <rect {...c} x={b.minX} y={b.minY} width={b.w} height={b.h} />}
        <foreignObject x={b.minX} y={b.minY} width={b.w} height={b.h}>
          <div className="markup-text" style={textCss(m, b.w, b.h)}>{m.text}</div>
        </foreignObject>
      </>;
      break;
    }
  }
  const hatchId = `hatch-${m.id}`;
  const [tile, tileH] = st.hatch ? hatchTileWH(st.hatch, st.hatchScale) : [0, 0];
  const hatchColor = st.fill ?? st.color;
  return (
    <g data-id={m.id}>
      {showAuthorDate && <title>{`${m.subject}${m.author ? ` · ${m.author}` : ''}${m.modified ? ` · ${new Date(m.modified).toLocaleString()}` : ''}${m.comment ? `\n${m.comment}` : ''}`}</title>}
      {hatchArea && st.hatch && (
        <>
          <defs>
            <pattern id={hatchId} patternUnits="userSpaceOnUse" width={tile} height={tileH}>
              {st.hatch.lines.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1 * tile} y1={y1 * tileH} x2={x2 * tile} y2={y2 * tileH} stroke={hatchColor} strokeWidth={hatchLineWidth(tile)} strokeLinecap="square" />)}
              {st.hatch.dots.map(([x, y, r], i) => <circle key={`d${i}`} cx={x * tile} cy={y * tileH} r={Math.max(0.3, r * tile)} fill={hatchColor} />)}
            </pattern>
          </defs>
          <path d={polyPath(hatchArea) + (m.cutouts ?? []).map(cutoutPath).join('')} fill={`url(#${hatchId})`} fillOpacity={st.fillOpacity} fillRule="evenodd" stroke="none" opacity={ghost ? 0.7 : 1} />
        </>
      )}
      {shape}
      {styled && <StyledOutline outline={styled} def={def} st={st} ghost={ghost} />}
      {m.seq && m.label && !TEXTUAL.has(m.type) && P.length > 0 && (() => {
        const b = bounds(P);
        return <text x={b.minX + b.w / 2} y={b.minY + b.h / 2} fontSize={st.fontSize} fill={st.color} textAnchor="middle" dominantBaseline="central"
          fontFamily="Helvetica, Arial, sans-serif" className="seq-label">{m.label}</text>;
      })()}
      {label && (
        <text x={label.at.x} y={label.at.y} fontSize={m.style.fontSize} fill={st.color}
          textAnchor="middle" dominantBaseline="middle" className="measure-label">{label.text}</text>
      )}
      {segments.map((sg, i) => (
        <text key={`sg${i}`} x={sg.at.x} y={sg.at.y} fontSize={Math.max(6, m.style.fontSize * 0.8)} fill={st.color}
          textAnchor="middle" dominantBaseline="middle" className="segment-label" pointerEvents="none">{sg.text}</text>
      ))}
      {centroidAt && <circle className="centroid-mark" cx={centroidAt.x} cy={centroidAt.y} r={Math.max(2, st.width * 1.5)} fill={st.color} pointerEvents="none" />}
      {replyIndicators && m.replies?.length && P.length > 0 ? <ReplyIndicator m={m} /> : null}
      {m.capture?.length && P.length > 0 ? <CaptureIcon m={m} /> : null}
    </g>
  );
}

/** Embedded media (Capture): a camera icon near the markup's lower-right corner; click opens the viewer. */
function CaptureIcon({ m }: { m: Markup }) {
  const b = bounds(m.points), x = b.maxX + 2, y = b.maxY + 2;
  return (
    <g className="capture-icon" style={{ cursor: 'pointer' }} pointerEvents="all" role="button" aria-label={`View ${m.capture!.length} photo${m.capture!.length === 1 ? '' : 's'}`}
      onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }} onClick={(e) => { e.stopPropagation(); openCapturePreview(m.capture!, 0, m.id); }}>
      <rect x={x} y={y} width={14} height={11} rx={2} fill="#fff" stroke={m.style.color} strokeWidth={0.8} />
      <circle cx={x + 7} cy={y + 6} r={3} fill="none" stroke={m.style.color} strokeWidth={0.8} />
      <rect x={x + 4} y={y + 1} width={3} height={1.5} fill={m.style.color} />
    </g>
  );
}

/** View > Always Show Reply Indicators: a speech bubble at the markup's top-right corner. */
function ReplyIndicator({ m }: { m: Markup }) {
  const b = bounds(m.points), x = b.maxX + 2, y = b.minY - 12;
  return (
    <g className="reply-indicator" pointerEvents="none">
      <path d={`M${x},${y} h12 a2,2 0 0 1 2,2 v6 a2,2 0 0 1 -2,2 h-7 l-3,3 v-3 h-2 a2,2 0 0 1 -2,-2 v-6 a2,2 0 0 1 2,-2 z`} fill="#fff" stroke={m.style.color} strokeWidth={0.8} />
      <text x={x + 7} y={y + 7.5} fontSize={7} fill={m.style.color} textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif">{m.replies!.length}</text>
    </g>
  );
}

/** A line in a style with parallel lines or text along it. */
function StyledOutline({ outline, def, st, ghost }: { outline: { pts: Pt[]; closed: boolean }; def: LineStyleDef; st: MarkupStyle; ghost?: boolean }) {
  const { lines, texts } = styledStroke(outline.pts, outline.closed, def, st.width);
  return (
    <g opacity={ghost ? 0.7 : 1} pointerEvents="none">
      {lines.map((l, i) => (
        <path key={i} d={polyPath(l.pts, l.closed)} fill="none" stroke={st.color} strokeWidth={st.width} strokeOpacity={st.opacity}
          strokeLinecap="round" strokeLinejoin="round" strokeDasharray={l.dash?.join(' ')} />
      ))}
      {texts.map((t, i) => (
        <text key={`t${i}`} x={t.at.x} y={t.at.y} fontSize={t.size} fill={st.color} fillOpacity={st.opacity} textAnchor="middle" dominantBaseline="central"
          fontFamily="Helvetica, Arial, sans-serif" transform={`rotate(${t.angle} ${t.at.x} ${t.at.y})`}>{t.text}</text>
      ))}
    </g>
  );
}

/** A small sample of a markup kind for a Legend's Symbol column. */
export function LegendSymbol({ type, style, x, y, w, h }: { type: MarkupType; style: MarkupStyle; x: number; y: number; w: number; h: number }) {
  const c = { stroke: style.color, strokeWidth: Math.min(style.width || 1, 3), fill: 'none' };
  const fill = style.fill ?? style.color;
  if (type === 'count') return <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) * 0.3} fill={fill} fillOpacity={style.fillOpacity} stroke={style.color} />;
  if (type === 'area' || type === 'volume' || type === 'polygon' || type === 'rectangle' || type === 'highlight' || type === 'cloud' || type === 'ellipse') {
    return <rect x={x + w * 0.15} y={y + h * 0.2} width={w * 0.7} height={h * 0.6} {...c} fill={style.fill ?? 'none'} fillOpacity={style.fillOpacity} />;
  }
  return <line x1={x + w * 0.1} y1={y + h / 2} x2={x + w * 0.9} y2={y + h / 2} {...c} />;
}

function LegendShape({ m }: { m: Markup }) {
  const doc = useApp((s) => s.docs.find((d) => d.id === s.activeId));
  const def = m.legend;
  const rows = def && doc ? legendRows(def, doc.markups, m.page) : [];
  const L = def ? legendLayout(def, rows, m.style.fontSize) : null;
  const P = m.points;
  // Anchored at the centre of its box: stable when the page is rotated and back
  // (the stored box keeps its orientation while the table is drawn upright).
  const tl = L && P[1] ? { x: (P[0].x + P[1].x) / 2 - L.w / 2, y: (P[0].y + P[1].y) / 2 - L.h / 2 } : P[0];
  // Keep the stored corners in step with the table's size (used for selection and saving).
  useEffect(() => {
    if (!L || !tl || m.id === 'draft') return;
    const want = { x: tl.x + L.w, y: tl.y + L.h };
    if (!P[1] || Math.abs(P[0].x - tl.x) > 0.01 || Math.abs(P[0].y - tl.y) > 0.01 || Math.abs(P[1].x - want.x) > 0.5 || Math.abs(P[1].y - want.y) > 0.5) {
      useApp.getState().updateMarkups([m.id], () => ({ points: [tl, want] }), { history: false });
    }
  });
  if (!def || !L) return null;
  const st = m.style, x0 = tl.x, y0 = tl.y, fs = st.fontSize;
  let x = x0;
  const colX = L.cols.map((c) => { const at = x; x += c.w; return at; });
  const text = (t: string | number, cx: number, cy: number, bold = false, anchor: 'start' | 'end' | 'middle' = 'start') => (
    <text x={cx} y={cy} fontSize={fs} fontWeight={bold ? 'bold' : undefined} fill={st.color} textAnchor={anchor} dominantBaseline="middle" fontFamily="Helvetica, Arial, sans-serif">{t}</text>
  );
  const cell = (id: string, r: (typeof rows)[number], i: number, cy: number) => {
    const cx = colX[i], w = L.cols[i].w;
    if (id === 'symbol') return <LegendSymbol key={id} type={r.type} style={r.style} x={cx} y={cy - L.row / 2} w={w} h={L.row} />;
    if (id === 'description') return <g key={id}>{text(r.description, cx + 5, cy)}</g>;
    if (id === 'quantity') return <g key={id}>{text(r.quantity, cx + w - 5, cy, false, 'end')}</g>;
    return <g key={id}>{text(r.measurement, cx + w - 5, cy, false, 'end')}</g>;
  };
  return (
    <g className="legend">
      <rect x={x0} y={y0} width={L.w} height={L.h} fill={st.fill ?? '#fff'} fillOpacity={st.fillOpacity} stroke={st.color} strokeWidth={0.8} />
      <line x1={x0} x2={x0 + L.w} y1={y0 + L.title} y2={y0 + L.title} stroke={st.color} strokeWidth={0.8} />
      {text(def.title, x0 + L.w / 2, y0 + L.title / 2, true, 'middle')}
      {L.cols.map((c, i) => <g key={c.id}>{text(LEGEND_HEADERS[c.id], colX[i] + (c.id === 'description' ? 5 : c.w - 5), y0 + L.title + L.row / 2, true, c.id === 'description' ? 'start' : 'end')}</g>)}
      {rows.map((r, k) => {
        const cy = y0 + L.title + L.row * (k + 1.5);
        return <g key={r.key}>
          <line x1={x0} x2={x0 + L.w} y1={cy - L.row / 2} y2={cy - L.row / 2} stroke={st.color} strokeWidth={0.4} />
          {L.cols.map((c, i) => cell(c.id, r, i, cy))}
        </g>;
      })}
    </g>
  );
}

/** CSS of a text box's text from its formatting (font, style, alignment, spacing, margin, colour, auto size). */
export function textCss(m: Markup, boxW: number, boxH: number): React.CSSProperties {
  const st = m.style, t = textStyleOf(st);
  const size = t.autoSize ? fitFontSize((m.text ?? '').split('\n'), boxW, boxH, t.lineHeight, t.margin, (s, k) => textWidth(s, k) * (t.font === 'Courier' ? 1.1 : 1)) : st.fontSize;
  return {
    fontSize: size, color: t.textColor, fontFamily: cssFamily(t.font), fontWeight: t.bold ? 'bold' : undefined, fontStyle: t.italic ? 'italic' : undefined,
    textDecoration: [t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
    textAlign: t.align, lineHeight: t.lineHeight, padding: `${Math.max(0, t.margin - 1)}px ${t.margin}px`,
    display: 'flex', flexDirection: 'column', justifyContent: t.valign === 'middle' ? 'center' : t.valign === 'bottom' ? 'flex-end' : 'flex-start',
  };
}

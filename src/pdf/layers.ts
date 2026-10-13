// PDF layers (optional content, ISO 32000 8.11), as Revu's Layers panel
// shows them: the layer tree from /OCProperties /D /Order, default states,
// locked layers, print usage, and named configurations (/D /Configs).
// Layer ids are the OCG's reference as pdf.js names it ("12R"), or
// "new:<uuid>" for layers created since the file was opened.
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFRef, PDFStream, PDFString, type PDFDocument, type PDFObject } from 'pdf-lib';
import { bytesOfLatin1, latin1, mkOp, name as nameOp, parseContent, writeContent, type Op } from './content';
import { streamBytes } from './redactContent';

export interface Layer {
  id: string;
  name: string;
  /** Default state when the file is opened. */
  on: boolean;
  locked: boolean;
  /** Included when printing. */
  print: boolean;
}
/** A node of the layer tree: a layer (with child layers), or a label-only layer group. */
export interface LayerNode { id?: string; label?: string; kids: LayerNode[] }
/** A saved visibility configuration: the layers it hides. */
export interface LayerConfig { name: string; off: string[] }
export interface LayerSet { layers: Record<string, Layer>; order: LayerNode[]; configs: LayerConfig[] }

const N = (s: string) => PDFName.of(s);
export const refId = (r: PDFRef) => (r.generationNumber ? `${r.objectNumber}R${r.generationNumber}` : `${r.objectNumber}R`);
const text = (o: unknown) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : '');
const encode = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? PDFString.of(s) : PDFHexString.fromText(s));

function refsOf(doc: PDFDocument, a: unknown): PDFRef[] {
  const arr = a instanceof PDFRef ? doc.context.lookup(a) : a;
  return arr instanceof PDFArray ? arr.asArray().filter((x): x is PDFRef => x instanceof PDFRef) : [];
}

/** Read the document's layers, or null when it has none. */
export function readLayers(doc: PDFDocument): LayerSet | null {
  const ocp = doc.catalog.lookup(N('OCProperties'));
  if (!(ocp instanceof PDFDict)) return null;
  const ocgs = refsOf(doc, ocp.get(N('OCGs')));
  if (!ocgs.length) return null;
  const d = ocp.lookup(N('D'));
  const D = d instanceof PDFDict ? d : undefined;
  const base = String(D?.get(N('BaseState')) ?? '/ON');
  const offIds = new Set(refsOf(doc, D?.get(N('OFF'))).map(refId));
  const onIds = new Set(refsOf(doc, D?.get(N('ON'))).map(refId));
  const lockedIds = new Set(refsOf(doc, D?.get(N('Locked'))).map(refId));
  const layers: Record<string, Layer> = {};
  for (const r of ocgs) {
    const g = doc.context.lookup(r);
    if (!(g instanceof PDFDict)) continue;
    const id = refId(r);
    const usage = g.lookup(N('Usage'));
    const pr = usage instanceof PDFDict ? usage.lookup(N('Print')) : undefined;
    const printOff = pr instanceof PDFDict && String(pr.get(N('PrintState'))) === '/OFF';
    layers[id] = {
      id, name: text(g.lookup(N('Name'))) || 'Layer',
      on: base === '/OFF' ? onIds.has(id) : !offIds.has(id),
      locked: lockedIds.has(id), print: !printOff,
    };
  }
  const seen = new Set<string>();
  const parse = (a: PDFObject | undefined, depth = 0): LayerNode[] => {
    const arr = a instanceof PDFRef ? doc.context.lookup(a) : a;
    if (!(arr instanceof PDFArray) || depth > 20) return [];
    const out: LayerNode[] = [];
    const items = arr.asArray();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const v = it instanceof PDFRef ? doc.context.lookup(it) : it;
      if (it instanceof PDFRef && layers[refId(it)]) {
        const node: LayerNode = { id: refId(it), kids: [] };
        seen.add(node.id!);
        // An array right after a layer holds its children.
        const next = items[i + 1];
        const nv = next instanceof PDFRef ? doc.context.lookup(next) : next;
        if (nv instanceof PDFArray && !(nv.get(0) instanceof PDFString || nv.get(0) instanceof PDFHexString)) { node.kids = parse(nv, depth + 1); i++; }
        out.push(node);
      } else if (v instanceof PDFArray) {
        const first = v.get(0);
        if (first instanceof PDFString || first instanceof PDFHexString) out.push({ label: text(first), kids: parse(doc.context.obj(v.asArray().slice(1)), depth + 1) });
        else out.push(...parse(v, depth + 1));
      }
    }
    return out;
  };
  const order = parse(D?.get(N('Order')));
  for (const id of Object.keys(layers)) if (!seen.has(id)) order.push({ id, kids: [] });
  const configs: LayerConfig[] = [];
  const cf = D?.lookup(N('Configs'));
  if (cf instanceof PDFArray) {
    for (const c of cf.asArray()) {
      const cd = c instanceof PDFRef ? doc.context.lookup(c) : c;
      if (!(cd instanceof PDFDict)) continue;
      const cb = String(cd.get(N('BaseState')) ?? '/ON');
      const cOn = new Set(refsOf(doc, cd.get(N('ON'))).map(refId));
      const cOff = new Set(refsOf(doc, cd.get(N('OFF'))).map(refId));
      configs.push({ name: text(cd.lookup(N('Name'))) || `Configuration ${configs.length + 1}`, off: Object.keys(layers).filter((id) => (cb === '/OFF' ? !cOn.has(id) : cOff.has(id))) });
    }
  }
  return { layers, order, configs };
}

/** Every layer id in tree order. */
export function layerIds(order: LayerNode[]): string[] {
  return order.flatMap((n) => [...(n.id ? [n.id] : []), ...layerIds(n.kids)]);
}

/**
 * Write `set` into the document's /OCProperties. Returns the reference of
 * every layer, so markups can point their /OC at new layers.
 */
export function writeLayers(doc: PDFDocument, set: LayerSet): Map<string, PDFRef> {
  const ctx = doc.context;
  const refs = new Map<string, PDFRef>();
  const existing = new Map<string, PDFRef>();
  const ocp0 = doc.catalog.lookup(N('OCProperties'));
  if (ocp0 instanceof PDFDict) for (const r of refsOf(doc, ocp0.get(N('OCGs')))) existing.set(refId(r), r);
  for (const l of Object.values(set.layers)) {
    let r = existing.get(l.id);
    let g = r ? ctx.lookup(r) : undefined;
    if (!(g instanceof PDFDict)) { g = ctx.obj({ Type: 'OCG' }) as PDFDict; r = ctx.register(g); }
    (g as PDFDict).set(N('Name'), encode(l.name));
    const usage = (g as PDFDict).lookup(N('Usage'));
    if (!l.print) (g as PDFDict).set(N('Usage'), ctx.obj({ ...(usage instanceof PDFDict ? {} : {}), Print: { PrintState: 'OFF' } }));
    else if (usage instanceof PDFDict) usage.delete(N('Print'));
    refs.set(l.id, r!);
  }
  const ids = layerIds(set.order).filter((id) => refs.has(id));
  for (const id of Object.keys(set.layers)) if (!ids.includes(id)) ids.push(id);
  if (!ids.length) { doc.catalog.delete(N('OCProperties')); return refs; }
  const orderObj = (nodes: LayerNode[]): unknown[] => nodes.flatMap((n) => {
    if (n.label !== undefined) return [ctx.obj([encode(n.label), ...orderObj(n.kids)] as never)];
    if (!n.id || !refs.has(n.id)) return orderObj(n.kids);
    return n.kids.length ? [refs.get(n.id)!, ctx.obj(orderObj(n.kids) as never)] : [refs.get(n.id)!];
  });
  const ocp = ocp0 instanceof PDFDict ? ocp0 : (ctx.obj({}) as PDFDict);
  const d0 = ocp.lookup(N('D'));
  const D = d0 instanceof PDFDict ? d0 : (ctx.obj({}) as PDFDict);
  ocp.set(N('OCGs'), ctx.obj(ids.map((id) => refs.get(id)!)));
  D.set(N('Order'), ctx.obj(orderObj(set.order) as never));
  D.set(N('BaseState'), N('ON'));
  D.delete(N('ON'));
  D.set(N('OFF'), ctx.obj(ids.filter((id) => !set.layers[id].on).map((id) => refs.get(id)!)));
  const locked = ids.filter((id) => set.layers[id].locked);
  if (locked.length) D.set(N('Locked'), ctx.obj(locked.map((id) => refs.get(id)!))); else D.delete(N('Locked'));
  if (!D.get(N('Name'))) D.set(N('Name'), PDFString.of('Default'));
  if (set.configs.length) {
    D.set(N('Configs'), ctx.obj(set.configs.map((c) => ctx.obj({
      Name: encode(c.name), BaseState: 'ON', OFF: c.off.filter((id) => refs.has(id)).map((id) => refs.get(id)!),
    }))));
  } else D.delete(N('Configs'));
  ocp.set(N('D'), D);
  doc.catalog.set(N('OCProperties'), ocp);
  return refs;
}

/**
 * Revu's Delete Layer: content on the deleted layers is removed
 * (`deleteContent`) or moved to the base PDF (it stays, no longer on a layer).
 * Works on the page content and on form XObjects tagged with the layer.
 */
export function stripLayerContent(doc: PDFDocument, ids: Set<string>, deleteContent: boolean) {
  const ctx = doc.context;
  const isOurs = (o: unknown): boolean => {
    if (o instanceof PDFRef) { if (ids.has(refId(o))) return true; o = ctx.lookup(o); }
    // An optional content membership dict (/OCMD) on a deleted layer.
    if (o instanceof PDFDict && String(o.get(N('Type'))) === '/OCMD') {
      const g = o.get(N('OCGs'));
      return g instanceof PDFRef ? ids.has(refId(g)) : refsOf(doc, g).some((r) => ids.has(refId(r)));
    }
    return false;
  };
  const done = new Set<PDFStream>();
  const fix = (content: string, res: PDFDict | undefined): string | null => {
    const props = res?.lookup(N('Properties'));
    const xobjs = res?.lookup(N('XObject'));
    const ops = parseContent(content);
    const out: Op[] = [];
    let changed = false;
    let skipDepth = 0;
    const stack: boolean[] = [];
    for (const op of ops) {
      if (op.op === 'BDC' || op.op === 'BMC') {
        const tagged = op.op === 'BDC' && op.args[0]?.t === 'name' && op.args[0].v === 'OC' && op.args[1]?.t === 'name'
          && props instanceof PDFDict && isOurs(props.get(N(op.args[1].v)));
        stack.push(tagged);
        if (skipDepth) { skipDepth++; continue; }
        if (tagged) {
          changed = true;
          if (deleteContent) { skipDepth = 1; continue; }
          out.push(mkOp('BMC', nameOp('OC')));
          continue;
        }
        out.push(op);
        continue;
      }
      if (op.op === 'EMC') {
        stack.pop();
        if (skipDepth) { skipDepth--; continue; }
        out.push(op);
        continue;
      }
      if (skipDepth) continue;
      if (op.op === 'Do' && op.args[0]?.t === 'name' && xobjs instanceof PDFDict) {
        const xr = xobjs.get(N(op.args[0].v));
        const xo = xr instanceof PDFRef ? ctx.lookup(xr) : xr;
        if (xo instanceof PDFStream) {
          if (isOurs(xo.dict.get(N('OC')))) {
            changed = true;
            if (deleteContent) continue;
            xo.dict.delete(N('OC'));
          } else if (String(xo.dict.get(N('Subtype'))) === '/Form' && !done.has(xo)) {
            done.add(xo);
            const fr = xo.dict.lookup(N('Resources'));
            const inner = fix(latin1(streamBytes(xo)), fr instanceof PDFDict ? fr : res);
            if (inner !== null) {
              const fresh = ctx.flateStream(bytesOfLatin1(inner), {});
              for (const [k, v] of xo.dict.entries()) if (!['Filter', 'DecodeParms', 'Length'].includes(k.toString().slice(1))) fresh.dict.set(k, v);
              if (xr instanceof PDFRef) ctx.assign(xr, fresh);
              changed = true;
            }
          }
        }
      }
      out.push(op);
    }
    return changed ? writeContent(out) : null;
  };
  for (const page of doc.getPages()) {
    const c = page.node.Contents();
    const streams: PDFStream[] = [];
    if (c instanceof PDFStream) streams.push(c);
    else if (c instanceof PDFArray) for (const r of c.asArray()) { const s = ctx.lookup(r); if (s instanceof PDFStream) streams.push(s); }
    if (!streams.length) continue;
    const res = page.node.Resources();
    const next = fix(streams.map((s) => latin1(streamBytes(s))).join('\n'), res);
    if (next !== null) page.node.set(N('Contents'), ctx.register(ctx.flateStream(bytesOfLatin1(next))));
  }
}

/**
 * Revu's Add Layer from Page: draw page `srcPage` of `src` onto page
 * `pageIdx` of `doc` as a new layer named `name`. `m` maps the source
 * page's PDF space onto the target page's (alignment points), if given.
 */
export async function addLayerFromPage(doc: PDFDocument, pageIdx: number, src: PDFDocument, srcPage: number, name: string,
  m?: [number, number, number, number, number, number] | null): Promise<PDFRef> {
  const ctx = doc.context;
  const [emb] = await doc.embedPdf(src, [srcPage]);
  const ocg = ctx.register(ctx.obj({ Type: 'OCG', Name: encode(name) }));
  const page = doc.getPage(pageIdx);
  (page.node as unknown as { autoNormalizeCTM: boolean }).autoNormalizeCTM = false;
  const res = page.node.Resources() ?? (ctx.obj({}) as PDFDict);
  const props = res.lookup(N('Properties'));
  const P = props instanceof PDFDict ? props : (ctx.obj({}) as PDFDict);
  let i = 1;
  while (P.has(N(`CTLayer${i}`))) i++;
  P.set(N(`CTLayer${i}`), ocg);
  res.set(N('Properties'), P);
  const xo = res.lookup(N('XObject'));
  const X = xo instanceof PDFDict ? xo : (ctx.obj({}) as PDFDict);
  X.set(N(`CTLayerPage${i}`), emb.ref);
  res.set(N('XObject'), X);
  page.node.set(N('Resources'), res);
  await doc.flush();
  const cm = (m ?? [1, 0, 0, 1, 0, 0]).map((v) => +v.toFixed(6)).join(' ');
  const ops = `/OC /CTLayer${i} BDC q ${cm} cm /CTLayerPage${i} Do Q EMC`;
  // Drawn after the page's own content, which is first wrapped so its graphics state cannot leak.
  page.node.wrapContentStreams(ctx.register(ctx.stream('q')), ctx.register(ctx.stream('Q')));
  page.node.addContentStream(ctx.register(ctx.flateStream(ops)));
  return ocg;
}

/** Layer ids used by each page's content (marked content, form XObjects), for "Show Layers on Page Only". */
export function layersOnPages(doc: PDFDocument): string[][] {
  const ctx = doc.context;
  const idsOf = (o: unknown): string[] => {
    if (o instanceof PDFRef) {
      const v = ctx.lookup(o);
      if (v instanceof PDFDict && String(v.get(N('Type'))) === '/OCMD') return idsOf(v);
      return [refId(o)];
    }
    if (o instanceof PDFDict) {
      const g = o.get(N('OCGs'));
      return g instanceof PDFRef ? [refId(g)] : refsOf(doc, g).map(refId);
    }
    return [];
  };
  return doc.getPages().map((p) => {
    const out = new Set<string>();
    const res = p.node.Resources();
    const props = res?.lookup(N('Properties'));
    if (props instanceof PDFDict) for (const [, v] of props.entries()) idsOf(v).forEach((x) => out.add(x));
    const xo = res?.lookup(N('XObject'));
    if (xo instanceof PDFDict) {
      for (const [, v] of xo.entries()) {
        const s = v instanceof PDFRef ? ctx.lookup(v) : v;
        if (s instanceof PDFStream && s.dict.get(N('OC'))) idsOf(s.dict.get(N('OC'))).forEach((x) => out.add(x));
      }
    }
    return [...out];
  });
}

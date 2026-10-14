// XFDF (XML Forms Data Format, ISO 19444-1) markups exchange: export the
// document's annotations, import them into another copy of the drawing.
// Standard elements and attributes carry what every PDF app understands;
// keys XFDF has no attribute for (measurement scale /Measure, intent data,
// our CTData) travel in a namespaced <ct:extra> element as PDF syntax, which
// other apps ignore, so a CyanTakeoff round trip loses nothing. Stamps
// (images, snapshots, custom stamps) carry their artwork in <appearance>:
// base64 of an XML picture of the /AP dictionary (DICT, STREAM, ARRAY, NAME,
// INT, FIXED, BOOL and hex DATA elements), the form Acrobat writes.
import {
  PDFArray, PDFBool, PDFDict, PDFHexString, PDFName, PDFNumber, PDFObjectParser, PDFRawStream, PDFRef, PDFStream, PDFString,
  type PDFContext, type PDFDocument, type PDFObject,
} from 'pdf-lib';

const N = PDFName.of;
const NS = 'https://cyantakeoff.com/ns/xfdf';

const ELEMENT: Record<string, string> = {
  Text: 'text', FreeText: 'freetext', Line: 'line', Square: 'square', Circle: 'circle', Polygon: 'polygon', PolyLine: 'polyline',
  Highlight: 'highlight', Underline: 'underline', Squiggly: 'squiggly', StrikeOut: 'strikeout', Stamp: 'stamp', Caret: 'caret', Ink: 'ink', FileAttachment: 'fileattachment', Link: 'link', Redact: 'redact',
};
const SUBTYPE = Object.fromEntries(Object.entries(ELEMENT).map(([k, v]) => [v, k]));
const FLAGS = ['invisible', 'hidden', 'print', 'nozoom', 'norotate', 'noview', 'readonly', 'locked', 'togglenoview'];

// Keys written as XFDF attributes or children (not repeated in <ct:extra>).
const STANDARD = new Set(['Type', 'Subtype', 'Rect', 'NM', 'T', 'Subj', 'M', 'CreationDate', 'C', 'IC', 'CA', 'F', 'BS', 'IT', 'Contents', 'IRT', 'RT',
  'L', 'LE', 'LL', 'LLE', 'Cap', 'Vertices', 'InkList', 'QuadPoints', 'DA', 'Q', 'DS', 'Name', 'P', 'Popup', 'AP', 'Parent', 'RC', 'BE']);

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const unesc = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_m, e: string) =>
  e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));

// ---------- stamp appearances ----------

const hex = (b: Uint8Array) => { let out = ''; for (const x of b) out += x.toString(16).padStart(2, '0'); return out; };
const unhex = (h: string) => { const t = h.replace(/[^0-9a-f]/gi, ''); const out = new Uint8Array(t.length >> 1); for (let i = 0; i < out.length; i++) out[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16); return out; };
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/\s+/g, ''))));

/** One PDF object as an appearance XML element (`key` set when it is a dictionary entry). */
function apXml(o: PDFObject | undefined, ctx: PDFContext, key?: string, depth = 0): string {
  const k = key ? ` KEY="${esc(key)}"` : '';
  const v = o instanceof PDFRef ? ctx.lookup(o) : o;
  if (depth > 24 || v === undefined) return '';
  if (v instanceof PDFStream) {
    const dict = v.dict, bytes = v instanceof PDFRawStream ? v.contents : v.getContents();
    const inner = dict.entries().filter(([n]) => n.decodeText() !== 'Length').map(([n, x]) => apXml(x, ctx, n.decodeText(), depth + 1)).join('');
    return `<STREAM${k}>${inner}<DATA ENCODING="HEX">${hex(bytes)}</DATA></STREAM>`;
  }
  if (v instanceof PDFDict) return `<DICT${k}>${v.entries().map(([n, x]) => apXml(x, ctx, n.decodeText(), depth + 1)).join('')}</DICT>`;
  if (v instanceof PDFArray) return `<ARRAY${k}>${v.asArray().map((x) => apXml(x, ctx, undefined, depth + 1)).join('')}</ARRAY>`;
  if (v instanceof PDFName) return `<NAME${k} VAL="${esc(v.decodeText())}"/>`;
  if (v instanceof PDFNumber) { const n = v.asNumber(); return Number.isInteger(n) ? `<INT${k} VAL="${n}"/>` : `<FIXED${k} VAL="${n}"/>`; }
  if (v instanceof PDFBool) return `<BOOL${k} VAL="${v.asBoolean()}"/>`;
  return ''; // strings do not occur in appearance streams' dictionaries
}

/** The <appearance> text for an annotation's /AP, or '' when it has none. */
export function appearanceOf(a: PDFDict, ctx: PDFContext): string {
  const ap = a.get(N('AP'));
  const d = ap instanceof PDFRef ? ctx.lookup(ap) : ap;
  if (!(d instanceof PDFDict)) return '';
  const streams = d.entries().filter(([, x]) => (x instanceof PDFRef ? ctx.lookup(x) : x) instanceof PDFStream);
  if (!streams.length) return '';
  return b64(`<DICT KEY="AP">${streams.map(([n, x]) => apXml(x, ctx, n.decodeText(), 1)).join('')}</DICT>`);
}

/** Build the PDF object an appearance XML element describes. */
function apObject(el: XNode, ctx: PDFContext): PDFObject | undefined {
  const name = local(el.name).toUpperCase(), val = el.attrs.VAL ?? el.attrs.val ?? '';
  const entries = (kids: XNode[]) => {
    const d = ctx.obj({}) as PDFDict;
    for (const c of kids) {
      const key = c.attrs.KEY ?? c.attrs.key;
      const o = key ? apObject(c, ctx) : undefined;
      if (key && o) d.set(N(key), o);
    }
    return d;
  };
  if (name === 'STREAM') {
    const data = el.children.find((c) => local(c.name).toUpperCase() === 'DATA');
    const enc = (data?.attrs.ENCODING ?? data?.attrs.encoding ?? 'HEX').toUpperCase();
    const bytes = !data ? new Uint8Array() : enc === 'HEX' ? unhex(data.text) : new TextEncoder().encode(data.text);
    const dict = entries(el.children.filter((c) => local(c.name).toUpperCase() !== 'DATA'));
    dict.delete(N('Length'));
    return ctx.register(PDFRawStream.of(dict, bytes));
  }
  if (name === 'DICT') return entries(el.children);
  if (name === 'ARRAY') return ctx.obj(el.children.map((c) => apObject(c, ctx)).filter((x): x is PDFObject => !!x));
  if (name === 'NAME') return N(val);
  if (name === 'INT' || name === 'FIXED') { const n = Number(val); return Number.isFinite(n) ? PDFNumber.of(n) : undefined; }
  if (name === 'BOOL') return val === 'true' ? PDFBool.True : PDFBool.False;
  return undefined;
}

/** Set /AP from an <appearance> text; false when it cannot be read. */
export function setAppearance(d: PDFDict, text: string, ctx: PDFContext): boolean {
  try {
    const root = parseXml(unb64(text));
    const dict = root.children.find((c) => local(c.name).toUpperCase() === 'DICT');
    if (!dict) return false;
    const ap = apObject(dict, ctx);
    if (!(ap instanceof PDFDict) || !ap.has(N('N'))) return false;
    d.set(N('AP'), ap);
    return true;
  } catch { return false; }
}

const nums = (o: PDFObject | undefined) => (o instanceof PDFArray ? o.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0)) : []);
const text = (o: PDFObject | undefined) => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : '');
const fmt = (v: number) => String(Math.round(v * 10000) / 10000);
const hexColor = (c: number[]) => (c.length === 3 ? '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase() : '');

/** A copy of a PDF object with indirect references replaced by their objects (streams dropped). */
function inline(o: PDFObject, ctx: PDFContext, depth = 0, pages?: Map<string, number>): PDFObject | undefined {
  if (depth > 12) return undefined;
  // A page (link and bookmark targets) travels as its index.
  if (o instanceof PDFRef && pages?.has(o.tag)) return PDFNumber.of(pages.get(o.tag)!);
  if (o instanceof PDFRef) { const x = ctx.lookup(o); return x ? inline(x, ctx, depth + 1, pages) : undefined; }
  if (o instanceof PDFStream) return undefined;
  if (o instanceof PDFDict) {
    const d = ctx.obj({}) as PDFDict;
    for (const [k, v] of o.entries()) { const c = inline(v, ctx, depth + 1, pages); if (c) d.set(k, c); }
    return d;
  }
  if (o instanceof PDFArray) {
    const a = ctx.obj([]) as PDFArray;
    for (const v of o.asArray()) { const c = inline(v, ctx, depth + 1, pages); if (c) a.push(c); }
    return a;
  }
  return o;
}

/** XFDF for every markup annotation in the document. */
export function exportXfdf(doc: PDFDocument, fileName: string): string {
  const ctx = doc.context;
  const names = new Map<string, string>(); // annotation ref -> NM, for replies
  const pages = doc.getPages();
  const pageIndex = new Map(pages.map((p, i) => [p.ref.tag, i]));
  const all: { page: number; ref: PDFRef | null; a: PDFDict }[] = [];
  pages.forEach((p, page) => {
    const annots = p.node.lookup(N('Annots'));
    if (!(annots instanceof PDFArray)) return;
    for (const r of annots.asArray()) {
      const a = ctx.lookup(r);
      if (!(a instanceof PDFDict)) continue;
      const st = String(a.get(N('Subtype'))).slice(1);
      if (!ELEMENT[st]) continue;
      let nm = text(a.lookup(N('NM')));
      if (!nm) { nm = crypto.randomUUID(); a.set(N('NM'), PDFString.of(nm)); }
      if (r instanceof PDFRef) names.set(r.tag, nm);
      all.push({ page, ref: r instanceof PDFRef ? r : null, a });
    }
  });
  const out: string[] = [];
  for (const { page, a } of all) {
    const st = String(a.get(N('Subtype'))).slice(1);
    const at: Record<string, string> = { page: String(page) };
    const rect = nums(a.lookup(N('Rect')));
    if (rect.length === 4) at.rect = rect.map(fmt).join(',');
    at.name = text(a.lookup(N('NM')));
    const t = text(a.lookup(N('T'))); if (t) at.title = t;
    const subj = text(a.lookup(N('Subj'))); if (subj) at.subject = subj;
    const m = text(a.lookup(N('M'))); if (m) at.date = m;
    const cd = text(a.lookup(N('CreationDate'))); if (cd) at.creationdate = cd;
    const c = hexColor(nums(a.lookup(N('C')))); if (c) at.color = c;
    const ic = hexColor(nums(a.lookup(N('IC')))); if (ic) at['interior-color'] = ic;
    const ca = a.lookup(N('CA')); if (ca instanceof PDFNumber) at.opacity = fmt(ca.asNumber());
    const fl = a.lookup(N('F'));
    if (fl instanceof PDFNumber) { const f = fl.asNumber(); const list = FLAGS.filter((_, i) => f & (1 << i)); if (list.length) at.flags = list.join(','); }
    const bs = a.lookup(N('BS'));
    if (bs instanceof PDFDict) {
      const w = bs.lookup(N('W')); if (w instanceof PDFNumber) at.width = fmt(w.asNumber());
      const s = String(bs.get(N('S')) ?? '');
      const style: Record<string, string> = { '/S': 'solid', '/D': 'dash', '/B': 'bevelled', '/I': 'inset', '/U': 'underline' };
      if (style[s]) at.style = style[s];
      const d = nums(bs.lookup(N('D'))); if (d.length) at.dashes = d.map(fmt).join(',');
    }
    const be = a.lookup(N('BE'));
    if (be instanceof PDFDict && String(be.get(N('S'))) === '/C') { at.style = 'cloudy'; const i = be.lookup(N('I')); if (i instanceof PDFNumber) at.intensity = fmt(i.asNumber()); }
    const it = a.get(N('IT')); if (it instanceof PDFName) at.intent = it.decodeText();
    const irt = a.get(N('IRT')); if (irt instanceof PDFRef && names.has(irt.tag)) at.inreplyto = names.get(irt.tag)!;
    const rt = a.get(N('RT')); if (rt instanceof PDFName) at.replyType = rt.decodeText() === 'Group' ? 'group' : 'reply';
    const children: string[] = [];
    if (st === 'Line') {
      const l = nums(a.lookup(N('L')));
      if (l.length === 4) { at.start = `${fmt(l[0])},${fmt(l[1])}`; at.end = `${fmt(l[2])},${fmt(l[3])}`; }
      const le = a.lookup(N('LE'));
      if (le instanceof PDFArray) { at.head = String(le.get(0)).slice(1); at.tail = String(le.get(1)).slice(1); }
      const ll = a.lookup(N('LL')); if (ll instanceof PDFNumber) at.leaderLength = fmt(ll.asNumber());
      const lle = a.lookup(N('LLE')); if (lle instanceof PDFNumber) at.leaderExtend = fmt(lle.asNumber());
      if (String(a.get(N('Cap'))) === 'true') at.caption = 'yes';
    }
    if (st === 'Polygon' || st === 'PolyLine') {
      const v = nums(a.lookup(N('Vertices')));
      children.push(`<vertices>${v.reduce<string[]>((acc, x, i) => (i % 2 ? (acc[acc.length - 1] += `,${fmt(x)}`, acc) : [...acc, fmt(x)]), []).join(';')}</vertices>`);
    }
    if (st === 'Ink') {
      const il = a.lookup(N('InkList'));
      if (il instanceof PDFArray) {
        children.push(`<inklist>${il.asArray().map((g) => {
          const v = nums(g instanceof PDFRef ? ctx.lookup(g) : g);
          return `<gesture>${v.reduce<string[]>((acc, x, i) => (i % 2 ? (acc[acc.length - 1] += `,${fmt(x)}`, acc) : [...acc, fmt(x)]), []).join(';')}</gesture>`;
        }).join('')}</inklist>`);
      }
    }
    if (['Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Redact'].includes(st)) { const q = nums(a.lookup(N('QuadPoints'))); if (q.length) at.coords = q.map(fmt).join(','); }
    if (st === 'FreeText') {
      const da = text(a.lookup(N('DA'))); if (da) children.push(`<defaultappearance>${esc(da)}</defaultappearance>`);
      const ds = text(a.lookup(N('DS'))); if (ds) children.push(`<defaultstyle>${esc(ds)}</defaultstyle>`);
      const q = a.lookup(N('Q')); if (q instanceof PDFNumber) at.justification = ['left', 'centered', 'right'][q.asNumber()] ?? 'left';
    }
    if (st === 'Stamp' || st === 'Text') { const nmIcon = a.get(N('Name')); if (nmIcon instanceof PDFName) at.icon = nmIcon.decodeText(); }
    if (st === 'Stamp') { const ap = appearanceOf(a, ctx); if (ap) children.push(`<appearance>${ap}</appearance>`); }
    const contents = text(a.lookup(N('Contents')));
    if (contents) children.push(`<contents>${esc(contents)}</contents>`);
    // Everything else, as PDF syntax.
    const extra = ctx.obj({}) as PDFDict;
    for (const [k, v] of a.entries()) {
      if (STANDARD.has(k.decodeText())) continue;
      const c = inline(v, ctx, 0, pageIndex);
      if (c) extra.set(k, c);
    }
    if (extra.entries().length) children.push(`<ct:extra>${esc(extra.toString())}</ct:extra>`);
    const attrs = Object.entries(at).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
    out.push(`<${ELEMENT[st]} ${attrs}>${children.join('')}</${ELEMENT[st]}>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<xfdf xmlns="http://ns.adobe.com/xfdf/" xmlns:ct="${NS}" xml:space="preserve">\n`
    + `<f href="${esc(fileName)}"/>\n<annots>\n${out.join('\n')}\n</annots>\n</xfdf>\n`;
}

// ---------- a small XML reader (XFDF is simple) ----------

export interface XNode { name: string; attrs: Record<string, string>; children: XNode[]; text: string }

export function parseXml(xml: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unesc(a[2] ?? a[3] ?? '');
      const node: XNode = { name: m[3], attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) top.text += unesc(m[6]);
  }
  return root;
}

const local = (n: string) => n.slice(n.indexOf(':') + 1);
const find = (n: XNode, name: string): XNode | undefined => {
  for (const c of n.children) { if (local(c.name) === name) return c; const d = find(c, name); if (d) return d; }
  return undefined;
};

// ---------- import ----------

const color = (hex: string | undefined) => {
  const m = hex?.match(/^#?([0-9a-f]{6})$/i);
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255) : null;
};
const pts = (s: string | undefined) => (s ?? '').split(/[;,\s]+/).filter(Boolean).map(Number).filter((x) => Number.isFinite(x));

/** Add the XFDF's annotations to the document (replacing ones with the same name). Returns how many. */
export function importXfdf(doc: PDFDocument, xml: string): number {
  const ctx = doc.context;
  const root = parseXml(xml);
  const annots = find(root, 'annots');
  if (!annots) throw new Error('No <annots> in this XFDF file');
  const pages = doc.getPages();
  const incoming = annots.children.filter((c) => SUBTYPE[local(c.name)]);
  const names = new Set(incoming.map((c) => c.attrs.name).filter(Boolean));
  // Remove existing annotations with the same names (and their popups).
  for (const p of pages) {
    const arr = p.node.lookup(N('Annots'));
    if (!(arr instanceof PDFArray)) continue;
    const keep = arr.asArray().filter((r) => { const a = ctx.lookup(r); return !(a instanceof PDFDict && names.has(text(a.lookup(N('NM'))))); });
    p.node.set(N('Annots'), ctx.obj(keep));
  }
  const byName = new Map<string, PDFRef>();
  const replies: [PDFDict, string][] = [];
  let n = 0;
  for (const el of incoming) {
    const a = el.attrs, sub = SUBTYPE[local(el.name)];
    const page = pages[Math.max(0, Math.min(pages.length - 1, Number(a.page ?? 0)))];
    const d = ctx.obj({ Type: 'Annot', Subtype: sub }) as PDFDict;
    const rect = pts(a.rect);
    if (rect.length === 4) d.set(N('Rect'), ctx.obj(rect));
    if (a.name) d.set(N('NM'), PDFString.of(a.name));
    if (a.title) d.set(N('T'), PDFHexString.fromText(a.title));
    if (a.subject) d.set(N('Subj'), PDFHexString.fromText(a.subject));
    if (a.date) d.set(N('M'), PDFString.of(a.date));
    if (a.creationdate) d.set(N('CreationDate'), PDFString.of(a.creationdate));
    const c = color(a.color); if (c) d.set(N('C'), ctx.obj(c));
    const ic = color(a['interior-color']); if (ic) d.set(N('IC'), ctx.obj(ic));
    if (a.opacity) d.set(N('CA'), PDFNumber.of(Number(a.opacity)));
    if (a.flags) d.set(N('F'), PDFNumber.of(a.flags.split(/[,\s]+/).reduce((f, x) => f | (FLAGS.includes(x.toLowerCase()) ? 1 << FLAGS.indexOf(x.toLowerCase()) : 0), 0)));
    else d.set(N('F'), PDFNumber.of(4));
    if (a.width || a.style || a.dashes) {
      const bs = ctx.obj({ Type: 'Border' }) as PDFDict;
      if (a.width) bs.set(N('W'), PDFNumber.of(Number(a.width)));
      const s = { solid: 'S', dash: 'D', bevelled: 'B', inset: 'I', underline: 'U' }[a.style ?? ''];
      if (s) bs.set(N('S'), N(s));
      if (a.dashes) bs.set(N('D'), ctx.obj(pts(a.dashes)));
      d.set(N('BS'), bs);
    }
    if (a.style === 'cloudy') d.set(N('BE'), ctx.obj({ S: 'C', I: Number(a.intensity ?? 1) }));
    if (a.intent) d.set(N('IT'), N(a.intent));
    if (a.replyType) d.set(N('RT'), N(a.replyType === 'group' ? 'Group' : 'R'));
    if (sub === 'Line') {
      const s = pts(a.start), e = pts(a.end);
      if (s.length === 2 && e.length === 2) d.set(N('L'), ctx.obj([...s, ...e]));
      if (a.head || a.tail) d.set(N('LE'), ctx.obj([N(a.head ?? 'None'), N(a.tail ?? 'None')]));
      if (a.leaderLength) d.set(N('LL'), PDFNumber.of(Number(a.leaderLength)));
      if (a.leaderExtend) d.set(N('LLE'), PDFNumber.of(Number(a.leaderExtend)));
      if (a.caption === 'yes') d.set(N('Cap'), ctx.obj(true));
    }
    const v = find(el, 'vertices'); if (v) d.set(N('Vertices'), ctx.obj(pts(v.text)));
    const ink = find(el, 'inklist');
    if (ink) d.set(N('InkList'), ctx.obj(ink.children.filter((g) => local(g.name) === 'gesture').map((g) => pts(g.text))));
    if (a.coords) d.set(N('QuadPoints'), ctx.obj(pts(a.coords)));
    const da = find(el, 'defaultappearance'); if (da) d.set(N('DA'), PDFString.of(da.text));
    const ds = find(el, 'defaultstyle'); if (ds) d.set(N('DS'), PDFString.of(ds.text));
    if (a.justification) d.set(N('Q'), PDFNumber.of({ left: 0, centered: 1, right: 2 }[a.justification] ?? 0));
    if (a.icon) d.set(N('Name'), N(a.icon));
    const ap = find(el, 'appearance'); if (ap?.text.trim()) setAppearance(d, ap.text, ctx);
    const contents = find(el, 'contents'); if (contents) d.set(N('Contents'), PDFHexString.fromText(contents.text));
    const extra = find(el, 'extra');
    if (extra?.text.trim()) {
      try {
        const obj = PDFObjectParser.forBytes(new TextEncoder().encode(extra.text), ctx).parseObject();
        if (obj instanceof PDFDict) for (const [k, val] of obj.entries()) if (!d.has(k)) d.set(k, val);
        // Link targets: page indexes back to pages of this document (remote GoToR keeps numbers).
        const goTo = d.lookup(N('A'));
        const isRemote = goTo instanceof PDFDict && String(goTo.get(N('S'))) === '/GoToR';
        for (const dest of [d.lookup(N('Dest')), goTo instanceof PDFDict && !isRemote ? goTo.lookup(N('D')) : undefined]) {
          const first = dest instanceof PDFArray ? dest.get(0) : undefined;
          if (dest instanceof PDFArray && first instanceof PDFNumber && pages[first.asNumber()]) dest.set(0, pages[first.asNumber()].ref);
        }
      } catch { /* not ours, or damaged: keep the standard part */ }
    }
    d.set(N('P'), page.ref);
    const ref = ctx.register(d);
    if (a.name) byName.set(a.name, ref);
    if (a.inreplyto) replies.push([d, a.inreplyto]);
    const arr = page.node.lookup(N('Annots'));
    if (arr instanceof PDFArray) arr.push(ref); else page.node.set(N('Annots'), ctx.obj([ref]));
    n++;
  }
  for (const [d, name] of replies) { const r = byName.get(name); if (r) d.set(N('IRT'), r); }
  return n;
}

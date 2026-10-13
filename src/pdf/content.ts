// PDF content stream tokenizer (ISO 32000 7.8.2): splits a stream into
// operations, keeping each operand's original bytes so untouched
// operations can be written back exactly as they were.

export type Operand =
  | { t: 'num'; v: number; raw: string }
  | { t: 'str'; v: Uint8Array; raw: string }
  | { t: 'name'; v: string; raw: string }
  | { t: 'arr'; v: Operand[]; raw: string }
  | { t: 'dict'; raw: string }
  | { t: 'other'; raw: string };

export interface Op {
  op: string;
  args: Operand[];
  /** The operation's original text (operands and operator). */
  raw: string;
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set('()<>[]{}/%'.split('').map((c) => c.charCodeAt(0)));

/** Content streams are bytes; we work on a latin1 string so offsets match bytes. */
export const latin1 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};
export const bytesOfLatin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);

function literalBytes(body: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== '\\') { out.push(c.charCodeAt(0)); continue; }
    const n = body[++i];
    if (n === undefined) break;
    const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
    if (n in esc) out.push(esc[n]);
    else if (n === '\r') { if (body[i + 1] === '\n') i++; }
    else if (n === '\n') { /* line continuation */ }
    else if (/[0-7]/.test(n)) {
      let o = n;
      while (o.length < 3 && /[0-7]/.test(body[i + 1] ?? '')) o += body[++i];
      out.push(parseInt(o, 8) & 255);
    } else out.push(n.charCodeAt(0));
  }
  return Uint8Array.from(out);
}

function hexBytes(body: string): Uint8Array {
  const h = body.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(Math.ceil(h.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt((h.slice(i * 2, i * 2 + 2) + '0').slice(0, 2), 16);
  return out;
}

/** Parse a content stream (latin1 string) into operations. */
export function parseContent(s: string): Op[] {
  const ops: Op[] = [];
  let i = 0;
  const n = s.length;
  const code = (k: number) => s.charCodeAt(k);
  const skipWs = () => {
    while (i < n) {
      const c = code(i);
      if (WS.has(c)) i++;
      else if (c === 37) { while (i < n && code(i) !== 10 && code(i) !== 13) i++; } // % comment
      else break;
    }
  };
  // Returns one operand, or a string for an operator keyword.
  const read = (): Operand | { kw: string; start: number } | null => {
    skipWs();
    if (i >= n) return null;
    const start = i;
    const c = s[i];
    if (c === '(') {
      let depth = 0;
      for (; i < n; i++) {
        const ch = s[i];
        if (ch === '\\') { i++; continue; }
        if (ch === '(') depth++;
        else if (ch === ')' && --depth === 0) { i++; break; }
      }
      const raw = s.slice(start, i);
      return { t: 'str', v: literalBytes(raw.slice(1, -1)), raw };
    }
    if (c === '<' && s[i + 1] === '<') {
      let depth = 0;
      while (i < n) {
        if (s[i] === '<' && s[i + 1] === '<') { depth++; i += 2; }
        else if (s[i] === '>' && s[i + 1] === '>') { depth--; i += 2; if (!depth) break; }
        else if (s[i] === '(') { // strings inside dicts may contain >>
          let d = 0;
          for (; i < n; i++) { if (s[i] === '\\') { i++; continue; } if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0) { i++; break; } }
        } else i++;
      }
      return { t: 'dict', raw: s.slice(start, i) };
    }
    if (c === '<') {
      const end = s.indexOf('>', i);
      i = end < 0 ? n : end + 1;
      const raw = s.slice(start, i);
      return { t: 'str', v: hexBytes(raw.slice(1, -1)), raw };
    }
    if (c === '[') {
      i++;
      const items: Operand[] = [];
      for (;;) {
        skipWs();
        if (i >= n) break;
        if (s[i] === ']') { i++; break; }
        const x = read();
        if (!x) break;
        if ('kw' in x) items.push({ t: 'other', raw: x.kw });
        else items.push(x);
      }
      return { t: 'arr', v: items, raw: s.slice(start, i) };
    }
    if (c === '/') {
      i++;
      while (i < n && !WS.has(code(i)) && !DELIM.has(code(i))) i++;
      const raw = s.slice(start, i);
      return { t: 'name', v: raw.slice(1).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), raw };
    }
    if (/[0-9+\-.]/.test(c)) {
      i++;
      while (i < n && /[0-9.]/.test(s[i])) i++;
      const raw = s.slice(start, i);
      return { t: 'num', v: Number(raw) || 0, raw };
    }
    if (c === ']' || c === '>' || c === ')' || c === '{' || c === '}') { i++; return { t: 'other', raw: c }; }
    while (i < n && !WS.has(code(i)) && !DELIM.has(code(i))) i++;
    if (i === start) i++;
    return { kw: s.slice(start, i), start };
  };

  let args: Operand[] = [];
  let opStart = -1;
  for (;;) {
    skipWs();
    if (i >= n) break;
    if (opStart < 0) opStart = i;
    const x = read();
    if (!x) break;
    if (!('kw' in x)) { args.push(x); continue; }
    if (x.kw === 'true' || x.kw === 'false' || x.kw === 'null') { args.push({ t: 'other', raw: x.kw }); continue; }
    if (x.kw === 'BI') {
      // Inline image: BI <key value pairs> ID <binary data> EI
      const id = s.indexOf('ID', i);
      let j = id < 0 ? n : id + 3;
      for (; j < n; j++) {
        if (s[j] === 'E' && s[j + 1] === 'I' && WS.has(code(j - 1)) && (j + 2 >= n || WS.has(code(j + 2)))) break;
      }
      i = Math.min(n, j + 2);
      ops.push({ op: 'BI', args: [], raw: s.slice(opStart, i) });
    } else {
      ops.push({ op: x.kw, args, raw: s.slice(opStart, i) });
    }
    args = [];
    opStart = -1;
  }
  return ops;
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(4)));
export const num = (v: number): Operand => ({ t: 'num', v, raw: fmt(v) });
export const name = (v: string): Operand => ({ t: 'name', v, raw: `/${v.replace(/[^!-~]|[#()<>[\]{}/%]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}` });
export const hexStr = (b: Uint8Array): Operand => ({ t: 'str', v: b, raw: `<${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}>` });
export const arr = (items: Operand[]): Operand => ({ t: 'arr', v: items, raw: `[${items.map((x) => x.raw).join(' ')}]` });

/** A new operation (written fresh). */
export const mkOp = (op: string, ...args: Operand[]): Op => ({ op, args, raw: [...args.map((a) => a.raw), op].join(' ') });

/** Write operations back to content stream text. */
export const writeContent = (ops: Op[]) => ops.map((o) => o.raw).join('\n');

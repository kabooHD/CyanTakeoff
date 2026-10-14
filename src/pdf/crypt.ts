// PDF Standard security handler (ISO 32000-2 7.6): password-protected files.
//
// Opening: the file is parsed by pdf-lib with decryption hooked in (object
// streams are decrypted before they are read, everything else afterwards),
// giving a plain document to work on. RC4 40/128-bit (R2/R3), AES-128 (R4)
// and AES-256 (R5/R6) are supported. The original encryption dictionary and
// file key are kept, so saving re-encrypts with the same passwords.
// Security (Ctrl+L) sets new passwords and permissions: AES-256 (R6).
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFObjectStreamParser, PDFParser,
  PDFRawStream, PDFRef, PDFStream, PDFString, type PDFContext, type PDFObject,
} from 'pdf-lib';
import type forgeNs from 'node-forge';

type Forge = typeof forgeNs;
let forgeP: Promise<Forge> | null = null;
const loadForge = () => (forgeP ??= import('node-forge').then((m) => ((m as unknown as { default?: Forge }).default ?? (m as unknown as Forge))));

const N = PDFName.of;
const PAD = Uint8Array.from([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);

// ---------- byte helpers ----------
const bin = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return s; };
const unbin = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);
const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const le32 = (v: number) => Uint8Array.from([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

function digest(f: Forge, alg: 'md5' | 'sha256' | 'sha384' | 'sha512', data: Uint8Array): Uint8Array {
  const md = f.md[alg].create();
  md.update(bin(data));
  return unbin(md.digest().getBytes());
}

/** AES-CBC without padding (key schedule work of the password hashes). */
function aesCbcRaw(f: Forge, key: Uint8Array, iv: Uint8Array, data: Uint8Array, decrypt = false): Uint8Array {
  const c = decrypt ? f.cipher.createDecipher('AES-CBC', bin(key)) : f.cipher.createCipher('AES-CBC', bin(key));
  c.start({ iv: bin(iv) });
  c.update(f.util.createBuffer(bin(data)));
  (c.finish as (pad?: () => boolean) => boolean)(() => true); // no padding
  return unbin(c.output.getBytes());
}

/** AES-CBC with the IV in front and PKCS#7 padding, as PDF strings and streams use it. */
function aesDecrypt(f: Forge, key: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length < 32 || data.length % 16) return data.length <= 16 ? new Uint8Array(0) : data.subarray(16);
  const out = aesCbcRaw(f, key, data.subarray(0, 16), data.subarray(16), true);
  const p = out[out.length - 1];
  return p >= 1 && p <= 16 && out.length >= p ? out.subarray(0, out.length - p) : out;
}
function aesEncrypt(f: Forge, key: Uint8Array, data: Uint8Array): Uint8Array {
  const iv = rand(16), p = 16 - (data.length % 16);
  return cat(iv, aesCbcRaw(f, key, iv, cat(data, new Uint8Array(p).fill(p))));
}

// ---------- key derivation ----------

/** What a file's /Encrypt dictionary says. */
export interface EncryptInfo {
  V: number; R: number; length: number; P: number;
  O: Uint8Array; U: Uint8Array; OE?: Uint8Array; UE?: Uint8Array; Perms?: Uint8Array;
  encryptMetadata: boolean; id0: Uint8Array;
  /** Crypt method for streams and strings: RC4, AESV2 or AESV3 (or None). */
  stm: 'RC4' | 'AESV2' | 'AESV3' | 'None'; str: 'RC4' | 'AESV2' | 'AESV3' | 'None';
}

const bytesOf = (o: PDFObject | undefined) => (o instanceof PDFString || o instanceof PDFHexString ? o.asBytes() : new Uint8Array(0));

export function readEncrypt(context: PDFContext): EncryptInfo | null {
  const enc = context.lookup(context.trailerInfo.Encrypt);
  if (!(enc instanceof PDFDict)) return null;
  const num = (k: string, d = 0) => { const v = enc.lookup(N(k)); return v instanceof PDFNumber ? v.asNumber() : d; };
  if (String(enc.get(N('Filter'))) !== '/Standard') throw new Error('This PDF uses a security handler other than password security (e.g. certificates).');
  const V = num('V'), R = num('R');
  const cfm = (which: 'StmF' | 'StrF'): EncryptInfo['stm'] => {
    if (V < 4) return 'RC4';
    const name = String(enc.get(N(which)) ?? '/Identity').slice(1);
    if (name === 'Identity') return 'None';
    const cf = enc.lookup(N('CF'));
    const d = cf instanceof PDFDict ? cf.lookup(N(name)) : undefined;
    const m = d instanceof PDFDict ? String(d.get(N('CFM')) ?? '/None').slice(1) : 'None';
    return m === 'V2' ? 'RC4' : (m as EncryptInfo['stm']);
  };
  const id = context.trailerInfo.ID;
  const idArr = id instanceof PDFArray ? id : context.lookup(id);
  const em = enc.lookup(N('EncryptMetadata'));
  return {
    V, R, length: V === 1 ? 40 : num('Length', 40), P: num('P') | 0,
    O: bytesOf(enc.lookup(N('O'))), U: bytesOf(enc.lookup(N('U'))),
    OE: bytesOf(enc.lookup(N('OE'))), UE: bytesOf(enc.lookup(N('UE'))), Perms: bytesOf(enc.lookup(N('Perms'))),
    encryptMetadata: !(em && String(em) === 'false'),
    id0: idArr instanceof PDFArray ? bytesOf(idArr.lookup(0)) : new Uint8Array(0),
    stm: cfm('StmF'), str: cfm('StrF'),
  };
}

const padPw = (pw: Uint8Array) => cat(pw.subarray(0, 32), PAD.subarray(0, Math.max(0, 32 - pw.length)));
const latin1Pw = (s: string) => Uint8Array.from([...s].map((c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 63)));

/** Algorithm 2: file key from a (user) password, R2–R4. */
function key4(f: Forge, e: EncryptInfo, pw: Uint8Array): Uint8Array {
  const n = e.R === 2 ? 5 : e.length / 8;
  let h = digest(f, 'md5', cat(padPw(pw), e.O, le32(e.P), e.id0, e.R >= 4 && !e.encryptMetadata ? Uint8Array.from([255, 255, 255, 255]) : new Uint8Array(0)));
  if (e.R >= 3) for (let i = 0; i < 50; i++) h = digest(f, 'md5', h.subarray(0, n));
  return h.subarray(0, n);
}

/** Algorithms 4/5: does this key belong to the user password? */
function userKeyOk(f: Forge, e: EncryptInfo, key: Uint8Array): boolean {
  if (e.R === 2) return eq(rc4(key, PAD), e.U.subarray(0, 32));
  let x = rc4(key, digest(f, 'md5', cat(PAD, e.id0)));
  for (let i = 1; i <= 19; i++) x = rc4(key.map((b) => b ^ i), x);
  return eq(x.subarray(0, 16), e.U.subarray(0, 16));
}

/** Algorithm 7: the user password hidden in /O, from the owner password (R2–R4). */
function userPwFromOwner(f: Forge, e: EncryptInfo, owner: Uint8Array): Uint8Array {
  const n = e.R === 2 ? 5 : e.length / 8;
  let h = digest(f, 'md5', padPw(owner));
  if (e.R >= 3) for (let i = 0; i < 50; i++) h = digest(f, 'md5', h);
  const k = h.subarray(0, n);
  if (e.R === 2) return rc4(k, e.O);
  let x = e.O;
  for (let i = 19; i >= 0; i--) x = rc4(k.map((b) => b ^ i), x);
  return x;
}

/** Algorithm 2.B (R6) / plain SHA-256 (R5): the hash of a password with a salt (and the U string for owner hashes). */
function hash6(f: Forge, R: number, pw: Uint8Array, salt: Uint8Array, udata: Uint8Array): Uint8Array {
  let k = digest(f, 'sha256', cat(pw, salt, udata));
  if (R === 5) return k;
  for (let round = 0; ; round++) {
    const k1 = cat(pw, k, udata);
    const rep = new Uint8Array(k1.length * 64);
    for (let i = 0; i < 64; i++) rep.set(k1, i * k1.length);
    const ex = aesCbcRaw(f, k.subarray(0, 16), k.subarray(16, 32), rep);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += ex[i];
    const alg = (['sha256', 'sha384', 'sha512'] as const)[sum % 3];
    k = digest(f, alg, ex);
    if (round >= 63 && ex[ex.length - 1] <= round + 1 - 32) break; // at least 64 rounds; then until E ends small enough
  }
  return k.subarray(0, 32);
}

const utf8Pw = (s: string) => new TextEncoder().encode(s.normalize('NFKC')).subarray(0, 127);

export interface Unlocked { key: Uint8Array; owner: boolean }

/** The file key for a password (tried as owner password, then user password), or null if wrong. */
export async function unlock(e: EncryptInfo, password: string): Promise<Unlocked | null> {
  const f = await loadForge();
  if (e.R >= 5) {
    const pw = utf8Pw(password);
    const O = e.O.subarray(0, 48), U = e.U.subarray(0, 48);
    if (eq(hash6(f, e.R, pw, O.subarray(32, 40), U), O.subarray(0, 32))) {
      return { key: aesCbcRaw(f, hash6(f, e.R, pw, O.subarray(40, 48), U), new Uint8Array(16), e.OE!, true), owner: true };
    }
    if (eq(hash6(f, e.R, pw, U.subarray(32, 40), new Uint8Array(0)), U.subarray(0, 32))) {
      return { key: aesCbcRaw(f, hash6(f, e.R, pw, U.subarray(40, 48), new Uint8Array(0)), new Uint8Array(16), e.UE!, true), owner: false };
    }
    return null;
  }
  const pw = latin1Pw(password);
  const asOwner = key4(f, e, userPwFromOwner(f, e, pw));
  if (userKeyOk(f, e, asOwner)) return { key: asOwner, owner: true };
  const asUser = key4(f, e, pw);
  if (userKeyOk(f, e, asUser)) return { key: asUser, owner: false };
  return null;
}

/** Per-object key (R2–R4), or the file key itself (R5/R6). */
function objectKey(f: Forge, e: EncryptInfo, key: Uint8Array, ref: PDFRef, aes: boolean): Uint8Array {
  if (e.R >= 5) return key;
  const n = ref.objectNumber, g = ref.generationNumber;
  const h = digest(f, 'md5', cat(key, Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, g & 255, (g >> 8) & 255]), aes ? Uint8Array.from([0x73, 0x41, 0x6c, 0x54]) : new Uint8Array(0)));
  return h.subarray(0, Math.min(key.length + 5, 16));
}

function crypt(f: Forge, e: EncryptInfo, key: Uint8Array, ref: PDFRef, method: EncryptInfo['stm'], data: Uint8Array, decrypt: boolean): Uint8Array {
  if (method === 'None') return data;
  const k = objectKey(f, e, key, ref, method !== 'RC4');
  if (method === 'RC4') return rc4(k, data);
  return decrypt ? aesDecrypt(f, k, data) : aesEncrypt(f, k, data);
}

/** Replace every string in an object (recursively) with its en/decrypted bytes. */
function mapStrings(obj: PDFObject, fn: (b: Uint8Array) => Uint8Array): PDFObject {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return PDFHexString.of(Array.from(fn(obj.asBytes()), (b) => b.toString(16).padStart(2, '0')).join(''));
  if (obj instanceof PDFArray) { for (let i = 0; i < obj.size(); i++) obj.set(i, mapStrings(obj.get(i), fn)); return obj; }
  if (obj instanceof PDFDict) { for (const [k, v] of obj.entries()) obj.set(k, mapStrings(v, fn)); return obj; }
  if (obj instanceof PDFStream) { mapStrings(obj.dict, fn); return obj; }
  return obj;
}

const isIdentityCrypt = (d: PDFDict) => {
  const fl = d.lookup(N('Filter'));
  return (fl instanceof PDFArray ? fl.asArray() : [fl]).some((x) => String(x) === '/Crypt');
};

// ---------- opening ----------

export class PasswordRequired extends Error { constructor(readonly retry: boolean) { super(retry ? 'Wrong password' : 'Password required'); } }

export interface Security {
  info: EncryptInfo;
  key: Uint8Array;
  /** Opened with the owner password (or none needed): full access. */
  owner: boolean;
  /** The original /Encrypt dictionary, copied into saved files. */
  encryptDict: PDFDict;
}

/** Whether these bytes are an encrypted PDF (a quick look at the trailer). */
export function looksEncrypted(bytes: Uint8Array): boolean {
  const tail = bin(bytes.subarray(Math.max(0, bytes.length - 4096)));
  return /\/Encrypt\s+\d+\s+\d+\s+R/.test(tail) || /\/Encrypt\s+\d+\s+\d+\s+R/.test(bin(bytes.subarray(0, Math.min(bytes.length, 1 << 20))));
}

/**
 * Parse an encrypted PDF and decrypt it with `password` ('' tries no
 * password). Throws PasswordRequired when the password is missing or wrong.
 */
export async function openEncrypted(bytes: Uint8Array, password: string): Promise<{ doc: PDFDocument; security: Security }> {
  const f = await loadForge();
  // Pass 1: read the trailer and /Encrypt without reading object streams.
  const origFor = PDFObjectStreamParser.forStream;
  const P = PDFParser.prototype as unknown as { parseIndirectObjectHeader: () => PDFRef };
  const origHeader = P.parseIndirectObjectHeader;
  let info: EncryptInfo | null;
  try {
    (PDFObjectStreamParser as unknown as { forStream: unknown }).forStream = () => ({ parseIntoContext: async () => undefined });
    const pass1 = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    info = readEncrypt(pass1.context);
  } finally {
    (PDFObjectStreamParser as unknown as { forStream: unknown }).forStream = origFor;
  }
  if (!info) throw new Error('Not an encrypted PDF');
  const unlocked = await unlock(info, password) ?? (password ? null : null);
  if (!unlocked) throw new PasswordRequired(password !== '');
  const e = info, key = unlocked.key;
  // Pass 2: object streams decrypted before they are parsed; their objects are not encrypted again inside.
  let last: PDFRef | null = null;
  const fromObjStm = new Set<string>();
  let ctxRef: PDFContext | null = null;
  try {
    P.parseIndirectObjectHeader = function (this: unknown) { const r = origHeader.call(this); last = r; return r; };
    (PDFObjectStreamParser as unknown as { forStream: unknown }).forStream = (raw: PDFRawStream, tick?: unknown) => {
      const dec = last && e.stm !== 'None' ? PDFRawStream.of(raw.dict, crypt(f, e, key, last, e.stm, raw.contents, true)) : raw;
      const parser = (origFor as (r: PDFRawStream, t?: unknown) => { parseIntoContext(): Promise<void> }).call(PDFObjectStreamParser, dec, tick);
      return {
        parseIntoContext: async () => {
          const ctx = (dec.dict as unknown as { context: PDFContext }).context;
          ctxRef = ctx;
          const before = new Set(ctx.enumerateIndirectObjects().map(([r]) => r.tag));
          await parser.parseIntoContext();
          for (const [r] of ctx.enumerateIndirectObjects()) if (!before.has(r.tag)) fromObjStm.add(r.tag);
        },
      };
    };
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    ctxRef = doc.context;
    const encRef = doc.context.trailerInfo.Encrypt;
    const encryptDict = doc.context.lookup(encRef) as PDFDict;
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (fromObjStm.has(ref.tag) || (encRef instanceof PDFRef && ref.tag === encRef.tag) || obj === encryptDict) continue;
      if (obj instanceof PDFRawStream) {
        const type = String(obj.dict.get(N('Type')) ?? '');
        if (type === '/XRef') continue;
        mapStrings(obj.dict, (b) => crypt(f, e, key, ref, e.str, b, true));
        const skip = (type === '/Metadata' && !e.encryptMetadata) || isIdentityCrypt(obj.dict);
        if (!skip) doc.context.assign(ref, PDFRawStream.of(obj.dict, crypt(f, e, key, ref, e.stm, obj.contents, true)));
      } else {
        mapStrings(obj, (b) => crypt(f, e, key, ref, e.str, b, true));
      }
    }
    // A plain document from here on.
    if (encRef instanceof PDFRef) doc.context.delete(encRef);
    doc.context.trailerInfo.Encrypt = undefined;
    void ctxRef;
    return { doc, security: { info: e, key, owner: unlocked.owner, encryptDict } };
  } finally {
    P.parseIndirectObjectHeader = origHeader;
    (PDFObjectStreamParser as unknown as { forStream: unknown }).forStream = origFor;
  }
}

// ---------- permissions ----------

/** Permission bits (ISO 32000 Table 22). */
export const PERM = { print: 1 << 2, modify: 1 << 3, copy: 1 << 4, annotate: 1 << 5, fillForms: 1 << 8, assemble: 1 << 10, printHigh: 1 << 11 } as const;
export const allowed = (s: Security | null | undefined, bit: number) => !s || s.owner || (s.info.P & bit) !== 0;

// ---------- saving ----------

export interface NewSecurity { userPassword: string; ownerPassword: string; permissions: number }

/** /Encrypt for AES-256 (R6) with new passwords, and its file key. */
async function makeR6(sec: NewSecurity): Promise<{ dict: Record<string, unknown>; info: EncryptInfo; key: Uint8Array }> {
  const f = await loadForge();
  const key = rand(32);
  const upw = utf8Pw(sec.userPassword), opw = utf8Pw(sec.ownerPassword || sec.userPassword || bin(rand(16)));
  const uvs = rand(8), uks = rand(8);
  const U = cat(hash6(f, 6, upw, uvs, new Uint8Array(0)), uvs, uks);
  const UE = aesCbcRaw(f, hash6(f, 6, upw, uks, new Uint8Array(0)), new Uint8Array(16), key);
  const ovs = rand(8), oks = rand(8);
  const O = cat(hash6(f, 6, opw, ovs, U), ovs, oks);
  const OE = aesCbcRaw(f, hash6(f, 6, opw, oks, U), new Uint8Array(16), key);
  // Permissions: bits 1-2 zero, 7-8 and 13-32 set (ISO 32000-2 Table 22).
  const P = (sec.permissions | 0xfffff0c0) & ~3;
  const permsPlain = cat(le32(P), Uint8Array.from([255, 255, 255, 255, 0x54, 0x61, 0x64, 0x62]), rand(4));
  const ecb = f.cipher.createCipher('AES-ECB', bin(key));
  ecb.start({}); ecb.update(f.util.createBuffer(bin(permsPlain))); (ecb.finish as (pad?: () => boolean) => boolean)(() => true);
  const Perms = unbin(ecb.output.getBytes());
  const info: EncryptInfo = { V: 5, R: 6, length: 256, P: P | 0, O, U, OE, UE, Perms, encryptMetadata: true, id0: new Uint8Array(0), stm: 'AESV3', str: 'AESV3' };
  return { info, key, dict: { O, U, OE, UE, Perms, P: P | 0 } };
}

const hexObj = (b: Uint8Array) => PDFHexString.of(Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''));

/** Encrypt a plain PDF: with the security it was opened with, or new passwords. */
export async function encryptPdf(plain: Uint8Array, sec: Security | NewSecurity): Promise<Uint8Array> {
  const f = await loadForge();
  const doc = await PDFDocument.load(plain, { updateMetadata: false });
  const ctx = doc.context;
  let e: EncryptInfo, key: Uint8Array, encDict: PDFDict;
  if ('key' in sec) {
    e = sec.info; key = sec.key;
    encDict = ctx.obj({}) as PDFDict;
    for (const [k, v] of sec.encryptDict.entries()) encDict.set(k, v instanceof PDFRef ? (sec.encryptDict.context.lookup(v) ?? v) as PDFObject : v.clone(ctx));
  } else {
    const r6 = await makeR6(sec);
    e = r6.info; key = r6.key;
    encDict = ctx.obj({
      Filter: 'Standard', V: 5, R: 6, Length: 256, P: r6.dict.P as number,
      CF: { StdCF: { CFM: 'AESV3', AuthEvent: 'DocOpen', Length: 32 } }, StmF: 'StdCF', StrF: 'StdCF',
      EncryptMetadata: true,
    }) as PDFDict;
    for (const k of ['O', 'U', 'OE', 'UE', 'Perms'] as const) encDict.set(N(k), hexObj(r6.dict[k] as Uint8Array));
  }
  // R2–R4 keys depend on the file ID: keep the original first ID.
  const id = ctx.trailerInfo.ID;
  const idArr = id instanceof PDFArray ? id : ctx.lookup(id);
  if (!(idArr instanceof PDFArray)) {
    const r = hexObj(rand(16));
    ctx.trailerInfo.ID = ctx.obj([r, r]);
  }
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFStream) {
      mapStrings(obj.dict, (b) => crypt(f, e, key, ref, e.str, b, false));
      const type = String(obj.dict.get(N('Type')) ?? '');
      if (type === '/XRef' || (type === '/Metadata' && !e.encryptMetadata) || isIdentityCrypt(obj.dict)) continue;
      const contents = obj instanceof PDFRawStream ? obj.contents : (obj as unknown as { getContents(): Uint8Array }).getContents();
      ctx.assign(ref, PDFRawStream.of(obj.dict, crypt(f, e, key, ref, e.stm, contents, false)));
    } else {
      mapStrings(obj, (b) => crypt(f, e, key, ref, e.str, b, false));
    }
  }
  ctx.trailerInfo.Encrypt = ctx.register(encDict);
  return doc.save({ useObjectStreams: false });
}

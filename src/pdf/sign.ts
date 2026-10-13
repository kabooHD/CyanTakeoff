// Certificate-based digital signatures (ISO 32000 12.8): sign with a
// PKCS#12 (.pfx/.p12) file as a detached PKCS#7/CMS signature
// (adbe.pkcs7.detached) written as an incremental update, and verify the
// signatures in a document. node-forge reads PKCS#12 and builds the CMS;
// verification uses WebCrypto (RSA PKCS#1 v1.5 and ECDSA).
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, StandardFonts, type PDFPage } from 'pdf-lib';
import type forgeNs from 'node-forge';
import { incrementalUpdate, keepPageContents, loadForUpdate } from './incremental';

type Forge = typeof forgeNs;
let forgeP: Promise<Forge> | null = null;
/** node-forge is large: load it only when signing or verifying. */
const loadForge = () => (forgeP ??= import('node-forge').then((m) => ((m as unknown as { default?: Forge }).default ?? (m as unknown as Forge))));

const N = (s: string) => PDFName.of(s);
/** Bytes reserved for the CMS signature (hex doubles it in the file). */
const SIG_BYTES = 16384;
const BR_PLACEHOLDER = '**********';

const toBinary = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};
const fromBinary = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(s, (c) => c.charCodeAt(0));
const pdfDate = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  const tz = -d.getTimezoneOffset(), sign = tz >= 0 ? '+' : '-';
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${sign}${p(Math.floor(Math.abs(tz) / 60))}'${p(Math.abs(tz) % 60)}'`;
};

export interface Signer { name: string; issuer: string; notAfter: Date }

/** Open a PKCS#12 file: the private key and its certificate (with any chain). Throws on a wrong password. */
async function openP12(p12: Uint8Array, password: string) {
  const forge = await loadForge();
  let pkcs12;
  try {
    pkcs12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(toBinary(p12)), password);
  } catch (e) {
    throw new Error(/password|mac|decrypt/i.test(String(e)) ? 'Wrong password for this certificate file.' : `Not a readable .pfx/.p12 file (${(e as Error).message}).`);
  }
  const keyBags = [
    ...(pkcs12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(pkcs12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ];
  const certs = (pkcs12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).map((b) => b.cert).filter((c): c is forgeNs.pki.Certificate => !!c);
  const key = keyBags[0]?.key as forgeNs.pki.rsa.PrivateKey | undefined;
  if (!key || !certs.length) throw new Error('The certificate file has no private key or certificate (only RSA keys are supported).');
  const cert = certs.find((c) => (c.publicKey as forgeNs.pki.rsa.PublicKey).n?.equals?.(key.n)) ?? certs[0];
  return { forge, key, cert, chain: certs.filter((c) => c !== cert) };
}

const cn = (attrs: forgeNs.pki.Certificate['subject']) => String(attrs.getField('CN')?.value ?? attrs.getField('O')?.value ?? 'Unknown');

/** Who a certificate file belongs to (checks the password). */
export async function certificateInfo(p12: Uint8Array, password: string): Promise<Signer> {
  const { cert } = await openP12(p12, password);
  return { name: cn(cert.subject), issuer: cn(cert.issuer), notAfter: cert.validity.notAfter };
}

export interface SignOptions {
  p12: Uint8Array;
  password: string;
  reason?: string;
  location?: string;
  /** Visible signature: page index and rectangle in PDF space. Omit for an invisible signature. */
  page?: number;
  rect?: [number, number, number, number];
  /** Sign this existing (empty) signature field instead of adding one. */
  field?: string;
  date?: Date;
}

function findField(doc: PDFDocument, name: string): PDFDict | undefined {
  try {
    const f = doc.getForm().getFieldMaybe(name);
    return f?.acroField.dict;
  } catch { return undefined; }
}

/** Visible signature appearance: who signed, when, and why. */
async function appearance(doc: PDFDocument, w: number, h: number, lines: string[]) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = Math.max(4, Math.min(12, (h - 6) / (lines.length * 1.25), ...lines.map((l) => ((w - 8) / Math.max(1, font.widthOfTextAtSize(l, 1))))));
  let ops = `q 0 0 ${w} ${h} re W n 0 0 0.6 rg BT /F1 ${size} Tf`;
  lines.forEach((l, i) => {
    ops += ` 1 0 0 1 4 ${h - 4 - size * (i + 1) * 1.15} Tm ${font.encodeText(l).toString()} Tj`;
  });
  ops += ' ET Q';
  const stream = doc.context.stream(ops, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h], Resources: { Font: { F1: font.ref } } });
  return doc.context.register(stream);
}

/**
 * Sign `pdf` and return the signed file: the original bytes followed by an
 * incremental update holding the signature field and the CMS signature.
 */
export async function signPdf(pdf: Uint8Array, opts: SignOptions): Promise<Uint8Array> {
  const { forge, key, cert, chain } = await openP12(opts.p12, opts.password);
  const doc = await loadForUpdate(pdf);
  const ctx = doc.context;
  const date = opts.date ?? new Date();
  const name = cn(cert.subject);
  const sig = ctx.register(ctx.obj({
    Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, N(BR_PLACEHOLDER), N(BR_PLACEHOLDER), N(BR_PLACEHOLDER)],
    Contents: PDFHexString.of('0'.repeat(SIG_BYTES * 2)),
    M: PDFString.of(pdfDate(date)), Name: PDFHexString.fromText(name),
    ...(opts.reason ? { Reason: PDFHexString.fromText(opts.reason) } : {}),
    ...(opts.location ? { Location: PDFHexString.fromText(opts.location) } : {}),
  }));
  const form = doc.getForm();
  const acro = form.acroForm.dict;
  acro.set(N('SigFlags'), PDFNumber.of(3)); // signatures exist; append only
  let widget: PDFDict | undefined = opts.field ? findField(doc, opts.field) : undefined;
  if (opts.field && !widget) throw new Error(`No signature field named "${opts.field}".`);
  let page: PDFPage | undefined;
  if (widget) {
    if (widget.get(N('V'))) throw new Error(`"${opts.field}" is already signed.`);
    widget.set(N('V'), sig);
  } else {
    page = doc.getPage(opts.page ?? 0);
    keepPageContents(page);
    const rect = opts.rect ?? [0, 0, 0, 0];
    const used = form.getFields().map((f) => f.getName());
    let i = 1;
    while (used.includes(`Signature${i}`)) i++;
    widget = ctx.obj({
      Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFHexString.fromText(`Signature${i}`), V: sig,
      F: 4 | 128, P: page.ref, Rect: rect,
    }) as PDFDict;
    const ref = ctx.register(widget);
    page.node.addAnnot(ref);
    form.acroForm.addField(ref);
  }
  // Appearance on the widget (the field itself, or its first kid).
  const kids = widget.lookup(N('Kids'));
  const w0 = kids instanceof PDFArray ? ctx.lookup(kids.get(0)) as PDFDict : widget;
  const r = (w0.lookup(N('Rect')) as PDFArray | undefined)?.asArray().map((x) => (x as PDFNumber).asNumber()) ?? [0, 0, 0, 0];
  const w = Math.abs(r[2] - r[0]), h = Math.abs(r[3] - r[1]);
  if (w > 1 && h > 1) {
    const lines = [`Digitally signed by ${name}`, `Date: ${date.toLocaleString()}`];
    if (opts.reason) lines.push(`Reason: ${opts.reason}`);
    if (opts.location) lines.push(`Location: ${opts.location}`);
    w0.set(N('AP'), ctx.obj({ N: await appearance(doc, w, h, lines) }));
  }

  const out = await incrementalUpdate(pdf, doc);
  // Fill in /ByteRange, then sign everything except the /Contents hole.
  const text = new TextDecoder('latin1').decode(out.subarray(pdf.length));
  const hole = text.indexOf(`<${'0'.repeat(SIG_BYTES * 2)}>`);
  const brAt = text.indexOf(`/${BR_PLACEHOLDER}`);
  if (hole < 0 || brAt < 0) throw new Error('Signature placeholder not found');
  const start = pdf.length + hole, end = start + SIG_BYTES * 2 + 2;
  const brLen = `/${BR_PLACEHOLDER} /${BR_PLACEHOLDER} /${BR_PLACEHOLDER}`.length;
  const br = `${start} ${end} ${out.length - end}`.padEnd(brLen, ' ');
  out.set(new TextEncoder().encode(br), pdf.length + brAt);
  const signed = new Uint8Array(start + out.length - end);
  signed.set(out.subarray(0, start)); signed.set(out.subarray(end), start);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(toBinary(signed));
  p7.addCertificate(cert);
  chain.forEach((c) => p7.addCertificate(c));
  p7.addSigner({
    key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: date as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const hex = Array.from(der, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  if (hex.length > SIG_BYTES * 2) throw new Error('Signature too large');
  out.set(new TextEncoder().encode(hex), start + 1);
  return out;
}

// ---------------- Verification ----------------

export interface SignatureInfo {
  field: string;
  signer: string;
  issuer: string;
  time?: Date;
  reason?: string;
  location?: string;
  /** valid: the signed bytes are intact and the signature matches the certificate. */
  status: 'valid' | 'invalid' | 'unknown';
  detail: string;
  /** False when the document has later revisions (changes after this signature). */
  coversDocument: boolean;
  /** Signing time (or now) within the certificate's validity period. */
  certInDate: boolean;
  selfSigned: boolean;
}

const OID = {
  sha1: '1.3.14.3.2.26', sha256: '2.16.840.1.101.3.4.2.1', sha384: '2.16.840.1.101.3.4.2.2', sha512: '2.16.840.1.101.3.4.2.3',
  rsa: '1.2.840.113549.1.1.1', ec: '1.2.840.10045.2.1',
  messageDigest: '1.2.840.113549.1.9.4', signingTime: '1.2.840.113549.1.9.5', cn: '2.5.4.3', o: '2.5.4.10',
};
const HASH: Record<string, string> = { [OID.sha1]: 'SHA-1', [OID.sha256]: 'SHA-256', [OID.sha384]: 'SHA-384', [OID.sha512]: 'SHA-512' };
const CURVES: Record<string, [string, number]> = { '1.2.840.10045.3.1.7': ['P-256', 32], '1.3.132.0.34': ['P-384', 48], '1.3.132.0.35': ['P-521', 66] };

type Asn1 = forgeNs.asn1.Asn1;
const kids = (n: Asn1 | undefined) => (Array.isArray(n?.value) ? n!.value as Asn1[] : []);

/** All signature fields with a value, with their (inherited) names. */
function signatureFields(doc: PDFDocument): { name: string; v: PDFDict }[] {
  const acro = doc.catalog.lookup(N('AcroForm'));
  const out: { name: string; v: PDFDict }[] = [];
  if (!(acro instanceof PDFDict)) return out;
  const walk = (arr: unknown, prefix: string, ft: string, depth: number) => {
    if (!(arr instanceof PDFArray) || depth > 20) return;
    for (const r of arr.asArray()) {
      const f = r instanceof PDFRef ? doc.context.lookup(r) : r;
      if (!(f instanceof PDFDict)) continue;
      const t = f.lookup(N('T'));
      const part = t instanceof PDFString || t instanceof PDFHexString ? t.decodeText() : '';
      const name = part ? (prefix ? `${prefix}.${part}` : part) : prefix;
      const type = f.get(N('FT')) ? String(f.get(N('FT'))) : ft;
      const v = f.lookup(N('V'));
      if (type === '/Sig' && v instanceof PDFDict) out.push({ name, v });
      walk(f.lookup(N('Kids')), name, type, depth + 1);
    }
  };
  walk(acro.lookup(N('Fields')), '', '', 0);
  return out;
}

function derToRaw(sig: Uint8Array, size: number, forge: Forge): Uint8Array<ArrayBuffer> {
  const seq = forge.asn1.fromDer(toBinary(sig));
  const int = (n: Asn1) => {
    let b = fromBinary(n.value as string);
    while (b.length > size && b[0] === 0) b = b.subarray(1);
    const out = new Uint8Array(size); out.set(b, size - b.length); return out;
  };
  const [r, s] = kids(seq);
  const raw = new Uint8Array(size * 2); raw.set(int(r)); raw.set(int(s), size);
  return raw;
}

/** Verify every signature in `pdf`. */
export async function verifySignatures(pdf: Uint8Array): Promise<SignatureInfo[]> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false, ignoreEncryption: true });
  const fields = signatureFields(doc);
  if (!fields.length) return [];
  const forge = await loadForge();
  const asn1 = forge.asn1;
  const out: SignatureInfo[] = [];
  for (const { name, v } of fields) {
    const info: SignatureInfo = { field: name, signer: 'Unknown', issuer: '', status: 'unknown', detail: '', coversDocument: false, certInDate: false, selfSigned: false };
    const text = (k: string) => { const x = v.lookup(N(k)); return x instanceof PDFString || x instanceof PDFHexString ? x.decodeText() : undefined; };
    info.reason = text('Reason'); info.location = text('Location');
    out.push(info);
    try {
      const br = (v.lookup(N('ByteRange')) as PDFArray).asArray().map((x) => (x as PDFNumber).asNumber());
      const contents = v.lookup(N('Contents'));
      const sub = String(v.get(N('SubFilter')) ?? '');
      if (!(contents instanceof PDFHexString || contents instanceof PDFString) || br.length !== 4) throw new Error('No signature data');
      if (!/adbe\.pkcs7\.detached|ETSI\.CAdES\.detached/.test(sub)) { info.detail = `Signature format ${sub || '(none)'} is not supported for checking.`; continue; }
      info.coversDocument = br[2] + br[3] === pdf.length;
      const data = new Uint8Array(br[1] + br[3]);
      data.set(pdf.subarray(br[0], br[0] + br[1])); data.set(pdf.subarray(br[2], br[2] + br[3]), br[1]);

      const cms = asn1.fromDer(toBinary(contents.asBytes()), { parseAllBytes: false } as never);
      const signedData = kids(kids(cms)[1])[0];
      const sd = kids(signedData);
      const certsNode = sd.find((n) => n.tagClass === asn1.Class.CONTEXT_SPECIFIC && n.type === 0);
      const signerInfo = kids(sd[sd.length - 1])[0];
      const si = kids(signerInfo);
      const sid = si[1];
      const digestOid = asn1.derToOid(kids(si[2])[0].value as string);
      const hash = HASH[digestOid];
      if (!hash) { info.detail = 'Unsupported digest algorithm.'; continue; }
      let k = 3;
      const signedAttrs = si[k]?.tagClass === asn1.Class.CONTEXT_SPECIFIC && si[k].type === 0 ? si[k++] : undefined;
      k++; // signature algorithm
      const signature = fromBinary(si[k].value as string);

      // The signer's certificate: matched by issuer and serial number.
      const certs = kids(certsNode);
      const serialOf = (c: Asn1) => { const tbs = kids(kids(c)[0]); const off = tbs[0].tagClass === asn1.Class.CONTEXT_SPECIFIC ? 1 : 0; return tbs[off].value as string; };
      const wanted = sid.tagClass === asn1.Class.UNIVERSAL ? kids(sid)[1]?.value as string : undefined;
      const cert = certs.find((c) => wanted !== undefined && serialOf(c) === wanted) ?? certs[0];
      if (!cert) throw new Error('No certificate in the signature');
      const tbs = kids(kids(cert)[0]);
      const off = tbs[0].tagClass === asn1.Class.CONTEXT_SPECIFIC ? 1 : 0;
      const nameOf = (n: Asn1) => {
        let o = '';
        for (const set of kids(n)) for (const atv of kids(set)) {
          const oid = asn1.derToOid(kids(atv)[0].value as string);
          if (oid === OID.cn || (oid === OID.o && !o)) o = forge.util.decodeUtf8(kids(atv)[1].value as string);
        }
        return o || 'Unknown';
      };
      info.issuer = nameOf(tbs[off + 2]);
      info.signer = nameOf(tbs[off + 4]);
      info.selfSigned = asn1.toDer(tbs[off + 2]).getBytes() === asn1.toDer(tbs[off + 4]).getBytes();
      const validity = kids(tbs[off + 3]).map((t) => (t.type === asn1.Type.UTCTIME ? asn1.utcTimeToDate(t.value as string) : asn1.generalizedTimeToDate(t.value as string)));

      // The document digest must match the signed messageDigest attribute.
      const digest = new Uint8Array(await crypto.subtle.digest(hash, data));
      let toVerify = data;
      if (signedAttrs) {
        let md: string | undefined;
        for (const attr of kids(signedAttrs)) {
          const oid = asn1.derToOid(kids(attr)[0].value as string);
          const val = kids(kids(attr)[1])[0];
          if (oid === OID.messageDigest) md = val.value as string;
          if (oid === OID.signingTime) info.time = val.type === asn1.Type.UTCTIME ? asn1.utcTimeToDate(val.value as string) : asn1.generalizedTimeToDate(val.value as string);
        }
        if (md !== toBinary(digest)) { info.status = 'invalid'; info.detail = 'The document was altered after it was signed.'; continue; }
        // The signature covers the attributes, DER-encoded as a SET.
        toVerify = fromBinary(asn1.toDer(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SET, true, kids(signedAttrs))).getBytes());
      }
      const when = info.time ?? new Date();
      info.certInDate = validity.length === 2 && when >= validity[0] && when <= validity[1];

      // Check the signature with the certificate's public key.
      const spki = tbs[off + 5];
      const keyAlg = kids(spki)[0];
      const keyOid = asn1.derToOid(kids(keyAlg)[0].value as string);
      const spkiDer = fromBinary(asn1.toDer(spki).getBytes());
      let ok: boolean;
      if (keyOid === OID.rsa) {
        const key = await crypto.subtle.importKey('spki', spkiDer, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
        ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, toVerify);
      } else if (keyOid === OID.ec) {
        const curve = CURVES[asn1.derToOid(kids(keyAlg)[1].value as string)];
        if (!curve) { info.detail = 'Unsupported elliptic curve.'; continue; }
        const key = await crypto.subtle.importKey('spki', spkiDer, { name: 'ECDSA', namedCurve: curve[0] }, false, ['verify']);
        ok = await crypto.subtle.verify({ name: 'ECDSA', hash }, key, derToRaw(signature, curve[1], forge), toVerify);
      } else { info.detail = 'Unsupported key type.'; continue; }
      info.status = ok ? 'valid' : 'invalid';
      info.detail = ok
        ? `Signed content is intact${info.coversDocument ? '' : '; the document was changed after this signature (later revision)'}. Signer identity is not checked against a trusted list${info.selfSigned ? ' (self-signed certificate)' : ''}.`
        : 'The signature does not match the signer\'s certificate.';
    } catch (e) {
      info.status = 'unknown';
      info.detail = `Could not read the signature: ${(e as Error).message}`;
    }
  }
  return out;
}

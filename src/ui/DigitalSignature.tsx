// Certificate-based digital signatures (Revu: Signatures > Sign Document,
// and the Signatures panel, Alt+4). Signing appends an incremental update,
// so earlier signatures stay valid.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { useApp, type DocState } from '../model/store';
import { certificateInfo, signPdf, verifySignatures, type SignatureInfo, type Signer } from '../pdf/sign';
import { pickFile } from './toolActions';
import { FilesRow, batchHint, targets } from './filesRow';
import { readCertificates } from '../pdf/sign';
import { saveTrust, toTrusted, trustBytes, useTrust } from '../model/trust';

interface Pending { p12: Uint8Array; password: string; reason: string; location: string; signer: Signer; tsa?: string; certify?: 1 | 2 | 3 }
export const useDigitalSign = create<{ open: boolean; field?: string; certify?: boolean; pending: Pending | null; tick: number }>(() => ({ open: false, pending: null, tick: 0 }));

/** Open the Sign Document dialog, optionally for an empty signature field. */
export const openSignDialog = (field?: string, certify = false) => useDigitalSign.setState({ open: true, field, certify, pending: null });

/** Document > Validate Signatures: re-check every signature and show the Signatures panel. */
export async function validateSignatures() {
  const app = useApp.getState();
  const d = app.docs.find((x) => x.id === app.activeId);
  if (!d) return;
  app.setStatus('Validating signatures…');
  try {
    const list = await verifySignatures(d.bytes, trustBytes());
    app.setPanels({ left: 'signatures' });
    useDigitalSign.setState((x) => ({ tick: x.tick + 1 }));
    const valid = list.filter((x) => x.status === 'valid').length;
    app.setStatus(list.length ? `Validate Signatures: ${valid} of ${list.length} valid${list.some((x) => x.certified) ? ' (document certified)' : ''}` : 'This document has no digital signatures.');
  } catch (e) { app.setStatus(`Validate Signatures failed: ${(e as Error).message}`); }
}

/** True while waiting for the user to drag the visible signature's box. */
export const awaitingSignatureBox = () => !!useDigitalSign.getState().pending;

/** Sign the active document; `place` gives the visible signature's page and PDF-space box. */
export async function signActive(p: Pending, place: { page?: number; rect?: [number, number, number, number]; field?: string }) {
  const app = useApp.getState();
  useDigitalSign.setState({ pending: null });
  const ok = await app.transformDoc(
    (_lib, bytes) => signPdf(bytes, { p12: p.p12, password: p.password, reason: p.reason || undefined, location: p.location || undefined, tsa: p.tsa || undefined, certify: p.certify, hash: app.prefs.hashAlgorithm, ...place }),
    `${p.certify ? 'Certified' : 'Signed'} by ${p.signer.name}. Save (Ctrl+S) to write the signed file.`,
  );
  if (ok) useDigitalSign.setState((x) => ({ tick: x.tick + 1 }));
}

/** Batch > Sign & Seal: an invisible signature on every open document. */
async function signAll(p: Pending, active: DocState) {
  const app = useApp.getState();
  let n = 0;
  for (const d of targets(active, true)) {
    const ok = await app.transformDoc(
      (_lib, bytes) => signPdf(bytes, { p12: p.p12, password: p.password, reason: p.reason || undefined, location: p.location || undefined, tsa: p.tsa || undefined, certify: p.certify, hash: app.prefs.hashAlgorithm }),
      `Signed by ${p.signer.name}`, undefined, undefined, d.id,
    );
    if (ok) n++;
  }
  useDigitalSign.setState((x) => ({ tick: x.tick + 1 }));
  app.setStatus(`Sign & Seal: ${n} document${n === 1 ? '' : 's'} signed by ${p.signer.name}. Save All (Ctrl+F2) to write them.`);
}

/** The visible signature's box was dragged (page space) on `page`. */
export function placeSignatureBox(doc: DocState, page: number, a: { x: number; y: number }, b: { x: number; y: number }) {
  const p = useDigitalSign.getState().pending;
  if (!p) return;
  const vp = doc.loaded.pages[page].viewport;
  const [x0, y0] = vp.convertToPdfPoint(a.x, a.y), [x1, y1] = vp.convertToPdfPoint(b.x, b.y);
  useApp.getState().setTool('select');
  void signActive(p, { page, rect: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)] });
}

export function DigitalSignDialog() {
  const open = useDigitalSign((x) => x.open);
  const doc = useApp((s) => s.docs.find((d) => d.id === s.activeId));
  return open && doc ? <SignForm doc={doc} /> : null;
}

function SignForm({ doc }: { doc: DocState }) {
  const field0 = useDigitalSign((x) => x.field);
  const certify0 = useDigitalSign((x) => x.certify);
  const [certify, setCertify] = useState<0 | 1 | 2 | 3>(certify0 ? 2 : 0);
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [password, setPassword] = useState('');
  const [signer, setSigner] = useState<Signer | null>(null);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');
  const [tsa, setTsa] = useState(() => { try { return localStorage.getItem('cyantakeoff:tsa') ?? ''; } catch { return ''; } });
  const empty = doc.loaded.fields.filter((f) => f.type === 'signature' && !f.value);
  const [where, setWhere] = useState<string>(field0 ? `field:${field0}` : empty.length ? `field:${empty[0].name}` : 'box');
  const [all, setAll] = useState(() => batchHint.take());
  const close = () => useDigitalSign.setState({ open: false });
  const check = async () => {
    setError(''); setSigner(null);
    if (!file) return;
    try { setSigner(await certificateInfo(file.bytes, password)); } catch (e) { setError((e as Error).message); }
  };
  const sign = async () => {
    if (!file || !signer) return;
    const p: Pending = { p12: file.bytes, password, reason, location, signer, tsa: tsa.trim(), certify: certify || undefined };
    try { localStorage.setItem('cyantakeoff:tsa', tsa.trim()); } catch { /* ignore */ }
    close();
    if (all) { await signAll(p, doc); return; }
    if (where === 'box') {
      useDigitalSign.setState({ pending: p });
      useApp.getState().setTool('form-signature');
      useApp.getState().setStatus('Drag a box on the page where the signature should appear. Esc cancels.');
    } else if (where === 'invisible') await signActive(p, {});
    else await signActive(p, { field: where.slice(6) });
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-label="Sign Document" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="modal-title">{certify0 ? 'Certify Document' : 'Sign Document'}</div>
        <div className="scale-dialog">
          <div className="form-row"><span>Digital ID</span>
            <button onClick={async () => {
              const f = await pickFile('.pfx,.p12,application/x-pkcs12');
              if (f) { setFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }); setSigner(null); setError(''); }
            }}>Choose .pfx / .p12…</button>
            <span className="muted">{file?.name ?? 'No file chosen'}</span>
          </div>
          <div className="form-row"><span>Password</span>
            <input type="password" aria-label="Certificate password" value={password} onChange={(e) => { setPassword(e.target.value); setSigner(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void check(); }} />
            <button disabled={!file} onClick={check}>Open</button>
          </div>
          {signer && <p className="small">Signing as <strong>{signer.name}</strong> (issued by {signer.issuer}, valid until {signer.notAfter.toLocaleDateString()})</p>}
          {error && <p className="error small">{error}</p>}
          <div className="form-row"><span>Reason</span><input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Approved" /></div>
          <div className="form-row"><span>Location</span><input aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
          <div className="form-row"><span>Timestamp server</span><input aria-label="Timestamp server" value={tsa} onChange={(e) => setTsa(e.target.value)} placeholder="https://… (optional, RFC 3161)" /></div>
          <div className="form-row"><span>Certify</span>
            <select aria-label="Certification" value={certify} onChange={(e) => setCertify(Number(e.target.value) as 0)}>
              <option value={0}>Not certified (ordinary signature)</option>
              <option value={1}>Certified: no changes allowed</option>
              <option value={2}>Certified: form filling and signing allowed</option>
              <option value={3}>Certified: form filling, signing and markups allowed</option>
            </select>
          </div>
          <FilesRow all={all} setAll={setAll} />
          {all && <p className="muted small">Sign &amp; Seal: every open document gets an invisible signature (place a seal stamp first with Batch &gt; Apply Stamp).</p>}
          <div className="form-row"><span>Appearance</span>
            <select aria-label="Signature placement" value={where} onChange={(e) => setWhere(e.target.value)}>
              {empty.map((f) => <option key={f.name} value={`field:${f.name}`}>In field "{f.name}"</option>)}
              <option value="box">Draw a box on the page</option>
              <option value="invisible">Invisible</option>
            </select>
          </div>
          <p className="muted small">Your certificate file stays on this device: it is read in the browser and never uploaded. The signature is added as an update to the file, so earlier signatures stay valid.</p>
          <div className="modal-actions">
            <span className="spacer" />
            <button className="primary" disabled={!signer} onClick={sign}>Sign</button>
            <button onClick={close}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Signatures panel (Revu Alt+4): each signature with its validation status. */
export function SignaturesPanel({ doc }: { doc: DocState }) {
  const tick = useDigitalSign((x) => x.tick);
  const [list, setList] = useState<SignatureInfo[] | null>(null);
  const trust = useTrust((x) => x.certs);
  const [manage, setManage] = useState(false);
  useEffect(() => {
    let alive = true;
    setList(null);
    verifySignatures(doc.bytes, trustBytes()).then((l) => alive && setList(l)).catch(() => alive && setList([]));
    return () => { alive = false; };
  }, [doc.bytes, tick, trust]);
  return (
    <div className="signatures-panel">
      {!list && <p className="muted small">Checking signatures…</p>}
      {list && !list.length && <p className="muted small">This document has no digital signatures.</p>}
      {list?.map((v, i) => (
        <div key={i} className={`sig-item sig-${v.status}`} aria-label={`Signature ${v.field}`}>
          <div className="sig-title">
            <span className="sig-badge">{v.status === 'valid' ? '✔' : v.status === 'invalid' ? '✖' : '?'}</span>
            <strong>{v.signer}</strong>
          </div>
          <div className="small">{v.status === 'valid' ? 'Signature is valid' : v.status === 'invalid' ? 'Signature is INVALID' : 'Signature could not be checked'}</div>
          <div className="muted small">{v.detail}</div>
          <div className="small">{v.trusted ? `✔ Identity trusted (${v.trustedBy})` : 'Identity not trusted'}</div>
          {v.time && <div className="small">Signed: {v.time.toLocaleString()}</div>}
          {v.timestamp && <div className="small">{v.timestamp.ok ? 'Timestamp' : 'Timestamp (does NOT match)'}: {v.timestamp.time.toLocaleString()} by {v.timestamp.tsa}</div>}
          {v.reason && <div className="small">Reason: {v.reason}</div>}
          {v.location && <div className="small">Location: {v.location}</div>}
          <div className="muted small">Field: {v.field}. Certificate issued by {v.issuer}{v.certInDate ? '' : ' (not valid at signing time)'}.</div>
        </div>
      ))}
      <div className="prop-actions"><button onClick={() => openSignDialog()}>Sign Document…</button><button onClick={() => setManage(!manage)}>Trusted Certificates…</button></div>
      {manage && <TrustList signers={list ?? []} />}
    </div>
  );
}

/** Trusted Certificates: import .cer/.crt/.pem files (CA or person), remove. */
function TrustList({ signers }: { signers: SignatureInfo[] }) {
  const certs = useTrust((x) => x.certs);
  const [error, setError] = useState('');
  const add = async () => {
    setError('');
    const f = await pickFile('.cer,.crt,.pem,.der,application/x-x509-ca-cert,application/pkix-cert');
    if (!f) return;
    try {
      const got = await readCertificates(new Uint8Array(await f.arrayBuffer()));
      const toBytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
      const fresh = got.filter((c) => !certs.some((x) => x.der === btoa(c.der))).map((c) => toTrusted(c.subjectName, toBytes(c.der)));
      saveTrust([...certs, ...fresh]);
    } catch { setError('That file is not a certificate (.cer, .crt or .pem).'); }
  };
  return (
    <div className="trust-list" aria-label="Trusted Certificates">
      <div className="links-head">Trusted Certificates</div>
      {certs.length ? certs.map((c, i) => (
        <div key={i} className="space-row"><span style={{ flex: 1 }}>{c.name}</span><button onClick={() => saveTrust(certs.filter((_, k) => k !== i))}>Remove</button></div>
      )) : <p className="muted small">None. Add your company's or the signer's certificate (CA certificates trust everything they issued).</p>}
      {error && <p className="error small">{error}</p>}
      <div className="prop-actions"><button onClick={add}>Add Certificate…</button></div>
      {signers.some((v) => !v.trusted && v.status === 'valid') && <p className="muted small">Ask the signer for their certificate (.cer) or their organisation's CA certificate.</p>}
    </div>
  );
}

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import { signPdf, verifySignatures } from '../src/pdf/sign';

const bin = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));

function makeCert(cn: string, keys: forge.pki.rsa.KeyPair, issuer?: { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey }, ca = false) {
  const c = forge.pki.createCertificate();
  c.publicKey = keys.publicKey;
  c.serialNumber = String(Math.floor(Math.random() * 1e9) + 1);
  c.validity.notBefore = new Date(Date.now() - 86400e3);
  c.validity.notAfter = new Date(Date.now() + 365 * 86400e3);
  c.setSubject([{ name: 'commonName', value: cn }]);
  c.setIssuer(issuer ? issuer.cert.subject.attributes : [{ name: 'commonName', value: cn }]);
  if (ca) c.setExtensions([{ name: 'basicConstraints', cA: true }]);
  c.sign(issuer?.key ?? keys.privateKey, forge.md.sha256.create());
  return c;
}
const der = (c: forge.pki.Certificate) => bytes(forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes());

async function blank() {
  const d = await PDFDocument.create();
  d.addPage([612, 792]);
  return d.save();
}

describe('signature trust list', () => {
  const caKeys = forge.pki.rsa.generateKeyPair(1024), leafKeys = forge.pki.rsa.generateKeyPair(1024), otherKeys = forge.pki.rsa.generateKeyPair(1024);
  const ca = makeCert('Test Root CA', caKeys, undefined, true);
  const leaf = makeCert('Site Engineer', leafKeys, { cert: ca, key: caKeys.privateKey });
  const p12 = bytes(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(leafKeys.privateKey, [leaf, ca], 'pw', { algorithm: '3des' })).getBytes());
  const fakeCa = makeCert('Test Root CA', otherKeys, undefined, true); // same name, different key

  it('is untrusted without a trust list, and trusted through its issuing CA', async () => {
    const signed = await signPdf(await blank(), { p12, password: 'pw' });
    const [none] = await verifySignatures(signed);
    expect(none.status).toBe('valid');
    expect(none.trusted).toBe(false);
    const [viaCa] = await verifySignatures(signed, [der(ca)]);
    expect(viaCa.trusted).toBe(true);
    expect(viaCa.trustedBy).toBe('Test Root CA');
    const pem = new TextEncoder().encode(forge.pki.certificateToPem(leaf));
    expect((await verifySignatures(signed, [pem]))[0].trusted).toBe(true);
  });
  it('does not trust a look-alike CA with another key', async () => {
    const signed = await signPdf(await blank(), { p12, password: 'pw' });
    expect((await verifySignatures(signed, [der(fakeCa)]))[0].trusted).toBe(false);
  });
});

describe('RFC 3161 timestamps', () => {
  // A TSA in the test: signs a TSTInfo over the request's imprint with the test certificate.
  const tsaP12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(bin(new Uint8Array(readFileSync('tests/fixtures/test-cert.p12')))), 'test');
  const key = tsaP12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]![0].key!;
  const cert = tsaP12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]![0].cert!;
  const genTime = new Date(Date.UTC(2026, 9, 14, 12, 0, 0));
  const tsa = async (req: Uint8Array, tamper = false) => {
    const a = forge.asn1, U = a.Class.UNIVERSAL, T = a.Type;
    const imprint = (a.fromDer(bin(req)).value as forge.asn1.Asn1[])[1];
    if (tamper) ((imprint.value as forge.asn1.Asn1[])[1]).value = 'x'.repeat(32);
    const tst = a.create(U, T.SEQUENCE, true, [
      a.create(U, T.INTEGER, false, '\x01'), a.create(U, T.OID, false, a.oidToDer('1.2.3.4').getBytes()), imprint,
      a.create(U, T.INTEGER, false, '\x2a'), a.create(U, T.GENERALIZEDTIME, false, a.dateToGeneralizedTime(genTime)),
    ]);
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(a.toDer(tst).getBytes());
    p7.addCertificate(cert);
    p7.addSigner({ key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256, authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data }, { type: forge.pki.oids.messageDigest },
    ] });
    p7.sign();
    const resp = a.create(U, T.SEQUENCE, true, [a.create(U, T.SEQUENCE, true, [a.create(U, T.INTEGER, false, '\x00')]), p7.toAsn1()]);
    return bytes(a.toDer(resp).getBytes());
  };
  const p12 = new Uint8Array(readFileSync('tests/fixtures/test-cert.p12'));

  it('adds a timestamp token and reads its time and authority back', async () => {
    const signed = await signPdf(await blank(), { p12, password: 'test', fetchTimestamp: (r) => tsa(r) });
    const [v] = await verifySignatures(signed);
    expect(v.status).toBe('valid');
    expect(v.timestamp).toEqual({ time: genTime, tsa: 'Test Signer', ok: true });
  });
  it('flags a token for other data', async () => {
    const signed = await signPdf(await blank(), { p12, password: 'test', fetchTimestamp: (r) => tsa(r, true) });
    expect((await verifySignatures(signed))[0].timestamp?.ok).toBe(false);
  });
  it('fails clearly when the server refuses', async () => {
    const refuse = async () => bytes(forge.asn1.toDer(forge.asn1.create(0, 16, true, [forge.asn1.create(0, 16, true, [forge.asn1.create(0, 2, false, '\x02')])])).getBytes());
    await expect(signPdf(await blank(), { p12, password: 'test', fetchTimestamp: refuse })).rejects.toThrow(/refused/);
  });
});

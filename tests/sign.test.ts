import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, rgb } from 'pdf-lib';
import { certificateInfo, signPdf, verifySignatures } from '../src/pdf/sign';
import { hasSignatures, incrementalUpdate, loadForUpdate } from '../src/pdf/incremental';
import { createField } from '../src/pdf/forms';

const p12 = new Uint8Array(readFileSync('tests/fixtures/test-cert.p12'));

async function sample(objectStreams = false) {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawRectangle({ x: 50, y: 50, width: 100, height: 100, color: rgb(1, 0, 0) });
  doc.addPage([612, 792]);
  return doc.save({ useObjectStreams: objectStreams });
}

describe('incremental update', () => {
  it('appends only changed objects and keeps the original bytes', async () => {
    for (const streams of [false, true]) {
      const orig = await sample(streams);
      const doc = await loadForUpdate(orig);
      expect(await incrementalUpdate(orig, doc)).toBe(orig); // nothing changed
      doc.getPage(1).drawText('Hello');
      const out = await incrementalUpdate(orig, doc);
      expect(out.subarray(0, orig.length)).toEqual(orig);
      expect(out.length - orig.length).toBeLessThan(4000);
      const again = await PDFDocument.load(out);
      expect(again.getPageCount()).toBe(2);
      const ops = new TextDecoder('latin1').decode(out.subarray(orig.length));
      expect(ops).toContain(streams ? '/Type /XRef' : 'xref');
    }
  });
});

describe('digital signatures', () => {
  it('reads the certificate and rejects a wrong password', async () => {
    expect((await certificateInfo(p12, 'test')).name).toBe('Test Signer');
    await expect(certificateInfo(p12, 'nope')).rejects.toThrow(/password/i);
  });

  it('signs, verifies, detects tampering, and survives a second signature', async () => {
    const orig = await sample();
    const date = new Date('2026-10-13T12:00:00Z');
    const signed = await signPdf(orig, { p12, password: 'test', reason: 'Approved', page: 0, rect: [300, 50, 500, 110], date });
    expect(signed.subarray(0, orig.length)).toEqual(orig);
    let v = await verifySignatures(signed);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ field: 'Signature1', signer: 'Test Signer', status: 'valid', coversDocument: true, reason: 'Approved', selfSigned: true, certInDate: true });
    expect(v[0].time?.toISOString()).toBe(date.toISOString());
    expect(hasSignatures(await PDFDocument.load(signed))).toBe(true);

    // Change one byte inside the signed range.
    const bad = signed.slice();
    const at = new TextDecoder('latin1').decode(bad).indexOf('/MediaBox');
    bad[at + 1] = 'X'.charCodeAt(0);
    expect((await verifySignatures(bad))[0].status).toBe('invalid');

    // A later edit saved incrementally keeps the first signature valid (as an earlier revision).
    const doc = await loadForUpdate(signed);
    createField(doc, { type: 'signature', name: 'Approver', page: 1, rect: [100, 100, 300, 150] });
    const edited = await incrementalUpdate(signed, doc);
    v = await verifySignatures(edited);
    expect(v[0]).toMatchObject({ status: 'valid', coversDocument: false });

    // Sign the empty field: both signatures check out.
    const twice = await signPdf(edited, { p12, password: 'test', field: 'Approver' });
    v = await verifySignatures(twice);
    expect(v.map((x) => [x.field, x.status, x.coversDocument])).toEqual([['Signature1', 'valid', false], ['Approver', 'valid', true]]);
    // Adding fields and signatures never rewrites the page content (validators treat that as tampering).
    const contents = async (b: Uint8Array) => String((await PDFDocument.load(b)).getPages().map((p) => p.node.get(PDFName.of('Contents'))));
    expect(await contents(twice)).toBe(await contents(orig));
  });

  it('reports no signatures on an unsigned file', async () => {
    expect(await verifySignatures(await sample())).toEqual([]);
  });
});

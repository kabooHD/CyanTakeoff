import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, StandardFonts } from 'pdf-lib';
import { PasswordRequired, encryptPdf, openEncrypted, PERM } from '../src/pdf/crypt';

const fixture = (n: string) => new Uint8Array(readFileSync(`tests/fixtures/encrypted/${n}.pdf`));
const annotText = (doc: PDFDocument) => {
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
  const a = doc.context.lookup(annots.get(annots.size() - 1)) as PDFDict;
  return (a.lookup(PDFName.of('Contents')) as PDFString).decodeText();
};

describe('password-protected PDFs (made by pypdf)', () => {
  for (const name of ['rc4-40', 'rc4-128', 'aes-128', 'aes-256']) {
    it(`${name}: opens with the user or owner password, not without`, async () => {
      await expect(openEncrypted(fixture(name), '')).rejects.toBeInstanceOf(PasswordRequired);
      await expect(openEncrypted(fixture(name), 'nope')).rejects.toMatchObject({ retry: true });
      const user = await openEncrypted(fixture(name), 'user');
      expect(user.security.owner).toBe(false);
      expect(annotText(user.doc)).toBe('Secret note é');
      expect(user.doc.getPageCount()).toBe(2);
      const owner = await openEncrypted(fixture(name), 'owner');
      expect(owner.security.owner).toBe(true);
      // Page content decrypts to real operators.
      const page = await PDFDocument.load(await owner.doc.save());
      expect(page.getPageCount()).toBe(2);
    });
  }

  it('re-encrypts with the same passwords on save', async () => {
    const { doc, security } = await openEncrypted(fixture('aes-128'), 'user');
    const again = await encryptPdf(await doc.save({ useObjectStreams: false }), security);
    const r = await openEncrypted(again, 'user');
    expect(annotText(r.doc)).toBe('Secret note é');
    expect((await openEncrypted(again, 'owner')).security.owner).toBe(true);
  });

  it('new AES-256 security opens in pdf.js with the password only', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([300, 200]).drawText('Confidential plan', { x: 20, y: 100, font, size: 12 });
    const out = await encryptPdf(await doc.save(), { userPassword: 'open me', ownerPassword: 'boss', permissions: PERM.print });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    await expect(pdfjs.getDocument({ data: out.slice() }).promise).rejects.toMatchObject({ name: 'PasswordException' });
    const pdf = await pdfjs.getDocument({ data: out.slice(), password: 'open me' }).promise;
    const text = await (await pdf.getPage(1)).getTextContent();
    expect(text.items.map((i) => ('str' in i ? i.str : '')).join('')).toContain('Confidential plan');
    const mine = await openEncrypted(out, 'open me');
    expect(mine.security.owner).toBe(false);
    expect(mine.security.info.P & PERM.annotate).toBe(0);
    expect((await openEncrypted(out, 'boss')).security.owner).toBe(true);
  });
});

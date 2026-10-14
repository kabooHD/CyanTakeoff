// Archive as PDF/A (Revu Document > Archive as PDF/A, PDF/A-1b): the file
// gets the PDF/A identification in XMP metadata, a document title, and an
// sRGB output intent (a small ICC profile built here). What we cannot fix
// (fonts that are not embedded, transparency) is reported so the user
// knows the file may not pass a strict validator.
import { PDFDict, PDFDocument, PDFName, PDFStream } from 'pdf-lib';

const N = PDFName.of;

const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const s15f16 = (v: number) => be32(Math.round(v * 65536) | 0);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const pad4 = (a: number[]) => { while (a.length % 4) a.push(0); return a; };

/** A minimal ICC v2 display profile with sRGB primaries (D50-adapted) and a gamma 2.2 curve. */
export function srgbIccProfile(): Uint8Array {
  const xyz = (x: number, y: number, z: number) => [...ascii('XYZ '), 0, 0, 0, 0, ...s15f16(x), ...s15f16(y), ...s15f16(z)];
  const curv = [...ascii('curv'), 0, 0, 0, 0, ...be32(1), 0x02, 0x33]; // u8Fixed8 2.2
  const descText = 'CyanTakeoff sRGB';
  const desc = [...ascii('desc'), 0, 0, 0, 0, ...be32(descText.length + 1), ...ascii(descText), 0, ...new Array(4 + 4 + 2 + 1 + 67).fill(0)];
  const cprt = [...ascii('text'), 0, 0, 0, 0, ...ascii('Public domain'), 0];
  const tags: [string, number[]][] = [
    ['desc', pad4(desc)], ['cprt', pad4(cprt)], ['wtpt', xyz(0.9642, 1.0, 0.8249)],
    ['rXYZ', xyz(0.43607, 0.22249, 0.01392)], ['gXYZ', xyz(0.38515, 0.71687, 0.09708)], ['bXYZ', xyz(0.14307, 0.06061, 0.71410)],
    ['rTRC', pad4([...curv])], ['gTRC', pad4([...curv])], ['bTRC', pad4([...curv])],
  ];
  const headerSize = 128, tableSize = 4 + tags.length * 12;
  let offset = headerSize + tableSize;
  const table: number[] = [...be32(tags.length)];
  const body: number[] = [];
  for (const [sig, data] of tags) { table.push(...ascii(sig), ...be32(offset), ...be32(data.length)); body.push(...data); offset += data.length; }
  const size = headerSize + tableSize + body.length;
  const header = [
    ...be32(size), ...ascii('none'), ...be32(0x02100000), ...ascii('mntr'), ...ascii('RGB '), ...ascii('XYZ '),
    ...[2026, 1, 1, 0, 0, 0].flatMap((v) => [(v >> 8) & 255, v & 255]), ...ascii('acsp'), ...ascii('APPL'), ...be32(0),
    ...be32(0), ...be32(0), ...be32(0), ...be32(0), ...be32(0), ...s15f16(0.9642), ...s15f16(1.0), ...s15f16(0.8249), ...ascii('none'),
  ];
  while (header.length < 128) header.push(0);
  return Uint8Array.from([...header, ...table, ...body]);
}

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));

/** XMP packet with the PDF/A-1b identification. */
export function pdfaXmp(title: string, producer: string, date: Date): string {
  const iso = date.toISOString();
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>1</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(title)}</rdf:li></rdf:Alt></dc:title></rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreateDate>${iso}</xmp:CreateDate><xmp:ModifyDate>${iso}</xmp:ModifyDate><xmp:CreatorTool>${esc(producer)}</xmp:CreatorTool></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>${esc(producer)}</pdf:Producer></rdf:Description>
</rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
}

export interface PdfaReport { fontsNotEmbedded: string[]; transparency: number; javascript: boolean }

/** Mark the document PDF/A-1b and report what may still fail a validator. */
export function archivePdfA(doc: PDFDocument, title: string, producer = 'CyanTakeoff'): PdfaReport {
  const ctx = doc.context;
  const xmp = ctx.stream(pdfaXmp(title, producer, new Date()), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(N('Metadata'), ctx.register(xmp));
  const icc = ctx.flateStream(srgbIccProfile(), { N: 3 });
  const intent = ctx.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: 'sRGB IEC61966-2.1', Info: 'sRGB IEC61966-2.1', DestOutputProfile: ctx.register(icc) });
  doc.catalog.set(N('OutputIntents'), ctx.obj([intent]));
  doc.setTitle(title);
  doc.setProducer(producer);
  // Report: fonts without a font file, transparency (soft masks, blend modes, constant alpha), JavaScript.
  const fonts = new Set<string>();
  let transparency = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    void ref;
    const d = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (!d) continue;
    const type = String(d.get(N('Type')));
    if (type === '/Font') {
      const desc = d.lookup(N('FontDescriptor'));
      const sub = String(d.get(N('Subtype')));
      if (sub === '/Type0') continue; // its descendant font is checked on its own
      const embedded = desc instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => desc.has(N(k)));
      if (!embedded) { const base = d.get(N('BaseFont')); fonts.add(base instanceof PDFName ? base.decodeText() : '?'); }
    }
    if (type === '/ExtGState') {
      const ca = d.get(N('ca')), CA = d.get(N('CA')), bm = d.get(N('BM')), sm = d.get(N('SMask'));
      const alpha = (v: unknown) => typeof (v as { asNumber?: () => number })?.asNumber === 'function' && (v as { asNumber: () => number }).asNumber() < 1;
      if (alpha(ca) || alpha(CA) || (bm instanceof PDFName && bm.decodeText() !== 'Normal' && bm.decodeText() !== 'Compatible') || (sm !== undefined && !(sm instanceof PDFName))) transparency++;
    }
    if (type === '/Group' || (d.has(N('Group')) && obj instanceof PDFStream)) transparency++;
  }
  const names = doc.catalog.lookup(N('Names'));
  const javascript = names instanceof PDFDict && names.has(N('JavaScript'));
  return { fontsNotEmbedded: [...fonts].sort(), transparency, javascript };
}

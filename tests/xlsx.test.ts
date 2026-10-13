import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildXlsx } from '../src/model/xlsx';

describe('xlsx summary', () => {
  it('writes a workbook with typed cells', () => {
    const z = unzipSync(buildXlsx('Markups', ['Subject', 'Area'], [['Area Measurement', 432.5], ['A & B <c>', '']], ['Total', 432.5]));
    expect(Object.keys(z).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
    const sheet = strFromU8(z['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('<c r="B2"><v>432.5</v></c>');
    expect(sheet).toContain('A &amp; B &lt;c&gt;');
    expect(sheet).toContain('<c r="A4" s="1" t="inlineStr">');
  });
});

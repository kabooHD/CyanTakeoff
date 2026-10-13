import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildXlsx } from '../src/model/xlsx';
import { parseCellRef, setCellXml, setCells, sheetsOf } from '../src/model/xlsxEdit';

describe('Quantity Link: writing into a workbook', () => {
  it('parses cell references', () => {
    expect(parseCellRef('B3')).toEqual({ cell: 'B3' });
    expect(parseCellRef("'Take off'!$c$12")).toEqual({ sheet: 'Take off', cell: 'C12' });
    expect(parseCellRef('Estimate!AA7')).toEqual({ sheet: 'Estimate', cell: 'AA7' });
    expect(parseCellRef('nonsense')).toBeNull();
  });

  it('replaces, inserts cells and rows in order, keeping the style', () => {
    const xml = '<worksheet><sheetData><row r="1"><c r="A1" s="2" t="s"><v>0</v></c><c r="C1"><v>5</v></c></row><row r="4"><c r="A4"><f>B2*2</f></c></row></sheetData></worksheet>';
    let x = setCellXml(xml, 'A1', 12.5);
    expect(x).toContain('<c r="A1" s="2"><v>12.5</v></c>');
    x = setCellXml(x, 'B1', 3);
    expect(x).toMatch(/<c r="A1"[^>]*>.*<\/c><c r="B1"><v>3<\/v><\/c><c r="C1">/);
    x = setCellXml(x, 'B2', 7);
    expect(x).toMatch(/<\/row><row r="2"><c r="B2"><v>7<\/v><\/c><\/row><row r="4">/);
    expect(x).toContain('<f>B2*2</f>');
  });

  it('writes into a real workbook by sheet name and asks Excel to recalculate', () => {
    const wb = buildXlsx('Takeoff', ['Item', 'Qty'], [['Doors', 0], ['Walls', 0]]);
    const out = setCells(wb, [{ sheet: 'Takeoff', cell: 'B2', value: 14 }, { cell: 'B3', value: 120.5 }, { cell: 'D9', value: 1 }]);
    const files = unzipSync(out);
    const [sh] = sheetsOf(files);
    const xml = strFromU8(files[sh.path]);
    expect(xml).toContain('<c r="B2"><v>14</v></c>');
    expect(xml).toContain('<c r="B3"><v>120.5</v></c>');
    expect(xml).toContain('<row r="9"><c r="D9"><v>1</v></c></row>');
    expect(strFromU8(files['xl/workbook.xml'])).toContain('fullCalcOnLoad="1"');
  });
});

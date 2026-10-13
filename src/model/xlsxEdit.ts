// Write numbers into cells of an existing .xlsx, keeping everything else
// (formatting, formulas elsewhere, other sheets) as it was. Used by
// Quantity Link to push measurement totals into an estimate workbook.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export interface CellWrite { sheet?: string; cell: string; value: number }

/** "Sheet 1!B3" / "'My sheet'!B3" / "B3" → sheet name (or undefined) and cell. */
export function parseCellRef(ref: string): { sheet?: string; cell: string } | null {
  const m = ref.trim().match(/^(?:(?:'((?:[^']|'')+)'|([^!]+))!)?\$?([A-Za-z]{1,3})\$?(\d{1,7})$/);
  if (!m) return null;
  const sheet = m[1]?.replace(/''/g, "'") ?? m[2]?.trim();
  return { sheet: sheet || undefined, cell: `${m[3].toUpperCase()}${m[4]}` };
}

const colNum = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const split = (cell: string) => { const m = cell.match(/^([A-Z]+)(\d+)$/)!; return { col: colNum(m[1]), row: Number(m[2]) }; };
const attr = (xml: string, name: string) => xml.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Sheet names and their part paths, in workbook order. */
export function sheetsOf(files: Record<string, Uint8Array>): { name: string; path: string }[] {
  const wb = strFromU8(files['xl/workbook.xml']);
  const rels = strFromU8(files['xl/_rels/workbook.xml.rels'] ?? new Uint8Array());
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((r) => [attr(r[0], 'Id'), attr(r[0], 'Target')]));
  return [...wb.matchAll(/<sheet\b[^>]*\/?>/g)].map((s) => {
    const t = target.get(attr(s[0], 'r:id')) ?? '';
    const path = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
    return { name: unesc(attr(s[0], 'name') ?? ''), path };
  });
}

/** Put a number into one cell of a worksheet's XML. */
export function setCellXml(xml: string, cell: string, value: number): string {
  const { col, row } = split(cell);
  const v = `<v>${Number.isFinite(value) ? value : 0}</v>`;
  const rowRe = new RegExp(`<row\\b[^>]*\\br="${row}"[^>]*?(?:/>|>([\\s\\S]*?)</row>)`);
  const rm = xml.match(rowRe);
  if (rm) {
    const open = rm[0].match(/^<row\b[^>]*?(?=\/?>)/)![0];
    const body = rm[1] ?? '';
    const cellRe = new RegExp(`<c\\b[^>]*\\br="${cell}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
    const cm = body.match(cellRe);
    let nb: string;
    if (cm) {
      const s = attr(cm[0], 's');
      nb = body.replace(cellRe, `<c r="${cell}"${s ? ` s="${s}"` : ''}>${v}</c>`);
    } else {
      // Insert in column order.
      const cells = [...body.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)];
      const after = cells.find((c) => colNum(c[1]) > col);
      const nc = `<c r="${cell}">${v}</c>`;
      nb = after ? body.slice(0, after.index) + nc + body.slice(after.index) : body + nc;
    }
    return xml.replace(rowRe, `${open}>${nb}</row>`);
  }
  // New row, in row order.
  const nr = `<row r="${row}"><c r="${cell}">${v}</c></row>`;
  const rows = [...xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)];
  const after = rows.find((r) => Number(r[1]) > row);
  if (after) return xml.slice(0, after.index) + nr + xml.slice(after.index);
  if (/<sheetData\s*\/>/.test(xml)) return xml.replace(/<sheetData\s*\/>/, `<sheetData>${nr}</sheetData>`);
  return xml.replace('</sheetData>', `${nr}</sheetData>`);
}

/** Write the numbers into the workbook; Excel recalculates formulas when it opens it. */
export function setCells(xlsx: Uint8Array, writes: CellWrite[]): Uint8Array {
  const files = unzipSync(xlsx);
  const sheets = sheetsOf(files);
  if (!sheets.length) throw new Error('No worksheets in this workbook');
  for (const w of writes) {
    const sh = w.sheet ? sheets.find((s) => s.name.toLowerCase() === w.sheet!.toLowerCase()) : sheets[0];
    if (!sh || !files[sh.path]) throw new Error(`No sheet named "${w.sheet}"`);
    files[sh.path] = strToU8(setCellXml(strFromU8(files[sh.path]), w.cell, w.value));
  }
  // Ask Excel to recalculate on open (formulas that use these cells).
  let wb = strFromU8(files['xl/workbook.xml']);
  if (/<calcPr\b/.test(wb)) wb = wb.replace(/<calcPr\b([^>]*?)\/?>/, (_m, a: string) => `<calcPr${a.replace(/\sfullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`);
  else wb = wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
  files['xl/workbook.xml'] = strToU8(wb);
  return zipSync(files);
}

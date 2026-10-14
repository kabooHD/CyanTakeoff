// Tags on the sheets of a Set (Revu): named values per sheet (Sheet
// Number, Sheet Name, Discipline, Revision...), used to organise the Set
// and to build a drawing log. Discipline and Sheet Type can be derived
// from the Sheet Number (the US National CAD Standard numbering:
// discipline letters, then the sheet type digit).

export type TagType = 'text' | 'number' | 'date';
export interface TagDef { name: string; type: TagType }

/** Revu's standard tags; the first four are on by default. */
export const STANDARD_TAGS: TagDef[] = [
  { name: 'Sheet Number', type: 'text' }, { name: 'Sheet Name', type: 'text' }, { name: 'Discipline', type: 'text' }, { name: 'Revision', type: 'text' },
  { name: 'Drawing Number', type: 'text' }, { name: 'Revision Number', type: 'number' }, { name: 'Sheet Type', type: 'text' },
];
export const DEFAULT_TAGS: TagDef[] = STANDARD_TAGS.slice(0, 4);

export type TagValues = Record<string, Record<string, string>>; // sheet key -> tag name -> value

export const sheetKey = (docName: string, page: number) => `${docName}#${page}`;

const DISCIPLINES: Record<string, string> = {
  G: 'General', H: 'Hazardous Materials', V: 'Survey / Mapping', B: 'Geotechnical', W: 'Civil Works', C: 'Civil', L: 'Landscape',
  S: 'Structural', A: 'Architectural', I: 'Interiors', Q: 'Equipment', F: 'Fire Protection', P: 'Plumbing', D: 'Process',
  M: 'Mechanical', E: 'Electrical', T: 'Telecommunications', R: 'Resource', X: 'Other Disciplines', Z: 'Contractor / Shop Drawings', O: 'Operations',
};
const SHEET_TYPES = ['General', 'Plans', 'Elevations', 'Sections', 'Large-Scale Views', 'Details', 'Schedules and Diagrams', 'User Defined', 'User Defined', '3D Representations'];

/** The letters and the first digit of a sheet number ("A-101" -> ["A", "1"]). */
export function splitSheetNumber(n: string): { letters: string; digit: string } | null {
  const m = /^\s*([A-Za-z]{1,3})[-. ]?(\d)/.exec(n);
  return m ? { letters: m[1].toUpperCase(), digit: m[2] } : null;
}

/** Discipline from the sheet number's letters (the first letter decides; "FP" is Fire Protection). */
export function disciplineOf(sheetNumber: string): string {
  const s = splitSheetNumber(sheetNumber);
  if (!s) return '';
  if (s.letters.startsWith('FP')) return 'Fire Protection';
  return DISCIPLINES[s.letters[0]] ?? '';
}

/** Sheet type from the first digit of the number ("A-101" -> Plans). */
export function sheetTypeOf(sheetNumber: string): string {
  const s = splitSheetNumber(sheetNumber);
  return s ? SHEET_TYPES[Number(s.digit)] ?? '' : '';
}

/** Fill the derived tags (Discipline, Sheet Type) of a sheet from its Sheet Number, when they are empty. */
export function autoTags(values: Record<string, string>, tags: TagDef[]): Record<string, string> {
  const n = values['Sheet Number'];
  if (!n) return values;
  const out = { ...values };
  if (tags.some((t) => t.name === 'Discipline') && !out.Discipline) out.Discipline = disciplineOf(n);
  if (tags.some((t) => t.name === 'Sheet Type') && !out['Sheet Type']) out['Sheet Type'] = sheetTypeOf(n);
  return out;
}

/** Sort key for sheet numbers: letters, then the numbers as numbers ("A-2" before "A-10"). */
export function compareSheetNumbers(a: string, b: string): number {
  const parts = (s: string) => s.toUpperCase().split(/(\d+)/).filter(Boolean);
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '', y = pb[i] ?? '';
    if (x === y) continue;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) - Number(y);
    return x < y ? -1 : 1;
  }
  return 0;
}

export interface LogSheet { docName: string; page: number; label: string; values: Record<string, string> }

/** The drawing log's built-in data elements, besides the tags. */
export const LOG_BUILTINS = ['File Name', 'Page Label', 'Page Index'];

/** A cell of the drawing log. */
export function logCell(sheet: LogSheet, element: string): string {
  switch (element) {
    case 'File Name': return sheet.docName;
    case 'Page Label': return sheet.label;
    case 'Page Index': return String(sheet.page + 1);
    default: return sheet.values[element] ?? '';
  }
}

/** Rows of the drawing log, `elements` in order; sorted by Sheet Number when every sheet has one. */
export function drawingLogRows(sheets: LogSheet[], elements: string[]): string[][] {
  const sorted = sheets.every((s) => s.values['Sheet Number']) ? [...sheets].sort((a, b) => compareSheetNumbers(a.values['Sheet Number'], b.values['Sheet Number'])) : sheets;
  return sorted.map((s) => elements.map((e) => logCell(s, e)));
}

export function drawingLogCsv(elements: string[], rows: string[][]): string {
  const q = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [elements, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
}

/** The log's title with the optional Set name in front and date at the end. */
export function logTitle(title: string, setName: string, prependSet: boolean, appendDate: boolean, date = new Date()): string {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${prependSet && setName ? `${setName} ` : ''}${title}${appendDate ? ` ${d}` : ''}`.trim();
}

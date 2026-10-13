// Generates public/sample-floorplan.pdf: a two-sheet drawing set at known
// scales, used for demos and automated tests.
import { writeFileSync, mkdirSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

const doc = await PDFDocument.create();
doc.setTitle('Sample Floor Plan');
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const W = 36 * 72, H = 24 * 72;
const black = rgb(0, 0, 0);

function titleBlock(page, sheet, title, scale) {
  page.drawRectangle({ x: 36, y: 36, width: W - 72, height: H - 72, borderWidth: 2, borderColor: black });
  const x = W - 36 - 360;
  page.drawRectangle({ x, y: 36, width: 360, height: 160, borderWidth: 1.5, borderColor: black });
  page.drawText('CYANTAKEOFF SAMPLE PROJECT', { x: x + 12, y: 168, size: 14, font: bold });
  page.drawText(title, { x: x + 12, y: 140, size: 18, font: bold });
  page.drawText(`SCALE: ${scale}`, { x: x + 12, y: 112, size: 12, font });
  page.drawText('DATE: 2026-10-12', { x: x + 12, y: 92, size: 10, font });
  page.drawText(sheet, { x: x + 250, y: 60, size: 36, font: bold });
}

function dim(page, x1, y1, x2, y2, text, off = 30) {
  // horizontal or vertical dimension string
  const horiz = y1 === y2;
  const ox = horiz ? 0 : -off, oy = horiz ? off : 0;
  page.drawLine({ start: { x: x1 + ox, y: y1 + oy }, end: { x: x2 + ox, y: y2 + oy }, thickness: 0.5 });
  for (const [x, y] of [[x1, y1], [x2, y2]]) {
    page.drawLine({ start: { x, y }, end: { x: x + ox * 1.2, y: y + oy * 1.2 }, thickness: 0.3 });
    page.drawLine({ start: { x: x + ox - 4, y: y + oy - 4 }, end: { x: x + ox + 4, y: y + oy + 4 }, thickness: 0.8 });
  }
  const w = font.widthOfTextAtSize(text, 9);
  if (horiz) page.drawText(text, { x: (x1 + x2) / 2 - w / 2, y: y1 + oy + 4, size: 9, font });
  else page.drawText(text, { x: x1 + ox - 4, y: (y1 + y2) / 2 - w / 2, size: 9, font, rotate: degrees(90) });
}

// ---- Sheet A-101: floor plan at 1/4" = 1'-0" (18 pt per foot) ----
{
  const page = doc.addPage([W, H]);
  const ft = 18;
  const ox = 300, oy = 400;
  const t = 0.5 * ft; // 6" walls
  const wall = (x, y, w, h) => page.drawRectangle({ x: ox + x * ft, y: oy + y * ft, width: w * ft, height: h * ft, color: rgb(0.25, 0.25, 0.25) });
  // exterior 60' x 40'
  wall(0, 0, 60, 0.5); wall(0, 39.5, 60, 0.5); wall(0, 0, 0.5, 40); wall(59.5, 0, 0.5, 40);
  // interior walls
  wall(24, 0, 0.33, 22); wall(24, 26, 0.33, 14); wall(0, 22, 18, 0.33); wall(42, 0, 0.33, 40); wall(42, 18, 18, 0.33);
  // doors: openings drawn as swing arcs
  const door = (x, y, r, a0) => {
    const cx = ox + x * ft, cy = oy + y * ft, R = r * ft;
    page.drawLine({ start: { x: cx, y: cy }, end: { x: cx + R * Math.cos(a0), y: cy + R * Math.sin(a0) }, thickness: 1 });
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const a = a0 + (Math.PI / 2) * (i / steps), b = a0 + (Math.PI / 2) * ((i + 1) / steps);
      page.drawLine({ start: { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }, end: { x: cx + R * Math.cos(b), y: cy + R * Math.sin(b) }, thickness: 0.4 });
    }
  };
  door(28, 0.5, 3, 0); door(24.33, 22.5, 3, 0); door(18, 22.33, 3, Math.PI / 2); door(42.33, 10, 3, 0); door(45, 18.33, 3, Math.PI / 2);
  // windows
  for (const x of [6, 14, 34, 50]) page.drawRectangle({ x: ox + x * ft, y: oy + 39.5 * ft, width: 4 * ft, height: t, color: rgb(1, 1, 1), borderColor: black, borderWidth: 0.6 });
  // room labels
  const label = (x, y, name, area) => {
    page.drawText(name, { x: ox + x * ft, y: oy + y * ft, size: 12, font: bold });
    page.drawText(area, { x: ox + x * ft, y: oy + y * ft - 14, size: 9, font });
  };
  label(8, 30, 'OFFICE 101', '432 SF'); label(6, 10, 'STORAGE 102', '396 SF'); label(30, 30, 'OPEN WORK 103', '');
  label(48, 30, 'CONFERENCE 104', '371 SF'); label(48, 8, 'BREAK 105', '308 SF');
  dim(page, ox, oy + 40 * ft, ox + 60 * ft, oy + 40 * ft, `60'-0"`);
  dim(page, ox, oy, ox, oy + 40 * ft, `40'-0"`);
  // north arrow
  page.drawLine({ start: { x: 220, y: 1500 }, end: { x: 220, y: 1560 }, thickness: 2 });
  page.drawText('N', { x: 214, y: 1566, size: 16, font: bold });
  page.drawText('SEE C-101 FOR SITE PLAN', { x: 300, y: 1540, size: 10, font });
  titleBlock(page, 'A-101', 'FLOOR PLAN', `1/4" = 1'-0"`);
}

// ---- Sheet C-101: site plan at 1" = 20' (3.6 pt per foot) ----
{
  const page = doc.addPage([W, H]);
  const ft = 72 / 20;
  const ox = 400, oy = 300;
  const r = (x, y, w, h, opts) => page.drawRectangle({ x: ox + x * ft, y: oy + y * ft, width: w * ft, height: h * ft, ...opts });
  r(0, 0, 400, 300, { borderColor: black, borderWidth: 1.5, borderDashArray: [12, 6] }); // property line
  r(120, 100, 60, 40, { color: rgb(0.8, 0.8, 0.8), borderColor: black, borderWidth: 1 }); // building
  r(200, 40, 150, 120, { borderColor: black, borderWidth: 0.8 }); // parking lot
  for (let i = 0; i <= 15; i++) page.drawLine({ start: { x: ox + (200 + i * 10) * ft, y: oy + 40 * ft }, end: { x: ox + (200 + i * 10) * ft, y: oy + 58 * ft }, thickness: 0.5 });
  page.drawText('PARKING (32 STALLS)', { x: ox + 230 * ft, y: oy + 100 * ft, size: 12, font: bold });
  page.drawText('PROPOSED BUILDING', { x: ox + 122 * ft, y: oy + 118 * ft, size: 9, font: bold });
  dim(page, ox, oy + 300 * ft, ox + 400 * ft, oy + 300 * ft, `400'-0"`);
  dim(page, ox, oy, ox, oy + 300 * ft, `300'-0"`);
  page.drawText('BUILDING: SEE A-101 FOR FLOOR PLAN', { x: 300, y: 1540, size: 10, font });
  titleBlock(page, 'C-101', 'SITE PLAN', `1" = 20'`);
}

mkdirSync('public', { recursive: true });
writeFileSync('public/sample-floorplan.pdf', await doc.save());
console.log('wrote public/sample-floorplan.pdf');

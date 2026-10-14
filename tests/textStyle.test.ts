import { describe, expect, it } from 'vitest';
import { alignOfQuadding, fitFontSize, parseDS, parseRC, quadding, shapeOutline, toDS, toRC } from '../src/model/textStyle';
import type { MarkupStyle } from '../src/model/types';

const base: MarkupStyle = { color: '#ff0000', fill: null, opacity: 1, fillOpacity: 1, width: 1, lineStyle: 'solid', fontSize: 12 };

describe('text style', () => {
  it('writes the /DS string the way Revu does and reads it back', () => {
    expect(toDS(base)).toBe('font: Helvetica 12pt; text-align:left; line-height:13.8pt; color:#FF0000');
    const rich: MarkupStyle = { ...base, font: 'Times', bold: true, italic: true, underline: true, strike: true, align: 'center', lineHeight: 1.5, textColor: '#0000ff', fontSize: 10 };
    const ds = toDS(rich);
    expect(ds).toBe('font: Times 10pt; text-align:center; line-height:15pt; color:#0000FF; font-weight:bold; font-style:italic; text-decoration:underline line-through');
    expect(parseDS(ds)).toEqual({ font: 'Times', fontSize: 10, align: 'center', lineHeight: 1.5, textColor: '#0000ff', bold: true, italic: true, underline: true, strike: true });
  });
  it('reads a Revu /DS and other CSS-like strings', () => {
    expect(parseDS('font: Helvetica 12pt; text-align:center; line-height:13.8pt; color:#FF0000')).toEqual({ font: 'Helvetica', fontSize: 12, align: 'center', lineHeight: 1.15, textColor: '#ff0000' });
    expect(parseDS('font-family: "Courier New"; font-size: 9pt; font-weight: bold')).toEqual({ font: 'Courier', fontSize: 9, bold: true });
    expect(parseDS('')).toEqual({});
  });
  it('writes rich text with a paragraph per line and reads the lines back', () => {
    const rc = toRC('Room <A>\n"Second" & third', base);
    expect(rc).toContain('<p>Room &lt;A&gt;</p><p>"Second" &amp; third</p>');
    expect(rc).toContain('style="font: Helvetica 12pt;');
    expect(parseRC(rc)).toBe('Room <A>\n"Second" & third');
    expect(parseRC('<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml"><p>5\'-5"</p></body>')).toBe('5\'-5"');
    expect(parseRC('<body><p>a<br/>b</p></body>')).toBe('a\nb');
  });
  it('maps alignment to /Q and back', () => {
    expect(quadding('right')).toBe(2);
    expect(alignOfQuadding(1)).toBe('center');
    expect(alignOfQuadding(undefined)).toBeUndefined();
  });
  it('fits a font size to the box', () => {
    const width = (t: string, s: number) => t.length * s * 0.5;
    // 10 chars at size s take 5s; box 100 wide with 3 margins -> 94 -> s = 18.5; height 100 allows 2 lines up to 43
    expect(fitFontSize(['abcdefghij', 'ab'], 100, 100, 1.15, 3, width)).toBe(18.5);
    expect(fitFontSize(['abcdefghij'], 100, 12, 1.15, 3, width)).toBe(5);
    expect(fitFontSize(['x'], 2, 2, 1, 3, width)).toBe(1);
  });
  it('outlines triangle and hexagon boxes', () => {
    const b = { minX: 0, minY: 0, maxX: 40, maxY: 20 };
    expect(shapeOutline('triangle', b)).toEqual([{ x: 20, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }]);
    expect(shapeOutline('hexagon', b)).toHaveLength(6);
    expect(shapeOutline('rectangle', b)).toBeNull();
  });
});

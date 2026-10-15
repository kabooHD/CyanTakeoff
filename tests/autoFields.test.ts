import { describe, expect, it } from 'vitest';
import { detectFields, findBoxes, findCircles, labelFor, nameFromLabel } from '../src/model/autoFields';
import type { TextBox } from '../src/ui/toolActions';

const rect = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0];
const circle = (cx: number, cy: number, r: number, n = 16) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI, b = ((i + 1) / n) * 2 * Math.PI;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b));
  }
  return out;
};
const text = (str: string, x0: number, y0: number, w = str.length * 5, h = 10): TextBox => ({ str, x0, y0, x1: x0 + w, y1: y0 + h });

describe('Automatically Create Form Fields', () => {
  it('finds boxes drawn as four segments and round closed curves', () => {
    const boxes = findBoxes(new Float32Array([...rect(100, 100, 300, 120), ...rect(100, 150, 112, 162), 0, 0, 50, 0]));
    expect(boxes).toEqual([{ x0: 100, y0: 100, x1: 300, y1: 120 }, { x0: 100, y0: 150, x1: 112, y1: 162 }]);
    const circles = findCircles(new Float32Array([...circle(50, 50, 6), ...circle(50, 70, 6), ...circle(200, 200, 60), ...circle(300, 300, 1)]));
    expect(circles).toHaveLength(2);
    expect(circles[0].x0).toBeCloseTo(44, 6);
  });
  it('names fields after the label on their left or above, cleaned up', () => {
    expect(nameFromLabel('Name:')).toBe('Name');
    expect(nameFromLabel('Date of birth *')).toBe('Date of birth');
    const texts = [text('Name:', 60, 102), text('Address', 100, 86)];
    expect(labelFor({ x0: 100, y0: 100, x1: 300, y1: 120 }, texts)?.str).toBe('Name:');
    expect(labelFor({ x0: 100, y0: 100, x1: 300, y1: 120 }, [texts[1]])?.str).toBe('Address');
    expect(labelFor({ x0: 100, y0: 100, x1: 300, y1: 120 }, [text('Far', 10, 102)])).toBeNull();
  });
  it('turns boxes, squares, signature lines and circles into typed, named fields', () => {
    const boxes = [
      { x0: 100, y0: 100, x1: 300, y1: 120 }, { x0: 100, y0: 140, x1: 300, y1: 200 }, { x0: 100, y0: 220, x1: 300, y1: 250 },
      { x0: 100, y0: 300, x1: 112, y1: 312 }, { x0: 50, y0: 50, x1: 400, y1: 500 }, { x0: 100, y0: 400, x1: 200, y1: 420 },
    ];
    const circles = [{ x0: 100, y0: 340, x1: 112, y1: 352 }, { x0: 100, y0: 360, x1: 112, y1: 372 }];
    const texts = [
      text('Name:', 60, 102), text('Notes', 100, 126), text('Signature:', 40, 232), text('I agree', 116, 302),
      text('Colour', 100, 326), text('Red', 116, 342), text('Blue', 116, 362), text('Total', 120, 404),
    ];
    const fields = detectFields(boxes, circles, texts);
    expect(fields.map((f) => [f.type, f.name, f.option ?? f.multiline ?? ''])).toEqual([
      ['text', 'Name', ''], ['text', 'Notes', true], ['signature', 'Signature', ''], ['checkbox', 'I agree', ''],
      ['radio', 'Colour', 'Red'], ['radio', 'Colour', 'Blue'],
    ]);
    // The box already holding a field is skipped; unlabelled fields get generic unique names.
    const again = detectFields([{ x0: 100, y0: 100, x1: 300, y1: 120 }, { x0: 100, y0: 130, x1: 300, y1: 150 }, { x0: 100, y0: 160, x1: 300, y1: 180 }], [], [], [{ x0: 90, y0: 90, x1: 310, y1: 125 }]);
    expect(again.map((f) => f.name)).toEqual(['Text', 'Text 2']);
  });
});

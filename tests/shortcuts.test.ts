// Tool shortcuts must match Revu 20/21's published defaults
// (support.bluebeam.com, "Keyboard shortcuts and mouse navigation").
import { describe, expect, it } from 'vitest';
import { TOOLS } from '../src/tools/tools';

const REVU: Record<string, string> = {
  select: 'V', pan: 'Shift+V', zoom: 'Z',
  textbox: 'T', callout: 'Q', note: 'N', pen: 'P', highlight: 'H', line: 'L', arrow: 'A',
  polyline: 'Shift+N', rectangle: 'R', ellipse: 'E', polygon: 'Shift+P', cloud: 'C',
  length: 'Shift+Alt+L', polylength: 'Shift+Alt+Q', area: 'Shift+Alt+A', perimeter: 'Shift+Alt+P',
  volume: 'Shift+Alt+V', diameter: 'Shift+Alt+D', radius: 'Shift+Alt+U', angle: 'Shift+Alt+G',
  count: 'Shift+Alt+C', 'dynamic-fill': 'J',
  cloudplus: 'K', typewriter: 'W', arc: 'Shift+C', dimension: 'Shift+L', stamp: 'S', flag: 'Shift+F',
  strikeout: 'D', underline: 'U', squiggly: 'Shift+U', image: 'I', snapshot: 'G', link: 'Shift+H',
  attachment: 'F', eraser: 'Shift+E',
};

describe('default shortcuts', () => {
  for (const t of TOOLS) {
    it(`${t.name}`, () => expect(t.shortcut).toBe(REVU[t.id]));
  }
  it('are unique', () => {
    const keys = TOOLS.map((t) => t.shortcut).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

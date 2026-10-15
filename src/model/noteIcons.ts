// Note icons (Revu: Properties > Icon on a Note): the standard PDF text
// annotation icon names (/Name), drawn as simple glyphs in an 18 × 18 box.

export const NOTE_ICONS = ['Comment', 'Key', 'Note', 'Help', 'NewParagraph', 'Paragraph', 'Insert', 'Check', 'Circle', 'Cross', 'Star', 'RightArrow', 'RightPointer', 'UpArrow', 'UpLeftArrow', 'CrossHairs'] as const;
export type NoteIcon = (typeof NOTE_ICONS)[number];

export const NOTE_ICON_LABELS: Record<NoteIcon, string> = {
  Comment: 'Comment', Key: 'Key', Note: 'Note', Help: 'Help', NewParagraph: 'New Paragraph', Paragraph: 'Paragraph', Insert: 'Insert', Check: 'Check',
  Circle: 'Circle', Cross: 'Cross', Star: 'Star', RightArrow: 'Right Arrow', RightPointer: 'Right Pointer', UpArrow: 'Up Arrow', UpLeftArrow: 'Up-Left Arrow', CrossHairs: 'Crosshairs',
};

/** A PDF /Name as one of our icons (unknown names fall back to Comment). */
export const noteIconOf = (name: string | undefined): NoteIcon => (NOTE_ICONS as readonly string[]).includes(name ?? '') ? (name as NoteIcon) : 'Comment';

/**
 * The glyph of an icon in an 18 × 18 box at (0, 0): stroked paths and
 * filled paths (SVG path data), drawn in black over the note's fill.
 */
export function noteGlyph(icon: NoteIcon): { stroke: string[]; fill: string[] } {
  switch (icon) {
    case 'Comment': return { stroke: ['M4 5H14', 'M4 9H14', 'M4 13H14'], fill: [] };
    case 'Key': return { stroke: ['M7 6A3 3 0 1 1 7 12A3 3 0 1 1 7 6Z', 'M9.5 9H15', 'M13 9V12', 'M15 9V11'], fill: [] };
    case 'Note': return { stroke: ['M5 3H11L14 6V15H5Z', 'M11 3V6H14', 'M7 9H12', 'M7 12H12'], fill: [] };
    case 'Help': return { stroke: ['M6 7A3 3 0 1 1 9 10V12'], fill: ['M8.2 13.6H9.8V15.2H8.2Z'] };
    case 'NewParagraph': return { stroke: ['M4 15L9 4L14 15', 'M6 11H12'], fill: [] };
    case 'Paragraph': return { stroke: ['M12 3V15', 'M8 3V15', 'M14 3H7A3.5 3.5 0 0 0 7 10H8'], fill: [] };
    case 'Insert': return { stroke: ['M4 14L9 4L14 14Z'], fill: [] };
    case 'Check': return { stroke: ['M4 9.5L7.5 13L14 5'], fill: [] };
    case 'Circle': return { stroke: ['M9 3A6 6 0 1 1 9 15A6 6 0 1 1 9 3Z'], fill: [] };
    case 'Cross': return { stroke: ['M4 4L14 14', 'M14 4L4 14'], fill: [] };
    case 'Star': return { stroke: [], fill: ['M9 2.5L10.9 7H15.5L11.8 9.8L13.2 14.5L9 11.7L4.8 14.5L6.2 9.8L2.5 7H7.1Z'] };
    case 'RightArrow': return { stroke: ['M3 9H14', 'M10 5L14 9L10 13'], fill: [] };
    case 'RightPointer': return { stroke: [], fill: ['M4 4L15 9L4 14L6.5 9Z'] };
    case 'UpArrow': return { stroke: ['M9 15V4', 'M5 8L9 4L13 8'], fill: [] };
    case 'UpLeftArrow': return { stroke: ['M14 14L5 5', 'M5 11V5H11'], fill: [] };
    case 'CrossHairs': return { stroke: ['M9 2V16', 'M2 9H16', 'M9 5A4 4 0 1 1 9 13A4 4 0 1 1 9 5Z'], fill: [] };
  }
}

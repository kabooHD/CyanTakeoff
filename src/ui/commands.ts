// Keyboard commands and user-assigned shortcuts (Revu > Keyboard Shortcuts).
// Each command is identified by its default combo (app commands) or
// "tool:<id>" (tools); custom shortcuts map a command to another combo.
import { TOOLS } from '../tools/tools';

export interface Command { id: string; label: string; group: string; combo?: string }

const c = (group: string, label: string, combo: string): Command => ({ id: combo, label, group, combo });

/** Commands handled by the global key handler (App.tsx), with their Revu default shortcuts. */
export const APP_COMMANDS: Command[] = [
  c('File', 'Open', 'Ctrl+O'), c('File', 'Save', 'Ctrl+S'), c('File', 'Save As', 'Ctrl+Shift+S'), c('File', 'Close', 'Ctrl+F4'), c('File', 'Print', 'Ctrl+P'), c('File', 'Close All', 'Ctrl+Shift+W'), c('File', 'Save All', 'Ctrl+F2'), c('File', 'New PDF', 'Ctrl+N'), c('File', 'Email', 'Ctrl+E'), c('File', 'Publish as Compressed', 'Ctrl+Shift+P'), c('File', 'Refresh', 'F5'),
  c('Edit', 'Undo', 'Ctrl+Z'), c('Edit', 'Redo', 'Ctrl+Y'), c('Edit', 'Copy', 'Ctrl+C'), c('Edit', 'Cut', 'Ctrl+X'), c('Edit', 'Paste', 'Ctrl+V'),
  c('Edit', 'Paste in Place', 'Ctrl+Shift+V'), c('Edit', 'Select All', 'Ctrl+A'), c('Edit', 'Delete', 'Delete'), c('Edit', 'Format Painter', 'Ctrl+Shift+C'), c('Edit', 'Select All Text', 'Ctrl+Shift+A'), c('Edit', 'Offset', 'O'), c('Edit', 'Copy Page to Snapshot', 'Ctrl+Alt+C'), c('Edit', 'Check Spelling', 'F7'),
  c('Markup', 'Group', 'Ctrl+G'), c('Markup', 'Ungroup', 'Ctrl+Shift+G'), c('Markup', 'Bring Forward', 'Ctrl+J'), c('Markup', 'Bring to Front', 'Ctrl+Shift+J'),
  c('Markup', 'Send Backward', 'Ctrl+['), c('Markup', 'Send to Back', 'Ctrl+Shift+['), c('Markup', 'Lock', 'Ctrl+Shift+L'),
  c('Markup', 'Align Left', 'Ctrl+Alt+L'), c('Markup', 'Align Center', 'Ctrl+Alt+E'), c('Markup', 'Align Right', 'Ctrl+Alt+R'),
  c('Markup', 'Align Top', 'Ctrl+Alt+T'), c('Markup', 'Align Middle', 'Ctrl+Alt+M'), c('Markup', 'Align Bottom', 'Ctrl+Alt+B'),
  c('Markup', 'Flip Horizontal', 'Ctrl+Alt+H'), c('Markup', 'Flip Vertical', 'Ctrl+Alt+V'),
  c('Markup', 'Autosize Text Box', 'Alt+Z'), c('Markup', 'Edit Action', 'Ctrl+Shift+E'), c('Markup', 'Camera', 'Ctrl+Alt+I'), c('Markup', 'Remove Selected from Group', 'Ctrl+Shift+Alt+G'),
  c('View', 'Fit Page', 'Ctrl+9'), c('View', 'Fit Width', 'Ctrl+0'), c('View', 'Actual Size', 'Ctrl+8'), c('View', 'Zoom In', '+'), c('View', 'Zoom Out', '-'),
  c('View', 'Rulers', 'Ctrl+R'), c('View', 'Dimmer', 'Ctrl+F5'), c('View', 'Previous View', 'Alt+ArrowLeft'), c('View', 'Next View', 'Alt+ArrowRight'),
  c('View', 'Show Grid', 'Shift+F9'), c('View', 'Snap to Grid', 'Ctrl+Shift+F9'), c('View', 'Snap to Content', 'Ctrl+Shift+F8'), c('View', 'Snap to Markup', 'Ctrl+Shift+F7'),
  c('View', 'Single Page', 'Ctrl+4'), c('View', 'Continuous', 'Ctrl+5'), c('View', 'Side by Side', 'Ctrl+6'), c('View', 'Continuous Side by Side', 'Ctrl+7'),
  c('View', 'Rotate View Clockwise', 'Ctrl+Shift++'), c('View', 'Rotate View Counterclockwise', 'Ctrl+Shift+-'),
  c('View', 'Split Horizontal', 'Ctrl+H'), c('View', 'Split Vertical', 'Ctrl+2'), c('View', 'Unsplit', 'Ctrl+Shift+2'), c('View', 'Switch', 'Ctrl+1'), c('View', 'Toggle Split', 'Ctrl+I'),
  c('Navigation', 'Next Page', 'Ctrl+ArrowRight'), c('Navigation', 'Previous Page', 'Ctrl+ArrowLeft'), c('Navigation', 'First Page', 'Home'), c('Navigation', 'Last Page', 'End'),
  c('Search', 'Search', 'Ctrl+F'), c('Search', 'Next Result', 'F3'), c('Search', 'Previous Result', 'Shift+F3'),
  c('Document', 'Document Properties', 'Ctrl+D'), c('Document', 'Crop Pages', 'Shift+Alt+O'), c('Document', 'Deskew', 'Ctrl+Alt+D'), c('Document', 'Add Bookmark', 'Ctrl+B'), c('Document', 'Security', 'Ctrl+L'), c('Document', 'Insert Pages', 'Ctrl+Shift+I'), c('Document', 'Insert Blank Page', 'Ctrl+Shift+N'), c('Document', 'Delete Pages', 'Ctrl+Shift+D'),
  c('Document', 'Extract Pages', 'Ctrl+Shift+X'), c('Document', 'Replace Pages', 'Ctrl+Shift+Y'), c('Document', 'Rotate Pages', 'Ctrl+Shift+R'),
  c('Document', 'Apply Redactions', 'Shift+A'), c('Document', 'OCR', 'Ctrl+Shift+O'), c('Document', 'Rotate Clockwise', 'Shift+Alt++'), c('Document', 'Rotate Counterclockwise', 'Shift+Alt+-'), c('Document', 'Flatten', 'Ctrl+Shift+M'), c('Document', 'Unflatten', 'Ctrl+Shift+U'),
  c('Window', 'Markups', 'Alt+L'), c('Window', 'Thumbnails', 'Alt+T'), c('Window', 'Bookmarks', 'Alt+B'), c('Window', 'Spaces', 'Alt+S'), c('Window', 'Layers', 'Alt+Y'), c('Window', 'Links', 'Alt+N'), c('Window', 'File Access', 'Alt+A'),
  c('Window', 'Search', 'Alt+1'), c('Window', 'Sets', 'Alt+2'), c('Window', 'Signatures', 'Alt+4'), c('Window', 'Properties', 'Alt+P'), c('Window', 'Tool Chest', 'Alt+X'),
  c('Window', 'Measurements', 'Alt+U'), c('Window', 'Hide Panel', 'Shift+F4'),
  c('Window', 'Full Screen', 'F11'), c('Window', 'Presentation', 'Ctrl+Enter'), c('Window', 'Navigation Bar', 'F4'), c('Window', 'Balance', 'Shift+F12'),
  c('Window', 'Show Context Menu', 'Shift+F10'), c('View', 'Zoom Tool (toggle)', 'Shift+Z'), c('Forms', 'Forms Editor', 'Ctrl+Shift+F'), c('Help', 'Help', 'F1'), c('CyanTakeoff', 'Preferences', 'Ctrl+K'),
];

export function allCommands(): Command[] {
  return [
    ...TOOLS.filter((t) => !['viewport', 'space', 'legend', 'visual-pick', 'region-pick', 'edit-text', 'erase-content', 'cut-content', 'sketch-polygon', 'sketch-polyline', 'sketch-rectangle', 'sketch-ellipse', 'review-text', 'caret'].includes(t.id))
      .map((t) => ({ id: `tool:${t.id}`, label: t.name, group: t.group === 'measure' ? 'Measure' : t.group === 'markup' ? 'Markup tools' : t.group === 'form' ? 'Forms' : 'Selection', combo: t.shortcut })),
    ...APP_COMMANDS,
  ];
}

let defaultsCache: Map<string, string> | null = null;
/** Default combo of every command (built once: the lists are fixed). */
const defaults = () => (defaultsCache ??= new Map(allCommands().map((x) => [x.id, x.combo ?? ''])));

/** The shortcut a command has now (custom, else default; '' = none). */
export function effectiveCombo(id: string, custom: Record<string, string>): string {
  return id in custom ? custom[id] : defaults().get(id) ?? '';
}

/**
 * Translate a pressed combo into the command to run: a command reassigned
 * to it, else the command it is the default of (unless that command was
 * reassigned elsewhere). Returns '' when nothing should run.
 */
export function resolveCombo(pressed: string, custom: Record<string, string>): string {
  for (const [id, combo] of Object.entries(custom)) if (combo === pressed) return id;
  const def = defaults();
  for (const [id, combo] of def) {
    if (combo === pressed && id in custom && custom[id] !== pressed) return '';
  }
  return pressed;
}

/** Commands whose shortcut is `combo` (for conflict warnings). */
export function usersOf(combo: string, custom: Record<string, string>): Command[] {
  return allCommands().filter((x) => effectiveCombo(x.id, custom) === combo);
}

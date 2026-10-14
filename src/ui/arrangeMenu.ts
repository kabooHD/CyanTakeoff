// Menu entries for Revu's markup arrangement commands (Edit menu and context menu).
import { align, flip, group, reorder, ungroup, type Edge, type Order } from '../model/arrange';
import { activeDoc, useApp } from '../model/store';
import type { MenuItem } from './ContextMenu';
import { markupBounds } from './hit';
import { autosizeTextBoxes, removeSelectedFromGroup } from './quickCommands';

export function arrangeItems(): MenuItem[] {
  const s = useApp.getState();
  const d = activeDoc();
  const sel = d?.markups.filter((m) => d.selection.includes(m.id)) ?? [];
  const none = !sel.length, few = sel.length < 2;
  const grouped = sel.some((m) => m.groupId);
  const locked = sel.length > 0 && sel.every((m) => m.locked);
  const order = (label: string, o: Order, shortcut: string): MenuItem => ({ label, shortcut, disabled: none, action: () => s.arrange((m, ids) => reorder(m, ids, o)) });
  const al = (label: string, e: Edge, shortcut: string): MenuItem => ({ label, shortcut, disabled: few, action: () => s.arrange((m, ids) => align(m, ids, e, markupBounds)) });
  return [
    { label: 'Group', shortcut: 'Ctrl+G', disabled: few, action: () => s.arrange(group) },
    { label: 'Ungroup', shortcut: 'Ctrl+Shift+G', disabled: !grouped, action: () => s.arrange(ungroup) },
    { label: 'Remove Selected from Group', shortcut: 'Ctrl+Shift+Alt+G', disabled: !grouped, action: removeSelectedFromGroup },
    { label: 'Autosize Text Box', shortcut: 'Alt+Z', disabled: !sel.some((m) => m.type === 'textbox' || m.type === 'callout'), action: autosizeTextBoxes },
    { label: locked ? 'Unlock' : 'Lock', shortcut: 'Ctrl+Shift+L', disabled: none, action: s.toggleLock },
    { label: 'Format Painter', shortcut: 'Ctrl+Shift+C', disabled: sel.length !== 1, action: () => useApp.setState({ painter: { style: sel[0].style }, status: 'Format Painter: click a markup to apply this format (Esc cancels).' }) },
    { sep: true },
    order('Bring to Front', 'front', 'Ctrl+Shift+J'),
    order('Bring Forward', 'forward', 'Ctrl+J'),
    order('Send Backward', 'backward', 'Ctrl+['),
    order('Send to Back', 'back', 'Ctrl+Shift+['),
    { sep: true },
    { label: 'Flip Horizontal', shortcut: 'Ctrl+Alt+H', disabled: none, action: () => s.arrange((m, ids) => flip(m, ids, 'horizontal')) },
    { label: 'Flip Vertical', shortcut: 'Ctrl+Alt+V', disabled: none, action: () => s.arrange((m, ids) => flip(m, ids, 'vertical')) },
    { sep: true },
    al('Align Left', 'left', 'Ctrl+Alt+L'), al('Align Center', 'center', 'Ctrl+Alt+E'), al('Align Right', 'right', 'Ctrl+Alt+R'),
    al('Align Top', 'top', 'Ctrl+Alt+T'), al('Align Middle', 'middle', 'Ctrl+Alt+M'), al('Align Bottom', 'bottom', 'Ctrl+Alt+B'),
  ];
}

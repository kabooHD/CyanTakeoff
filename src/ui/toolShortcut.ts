// Enable Single Key Shortcuts (Revu, Preferences > Forms): a tool's one-key
// shortcut (R, L, A…) works while a form field has the focus; the field
// loses it. Off by default, so typing in a field never changes the tool.
import { useApp } from '../model/store';
import { TOOLS, comboFromEvent } from '../tools/tools';

/** Picks the tool of a single-key shortcut pressed in a form field; true when one was picked. */
export function singleKeyInField(e: KeyboardEvent): boolean {
  const st = useApp.getState();
  if (!st.prefs.singleKeyInForms || !/^[a-z]$/i.test(e.key) || e.ctrlKey || e.altKey || e.metaKey) return false;
  const tool = TOOLS.find((x) => x.shortcut === comboFromEvent(e));
  if (!tool) return false;
  st.setTool(tool.id === 'radius' ? st.radiusTool : tool.id);
  return true;
}

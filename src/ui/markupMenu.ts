// Right-click menu of a markup (Revu), shared by the drawing and the
// Markups List: Properties, Edit Action, Add to My Tools, Set Status, Layer,
// Copy, Delete, Reply, Check, Create Legend, then the arrange commands.
import { addLayer } from './LayersPanel';
import { layerIds } from '../pdf/layers';
import { arrangeItems } from './arrangeMenu';
import { legendKey } from '../model/legend';
import { statusMenuItems } from './StatusModels';
import { editAction } from './quickCommands';
import { sequenceMembers } from '../model/sequence';
import type { MenuItem } from './ContextMenu';
import { useApp, type DocState } from '../model/store';
import type { Markup } from '../model/types';
import { captureMenuItems } from './Capture';
import { openCameraFor } from './Camera';

export function markupMenuItems(doc: DocState, hit: Markup, ids: string[]): MenuItem[] {
  const s = useApp.getState();
  return [
    { label: 'Properties', action: () => s.setPanels({ right: 'properties' }) },
    { label: 'Edit Action…', shortcut: 'Ctrl+Shift+E', action: () => editAction(ids) },
    { label: 'Add to My Tools', action: () => s.addToToolChest(hit) },
    ...(hit.seq ? [{ label: 'Select Sequence', action: () => s.select(sequenceMembers(doc.markups, hit)) }] : []),
    ...captureMenuItems(hit, openCameraFor),
    { sep: true },
    ...statusMenuItems(hit, ids),
    { sep: true },
    ...layerIds(doc.layers?.order ?? []).map((id) => ({
      label: `Layer › ${doc.layers!.layers[id].name}`, checked: hit.layer === id,
      action: () => s.updateMarkups(ids, () => ({ layer: hit.layer === id ? undefined : id })),
    })),
    { label: 'Layer › Create New Layer…', action: () => {
      const name = prompt('Layer name', `Layer ${Object.keys(doc.layers?.layers ?? {}).length + 1}`);
      const id = name ? addLayer(name, null, 'after') : null;
      if (id) s.updateMarkups(ids, () => ({ layer: id }));
    } },
    { sep: true },
    { label: 'Copy', shortcut: 'Ctrl+C', action: () => s.copy() },
    { label: 'Delete', shortcut: 'Del', action: () => s.deleteMarkups(ids), disabled: !!hit.locked },
    { label: 'Reply', action: () => { s.setPanels({ markupsList: true }); useApp.setState({ replyTo: hit.id }); } },
    { label: hit.checked ? 'Uncheck' : 'Check', action: () => s.updateMarkups(ids, () => ({ checked: !hit.checked || undefined })) },
    { label: 'Clear All Checkmarks', action: () => s.updateMarkups(doc.markups.filter((x) => x.checked).map((x) => x.id), () => ({ checked: undefined })) },
    { label: 'Create Legend', action: () => {
      const sel = doc.markups.filter((m) => ids.includes(m.id) && m.type !== 'legend');
      useApp.setState({ legendKeys: [...new Set(sel.map(legendKey))] });
      s.setTool('legend');
      s.setStatus('Click on the drawing to place the Legend.');
    } },
    { sep: true },
    ...arrangeItems(),
  ];
}

// Retain Layer information when copying Markups (Revu, Preferences >
// Markup): a markup pasted into another file keeps its layer; when that
// file has no such layer, one with the same name is used or created. With
// the preference off, pasted markups land on no layer.
import type { Layer, LayerSet } from '../pdf/layers';

export interface PastedLayers<M> { markups: M[]; layers: LayerSet | null; /** Ids of the layers created. */ added: string[] }

/**
 * `names`: the layer names of the file the markups were copied from, by
 * layer id. `newId` makes ids for the layers created.
 */
export function pasteLayers<M extends { layer?: string }>(markups: M[], names: Record<string, string>, target: LayerSet | null, retain: boolean, newId: () => string): PastedLayers<M> {
  if (!retain) return { markups: markups.map((m) => (m.layer ? { ...m, layer: undefined } : m)), layers: target, added: [] };
  let set: LayerSet = target ?? { layers: {}, order: [], configs: [] };
  const added: string[] = [];
  const remap = new Map<string, string | undefined>();
  const byName = () => new Map(Object.values(set.layers).map((l) => [l.name, l.id]));
  for (const m of markups) {
    const id = m.layer;
    if (!id || remap.has(id)) continue;
    if (set.layers[id]) { remap.set(id, id); continue; }
    const name = names[id];
    if (!name) { remap.set(id, undefined); continue; }
    const same = byName().get(name);
    if (same) { remap.set(id, same); continue; }
    const nid = newId();
    const layer: Layer = { id: nid, name, on: true, locked: false, print: true };
    set = { ...set, layers: { ...set.layers, [nid]: layer }, order: [...set.order, { id: nid, kids: [] }] };
    added.push(nid);
    remap.set(id, nid);
  }
  return {
    markups: markups.map((m) => (m.layer ? { ...m, layer: remap.get(m.layer) } : m)),
    layers: added.length ? set : target,
    added,
  };
}

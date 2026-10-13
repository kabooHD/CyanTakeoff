// Edits of the layer tree (Revu's Layers panel): add before / after / as
// child, move by drag, remove, and the layers under a node. Nodes are
// addressed by key: the layer id, or "g:<label>" for a layer group.
import type { LayerNode, LayerSet } from '../pdf/layers';

export type Where = 'before' | 'after' | 'child';

export const nodeKey = (n: LayerNode) => n.id ?? `g:${n.label}`;

/** The layer ids of a node and everything under it. */
export function idsUnder(n: LayerNode): string[] {
  return [...(n.id ? [n.id] : []), ...n.kids.flatMap(idsUnder)];
}

export function findNode(nodes: LayerNode[], key: string): LayerNode | undefined {
  for (const n of nodes) {
    if (nodeKey(n) === key) return n;
    const k = findNode(n.kids, key);
    if (k) return k;
  }
  return undefined;
}

const clone = (nodes: LayerNode[]): LayerNode[] => nodes.map((n) => ({ ...n, kids: clone(n.kids) }));

/** Remove the nodes with these keys (and their children). */
export function removeNodes(nodes: LayerNode[], keys: Set<string>): LayerNode[] {
  return nodes.filter((n) => !keys.has(nodeKey(n))).map((n) => ({ ...n, kids: removeNodes(n.kids, keys) }));
}

/** Insert `node` relative to the node `target` (none: top for before, bottom otherwise). */
export function insertNode(nodes: LayerNode[], node: LayerNode, target: string | null, where: Where): LayerNode[] {
  const out = clone(nodes);
  if (!target) return where === 'before' ? [node, ...out] : [...out, node];
  const place = (list: LayerNode[]): boolean => {
    const i = list.findIndex((n) => nodeKey(n) === target);
    if (i >= 0) {
      if (where === 'child') list[i].kids.push(node);
      else list.splice(where === 'before' ? i : i + 1, 0, node);
      return true;
    }
    return list.some((n) => place(n.kids));
  };
  if (!place(out)) out.push(node);
  return out;
}

/** Move node `key` next to (or into) `target`; a node cannot move into itself. */
export function moveNode(nodes: LayerNode[], key: string, target: string, where: Where): LayerNode[] {
  if (key === target) return nodes;
  const node = findNode(nodes, key);
  if (!node || findNode(node.kids, target)) return nodes;
  return insertNode(removeNodes(nodes, new Set([key])), { ...node, kids: clone(node.kids) }, target, where);
}

/** Layers set with these layer ids removed from the list, order and configurations. */
export function withoutLayers(set: LayerSet, ids: Set<string>): LayerSet {
  const layers = Object.fromEntries(Object.entries(set.layers).filter(([id]) => !ids.has(id)));
  // Children of a removed layer move up to its place.
  const lift = (list: LayerNode[]): LayerNode[] => list.flatMap((n) => (n.id && ids.has(n.id) ? lift(n.kids) : [{ ...n, kids: lift(n.kids) }]));
  return { layers, order: lift(set.order), configs: set.configs.map((c) => ({ ...c, off: c.off.filter((x) => !ids.has(x)) })) };
}

/** Top-level nodes sorted by name (Revu's Show Layers Alphabetically). */
export function alphabetical(set: LayerSet): LayerNode[] {
  const name = (n: LayerNode) => (n.id ? set.layers[n.id]?.name : n.label) ?? '';
  return [...set.order].sort((a, b) => name(a).localeCompare(name(b), undefined, { numeric: true }));
}

/** Move (dx, dy, PDF points), rotate (degrees, counterclockwise) and scale a layer about a base point (PDF space). */
export function layerMatrix(dx: number, dy: number, deg: number, scale: number, bx: number, by: number): [number, number, number, number, number, number] {
  const r = (deg * Math.PI) / 180, c = Math.cos(r) * scale, sn = Math.sin(r) * scale;
  // p' = (p - b)·(scale·R) + b + d
  return [c, sn, -sn, c, bx - (c * bx - sn * by) + dx, by - (sn * bx + c * by) + dy];
}

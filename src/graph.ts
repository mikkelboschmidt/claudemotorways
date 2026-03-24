import { GraphNode, Edge } from './types.ts';
import { GRID, HALF, GRID_DIAG } from './constants.ts';

export const nodes = new Map<string, GraphNode>();
export const edges = new Map<string, Edge>();

export function nodeKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

const parseKeyCache = new Map<string, [number, number]>();
export function parseKey(key: string): [number, number] {
  let cached = parseKeyCache.get(key);
  if (cached) return cached;
  const [gx, gy] = key.split(',').map(Number);
  cached = [gx, gy];
  parseKeyCache.set(key, cached);
  return cached;
}

export function edgeKey(gx1: number, gy1: number, gx2: number, gy2: number): string {
  if (gx1 < gx2 || (gx1 === gx2 && gy1 < gy2)) {
    return `${gx1},${gy1}-${gx2},${gy2}`;
  }
  return `${gx2},${gy2}-${gx1},${gy1}`;
}

function ensureNode(gx: number, gy: number): GraphNode {
  const key = nodeKey(gx, gy);
  let node = nodes.get(key);
  if (!node) {
    node = { gx, gy, edges: new Set() };
    nodes.set(key, node);
  }
  return node;
}

export function ensureNodeRaw(key: string, gx: number, gy: number): GraphNode {
  let node = nodes.get(key);
  if (!node) {
    node = { gx, gy, edges: new Set() };
    nodes.set(key, node);
  }
  return node;
}

export function edgeLength(gx1: number, gy1: number, gx2: number, gy2: number): number {
  const dx = Math.abs(gx2 - gx1);
  const dy = Math.abs(gy2 - gy1);
  if (dx === 0 || dy === 0) return GRID;
  return GRID_DIAG; // diagonal
}

export function addEdge(gx1: number, gy1: number, gx2: number, gy2: number, narrow?: boolean): boolean {
  const ek = edgeKey(gx1, gy1, gx2, gy2);
  if (edges.has(ek)) return false;

  const n1 = ensureNode(gx1, gy1);
  const n2 = ensureNode(gx2, gy2);

  let fromKey: string, toKey: string;
  if (gx1 < gx2 || (gx1 === gx2 && gy1 < gy2)) {
    fromKey = nodeKey(gx1, gy1);
    toKey = nodeKey(gx2, gy2);
  } else {
    fromKey = nodeKey(gx2, gy2);
    toKey = nodeKey(gx1, gy1);
  }

  const len = edgeLength(gx1, gy1, gx2, gy2);
  const [fgx, fgy] = parseKey(fromKey);
  const [tgx, tgy] = parseKey(toKey);
  const edge: Edge = {
    id: ek, fromKey, toKey, length: len,
    fx: fgx * GRID + HALF, fy: fgy * GRID + HALF,
    tx: tgx * GRID + HALF, ty: tgy * GRID + HALF,
    narrow: narrow || undefined,
  };
  edges.set(ek, edge);
  n1.edges.add(ek);
  n2.edges.add(ek);
  return true;
}

export function addEdgeRaw(fromKey: string, toKey: string, fx: number, fy: number, tx: number, ty: number): Edge | null {
  // Canonical ID: sort by string comparison
  const id = fromKey < toKey ? `${fromKey}-${toKey}` : `${toKey}-${fromKey}`;
  if (edges.has(id)) return edges.get(id)!;

  const canonFrom = fromKey < toKey ? fromKey : toKey;
  const canonTo = fromKey < toKey ? toKey : fromKey;
  const cfx = canonFrom === fromKey ? fx : tx;
  const cfy = canonFrom === fromKey ? fy : ty;
  const ctx_ = canonFrom === fromKey ? tx : fx;
  const cty = canonFrom === fromKey ? ty : fy;

  const edge: Edge = {
    id, fromKey: canonFrom, toKey: canonTo,
    length: Math.hypot(ctx_ - cfx, cty - cfy),
    fx: cfx, fy: cfy, tx: ctx_, ty: cty,
  };
  edges.set(id, edge);

  const n1 = nodes.get(canonFrom);
  const n2 = nodes.get(canonTo);
  if (n1) n1.edges.add(id);
  if (n2) n2.edges.add(id);

  return edge;
}

export function removeEdge(ek: string): boolean {
  const edge = edges.get(ek);
  if (!edge) return false;

  const n1 = nodes.get(edge.fromKey);
  const n2 = nodes.get(edge.toKey);
  if (n1) n1.edges.delete(ek);
  if (n2) n2.edges.delete(ek);
  edges.delete(ek);

  if (n1 && n1.edges.size === 0) nodes.delete(edge.fromKey);
  if (n2 && n2.edges.size === 0) nodes.delete(edge.toKey);

  return true;
}

// Point-to-line-segment distance for arbitrary angle edges
export function findEdgeAtPixel(px: number, py: number, roadW: number): string | null {
  const half = roadW / 2;
  for (const [, edge] of edges) {
    const dx = edge.tx - edge.fx, dy = edge.ty - edge.fy;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;
    const t = Math.max(0, Math.min(1, ((px - edge.fx) * dx + (py - edge.fy) * dy) / lenSq));
    const projX = edge.fx + t * dx;
    const projY = edge.fy + t * dy;
    const dist = Math.hypot(px - projX, py - projY);
    if (dist <= half) {
      return edge.id;
    }
  }
  return null;
}

export function getNeighbors(key: string): string[] {
  const node = nodes.get(key);
  if (!node) return [];
  const neighbors: string[] = [];
  for (const eid of node.edges) {
    const edge = edges.get(eid)!;
    neighbors.push(edge.fromKey === key ? edge.toKey : edge.fromKey);
  }
  return neighbors;
}

export function getEdgeBetween(key1: string, key2: string): Edge | null {
  const node = nodes.get(key1);
  if (!node) return null;
  for (const eid of node.edges) {
    const edge = edges.get(eid)!;
    if ((edge.fromKey === key1 && edge.toKey === key2) ||
        (edge.fromKey === key2 && edge.toKey === key1)) return edge;
  }
  return null;
}

export function getNodeEdges(key: string): string[] {
  const node = nodes.get(key);
  if (!node) return [];
  return [...node.edges];
}

export let graphVersion = 0;
export function bumpGraphVersion() { graphVersion++; }

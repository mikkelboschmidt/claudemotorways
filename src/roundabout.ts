import { addEdgeRaw, ensureNodeRaw, removeEdge, nodeKey, nodes, edges, parseKey, bumpGraphVersion } from './graph.ts';
import { GRID, HALF, ROAD_W } from './constants.ts';
import { isInsideBuilding } from './buildings.ts';

export interface Roundabout {
  id: number;
  gx: number; // top-left grid position of 3x3 area
  gy: number;
  edgeIds: string[];
  // Ring node keys in order: E, SE, S, SW, W, NW, N, NE (indices 0-7)
  ringNodeKeys: string[];
}

export interface RoundaboutConnection {
  outerGx: number;
  outerGy: number;
  ringIndex: number; // index into ringNodeKeys (0-7)
}

export const roundabouts: Roundabout[] = [];
export const roundaboutEdgeSet = new Set<string>();
export const roundaboutConnectionEdgeSet = new Set<string>(); // edges connecting roads to ring nodes
export const roundaboutTileSet = new Set<string>(); // all 9 tiles of all roundabouts

let nextRoundaboutId = 1;

export function resetRoundabouts() {
  roundabouts.length = 0;
  roundaboutEdgeSet.clear();
  roundaboutConnectionEdgeSet.clear();
  roundaboutTileSet.clear();
  nextRoundaboutId = 1;
}

// Check if a grid tile is inside any roundabout's 3x3 area
export function isInsideRoundaboutTile(gx: number, gy: number): boolean {
  return roundaboutTileSet.has(`${gx},${gy}`);
}

// Check if a grid tile is in a roundabout's interior (not a cardinal ring node)
export function isRoundaboutInterior(gx: number, gy: number): boolean {
  for (const ra of roundabouts) {
    if (gx >= ra.gx && gx < ra.gx + 3 && gy >= ra.gy && gy < ra.gy + 3) {
      const isRingNode =
        (gx === ra.gx + 1 && gy === ra.gy) ||
        (gx === ra.gx + 2 && gy === ra.gy + 1) ||
        (gx === ra.gx + 1 && gy === ra.gy + 2) ||
        (gx === ra.gx && gy === ra.gy + 1);
      if (!isRingNode) return true;
    }
  }
  return false;
}

// Check if a road segment cuts through a roundabout's interior
export function segmentCutsRoundabout(gx1: number, gy1: number, gx2: number, gy2: number): boolean {
  const dx = gx2 - gx1;
  const dy = gy2 - gy1;
  if (dx !== 0 && dy !== 0) {
    if (isRoundaboutInterior(gx1 + dx, gy1) || isRoundaboutInterior(gx1, gy1 + dy)) {
      return true;
    }
  }
  if (isRoundaboutInterior(gx1, gy1) || isRoundaboutInterior(gx2, gy2)) {
    return true;
  }
  return false;
}

export function canPlaceRoundabout(gx: number, gy: number): boolean {
  for (let tx = gx; tx < gx + 3; tx++) {
    for (let ty = gy; ty < gy + 3; ty++) {
      if (isInsideBuilding(tx, ty)) return false;
      if (isInsideRoundaboutTile(tx, ty)) return false;
      // Non-ring tiles must not have road edges
      const isRingNode =
        (tx === gx + 1 && ty === gy) ||
        (tx === gx + 2 && ty === gy + 1) ||
        (tx === gx + 1 && ty === gy + 2) ||
        (tx === gx && ty === gy + 1);
      if (!isRingNode) {
        const node = nodes.get(nodeKey(tx, ty));
        if (node && node.edges.size > 0) return false;
      }
    }
  }
  return true;
}

// 8 directions for ring nodes: E, SE, S, SW, W, NW, N, NE
// Angles: 0°, 45°, 90°, 135°, 180°, 225°, 270°, 315° (clockwise from East)
const NUM_RING_NODES = 8;

// Cardinal ring nodes map to integer grid positions
// Index → [gridOffsetX, gridOffsetY] from roundabout top-left
const CARDINAL_NODES: [number, number, number][] = [
  [0, 2, 1], // East  (0°)
  [2, 1, 2], // South (90°)
  [4, 0, 1], // West  (180°)
  [6, 1, 0], // North (270°)
];

export function createRoundabout(gx: number, gy: number): Roundabout | null {
  if (!canPlaceRoundabout(gx, gy)) return null;

  const id = nextRoundaboutId++;
  const cx = (gx + 1) * GRID + HALF; // center pixel x
  const cy = (gy + 1) * GRID + HALF; // center pixel y
  const radius = GRID; // ring radius in pixels

  const ringNodes: { key: string; px: number; py: number }[] = [];

  for (let i = 0; i < NUM_RING_NODES; i++) {
    const angle = (i / NUM_RING_NODES) * Math.PI * 2; // 0° = East, clockwise
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;

    const cardinal = CARDINAL_NODES.find(c => c[0] === i);
    if (cardinal) {
      const [, mgx, mgy] = cardinal;
      const key = nodeKey(gx + mgx, gy + mgy);
      ensureNodeRaw(key, gx + mgx, gy + mgy);
      ringNodes.push({ key, px: (gx + mgx) * GRID + HALF, py: (gy + mgy) * GRID + HALF });
    } else {
      const key = `ra${id}_${i}`;
      ensureNodeRaw(key, px / GRID, py / GRID);
      ringNodes.push({ key, px, py });
    }
  }

  // Create 8 one-way edges for counter-clockwise travel.
  // Indices go clockwise in angle, so counter-clockwise travel = (i+1) → i.
  const edgeIds: string[] = [];
  for (let i = 0; i < NUM_RING_NODES; i++) {
    const a = ringNodes[i];
    const b = ringNodes[(i + 1) % NUM_RING_NODES];
    // oneway = b.key means traffic can only enter from b and exit at a
    const edge = addEdgeRaw(a.key, b.key, a.px, a.py, b.px, b.py, b.key);
    if (edge) {
      edgeIds.push(edge.id);
      roundaboutEdgeSet.add(edge.id);
    }
  }

  const ringNodeKeys = ringNodes.map(n => n.key);
  const ra: Roundabout = { id, gx, gy, edgeIds, ringNodeKeys };
  roundabouts.push(ra);

  // Mark all 9 tiles
  for (let tx = gx; tx < gx + 3; tx++) {
    for (let ty = gy; ty < gy + 3; ty++) {
      roundaboutTileSet.add(`${tx},${ty}`);
    }
  }

  bumpGraphVersion();
  return ra;
}

export function removeRoundabout(id: number): boolean {
  const idx = roundabouts.findIndex(r => r.id === id);
  if (idx === -1) return false;

  const ra = roundabouts[idx];

  // Remove connection edges that touch this roundabout's ring nodes
  const ringNodeSet = new Set(ra.ringNodeKeys);
  for (const eid of [...roundaboutConnectionEdgeSet]) {
    const edge = edges.get(eid);
    if (edge && (ringNodeSet.has(edge.fromKey) || ringNodeSet.has(edge.toKey))) {
      roundaboutConnectionEdgeSet.delete(eid);
      removeEdge(eid);
    }
  }

  for (const eid of ra.edgeIds) {
    roundaboutEdgeSet.delete(eid);
    removeEdge(eid);
  }

  for (let tx = ra.gx; tx < ra.gx + 3; tx++) {
    for (let ty = ra.gy; ty < ra.gy + 3; ty++) {
      roundaboutTileSet.delete(`${tx},${ty}`);
    }
  }

  roundabouts.splice(idx, 1);
  bumpGraphVersion();
  return true;
}

export function findRoundaboutAtPixel(px: number, py: number): Roundabout | null {
  for (const ra of roundabouts) {
    const cx = (ra.gx + 1) * GRID + HALF;
    const cy = (ra.gy + 1) * GRID + HALF;
    const dist = Math.hypot(px - cx, py - cy);
    if (dist <= GRID + ROAD_W / 2) {
      return ra;
    }
  }
  return null;
}

// Find the roundabout whose 3x3 area contains the given tile
export function findRoundaboutAtTile(tileGx: number, tileGy: number): Roundabout | null {
  for (const ra of roundabouts) {
    if (tileGx >= ra.gx && tileGx < ra.gx + 3 && tileGy >= ra.gy && tileGy < ra.gy + 3) {
      return ra;
    }
  }
  return null;
}

// Given an approach direction (dx, dy in grid units), find the best ring node to connect to.
// Returns { nodeKey, px, py, outerGx, outerGy } where outer is the tile just outside the roundabout
// that should be the road's last grid-aligned node before the connecting edge.
export function findBestRoundaboutEntry(ra: Roundabout, fromGx: number, fromGy: number): {
  nodeKey: string; px: number; py: number; outerGx: number; outerGy: number; ringIndex: number;
} | null {
  const cx = ra.gx + 1; // center grid x
  const cy = ra.gy + 1; // center grid y
  const dx = fromGx - cx;
  const dy = fromGy - cy;
  if (dx === 0 && dy === 0) return null;

  // Compute angle and snap to nearest 45° (matching ring node indices)
  const angle = Math.atan2(dy, dx);
  const snappedIdx = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;

  const nk = ra.ringNodeKeys[snappedIdx];
  if (!nk) return null;

  const node = nodes.get(nk);
  if (!node) return null;

  const px = node.gx * GRID + HALF;
  const py = node.gy * GRID + HALF;

  // Compute the outer tile: one step outward from the ring node in the connection direction
  const dirAngle = (snappedIdx / 8) * Math.PI * 2;
  const dirX = Math.round(Math.cos(dirAngle));
  const dirY = Math.round(Math.sin(dirAngle));

  // For cardinal directions, outer tile is adjacent to the ring node
  // For diagonals, outer tile is one diagonal step outside the 3x3 corner
  let outerGx: number, outerGy: number;
  if (snappedIdx % 2 === 0) {
    // Cardinal: ring node is at integer grid, outer is one step further
    const [ringGx, ringGy] = [Math.round(node.gx), Math.round(node.gy)];
    outerGx = ringGx + dirX;
    outerGy = ringGy + dirY;
  } else {
    // Diagonal: outer tile is one step outside the 3x3 corner
    const cornerGx = cx + dirX;
    const cornerGy = cy + dirY;
    outerGx = cornerGx + dirX;
    outerGy = cornerGy + dirY;
  }

  return { nodeKey: nk, px, py, outerGx, outerGy, ringIndex: snappedIdx };
}

// Create and track a connection edge from an outer grid tile to a ring node
export function addRoundaboutConnectionEdge(ra: Roundabout, outerGx: number, outerGy: number, ringIndex: number): void {
  const nk = ra.ringNodeKeys[ringIndex];
  if (!nk) return;
  const node = nodes.get(nk);
  if (!node) return;

  const outerKey = nodeKey(outerGx, outerGy);
  ensureNodeRaw(outerKey, outerGx, outerGy);
  // Compute ring node pixel position from circle geometry (not node.gx * GRID + HALF,
  // which is wrong for synthetic diagonal nodes stored at fractional grid coords)
  const cx = (ra.gx + 1) * GRID + HALF;
  const cy = (ra.gy + 1) * GRID + HALF;
  const angle = (ringIndex / NUM_RING_NODES) * Math.PI * 2;
  const ringPx = cx + Math.cos(angle) * GRID;
  const ringPy = cy + Math.sin(angle) * GRID;
  const outerPx = outerGx * GRID + HALF;
  const outerPy = outerGy * GRID + HALF;

  const edge = addEdgeRaw(outerKey, nk, outerPx, outerPy, ringPx, ringPy);
  if (edge) {
    roundaboutConnectionEdgeSet.add(edge.id);
  }
}

// Get all connections for serialization
export function getRoundaboutConnections(): { raGx: number; raGy: number; outerGx: number; outerGy: number; ringIndex: number }[] {
  const result: { raGx: number; raGy: number; outerGx: number; outerGy: number; ringIndex: number }[] = [];
  // Scan connection edges and match them back to roundabouts
  for (const eid of roundaboutConnectionEdgeSet) {
    const edge = edges.get(eid);
    if (!edge) continue;
    // One endpoint is a regular node, the other is a ring node
    for (const ra of roundabouts) {
      const ringIdx = ra.ringNodeKeys.indexOf(edge.fromKey);
      const ringIdx2 = ra.ringNodeKeys.indexOf(edge.toKey);
      if (ringIdx >= 0) {
        const [ogx, ogy] = parseKey(edge.toKey);
        result.push({ raGx: ra.gx, raGy: ra.gy, outerGx: ogx, outerGy: ogy, ringIndex: ringIdx });
        break;
      } else if (ringIdx2 >= 0) {
        const [ogx, ogy] = parseKey(edge.fromKey);
        result.push({ raGx: ra.gx, raGy: ra.gy, outerGx: ogx, outerGy: ogy, ringIndex: ringIdx2 });
        break;
      }
    }
  }
  return result;
}

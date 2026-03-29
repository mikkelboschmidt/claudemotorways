import { addEdgeRaw, ensureNodeRaw, removeEdge, nodeKey, nodes, bumpGraphVersion } from './graph.ts';
import { GRID, HALF, ROAD_W } from './constants.ts';
import { isInsideBuilding } from './buildings.ts';

export interface Roundabout {
  id: number;
  gx: number; // top-left grid position of 3x3 area
  gy: number;
  edgeIds: string[];
}

export const roundabouts: Roundabout[] = [];
export const roundaboutEdgeSet = new Set<string>();
export const roundaboutTileSet = new Set<string>(); // all 9 tiles of all roundabouts

let nextRoundaboutId = 1;

export function resetRoundabouts() {
  roundabouts.length = 0;
  roundaboutEdgeSet.clear();
  roundaboutTileSet.clear();
  nextRoundaboutId = 1;
}

// Check if a grid tile is inside any roundabout's 3x3 area
export function isInsideRoundaboutTile(gx: number, gy: number): boolean {
  return roundaboutTileSet.has(`${gx},${gy}`);
}

// Check if a grid tile is in a roundabout's interior (not a ring node)
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

// Get the 4 ring node grid positions: Top, Right, Bottom, Left
function getRingNodes(gx: number, gy: number): [number, number][] {
  return [
    [gx + 1, gy],     // Top
    [gx + 2, gy + 1], // Right
    [gx + 1, gy + 2], // Bottom
    [gx, gy + 1],     // Left
  ];
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

export function createRoundabout(gx: number, gy: number): Roundabout | null {
  if (!canPlaceRoundabout(gx, gy)) return null;

  const id = nextRoundaboutId++;
  const cx = (gx + 1) * GRID + HALF; // center pixel x
  const cy = (gy + 1) * GRID + HALF; // center pixel y
  const radius = GRID; // ring radius in pixels

  // 12 points around the circle, starting at 0° (right / "East")
  // Main grid nodes at indices 0(R), 3(B), 6(L), 9(T)
  const NUM_POINTS = 12;
  const ringNodes: { key: string; px: number; py: number }[] = [];

  // Main grid nodes at cardinal positions (integer grid coords)
  const mainNodes: [number, number, number][] = [
    [0, gx + 2, gy + 1], // Right
    [3, gx + 1, gy + 2], // Bottom
    [6, gx,     gy + 1], // Left
    [9, gx + 1, gy],     // Top
  ];

  for (let i = 0; i < NUM_POINTS; i++) {
    const angle = (i / NUM_POINTS) * Math.PI * 2; // 0° = East, clockwise
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;

    const main = mainNodes.find(m => m[0] === i);
    if (main) {
      const [, mgx, mgy] = main;
      const key = nodeKey(mgx, mgy);
      ensureNodeRaw(key, mgx, mgy); // integer grid coords for proper joint rendering
      ringNodes.push({ key, px: mgx * GRID + HALF, py: mgy * GRID + HALF });
    } else {
      const key = `ra${id}_${i}`;
      ensureNodeRaw(key, px / GRID, py / GRID);
      ringNodes.push({ key, px, py });
    }
  }

  // Create 12 one-way edges for counter-clockwise travel.
  // Indices go clockwise in angle, so counter-clockwise travel = (i+1) → i.
  const edgeIds: string[] = [];
  for (let i = 0; i < NUM_POINTS; i++) {
    const a = ringNodes[i];
    const b = ringNodes[(i + 1) % NUM_POINTS];
    // oneway = b.key means traffic can only enter from b and exit at a
    const edge = addEdgeRaw(a.key, b.key, a.px, a.py, b.px, b.py, b.key);
    if (edge) {
      edgeIds.push(edge.id);
      roundaboutEdgeSet.add(edge.id);
    }
  }

  const ra: Roundabout = { id, gx, gy, edgeIds };
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

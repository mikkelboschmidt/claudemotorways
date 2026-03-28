import { GRID, HALF, HIGHWAY_ROAD_W } from './constants.ts';
import { nodeKey, nodes, ensureNodeRaw, addEdgeRaw, removeEdge, bumpGraphVersion } from './graph.ts';
import { removeCarsForEdge } from './cars.ts';
import { zoom } from './camera.ts';

export interface Highway {
  id: number;
  startGx: number; startGy: number;
  endGx: number; endGy: number;
  // User-adjustable pass-through points (pixel coords) — curve passes through mid1 at t≈1/3 and mid2 at t≈2/3
  mid1X: number; mid1Y: number;
  mid2X: number; mid2Y: number;
  // Cubic bezier control points (pixel coords) for rendering — derived from mid1/mid2
  p0x: number; p0y: number;
  p1x: number; p1y: number;
  p2x: number; p2y: number;
  p3x: number; p3y: number;
  // Decomposed graph data
  nodeKeys: string[];
  edgeIds: string[];
}

export const highways: Highway[] = [];
export const highwayEdgeSet: Set<string> = new Set();
let nextHighwayId = 0;

// Placement state
export let highwayPhase: 'idle' | 'pickEnd' = 'idle';
export let highwayStartGx = 0;
export let highwayStartGy = 0;
export let highwayPreviewEndPx = 0;
export let highwayPreviewEndPy = 0;

// Handle drag state
export let draggingHighwayId = -1;
export let draggingHandleIndex: 1 | 2 = 1;

export function setHighwayPhase(phase: 'idle' | 'pickEnd') { highwayPhase = phase; }
export function setHighwayStart(gx: number, gy: number) { highwayStartGx = gx; highwayStartGy = gy; }
export function setHighwayPreviewEnd(px: number, py: number) { highwayPreviewEndPx = px; highwayPreviewEndPy = py; }
export function setDraggingHighwayId(id: number) { draggingHighwayId = id; }
export function setDraggingHandleIndex(index: 1 | 2) { draggingHandleIndex = index; }

// Cubic bezier sampling
function cubicBezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

// Approximate bezier arc length by sampling
function approxBezierLength(p0x: number, p0y: number, p1x: number, p1y: number,
                             p2x: number, p2y: number, p3x: number, p3y: number, samples = 20): number {
  let len = 0;
  let prevX = p0x, prevY = p0y;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const x = cubicBezier(t, p0x, p1x, p2x, p3x);
    const y = cubicBezier(t, p0y, p1y, p2y, p3y);
    len += Math.hypot(x - prevX, y - prevY);
    prevX = x; prevY = y;
  }
  return len;
}

// Compute default pass-through points at t=1/3 and t=2/3 with a subtle perpendicular offset
function defaultMidpoints(p0x: number, p0y: number, p3x: number, p3y: number) {
  const dx = p3x - p0x, dy = p3y - p0y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { mid1X: p0x, mid1Y: p0y, mid2X: p0x, mid2Y: p0y };
  const perpX = -dy / dist, perpY = dx / dist;
  const offset = dist * 0.08; // subtle default curve
  return {
    mid1X: p0x + dx / 3 + perpX * offset,
    mid1Y: p0y + dy / 3 + perpY * offset,
    mid2X: p0x + dx * 2 / 3 + perpX * offset,
    mid2Y: p0y + dy * 2 / 3 + perpY * offset,
  };
}

// Compute bezier control points so the curve passes through mid1 at t=1/3 and mid2 at t=2/3
// Solving B(1/3) = M1 and B(2/3) = M2 for P1 and P2:
//   P1 = (18*M1 - 9*M2 - 5*P0 + 2*P3) / 6
//   P2 = (18*M2 - 9*M1 + 2*P0 - 5*P3) / 6
export function computeBezierFromMids(
  p0x: number, p0y: number, p3x: number, p3y: number,
  mid1X: number, mid1Y: number, mid2X: number, mid2Y: number,
) {
  return {
    p1x: (18 * mid1X - 9 * mid2X - 5 * p0x + 2 * p3x) / 6,
    p1y: (18 * mid1Y - 9 * mid2Y - 5 * p0y + 2 * p3y) / 6,
    p2x: (18 * mid2X - 9 * mid1X + 2 * p0x - 5 * p3x) / 6,
    p2y: (18 * mid2Y - 9 * mid1Y + 2 * p0y - 5 * p3y) / 6,
  };
}

// Preview (uses default midpoints)
export function computeBezierControls(p0x: number, p0y: number, p3x: number, p3y: number) {
  const m = defaultMidpoints(p0x, p0y, p3x, p3y);
  return computeBezierFromMids(p0x, p0y, p3x, p3y, m.mid1X, m.mid1Y, m.mid2X, m.mid2Y);
}

function buildEdges(hw: Highway) {
  const { p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y } = hw;
  const arcLen = approxBezierLength(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y);
  const N = Math.max(4, Math.ceil(arcLen / GRID));

  const startKey = nodeKey(hw.startGx, hw.startGy);
  const endKey = nodeKey(hw.endGx, hw.endGy);

  const nodeKeys: string[] = [startKey];
  for (let i = 1; i < N; i++) {
    nodeKeys.push(`hw${hw.id}_${i}`);
  }
  nodeKeys.push(endKey);

  // Create intermediate nodes
  for (let i = 1; i < N; i++) {
    const t = i / N;
    const px = cubicBezier(t, p0x, p1x, p2x, p3x);
    const py = cubicBezier(t, p0y, p1y, p2y, p3y);
    ensureNodeRaw(nodeKeys[i], Math.round(px / GRID), Math.round(py / GRID));
  }

  // Create edges
  const edgeIds: string[] = [];
  for (let i = 0; i < nodeKeys.length - 1; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const fx = cubicBezier(t0, p0x, p1x, p2x, p3x);
    const fy = cubicBezier(t0, p0y, p1y, p2y, p3y);
    const tx = cubicBezier(t1, p0x, p1x, p2x, p3x);
    const ty = cubicBezier(t1, p0y, p1y, p2y, p3y);
    const edge = addEdgeRaw(nodeKeys[i], nodeKeys[i + 1], fx, fy, tx, ty);
    if (edge) {
      edgeIds.push(edge.id);
      highwayEdgeSet.add(edge.id);
    }
  }

  hw.nodeKeys = nodeKeys;
  hw.edgeIds = edgeIds;
}

function clearEdges(hw: Highway) {
  for (const eid of hw.edgeIds) {
    removeCarsForEdge(eid);
    highwayEdgeSet.delete(eid);
    removeEdge(eid);
  }
  // Remove intermediate nodes
  for (let i = 1; i < hw.nodeKeys.length - 1; i++) {
    const key = hw.nodeKeys[i];
    const node = nodes.get(key);
    if (node && node.edges.size === 0) nodes.delete(key);
  }
  hw.nodeKeys = [];
  hw.edgeIds = [];
}

export function createHighway(startGx: number, startGy: number, endGx: number, endGy: number,
                               savedMid1X?: number, savedMid1Y?: number,
                               savedMid2X?: number, savedMid2Y?: number): Highway | null {
  const p0x = startGx * GRID + HALF;
  const p0y = startGy * GRID + HALF;
  const p3x = endGx * GRID + HALF;
  const p3y = endGy * GRID + HALF;

  const mids = (savedMid1X !== undefined && savedMid1Y !== undefined &&
                savedMid2X !== undefined && savedMid2Y !== undefined)
    ? { mid1X: savedMid1X, mid1Y: savedMid1Y, mid2X: savedMid2X, mid2Y: savedMid2Y }
    : defaultMidpoints(p0x, p0y, p3x, p3y);

  const { p1x, p1y, p2x, p2y } = computeBezierFromMids(p0x, p0y, p3x, p3y, mids.mid1X, mids.mid1Y, mids.mid2X, mids.mid2Y);

  const id = nextHighwayId++;
  const highway: Highway = {
    id, startGx, startGy, endGx, endGy,
    mid1X: mids.mid1X, mid1Y: mids.mid1Y,
    mid2X: mids.mid2X, mid2Y: mids.mid2Y,
    p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y,
    nodeKeys: [], edgeIds: [],
  };

  highways.push(highway);
  buildEdges(highway);
  bumpGraphVersion();
  return highway;
}

// Update a control point visually (during drag) — only updates bezier, NOT the graph edges
export function updateHighwayMid(hw: Highway, handleIndex: 1 | 2, px: number, py: number) {
  if (handleIndex === 1) { hw.mid1X = px; hw.mid1Y = py; }
  else { hw.mid2X = px; hw.mid2Y = py; }
  const { p1x, p1y, p2x, p2y } = computeBezierFromMids(hw.p0x, hw.p0y, hw.p3x, hw.p3y, hw.mid1X, hw.mid1Y, hw.mid2X, hw.mid2Y);
  hw.p1x = p1x; hw.p1y = p1y;
  hw.p2x = p2x; hw.p2y = p2y;
}

// Rebuild graph edges after drag finishes
export function rebuildHighway(hw: Highway) {
  clearEdges(hw);
  buildEdges(hw);
  bumpGraphVersion();
}

export function removeHighway(id: number) {
  const idx = highways.findIndex(h => h.id === id);
  if (idx === -1) return;
  clearEdges(highways[idx]);
  highways.splice(idx, 1);
  bumpGraphVersion();
}

// Find a highway handle near a pixel position, returning which handle (1 or 2) was hit
const HANDLE_SCREEN_RADIUS = 22; // screen pixels — comfortable for both mouse and touch
export function findHighwayHandleAtPixel(px: number, py: number): { highway: Highway; handleIndex: 1 | 2 } | null {
  const hitRadius = HANDLE_SCREEN_RADIUS / zoom; // convert to world coords
  for (const hw of highways) {
    if (Math.hypot(px - hw.mid1X, py - hw.mid1Y) <= hitRadius) return { highway: hw, handleIndex: 1 };
    if (Math.hypot(px - hw.mid2X, py - hw.mid2Y) <= hitRadius) return { highway: hw, handleIndex: 2 };
  }
  return null;
}

// Point-to-bezier distance test for removal
export function findHighwayAtPixel(px: number, py: number): Highway | null {
  const threshold = HIGHWAY_ROAD_W / 2 + 4;
  for (const hw of highways) {
    const samples = 20;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const bx = cubicBezier(t, hw.p0x, hw.p1x, hw.p2x, hw.p3x);
      const by = cubicBezier(t, hw.p0y, hw.p1y, hw.p2y, hw.p3y);
      if (Math.hypot(px - bx, py - by) <= threshold) return hw;
    }
  }
  return null;
}

export function resetHighways() {
  highways.length = 0;
  highwayEdgeSet.clear();
  nextHighwayId = 0;
  highwayPhase = 'idle';
  draggingHighwayId = -1;
  draggingHandleIndex = 1;
}

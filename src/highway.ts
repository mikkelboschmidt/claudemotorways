import { GRID, HALF, HIGHWAY_ROAD_W } from './constants.ts';
import { nodeKey, nodes, ensureNodeRaw, addEdgeRaw, removeEdge, bumpGraphVersion } from './graph.ts';
import { removeCarsForEdge } from './cars.ts';
import { zoom } from './camera.ts';

export interface Highway {
  id: number;
  startGx: number; startGy: number;
  endGx: number; endGy: number;
  // User-adjustable midpoint (pixel coords) — the curve passes through this point at t=0.5
  midX: number; midY: number;
  // Cubic bezier control points (pixel coords) for rendering — derived from midpoint
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

export function setHighwayPhase(phase: 'idle' | 'pickEnd') { highwayPhase = phase; }
export function setHighwayStart(gx: number, gy: number) { highwayStartGx = gx; highwayStartGy = gy; }
export function setHighwayPreviewEnd(px: number, py: number) { highwayPreviewEndPx = px; highwayPreviewEndPy = py; }
export function setDraggingHighwayId(id: number) { draggingHighwayId = id; }

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

// Compute default midpoint: chord center + small perpendicular offset
function defaultMidpoint(p0x: number, p0y: number, p3x: number, p3y: number) {
  const dx = p3x - p0x, dy = p3y - p0y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return { midX: p0x, midY: p0y };
  const perpX = -dy / dist, perpY = dx / dist;
  const offset = dist * 0.08; // subtle default curve
  return {
    midX: (p0x + p3x) / 2 + perpX * offset,
    midY: (p0y + p3y) / 2 + perpY * offset,
  };
}

// Compute bezier control points so the curve passes through midpoint at t=0.5
// Math: B(0.5) = (P0 + 3P1 + 3P2 + P3)/8 = M
// With P1 = P0 + (P3-P0)/3 + offset, P2 = P0 + 2(P3-P0)/3 + offset
// Solving: offset = (4/3) * (M - (P0+P3)/2)
export function computeBezierFromMid(p0x: number, p0y: number, p3x: number, p3y: number, midX: number, midY: number) {
  const chordMidX = (p0x + p3x) / 2;
  const chordMidY = (p0y + p3y) / 2;
  const offX = (4 / 3) * (midX - chordMidX);
  const offY = (4 / 3) * (midY - chordMidY);
  const dx = p3x - p0x, dy = p3y - p0y;
  return {
    p1x: p0x + dx / 3 + offX,
    p1y: p0y + dy / 3 + offY,
    p2x: p0x + dx * 2 / 3 + offX,
    p2y: p0y + dy * 2 / 3 + offY,
  };
}

// Legacy export for preview (uses default midpoint)
export function computeBezierControls(p0x: number, p0y: number, p3x: number, p3y: number) {
  const { midX, midY } = defaultMidpoint(p0x, p0y, p3x, p3y);
  return computeBezierFromMid(p0x, p0y, p3x, p3y, midX, midY);
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
                               savedMidX?: number, savedMidY?: number): Highway | null {
  const p0x = startGx * GRID + HALF;
  const p0y = startGy * GRID + HALF;
  const p3x = endGx * GRID + HALF;
  const p3y = endGy * GRID + HALF;

  const mid = (savedMidX !== undefined && savedMidY !== undefined)
    ? { midX: savedMidX, midY: savedMidY }
    : defaultMidpoint(p0x, p0y, p3x, p3y);

  const { p1x, p1y, p2x, p2y } = computeBezierFromMid(p0x, p0y, p3x, p3y, mid.midX, mid.midY);

  const id = nextHighwayId++;
  const highway: Highway = {
    id, startGx, startGy, endGx, endGy,
    midX: mid.midX, midY: mid.midY,
    p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y,
    nodeKeys: [], edgeIds: [],
  };

  highways.push(highway);
  buildEdges(highway);
  bumpGraphVersion();
  return highway;
}

// Update the midpoint visually (during drag) — only updates bezier, NOT the graph edges
export function updateHighwayMid(hw: Highway, midX: number, midY: number) {
  hw.midX = midX;
  hw.midY = midY;
  const { p1x, p1y, p2x, p2y } = computeBezierFromMid(hw.p0x, hw.p0y, hw.p3x, hw.p3y, midX, midY);
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

// Find a highway handle (midpoint) near a pixel position
// Use a screen-space hit radius so the handle stays easy to hit at any zoom level
const HANDLE_SCREEN_RADIUS = 22; // screen pixels — comfortable for both mouse and touch
export function findHighwayHandleAtPixel(px: number, py: number): Highway | null {
  const hitRadius = HANDLE_SCREEN_RADIUS / zoom; // convert to world coords
  for (const hw of highways) {
    if (Math.hypot(px - hw.midX, py - hw.midY) <= hitRadius) return hw;
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
}

import { GRID, HALF, TUNNEL_ROAD_W } from './constants.ts';
import { nodeKey, nodes, ensureNodeRaw, addEdgeRaw, removeEdge, bumpGraphVersion } from './graph.ts';
import { removeCarsForEdge } from './cars.ts';

export interface Tunnel {
  id: number;
  startGx: number; startGy: number;
  endGx: number; endGy: number;
  nodeKeys: string[];
  edgeIds: string[];
}

export const tunnels: Tunnel[] = [];
export const tunnelEdgeSet: Set<string> = new Set();
let nextTunnelId = 0;

// Placement state (two-click, like highways)
export let tunnelPhase: 'idle' | 'pickEnd' = 'idle';
export let tunnelStartGx = 0;
export let tunnelStartGy = 0;
export let tunnelPreviewEndPx = 0;
export let tunnelPreviewEndPy = 0;

export function setTunnelPhase(phase: 'idle' | 'pickEnd') { tunnelPhase = phase; }
export function setTunnelStart(gx: number, gy: number) { tunnelStartGx = gx; tunnelStartGy = gy; }
export function setTunnelPreviewEnd(px: number, py: number) { tunnelPreviewEndPx = px; tunnelPreviewEndPy = py; }

function buildEdges(tn: Tunnel) {
  const startPx = tn.startGx * GRID + HALF;
  const startPy = tn.startGy * GRID + HALF;
  const endPx = tn.endGx * GRID + HALF;
  const endPy = tn.endGy * GRID + HALF;

  const dist = Math.hypot(endPx - startPx, endPy - startPy);
  const N = Math.max(2, Math.ceil(dist / GRID));

  const startKey = nodeKey(tn.startGx, tn.startGy);
  const endKey = nodeKey(tn.endGx, tn.endGy);

  const nKeys: string[] = [startKey];
  for (let i = 1; i < N; i++) {
    nKeys.push(`tn${tn.id}_${i}`);
  }
  nKeys.push(endKey);

  // Create intermediate nodes along straight line
  for (let i = 1; i < N; i++) {
    const t = i / N;
    const px = startPx + (endPx - startPx) * t;
    const py = startPy + (endPy - startPy) * t;
    ensureNodeRaw(nKeys[i], Math.round(px / GRID), Math.round(py / GRID));
  }

  // Create edges
  const edgeIds: string[] = [];
  for (let i = 0; i < nKeys.length - 1; i++) {
    const t0 = i / N;
    const t1 = (i + 1) / N;
    const fx = startPx + (endPx - startPx) * t0;
    const fy = startPy + (endPy - startPy) * t0;
    const tx = startPx + (endPx - startPx) * t1;
    const ty = startPy + (endPy - startPy) * t1;
    const edge = addEdgeRaw(nKeys[i], nKeys[i + 1], fx, fy, tx, ty);
    if (edge) {
      edge.tunnel = true;
      edgeIds.push(edge.id);
      tunnelEdgeSet.add(edge.id);
    }
  }

  tn.nodeKeys = nKeys;
  tn.edgeIds = edgeIds;
}

function clearEdges(tn: Tunnel) {
  for (const eid of tn.edgeIds) {
    removeCarsForEdge(eid);
    tunnelEdgeSet.delete(eid);
    removeEdge(eid);
  }
  // Remove intermediate nodes (not start/end which are surface nodes)
  for (let i = 1; i < tn.nodeKeys.length - 1; i++) {
    const key = tn.nodeKeys[i];
    const node = nodes.get(key);
    if (node && node.edges.size === 0) nodes.delete(key);
  }
  tn.nodeKeys = [];
  tn.edgeIds = [];
}

export function createTunnel(startGx: number, startGy: number, endGx: number, endGy: number): Tunnel | null {
  const id = nextTunnelId++;
  const tunnel: Tunnel = {
    id, startGx, startGy, endGx, endGy,
    nodeKeys: [], edgeIds: [],
  };

  tunnels.push(tunnel);
  buildEdges(tunnel);
  bumpGraphVersion();
  return tunnel;
}

export function removeTunnel(id: number) {
  const idx = tunnels.findIndex(t => t.id === id);
  if (idx === -1) return;
  clearEdges(tunnels[idx]);
  tunnels.splice(idx, 1);
  bumpGraphVersion();
}

export function findTunnelAtPixel(px: number, py: number): Tunnel | null {
  const threshold = TUNNEL_ROAD_W / 2 + 4;
  for (const tn of tunnels) {
    const sx = tn.startGx * GRID + HALF;
    const sy = tn.startGy * GRID + HALF;
    const ex = tn.endGx * GRID + HALF;
    const ey = tn.endGy * GRID + HALF;
    // Point-to-line-segment distance
    const dx = ex - sx, dy = ey - sy;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      if (Math.hypot(px - sx, py - sy) <= threshold) return tn;
      continue;
    }
    const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / lenSq));
    const projX = sx + t * dx;
    const projY = sy + t * dy;
    if (Math.hypot(px - projX, py - projY) <= threshold) return tn;
  }
  return null;
}

// Find tunnel by entrance/exit node (for demolish by clicking entrance marker)
export function findTunnelByNode(gx: number, gy: number): Tunnel | null {
  for (const tn of tunnels) {
    if ((tn.startGx === gx && tn.startGy === gy) || (tn.endGx === gx && tn.endGy === gy)) {
      return tn;
    }
  }
  return null;
}

export function resetTunnels() {
  tunnels.length = 0;
  tunnelEdgeSet.clear();
  nextTunnelId = 0;
  tunnelPhase = 'idle';
}

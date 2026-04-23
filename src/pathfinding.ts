import { nodes, getNeighbors, getEdgeBetween } from './graph.ts';
import { Edge } from './types.ts';
import { cars, getNarrowChainPressure } from './cars.ts';
import { highwayEdgeSet } from './highway.ts';
import { tunnelEdgeSet } from './tunnel.ts';
import { TUNNEL_COST_FACTOR } from './constants.ts';

// Deterministic ≤1% per-edge jitter to split traffic across parallel equal-cost paths.
const edgeJitterCache = new Map<string, number>();
function edgeJitter(id: string): number {
  const cached = edgeJitterCache.get(id);
  if (cached !== undefined) return cached;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h * 31) + id.charCodeAt(i)) | 0;
  const j = 1 + (Math.abs(h) % 100) / 10000; // 1.0000..1.0099
  edgeJitterCache.set(id, j);
  return j;
}

// Precomputed congestion map — rebuilt once per frame at most
let congestionMap: Map<string, number> | null = null;
let congestionFrame = -1;
let frameCounter = 0;

export function tickPathfindingFrame() {
  frameCounter++;
}

// Congestion entry: total weighted car count on this edge
function getCongestionMap(): Map<string, number> {
  if (congestionMap && congestionFrame === frameCounter) return congestionMap;
  congestionMap = new Map();
  for (const c of cars) {
    if (c.state === 'toWork' || c.state === 'toHome') {
      // Stopped/slow cars are much worse than flowing traffic
      const weight = c.speed <= 0.1 ? 2 : 1;
      congestionMap.set(c.edgeId, (congestionMap.get(c.edgeId) ?? 0) + weight);
    }
  }
  congestionFrame = frameCounter;
  return congestionMap;
}

// Single source of truth for edge weight — used by both Dijkstra and path-cost checks
function edgeWeight(fromKey: string, edge: Edge, cong: Map<string, number>): number {
  const congestion = cong.get(edge.id) ?? 0;
  const density = congestion / (edge.length / 40);
  const penalty = density > 0 ? Math.pow(1.8, density) - 1 : 0;
  const highwayFactor = highwayEdgeSet.has(edge.id) ? 0.65 : 1.0;
  const tunnelFactor = tunnelEdgeSet.has(edge.id) ? TUNNEL_COST_FACTOR : 1.0;
  let narrowFactor = 1.0;
  if (edge.narrow) {
    const pressure = getNarrowChainPressure(edge.id, fromKey);
    if (pressure === 'blocked') narrowFactor = 2.5;
    else if (pressure === 'stopped') narrowFactor = 1.8;
    else if (pressure === 'occupied') narrowFactor = 1.3;
    else narrowFactor = 1.15;
  }
  return edge.length * highwayFactor * tunnelFactor * narrowFactor * edgeJitter(edge.id) * (1 + penalty);
}

// Compute total weighted cost of an existing path (for stale-path comparison).
// Returns Infinity if the path is broken.
export function pathCost(path: string[]): number {
  if (path.length < 2) return 0;
  const cong = getCongestionMap();
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const edge = getEdgeBetween(path[i], path[i + 1]);
    if (!edge) return Infinity;
    total += edgeWeight(path[i], edge, cong);
  }
  return total;
}

// findPath that also returns the best-path cost — avoids a second pass.
export function findPathWithCost(startKey: string, endKey: string): { path: string[]; cost: number } | null {
  const path = findPath(startKey, endKey);
  if (!path) return null;
  return { path, cost: pathCost(path) };
}

// Weighted Dijkstra with precomputed congestion
export function findPath(startKey: string, endKey: string): string[] | null {
  if (startKey === endKey) return [startKey];
  if (!nodes.has(startKey) || !nodes.has(endKey)) return null;

  const cong = getCongestionMap();
  const dist = new Map<string, number>();
  const cameFrom = new Map<string, string | null>();

  // Binary min-heap
  const heap: { key: string; cost: number }[] = [];

  function heapPush(item: { key: string; cost: number }) {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].cost <= heap[i].cost) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  }

  function heapPop(): { key: string; cost: number } {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < heap.length && heap[l].cost < heap[smallest].cost) smallest = l;
        if (r < heap.length && heap[r].cost < heap[smallest].cost) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  }

  dist.set(startKey, 0);
  cameFrom.set(startKey, null);
  heapPush({ key: startKey, cost: 0 });

  while (heap.length > 0) {
    const current = heapPop();

    if (current.key === endKey) {
      const path: string[] = [];
      let node: string | null = endKey;
      while (node !== null) {
        path.push(node);
        node = cameFrom.get(node) ?? null;
      }
      return path.reverse();
    }

    const currentDist = dist.get(current.key)!;
    if (current.cost > currentDist) continue;

    for (const neighbor of getNeighbors(current.key)) {
      const edge = getEdgeBetween(current.key, neighbor);
      if (!edge) continue;

      const weight = edgeWeight(current.key, edge, cong);
      const newDist = currentDist + weight;
      const oldDist = dist.get(neighbor);
      if (oldDist === undefined || newDist < oldDist) {
        dist.set(neighbor, newDist);
        cameFrom.set(neighbor, current.key);
        heapPush({ key: neighbor, cost: newDist });
      }
    }
  }

  return null;
}

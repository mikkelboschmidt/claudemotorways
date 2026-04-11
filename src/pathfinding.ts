import { nodes, edges, getNeighbors, getEdgeBetween } from './graph.ts';
import { cars } from './cars.ts';
import { highwayEdgeSet } from './highway.ts';
import { tunnelEdgeSet } from './tunnel.ts';
import { TUNNEL_COST_FACTOR } from './constants.ts';

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

      const congestion = cong.get(edge.id) ?? 0;
      // Density-based: cars per unit length. Short edges congest faster.
      // Exponential penalty makes heavily congested edges dramatically more expensive,
      // pushing pathfinding toward longer but clear alternative routes.
      const density = congestion / (edge.length / 40); // normalize to ~1 tile = 40px
      const penalty = density > 0 ? Math.pow(1.8, density) - 1 : 0;
      // Highways are faster (1.5x speed), so their effective time-cost is lower
      const highwayFactor = highwayEdgeSet.has(edge.id) ? 0.65 : 1.0;
      const tunnelFactor = tunnelEdgeSet.has(edge.id) ? TUNNEL_COST_FACTOR : 1.0;
      const weight = edge.length * highwayFactor * tunnelFactor * (1 + penalty);

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

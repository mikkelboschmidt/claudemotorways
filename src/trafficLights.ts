import { TrafficLight, Car } from './types.ts';
import { nodeKey, nodes, edges, parseKey } from './graph.ts';
import { GRID, HALF } from './constants.ts';
import { cars } from './cars.ts';
import { CORNER_BRAKE_DIST, CAR_LEN } from './constants.ts';

export const trafficLights: TrafficLight[] = [];
export const trafficLightByNode = new Map<string, TrafficLight>();

let nextId = 1;

export const TRAFFIC_LIGHT_INTERVAL = 360; // frames per phase (~6s at 60fps)
const MIN_GREEN_TIME = 120; // minimum frames before allowing a switch (~2s)
const AMBER_DURATION = 135; // frames for amber phase (~2.25s at 60fps)

/** Check if ALL edges at a node are diagonal (dx !== 0 && dy !== 0) */
function computeDiagonal(key: string): boolean {
  const node = nodes.get(key);
  if (!node) return false;
  for (const eid of node.edges) {
    const edge = edges.get(eid);
    if (!edge) continue;
    const otherKey = edge.fromKey === key ? edge.toKey : edge.fromKey;
    const [gx1, gy1] = parseKey(key);
    const [gx2, gy2] = parseKey(otherKey);
    const dx = gx2 - gx1;
    const dy = gy2 - gy1;
    if (dx === 0 || dy === 0) return false;
  }
  return true;
}

/** Classify which axis an edge belongs to relative to a traffic light node */
function edgeAxis(edgeId: string, tlNodeKey: string, diagonal: boolean): 'ns' | 'ew' {
  const edge = edges.get(edgeId);
  if (!edge) return 'ns';
  const otherKey = edge.fromKey === tlNodeKey ? edge.toKey : edge.fromKey;
  const [fromGx, fromGy] = parseKey(otherKey);
  const [toGx, toGy] = parseKey(tlNodeKey);
  const dx = toGx - fromGx;
  const dy = toGy - fromGy;

  if (diagonal) {
    const isNESW = (dx > 0 && dy < 0) || (dx < 0 && dy > 0);
    return isNESW ? 'ns' : 'ew';
  } else {
    return Math.abs(dy) >= Math.abs(dx) ? 'ns' : 'ew';
  }
}

/** Check if any car is waiting (slow/stopped) on the blocked axis */
function hasWaitingCarsOnAxis(tl: TrafficLight, axis: 'ns' | 'ew'): boolean {
  const node = nodes.get(tl.nodeKey);
  if (!node) return false;

  const range = CORNER_BRAKE_DIST + CAR_LEN;

  for (const car of cars) {
    if (car.state !== 'toWork' && car.state !== 'toHome' && car.state !== 'toStorage' && car.state !== 'toFactory') continue;
    const edge = edges.get(car.edgeId);
    if (!edge) continue;

    // Check if this car is approaching the traffic light node
    const endNodeKey = car.edgeDir === 1 ? edge.toKey : edge.fromKey;
    if (endNodeKey !== tl.nodeKey) continue;

    const distToEnd = car.edgeDir === 1 ? (1 - car.t) * edge.length : car.t * edge.length;
    if (distToEnd > range) continue;

    // Check if this edge is on the given axis
    if (edgeAxis(car.edgeId, tl.nodeKey, tl.diagonal) === axis) {
      return true;
    }
  }
  return false;
}

export function createTrafficLight(gx: number, gy: number): boolean {
  const key = nodeKey(gx, gy);
  const node = nodes.get(key);
  if (!node || node.edges.size < 3) return false;
  if (trafficLightByNode.has(key)) return false;

  const tl: TrafficLight = {
    id: nextId++,
    gx,
    gy,
    nodeKey: key,
    greenAxis: 'ns',
    phase: 'green',
    timer: TRAFFIC_LIGHT_INTERVAL,
    interval: TRAFFIC_LIGHT_INTERVAL,
    diagonal: computeDiagonal(key),
  };
  trafficLights.push(tl);
  trafficLightByNode.set(key, tl);
  return true;
}

export function removeTrafficLight(id: number): boolean {
  const idx = trafficLights.findIndex(tl => tl.id === id);
  if (idx < 0) return false;
  const tl = trafficLights[idx];
  trafficLightByNode.delete(tl.nodeKey);
  trafficLights.splice(idx, 1);
  return true;
}

export function findTrafficLightAtTile(gx: number, gy: number): TrafficLight | null {
  return trafficLightByNode.get(nodeKey(gx, gy)) ?? null;
}

export function updateTrafficLights() {
  for (let i = trafficLights.length - 1; i >= 0; i--) {
    const tl = trafficLights[i];
    const node = nodes.get(tl.nodeKey);
    if (!node || node.edges.size < 3) {
      trafficLightByNode.delete(tl.nodeKey);
      trafficLights.splice(i, 1);
      continue;
    }

    tl.diagonal = computeDiagonal(tl.nodeKey);

    tl.timer--;
    if (tl.phase === 'green') {
      if (tl.timer <= 0) {
        // Green expired — switch on demand OR after holding for a full extra interval
        const blockedAxis = tl.greenAxis === 'ns' ? 'ew' : 'ns';
        if (hasWaitingCarsOnAxis(tl, blockedAxis) || tl.timer <= -tl.interval) {
          tl.phase = 'amber';
          tl.timer = AMBER_DURATION;
        }
        // timer keeps decrementing as a hold-duration counter — no reset to 0
      }
    } else {
      // Amber phase — wait out the duration, then flip the axis to green
      if (tl.timer <= 0) {
        tl.greenAxis = tl.greenAxis === 'ns' ? 'ew' : 'ns';
        tl.phase = 'green';
        tl.timer = tl.interval;
      }
    }
  }
}

/**
 * Check if an edge approaching a node with a traffic light has a red signal.
 * Returns true if the car should stop (red light — not the transitioning axis).
 */
export function isRedLight(edgeId: string, approachNodeKey: string): boolean {
  const tl = trafficLightByNode.get(approachNodeKey);
  if (!tl) return false;
  const axis = edgeAxis(edgeId, approachNodeKey, tl.diagonal);
  return tl.greenAxis !== axis; // the non-green axis is always red
}

/**
 * Check if an edge approaching a node with a traffic light has an amber signal.
 * Returns true for the axis that was green but is now transitioning out.
 * Amber cars should brake and stop but committed cars (very close) may glide through.
 */
export function isAmberLight(edgeId: string, approachNodeKey: string): boolean {
  const tl = trafficLightByNode.get(approachNodeKey);
  if (!tl || tl.phase !== 'amber') return false;
  const axis = edgeAxis(edgeId, approachNodeKey, tl.diagonal);
  return tl.greenAxis === axis; // the previously-green axis is now amber
}

export function resetTrafficLights() {
  trafficLights.length = 0;
  trafficLightByNode.clear();
  nextId = 1;
}

export function setNextTrafficLightId(id: number) {
  nextId = id;
}

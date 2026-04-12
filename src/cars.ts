import { Car } from './types.ts';
import { CAR_SPEED, CAR_ACCEL, CAR_DECEL, CAR_LEN, CAR_WID, MIN_GAP, LANE_W, SPAWN_INTERVAL, MAX_CARS_PER_HOUSE, PARK_DURATION, PARK_ANIM_SPEED, TURN_LERP, CORNER_BRAKE_DIST, CORNER_MIN_SPEED, CORNER_MED_SPEED, HIGHWAY_SPEED, TRUCK_SPEED, TRUCK_CAPACITY, MAX_TRUCKS_PER_STORAGE, TRUCK_SPAWN_INTERVAL, FACTORY_MAX_PINS, UTURN_STUCK_THRESHOLD, UTURN_COOLDOWN } from './constants.ts';
import { edges, getEdgeBetween, graphVersion, nodes } from './graph.ts';
import { isRedLight, isAmberLight, trafficLightByNode } from './trafficLights.ts';
import { buildings, buildingById, getBuildingCenter, getBuildingPixelPos, getConnectionPixelPos, getPinPixelPos } from './buildings.ts';
import { findPath } from './pathfinding.ts';
import { addScore } from './score.ts';
import { getHighwayPose, highwayEdgeSet } from './highway.ts';
import { roundaboutEdgeSet } from './roundabout.ts';
import { tunnelEdgeSet } from './tunnel.ts';

const NARROW_SPEED = CAR_SPEED * 0.7; // slower on narrow single-lane roads

function getBaseSpeed(edgeId: string, isTruck = false): number {
  const base = isTruck ? TRUCK_SPEED : CAR_SPEED;
  if (highwayEdgeSet.has(edgeId)) return isTruck ? TRUCK_SPEED * 1.3 : HIGHWAY_SPEED;
  const edge = edges.get(edgeId);
  if (edge && edge.narrow) return base * 0.7;
  return base;
}

// Helper: is this car in a driving state (on the road, not parked/parking)?
function isDriving(state: Car['state']): boolean {
  return state === 'toWork' || state === 'toHome' || state === 'toFactory' || state === 'toStorage';
}

// What building is the car arriving at?
function getArrivalTarget(car: Car, state: Car['state']): number {
  if (state === 'toWork' || state === 'toFactory') return car.workBuildingId;
  if (state === 'toStorage') return car.storageBuildingId;
  return car.homeBuildingId; // toHome
}

// What state should the car transition to after parking?
function getNextState(car: Car, prevState: Car['state']): Car['nextState'] {
  if (car.isTruck) {
    return prevState === 'toFactory' ? 'toStorage' : 'toFactory';
  }
  if (prevState === 'toWork') return 'toHome';
  return 'toWork'; // toHome → toWork
}

export const cars: Car[] = [];
let nextCarId = 0;
let spawnTimer = 0;
let lastGraphVersion = -1;
let frameCount = 0;

type BuildingCarIndex = Map<number, Set<Car>>;

export function resetSpawnTimer() {
  spawnTimer = SPAWN_INTERVAL - 30;
}

export function removeCarsForEdge(edgeId: string) {
  for (let i = cars.length - 1; i >= 0; i--) {
    if (cars[i].edgeId === edgeId && isDriving(cars[i].state)) {
      cars.splice(i, 1);
    }
  }
}

export function removeCarsForBuilding(buildingId: number) {
  for (let i = cars.length - 1; i >= 0; i--) {
    const c = cars[i];
    if (c.homeBuildingId === buildingId || c.workBuildingId === buildingId || c.storageBuildingId === buildingId) {
      cars.splice(i, 1);
    }
  }
}

// When a factory is disabled, parked/parking cars depart home immediately.
// Cars driving toWork are left alone — they'll handle it on arrival.
export function evictCarsFromFactory(factoryId: number) {
  for (const car of cars) {
    if (car.workBuildingId !== factoryId) continue;
    const evictState = car.isTruck ? 'toStorage' as const : 'toHome' as const;
    if (car.state === 'parked' || car.state === 'collecting') {
      car.state = 'departing';
      car.parkProgress = 0;
      car.nextState = evictState;
      setupDepartPath(car);
    } else if (car.state === 'parking') {
      car.parkProgress = 1;
      car.state = 'parked';
      car.parkedAt = 0;
      car.x = car.parkTargetX;
      car.y = car.parkTargetY;
      car.nextState = evictState;
    }
  }
}

// Shortest angle difference, handles wrapping
function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function lerpAngle(current: number, target: number, t: number): number {
  return current + angleDiff(current, target) * t;
}

// Get the building ID a car is currently parked/parking at
function getParkedBuildingId(c: Car): number {
  if (c.isTruck && c.nextState === 'toFactory') {
    return c.storageBuildingId;  // truck at storage, heading to factory next
  }
  if (c.isTruck && c.nextState === 'toStorage') {
    return c.workBuildingId;     // truck at factory, heading to storage next
  }
  if (c.nextState === 'toWork') {
    return c.homeBuildingId;     // car at home (house)
  }
  return c.workBuildingId;       // car at factory/storage (nextState=toHome)
}

function isBuildingOccupantState(state: Car['state']): boolean {
  return state === 'parking' || state === 'parked' || state === 'collecting' || state === 'departing';
}

function getBuildingCarSet(index: BuildingCarIndex, buildingId: number): Set<Car> {
  let set = index.get(buildingId);
  if (!set) {
    set = new Set<Car>();
    index.set(buildingId, set);
  }
  return set;
}

function buildBuildingCarIndex(): BuildingCarIndex {
  const index: BuildingCarIndex = new Map();
  for (const car of cars) {
    if (!isBuildingOccupantState(car.state)) continue;
    getBuildingCarSet(index, getParkedBuildingId(car)).add(car);
  }
  return index;
}

function addBuildingOccupant(index: BuildingCarIndex | undefined, car: Car) {
  if (!index || !isBuildingOccupantState(car.state)) return;
  getBuildingCarSet(index, getParkedBuildingId(car)).add(car);
}

function removeBuildingOccupant(index: BuildingCarIndex | undefined, car: Car) {
  if (!index || !isBuildingOccupantState(car.state)) return;
  const set = index.get(getParkedBuildingId(car));
  if (!set) return;
  set.delete(car);
  if (set.size === 0) index.delete(getParkedBuildingId(car));
}

function countParkedCars(buildingCars: Set<Car> | undefined): number {
  return buildingCars?.size ?? 0;
}

function hasAnimatingCar(buildingCars: Set<Car> | undefined, includeTrucks = true): boolean {
  if (!buildingCars) return false;
  for (const car of buildingCars) {
    if (!includeTrucks && car.isTruck) continue;
    if (car.state === 'parking' || car.state === 'collecting' || car.state === 'departing') return true;
  }
  return false;
}

function hasTruckInside(buildingCars: Set<Car> | undefined, exclude?: Car): boolean {
  if (!buildingCars) return false;
  for (const car of buildingCars) {
    if (car === exclude) continue;
    if (car.isTruck) return true;
  }
  return false;
}

function hasAnyOccupant(buildingCars: Set<Car> | undefined, exclude?: Car): boolean {
  if (!buildingCars) return false;
  for (const car of buildingCars) {
    if (car !== exclude) return true;
  }
  return false;
}

function getFactoryParkSlot(buildingCars: Set<Car> | undefined, buildingId: number, car: Car): number {
  // Find the farthest available slot. Slot 0 = nearest entrance, higher = deeper.
  const b = buildingById.get(buildingId);
  const maxSlots = b ? b.maxParkedCars : 3;
  const takenSlots = new Set<number>();
  if (buildingCars) for (const c of buildingCars) {
    if (c === car) continue;
    takenSlots.add(c.parkSlot);
  }
  // Pick the deepest (highest index) available slot
  for (let s = maxSlots - 1; s >= 0; s--) {
    if (!takenSlots.has(s)) return s;
  }
  return 0;
}

// FIFO: the car that parked earliest gets to depart first.
// Also block if another car is currently parking or departing (avoid collisions).
function canDepartBuilding(buildingCars: Set<Car> | undefined, car: Car): boolean {
  if (!buildingCars) return true;
  for (const c of buildingCars) {
    if (c === car) continue;
    // Block if any car is mid-animation in this building
    if (c.state === 'parking' || c.state === 'collecting' || c.state === 'departing') return false;
    // Block if another parked car arrived earlier (FIFO)
    if (c.state === 'parked' && c.parkedAt < car.parkedAt) return false;
  }
  return true;
}

// Returns cubic bezier control points for factory parking path.
// Layout: a driving lane runs along one side of the factory, parking spots on the opposite side.
// Cars drive into the lane, travel along it, then pull into their spot.
function getFactoryParkPath(buildingCars: Set<Car> | undefined, buildingId: number, car: Car): {
  p0x: number; p0y: number; // start (road)
  p1x: number; p1y: number; // control 1 (into lane)
  p2x: number; p2y: number; // control 2 (above/beside spot)
  p3x: number; p3y: number; // end (parked)
  endAngle: number;
  slot: number;
} {
  const b = buildingById.get(buildingId)!;
  const pos = getBuildingPixelPos(b);
  const slot = getFactoryParkSlot(buildingCars, buildingId, car);
  const spotSpacing = CAR_WID + 8;
  const margin = 6;

  const p0x = car.x;
  const p0y = car.y;
  let p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number, endAngle: number;

  // Slot 0 = nearest entrance, higher slot = deeper inside.
  // Control points create a gentle arc from the road into the parking spot.
  // P1 guides the car inward, P2 eases it into the final spot direction.
  switch (b.connectionSide) {
    case 'left': {
      const spotY = pos.y + pos.h - margin - CAR_LEN / 2;
      const spotX = pos.x + margin + CAR_WID / 2 + slot * spotSpacing;
      const midY = (p0y + spotY) / 2;
      p1x = spotX * 0.4 + p0x * 0.6;
      p1y = midY;
      p2x = spotX;
      p2y = midY;
      p3x = spotX;
      p3y = spotY;
      endAngle = Math.PI / 2;
      break;
    }
    case 'right': {
      const spotY = pos.y + pos.h - margin - CAR_LEN / 2;
      const spotX = pos.x + pos.w - margin - CAR_WID / 2 - slot * spotSpacing;
      const midY = (p0y + spotY) / 2;
      p1x = spotX * 0.4 + p0x * 0.6;
      p1y = midY;
      p2x = spotX;
      p2y = midY;
      p3x = spotX;
      p3y = spotY;
      endAngle = Math.PI / 2;
      break;
    }
    case 'top': {
      const spotX = pos.x + pos.w - margin - CAR_LEN / 2;
      const spotY = pos.y + margin + CAR_WID / 2 + slot * spotSpacing;
      const midX = (p0x + spotX) / 2;
      p1x = midX;
      p1y = spotY * 0.4 + p0y * 0.6;
      p2x = midX;
      p2y = spotY;
      p3x = spotX;
      p3y = spotY;
      endAngle = 0;
      break;
    }
    case 'bottom': {
      const spotX = pos.x + pos.w - margin - CAR_LEN / 2;
      const spotY = pos.y + pos.h - margin - CAR_WID / 2 - slot * spotSpacing;
      const midX = (p0x + spotX) / 2;
      p1x = midX;
      p1y = spotY * 0.4 + p0y * 0.6;
      p2x = midX;
      p2y = spotY;
      p3x = spotX;
      p3y = spotY;
      endAngle = 0;
      break;
    }
  }

  return { p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, endAngle, slot };
}

// House parking: enter on the right lane, park inside, exit on the right lane (other side).
// Returns cubic bezier for entry path. Departure reverses it with lane offset swap.
function getHouseParkPath(buildingId: number, car: Car): {
  p0x: number; p0y: number;
  p1x: number; p1y: number;
  p2x: number; p2y: number;
  p3x: number; p3y: number;
  endAngle: number;
} {
  const b = buildingById.get(buildingId)!;
  const center = getBuildingCenter(b);
  const laneOff = LANE_W / 2;

  // p0 = car's current position (already on the right lane)
  const p0x = car.x, p0y = car.y;

  // Park target inside the building, offset to the entry lane side
  // Exit point will be on the opposite lane side
  let p3x: number, p3y: number, endAngle: number;

  // Lane offset formula: offsetX = -tdy * laneOff, offsetY = tdx * laneOff
  // Heading LEFT  (tdx=-1, tdy=0): offsetY = -laneOff → top lane (y - off)
  // Heading RIGHT (tdx=+1, tdy=0): offsetY = +laneOff → bottom lane (y + off)
  // Heading DOWN  (tdx=0, tdy=+1): offsetX = -laneOff → left lane (x - off)
  // Heading UP    (tdx=0, tdy=-1): offsetX = +laneOff → right lane (x + off)
  switch (b.connectionSide) {
    case 'right':
      // Car enters heading left → right lane = y - laneOff
      p3x = center.x;
      p3y = center.y - laneOff;
      endAngle = Math.PI;
      break;
    case 'left':
      // Car enters heading right → right lane = y + laneOff
      p3x = center.x;
      p3y = center.y + laneOff;
      endAngle = 0;
      break;
    case 'top':
      // Car enters heading down → right lane = x - laneOff
      p3x = center.x - laneOff;
      p3y = center.y;
      endAngle = Math.PI / 2;
      break;
    case 'bottom':
      // Car enters heading up → right lane = x + laneOff
      p3x = center.x + laneOff;
      p3y = center.y;
      endAngle = -Math.PI / 2;
      break;
  }

  // Simple cubic bezier: straight-ish pull into the building
  const p1x = (p0x * 2 + p3x) / 3;
  const p1y = (p0y * 2 + p3y) / 3;
  const p2x = (p0x + p3x * 2) / 3;
  const p2y = (p0y + p3y * 2) / 3;

  return { p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, endAngle };
}

// Compute factory exit bezier: from parked spot to the right lane of the outgoing direction.
// The car leaves the factory on the opposite lane from where it entered.
function getFactoryExitPath(buildingId: number, car: Car): {
  p0x: number; p0y: number;
  p1x: number; p1y: number;
  p2x: number; p2y: number;
  p3x: number; p3y: number;
} {
  const b = buildingById.get(buildingId)!;
  const conn = getConnectionPixelPos(b);
  const laneOff = LANE_W / 2;

  // P0 = current parked position
  const p0x = car.x;
  const p0y = car.y;

  // P3 = exit point on the right lane for the outgoing direction
  // Factory entrance is on connectionSide, so car exits heading AWAY from building
  let p3x: number, p3y: number;
  switch (b.connectionSide) {
    case 'left':
      // Entered heading right, exits heading LEFT → right lane = y - laneOff
      p3x = conn.x; p3y = conn.y - laneOff;
      break;
    case 'right':
      // Entered heading left, exits heading RIGHT → right lane = y + laneOff
      p3x = conn.x; p3y = conn.y + laneOff;
      break;
    case 'top':
      // Entered heading down, exits heading UP → right lane = x + laneOff
      p3x = conn.x + laneOff; p3y = conn.y;
      break;
    case 'bottom':
      // Entered heading up, exits heading DOWN → right lane = x - laneOff
      p3x = conn.x - laneOff; p3y = conn.y;
      break;
  }

  // Gentle bezier: P1 eases out of the parking spot, P2 aligns toward exit
  const p1x = (p0x * 2 + p3x) / 3;
  const p1y = (p0y * 2 + p3y) / 3;
  const p2x = (p0x + p3x * 2) / 3;
  const p2y = (p0y + p3y * 2) / 3;

  return { p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y };
}

// For house departure: compute the exit point on the opposite lane
function getHouseExitPoint(buildingId: number): { x: number; y: number } {
  const b = buildingById.get(buildingId)!;
  const conn = getConnectionPixelPos(b);
  const laneOff = LANE_W / 2;

  // Exit direction is opposite to entry: car leaves the building heading away
  // right conn → exits heading RIGHT → right lane = y + laneOff
  // left conn  → exits heading LEFT  → right lane = y - laneOff
  // top conn   → exits heading UP    → right lane = x + laneOff
  // bottom conn→ exits heading DOWN  → right lane = x - laneOff
  switch (b.connectionSide) {
    case 'right':  return { x: conn.x, y: conn.y + laneOff };
    case 'left':   return { x: conn.x, y: conn.y - laneOff };
    case 'top':    return { x: conn.x + laneOff, y: conn.y };
    case 'bottom': return { x: conn.x - laneOff, y: conn.y };
  }
}

// How much a factory needs a car: pins waiting + future pins minus cars already heading there / inside
function factoryNeed(factory: typeof buildings[0]): number {
  let carsAssigned = 0;
  for (const c of cars) {
    if (c.workBuildingId === factory.id && (c.state === 'toWork' || c.state === 'parking' || c.state === 'parked' || c.state === 'collecting')) {
      carsAssigned++;
    }
  }
  // Need = pins available to pick up minus cars that will pick them up, plus a base desire
  // so empty factories still attract some cars
  return factory.pins - carsAssigned + 1;
}

function pickBestFactory(fromNodeKey: string, factories: typeof buildings): { factory: typeof buildings[0]; path: string[] } | null {
  let best: { factory: typeof buildings[0]; path: string[] } | null = null;
  let bestScore = -Infinity;

  for (const factory of factories) {
    if (factory.disabled) continue;
    const need = factoryNeed(factory);
    if (need <= 0 && factory.pins === 0) continue; // skip if fully served and no pins

    const path = findPath(fromNodeKey, factory.nodeKey);
    if (!path || path.length < 2) continue;

    // Score: need minus path length penalty (prefer closer factories when need is equal)
    const score = need * 10 - path.length;
    if (score > bestScore) {
      bestScore = score;
      best = { factory, path };
    }
  }
  return best;
}

// Pick best pin source (factory or storage with pins) for a regular car
function pickBestPinSource(fromNodeKey: string, targets: typeof buildings): { building: typeof buildings[0]; path: string[] } | null {
  let best: { building: typeof buildings[0]; path: string[] } | null = null;
  let bestScore = -Infinity;

  for (const target of targets) {
    if (target.disabled) continue;
    // For factories, use factoryNeed; for storages, use pin count
    let need: number;
    if (target.type === 'factory') {
      need = factoryNeed(target);
      if (need <= 0 && target.pins === 0) continue;
    } else {
      // Storage: only send cars if there are actual pins to collect
      if (target.pins === 0) continue;
      let carsHeading = 0;
      for (const c of cars) {
        if (!c.isTruck && c.workBuildingId === target.id && (c.state === 'toWork' || c.state === 'parking' || c.state === 'parked' || c.state === 'collecting')) {
          carsHeading++;
        }
      }
      need = target.pins - carsHeading;
      if (need <= 0) continue;
    }

    const path = findPath(fromNodeKey, target.nodeKey);
    if (!path || path.length < 2) continue;

    let score: number;
    if (target.type === 'storage') {
      // Prefer storage to keep inventory low
      score = need * 10 + 15 - path.length;
    } else {
      // Factory: urgency rises as pins approach capacity (prevents burn-out)
      const urgency = target.pins / FACTORY_MAX_PINS;
      score = need * 10 * (1 + urgency * 2) - path.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = { building: target, path };
    }
  }
  return best;
}

let truckSpawnTimer = 0;

export function spawnCars() {
  spawnTimer++;
  const carReady = spawnTimer >= SPAWN_INTERVAL;
  if (carReady) spawnTimer = 0;

  truckSpawnTimer++;
  const truckReady = truckSpawnTimer >= TRUCK_SPAWN_INTERVAL;
  if (truckReady) truckSpawnTimer = 0;

  const colorGroups = new Map<string, { houses: typeof buildings; factories: typeof buildings; storages: typeof buildings }>();
  for (const b of buildings) {
    if (!colorGroups.has(b.color)) {
      colorGroups.set(b.color, { houses: [], factories: [], storages: [] });
    }
    const g = colorGroups.get(b.color)!;
    if (b.type === 'house') g.houses.push(b);
    else if (b.type === 'factory') g.factories.push(b);
    else if (b.type === 'storage') g.storages.push(b);
  }

  for (const [, { houses, factories, storages }] of colorGroups) {
    // Spawn regular cars from houses → factories or storages
    if (carReady) {
      const pinSources = [...factories, ...storages];
      const houseCarCounts = new Map<number, number>();
      for (const car of cars) {
        if (car.isTruck) continue;
        houseCarCounts.set(car.homeBuildingId, (houseCarCounts.get(car.homeBuildingId) ?? 0) + 1);
      }
      for (const house of houses) {
        const houseCars = houseCarCounts.get(house.id) ?? 0;
        if (houseCars >= MAX_CARS_PER_HOUSE) continue;

        const result = pickBestPinSource(house.nodeKey, pinSources);
        if (!result) continue;

        const firstEdge = getEdgeBetween(result.path[0], result.path[1]);
        if (!firstEdge) continue;
        if (!isEdgeEntryClear(firstEdge.id, result.path[0], result.path[1])) continue;

        const car = createCar(house.id, result.building.id, house.color, result.path);
        if (car) {
          cars.push(car);
          houseCarCounts.set(house.id, houseCars + 1);
        }
      }
    }

    // Spawn trucks from storages → factories
    if (truckReady) {
      const storageTruckCounts = new Map<number, number>();
      for (const car of cars) {
        if (!car.isTruck) continue;
        storageTruckCounts.set(car.storageBuildingId, (storageTruckCounts.get(car.storageBuildingId) ?? 0) + 1);
      }
      for (const storage of storages) {
        if (storage.disabled) continue;
        // Count existing trucks for this storage
        const truckCount = storageTruckCounts.get(storage.id) ?? 0;
        if (truckCount >= MAX_TRUCKS_PER_STORAGE) continue;

        // Find a factory that needs pickup (has pins)
        const result = pickBestFactory(storage.nodeKey, factories);
        if (!result) continue;

        const firstEdge = getEdgeBetween(result.path[0], result.path[1]);
        if (!firstEdge) continue;
        if (!isEdgeEntryClear(firstEdge.id, result.path[0], result.path[1])) continue;

        const truck = createCar(storage.id, result.factory.id, storage.color, result.path);
        if (truck) {
          truck.isTruck = true;
          truck.storageBuildingId = storage.id;
          truck.homeBuildingId = storage.id;
          truck.state = 'toFactory';
          truck.nextState = 'toStorage';
          truck.speed = TRUCK_SPEED;
          cars.push(truck);
          storageTruckCounts.set(storage.id, truckCount + 1);
        }
      }
    }
  }
}

// ── Narrow chain system ──
// Connected narrow edges form a "chain" that shares a single direction lock.
// A car on ANY edge in the chain blocks entry from the opposite end.

// Cache: edgeId → Set of all edgeIds in its narrow chain (rebuilt when graph changes)
let narrowChainMap = new Map<string, Set<string>>();
let narrowChainsVersion = -1;

function ensureNarrowChains() {
  if (narrowChainsVersion === graphVersion) return;
  narrowChainsVersion = graphVersion;
  narrowChainMap.clear();

  const visited = new Set<string>();
  for (const [eid, edge] of edges) {
    if (!edge.narrow || visited.has(eid)) continue;
    // BFS to find all connected narrow edges
    const chain = new Set<string>();
    const nodeQueue = [edge.fromKey, edge.toKey];
    const visitedNodes = new Set<string>();
    while (nodeQueue.length > 0) {
      const nk = nodeQueue.shift()!;
      if (visitedNodes.has(nk)) continue;
      visitedNodes.add(nk);
      const node = nodes.get(nk);
      if (!node) continue;
      for (const neighborEid of node.edges) {
        const ne = edges.get(neighborEid);
        if (!ne || !ne.narrow || chain.has(neighborEid)) continue;
        chain.add(neighborEid);
        visited.add(neighborEid);
        nodeQueue.push(ne.fromKey === nk ? ne.toKey : ne.fromKey);
      }
    }
    for (const ceid of chain) narrowChainMap.set(ceid, chain);
  }
}

// BFS from `from` through narrow edges in `chain` (excluding `excludeEdge`)
// to see if `target` is reachable — i.e. the car is heading towards target.
function reachableThroughNarrow(from: string, target: string, chain: Set<string>, excludeEdge: string): boolean {
  const visited = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const nk = queue.shift()!;
    if (nk === target) return true;
    if (visited.has(nk)) continue;
    visited.add(nk);
    const node = nodes.get(nk);
    if (!node) continue;
    for (const eid of node.edges) {
      if (eid === excludeEdge || !chain.has(eid)) continue;
      const e = edges.get(eid)!;
      queue.push(e.fromKey === nk ? e.toKey : e.fromKey);
    }
  }
  return false;
}

// Per-frame lock: prevents two cars entering the same chain from opposite ends
// in the same frame. Maps chain (by ref) → entry node string.
const chainFrameLock = new Map<Set<string>, string>();

// currentEdgeId: if the car is already on this edge (transitioning within the
// chain), skip the narrow check — it's an internal move, not an external entry.
function isNarrowBlocked(edgeId: string, dir: 1 | -1, currentEdgeId?: string): boolean {
  ensureNarrowChains();
  const edge = edges.get(edgeId)!;
  const entryNode = dir === 1 ? edge.fromKey : edge.toKey;
  const chain = narrowChainMap.get(edgeId);
  if (!chain) return false;

  // If the car is already on the chain, it's an internal transition — allow it
  if (currentEdgeId && chain.has(currentEdgeId)) return false;

  // Check per-frame lock (same-frame race prevention)
  const frameLock = chainFrameLock.get(chain);
  if (frameLock !== undefined && frameLock !== entryNode) return true;

  // Check all cars on any edge in the chain for oncoming traffic
  for (const c of cars) {
    if (!isDriving(c.state)) continue;
    if (!chain.has(c.edgeId)) continue;
    const cEdge = edges.get(c.edgeId)!;
    // Node the car is heading towards (exit of its current edge)
    const carExitNode = c.edgeDir === 1 ? cEdge.toKey : cEdge.fromKey;
    // Is the car heading towards our entry node? BFS forward from carExitNode
    // (excluding car's own edge so we only search in its travel direction)
    if (carExitNode === entryNode) return true;
    if (reachableThroughNarrow(carExitNode, entryNode, chain, c.edgeId)) return true;
  }
  return false;
}

function lockNarrowChain(edgeId: string, dir: 1 | -1) {
  ensureNarrowChains();
  const edge = edges.get(edgeId);
  if (!edge || !edge.narrow) return;
  const entryNode = dir === 1 ? edge.fromKey : edge.toKey;
  const chain = narrowChainMap.get(edgeId);
  if (chain) chainFrameLock.set(chain, entryNode);
}

function isEdgeEntryClear(edgeId: string, fromKey: string, _toKey: string, currentEdgeId?: string): boolean {
  const edge = edges.get(edgeId)!;
  const dir: 1 | -1 = edge.fromKey === fromKey ? 1 : -1;
  const startT = dir === 1 ? 0 : 1;
  const clearance = MIN_GAP + CAR_LEN;

  // Narrow roads: check chain-wide direction lock
  if (edge.narrow && isNarrowBlocked(edgeId, dir, currentEdgeId)) return false;

  for (const c of cars) {
    if (c.edgeId !== edgeId) continue;
    if (!isDriving(c.state)) continue;
    if (c.edgeDir !== dir) continue;
    const dist = Math.abs(c.t - startT) * edge.length;
    if (dist < clearance) return false;
  }
  return true;
}

function createCar(homeId: number, workId: number, color: string, path: string[]): Car | null {
  const edge = getEdgeBetween(path[0], path[1]);
  if (!edge) return null;

  const dir: 1 | -1 = edge.fromKey === path[0] ? 1 : -1;
  const initialAngle = computeEdgeAngle(edge, dir);

  const car: Car = {
    id: nextCarId++,
    color,
    homeBuildingId: homeId,
    workBuildingId: workId,
    path,
    pathIndex: 1,
    edgeId: edge.id,
    edgeDir: dir,
    t: dir === 1 ? 0 : 1,
    x: 0, y: 0,
    angle: initialAngle,
    targetAngle: initialAngle,
    speed: CAR_SPEED,
    state: 'toWork',
    parkTimer: 0,
    parkProgress: 0,
    parkStartX: 0, parkStartY: 0,
    parkTargetX: 0, parkTargetY: 0,
    parkAngle: 0,
    parkCx1: 0,
    parkCy1: 0,
    parkCx2: 0,
    parkCy2: 0,
    parkEndAngle: 0,
    parkedAt: 0,
    parkSlot: 0,
    stuckFrames: 0,
    uTurnCooldown: 0,
    lastUTurnEdgeId: '',
    nextState: 'toHome',
    collectProgress: 0,
    carryingPin: false,
    pinSourceX: 0,
    pinSourceY: 0,
    isTruck: false,
    pinsCarried: 0,
    storageBuildingId: 0,
  };

  if (edge.narrow) lockNarrowChain(edge.id, dir);
  updateCarPosition(car);
  return car;
}

function computeEdgeAngle(edge: { fx: number; fy: number; tx: number; ty: number }, dir: 1 | -1): number {
  let dx = edge.tx - edge.fx;
  let dy = edge.ty - edge.fy;
  if (dir === -1) { dx = -dx; dy = -dy; }
  return Math.atan2(dy, dx);
}

// Distance from rear axle to front of car (for look-ahead steering)
const FRONT_OVERHANG = CAR_LEN * 0.7;
const ROAD_LANE_LEFT_BIAS = 1;
const ROUNDABOUT_LANE_OUTSET = 1;

function getLaneHalf(edgeId: string, narrow?: boolean): number {
  const baseLane = narrow ? 0 : LANE_W / 2 - ROAD_LANE_LEFT_BIAS;
  return roundaboutEdgeSet.has(edgeId) ? baseLane + ROUNDABOUT_LANE_OUTSET : baseLane;
}

// Sample a point along the car's path at a given distance ahead.
// Returns pixel coordinates (center of road, not lane-offset).
function samplePathAhead(car: Car, dist: number): { x: number; y: number } | null {
  let remaining = dist;
  let edgeId = car.edgeId;
  let t = car.t;
  let pathIdx = car.pathIndex;

  // Walk forward along edges until we've covered `dist` pixels
  while (remaining > 0) {
    const edge = edges.get(edgeId);
    if (!edge) break;

    const dir: 1 | -1 = pathIdx > 0 && pathIdx <= car.path.length
      ? (edge.fromKey === car.path[pathIdx - 1] ? 1 : -1)
      : car.edgeDir;

    const distToEnd = dir === 1 ? (1 - t) * edge.length : t * edge.length;

    if (remaining <= distToEnd) {
      // Target point is on this edge
      const advance = remaining / edge.length;
      const finalT = dir === 1 ? t + advance : t - advance;
      const px = edge.fx + (edge.tx - edge.fx) * finalT;
      const py = edge.fy + (edge.ty - edge.fy) * finalT;
      return { x: px, y: py };
    }

    // Move to next edge
    remaining -= distToEnd;
    if (pathIdx >= car.path.length || pathIdx + 1 >= car.path.length) break;

    const nextNodeKey = car.path[pathIdx];
    const nextNextKey = car.path[pathIdx + 1];
    const nextEdge = getEdgeBetween(nextNodeKey, nextNextKey);
    if (!nextEdge) break;

    edgeId = nextEdge.id;
    const nextDir: 1 | -1 = nextEdge.fromKey === nextNodeKey ? 1 : -1;
    t = nextDir === 1 ? 0 : 1;
    pathIdx++;
  }

  // Couldn't look far enough ahead — extrapolate along last known edge
  const edge = edges.get(edgeId);
  if (!edge) return null;
  const dir = car.edgeDir;
  const finalT = dir === 1 ? Math.min(t + remaining / edge.length, 1) : Math.max(t - remaining / edge.length, 0);
  return {
    x: edge.fx + (edge.tx - edge.fx) * finalT,
    y: edge.fy + (edge.ty - edge.fy) * finalT,
  };
}

function updateCarPosition(car: Car) {
  const edge = edges.get(car.edgeId);
  if (!edge) return;

  const highwayPose = highwayEdgeSet.has(car.edgeId) ? getHighwayPose(car.edgeId, car.t, car.edgeDir) : null;
  if (highwayPose) {
    car.x = highwayPose.x;
    car.y = highwayPose.y;

    const desiredAngle = Math.atan2(highwayPose.tangentY, highwayPose.tangentX);
    const speedRatio = car.speed / getBaseSpeed(car.edgeId, car.isTruck);
    const lerpRate = 0.06 + 0.94 * speedRatio;
    car.angle = lerpAngle(car.angle, desiredAngle, lerpRate);
    car.targetAngle = car.angle;
    return;
  }

  // Rear axle position on current edge (center of road)
  const rearCenterX = edge.fx + (edge.tx - edge.fx) * car.t;
  const rearCenterY = edge.fy + (edge.ty - edge.fy) * car.t;

  // Lane offset stays based on the edge direction so the rear axle
  // tracks its lane solidly — no sideways drift through turns
  let tdx = edge.tx - edge.fx;
  let tdy = edge.ty - edge.fy;
  if (car.edgeDir === -1) { tdx = -tdx; tdy = -tdy; }
  const len = Math.hypot(tdx, tdy);
  if (len > 0) { tdx /= len; tdy /= len; }
  // Smooth lane offset blending at narrow↔regular transitions
  const BLEND_DIST = 15; // pixels over which to blend
  const baseLane = getLaneHalf(edge.id, edge.narrow);
  let laneHalf = baseLane;
  let lateralRate = 0; // perpendicular pixels per forward pixel (for steering angle)

  const distFromStart = car.edgeDir === 1 ? car.t * edge.length : (1 - car.t) * edge.length;
  const distToEnd = edge.length - distFromStart;

  // Check previous edge (blend at entry)
  if (distFromStart < BLEND_DIST && car.pathIndex >= 2) {
    const prevEdge = getEdgeBetween(car.path[car.pathIndex - 2], car.path[car.pathIndex - 1]);
    if (prevEdge) {
      const prevLane = getLaneHalf(prevEdge.id, prevEdge.narrow);
      if (prevLane !== baseLane) {
        const blend = distFromStart / BLEND_DIST;
        laneHalf = prevLane + (baseLane - prevLane) * blend;
        lateralRate = (baseLane - prevLane) / BLEND_DIST;
      }
    }
  }

  // Check next edge (blend at exit)
  if (distToEnd < BLEND_DIST && car.pathIndex < car.path.length && car.pathIndex + 1 <= car.path.length) {
    const nextNodeKey = car.path[car.pathIndex];
    const nextIdx = car.pathIndex + 1;
    if (nextIdx < car.path.length) {
      const nextEdge = getEdgeBetween(nextNodeKey, car.path[nextIdx]);
      if (nextEdge) {
        const nextLane = getLaneHalf(nextEdge.id, nextEdge.narrow);
        if (nextLane !== baseLane) {
          const blend = distToEnd / BLEND_DIST;
          laneHalf = nextLane + (baseLane - nextLane) * blend;
          lateralRate = (nextLane - baseLane) / BLEND_DIST;
        }
      }
    }
  }

  const offsetX = -tdy * laneHalf;
  const offsetY = tdx * laneHalf;

  let posX = rearCenterX + offsetX;
  let posY = rearCenterY + offsetY;

  // ---- Corner smoothing: arc through junctions via quadratic bezier ----
  const CORNER_R = 15; // radius of the smoothing zone on each side of the node
  let cornerTangentX = 0, cornerTangentY = 0;
  let inCorner = false;

  // Approaching the end of this edge — smooth into next edge
  if (distToEnd < CORNER_R && car.pathIndex < car.path.length) {
    const nextIdx = car.pathIndex + 1;
    if (nextIdx < car.path.length) {
      const nextEdge = getEdgeBetween(car.path[car.pathIndex], car.path[nextIdx]);
      if (nextEdge) {
        const nextDir: 1 | -1 = nextEdge.fromKey === car.path[car.pathIndex] ? 1 : -1;
        let ndx = nextEdge.tx - nextEdge.fx;
        let ndy = nextEdge.ty - nextEdge.fy;
        if (nextDir === -1) { ndx = -ndx; ndy = -ndy; }
        const nLen = Math.hypot(ndx, ndy);
        if (nLen > 0) { ndx /= nLen; ndy /= nLen; }

        // Next edge lane offset
        const nextLane = getLaneHalf(nextEdge.id, nextEdge.narrow);

        // P0: point on current edge at CORNER_R before node
        const p0t = car.edgeDir === 1 ? (edge.length - CORNER_R) / edge.length : CORNER_R / edge.length;
        const p0x = edge.fx + (edge.tx - edge.fx) * p0t + (-tdy) * laneHalf;
        const p0y = edge.fy + (edge.ty - edge.fy) * p0t + tdx * laneHalf;

        // P1: node position with averaged lane offset
        const nodeX = car.edgeDir === 1 ? edge.tx : edge.fx;
        const nodeY = car.edgeDir === 1 ? edge.ty : edge.fy;
        const avgLane = (laneHalf + nextLane) / 2;
        const p1x = nodeX + (-tdy) * avgLane;
        const p1y = nodeY + tdx * avgLane;

        // P2: point on next edge at CORNER_R after node
        const p2Base = nextDir === 1 ? CORNER_R / nextEdge.length : 1 - CORNER_R / nextEdge.length;
        const p2x = nextEdge.fx + (nextEdge.tx - nextEdge.fx) * p2Base + (-ndy) * nextLane;
        const p2y = nextEdge.fy + (nextEdge.ty - nextEdge.fy) * p2Base + ndx * nextLane;

        // t in the bezier: 0 at P0 (CORNER_R from node), 0.5 at node, 1 at P2
        // We're on the first half (approaching node)
        const bezT = 0.5 * (1 - distToEnd / CORNER_R); // 0 → 0.5
        const u = 1 - bezT;
        posX = u * u * p0x + 2 * u * bezT * p1x + bezT * bezT * p2x;
        posY = u * u * p0y + 2 * u * bezT * p1y + bezT * bezT * p2y;

        // Bezier tangent for angle
        cornerTangentX = 2 * (1 - bezT) * (p1x - p0x) + 2 * bezT * (p2x - p1x);
        cornerTangentY = 2 * (1 - bezT) * (p1y - p0y) + 2 * bezT * (p2y - p1y);
        inCorner = true;
      }
    }
  }

  // Just entered this edge — smooth from previous edge
  if (!inCorner && distFromStart < CORNER_R && car.pathIndex >= 2) {
    const prevEdge = getEdgeBetween(car.path[car.pathIndex - 2], car.path[car.pathIndex - 1]);
    if (prevEdge) {
      const prevDir: 1 | -1 = prevEdge.fromKey === car.path[car.pathIndex - 2] ? 1 : -1;
      let pdx = prevEdge.tx - prevEdge.fx;
      let pdy = prevEdge.ty - prevEdge.fy;
      if (prevDir === -1) { pdx = -pdx; pdy = -pdy; }
      const pLen = Math.hypot(pdx, pdy);
      if (pLen > 0) { pdx /= pLen; pdy /= pLen; }

      const prevLane = getLaneHalf(prevEdge.id, prevEdge.narrow);

      // P0: point on prev edge at CORNER_R before node
      const p0t = prevDir === 1 ? (prevEdge.length - CORNER_R) / prevEdge.length : CORNER_R / prevEdge.length;
      const p0x = prevEdge.fx + (prevEdge.tx - prevEdge.fx) * p0t + (-pdy) * prevLane;
      const p0y = prevEdge.fy + (prevEdge.ty - prevEdge.fy) * p0t + pdx * prevLane;

      // P1: node position
      const nodeX = car.edgeDir === 1 ? edge.fx : edge.tx;
      const nodeY = car.edgeDir === 1 ? edge.fy : edge.ty;
      const avgLane = (prevLane + laneHalf) / 2;
      const p1x = nodeX + (-pdy) * avgLane;
      const p1y = nodeY + pdx * avgLane;

      // P2: point on current edge at CORNER_R after node
      const p2t = car.edgeDir === 1 ? CORNER_R / edge.length : 1 - CORNER_R / edge.length;
      const p2x = edge.fx + (edge.tx - edge.fx) * p2t + (-tdy) * laneHalf;
      const p2y = edge.fy + (edge.ty - edge.fy) * p2t + tdx * laneHalf;

      // We're on the second half (leaving node)
      const bezT = 0.5 + 0.5 * (distFromStart / CORNER_R); // 0.5 → 1
      const u = 1 - bezT;
      posX = u * u * p0x + 2 * u * bezT * p1x + bezT * bezT * p2x;
      posY = u * u * p0y + 2 * u * bezT * p1y + bezT * bezT * p2y;

      cornerTangentX = 2 * (1 - bezT) * (p1x - p0x) + 2 * bezT * (p2x - p1x);
      cornerTangentY = 2 * (1 - bezT) * (p1y - p0y) + 2 * bezT * (p2y - p1y);
      inCorner = true;
    }
  }

  car.x = posX;
  car.y = posY;

  // ---- Heading angle ----
  let desiredAngle: number;

  if (inCorner && Math.hypot(cornerTangentX, cornerTangentY) > 0.01) {
    // Use bezier tangent for smooth cornering
    desiredAngle = Math.atan2(cornerTangentY, cornerTangentX);
  } else {
    // Straight section: use look-ahead
    const frontPos = samplePathAhead(car, FRONT_OVERHANG);
    desiredAngle = Math.atan2(tdy, tdx);
    if (frontPos) {
      const dx = frontPos.x - rearCenterX;
      const dy = frontPos.y - rearCenterY;
      if (Math.hypot(dx, dy) > 0.5) {
        desiredAngle = Math.atan2(dy, dx);
      }
    }

    // Steer into lane changes at narrow↔regular transitions
    if (lateralRate !== 0) {
      const vx = tdx + (-tdy) * lateralRate;
      const vy = tdy + tdx * lateralRate;
      desiredAngle = Math.atan2(vy, vx);
    }
  }

  // When moving at speed, set the angle directly (look-ahead is smooth).
  // When slow or stopped, lerp so cars in queues turn gradually, not snap.
  const speedRatio = car.speed / getBaseSpeed(car.edgeId, car.isTruck); // 0 = stopped, 1 = full speed
  const lerpRate = 0.06 + 0.94 * speedRatio; // slow → 0.06, fast → 1.0
  car.angle = lerpAngle(car.angle, desiredAngle, lerpRate);
  car.targetAngle = car.angle;
}

// Cubic bezier: B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
function cubicBezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}
// Cubic bezier tangent: B'(t) = 3(1-t)²(P1-P0) + 6(1-t)t(P2-P1) + 3t²(P3-P2)
function cubicBezierTangent(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return 3 * u * u * (p1 - p0) + 6 * u * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

function setupDepartPath(car: Car) {
  const parkedAtId = getParkedBuildingId(car);
  const parkedBuilding = buildingById.get(parkedAtId);

  if (parkedBuilding && parkedBuilding.type === 'house') {
    // Departing from house
    const exit = getHouseExitPoint(parkedAtId);
    car.parkStartX = car.parkTargetX;
    car.parkStartY = car.parkTargetY;
    car.parkTargetX = exit.x;
    car.parkTargetY = exit.y;
    car.parkCx1 = (car.parkStartX * 2 + exit.x) / 3;
    car.parkCy1 = (car.parkStartY * 2 + exit.y) / 3;
    car.parkCx2 = (car.parkStartX + exit.x * 2) / 3;
    car.parkCy2 = (car.parkStartY + exit.y * 2) / 3;
  } else {
    // Departing from factory or storage
    const ep = getFactoryExitPath(parkedAtId, car);
    car.parkStartX = ep.p0x;
    car.parkStartY = ep.p0y;
    car.parkCx1 = ep.p1x;
    car.parkCy1 = ep.p1y;
    car.parkCx2 = ep.p2x;
    car.parkCy2 = ep.p2y;
    car.parkTargetX = ep.p3x;
    car.parkTargetY = ep.p3y;
  }
}

export function updateCars() {
  frameCount++;
  chainFrameLock.clear();

  // Remove cars whose edge was deleted
  if (graphVersion !== lastGraphVersion) {
    lastGraphVersion = graphVersion;
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      if ((isDriving(c.state)) && !edges.has(c.edgeId)) {
        cars.splice(i, 1);
      }
    }
  }

  const buildingCarIndex = buildBuildingCarIndex();
  ensureNarrowChains();

  // Parking/departing angle is now handled inline with bezier tangent below.

  // Update parking/parked/departing cars
  for (let i = cars.length - 1; i >= 0; i--) {
    const car = cars[i];

    if (car.state === 'parking') {
      car.parkProgress += PARK_ANIM_SPEED;
      if (car.parkProgress >= 1) {
        car.parkProgress = 1;
        car.state = 'parked';
        car.parkedAt = frameCount;
        car.parkTimer = PARK_DURATION;
        if (!car.isTruck && car.nextState === 'toWork') {
          car.carryingPin = false;
        }
        car.angle = car.parkEndAngle;
      }
      // Cubic bezier position
      const t = car.parkProgress;
      car.x = cubicBezier(t, car.parkStartX, car.parkCx1, car.parkCx2, car.parkTargetX);
      car.y = cubicBezier(t, car.parkStartY, car.parkCy1, car.parkCy2, car.parkTargetY);
      // Angle follows bezier tangent directly — car rides the curve like rails
      const tx = cubicBezierTangent(t, car.parkStartX, car.parkCx1, car.parkCx2, car.parkTargetX);
      const ty = cubicBezierTangent(t, car.parkStartY, car.parkCy1, car.parkCy2, car.parkTargetY);
      if (Math.hypot(tx, ty) > 0.01) {
        car.angle = Math.atan2(ty, tx);
        car.targetAngle = car.angle;
      }
    } else if (car.state === 'parked') {
      const parkedAtId = getParkedBuildingId(car);
      const parkedBuilding = buildingById.get(parkedAtId);
      const buildingCars = buildingCarIndex.get(parkedAtId);
      let canDepart = false;

      if (car.isTruck && car.nextState === 'toFactory') {
        // Truck at storage — deposit pins then head to factory
        if (canDepartBuilding(buildingCars, car)) {
          if (car.pinsCarried > 0 && parkedBuilding) {
            parkedBuilding.pins = Math.min(parkedBuilding.pins + car.pinsCarried, parkedBuilding.maxPins);
            car.pinsCarried = 0;
          }
          canDepart = true;
        }
      } else if (car.isTruck && car.nextState === 'toStorage') {
        // Truck at factory — pick up pins one at a time, leave when full
        if (parkedBuilding && parkedBuilding.disabled) {
          canDepart = true;
        } else if (car.pinsCarried >= TRUCK_CAPACITY) {
          canDepart = true;
        } else if (parkedBuilding && parkedBuilding.pins > 0 && parkedBuilding.pinCooldown <= 0) {
          // Pick up one pin with animation (same as regular cars)
          const pinPos = getPinPixelPos(parkedBuilding, parkedBuilding.pins - 1);
          parkedBuilding.pins--;
          addScore(1);
          car.state = 'collecting';
          car.collectProgress = 0;
          car.pinSourceX = pinPos.x;
          car.pinSourceY = pinPos.y;
        }
      } else if (car.nextState === 'toWork') {
        // Regular car at home (house) — timer-based departure
        car.parkTimer--;
        if (car.parkTimer <= 0) canDepart = true;
      } else {
        // Regular car at factory or storage (nextState === 'toHome')
        if (parkedBuilding && parkedBuilding.disabled) {
          canDepart = true;
        } else if (parkedBuilding && parkedBuilding.type === 'storage' && parkedBuilding.pins === 0) {
          // Storage is empty — leave immediately so we don't block the truck
          canDepart = true;
        } else if (canDepartBuilding(buildingCars, car)) {
          if (parkedBuilding && parkedBuilding.pins > 0 && parkedBuilding.pinCooldown <= 0) {
            // Start collecting animation — pin flies to car
            const pinPos = getPinPixelPos(parkedBuilding, parkedBuilding.pins - 1);
            parkedBuilding.pins--;
            addScore(1);
            car.state = 'collecting';
            car.collectProgress = 0;
            car.carryingPin = true;
            car.pinSourceX = pinPos.x;
            car.pinSourceY = pinPos.y;
          }
        }
      }
      if (canDepart) {
        car.state = 'departing';
        car.parkProgress = 0;
        setupDepartPath(car);
      }
    } else if (car.state === 'collecting') {
      // Pin flies from factory/storage to car over ~30 frames
      car.collectProgress += 0.035;
      if (car.collectProgress >= 1) {
        car.collectProgress = 1;
        if (car.isTruck) {
          // Truck: increment carried pins and return to parked to collect more
          car.pinsCarried++;
          car.state = 'parked';
        } else {
          car.state = 'departing';
          car.parkProgress = 0;
          setupDepartPath(car);
        }
      }
    } else if (car.state === 'departing') {
      car.parkProgress += PARK_ANIM_SPEED;
      if (car.parkProgress >= 1) {
        car.parkProgress = 1;
        startDriving(car, i, buildingCarIndex);
      } else {
        const t = car.parkProgress;
        // Both house and factory departures now use a forward bezier exit path
        const bx = cubicBezier(t, car.parkStartX, car.parkCx1, car.parkCx2, car.parkTargetX);
        const by = cubicBezier(t, car.parkStartY, car.parkCy1, car.parkCy2, car.parkTargetY);
        const btx = cubicBezierTangent(t, car.parkStartX, car.parkCx1, car.parkCx2, car.parkTargetX);
        const bty = cubicBezierTangent(t, car.parkStartY, car.parkCy1, car.parkCy2, car.parkTargetY);
        car.x = bx;
        car.y = by;
        if (Math.hypot(btx, bty) > 0.01) {
          car.angle = Math.atan2(bty, btx);
          car.targetAngle = car.angle;
        }
      }
    }
  }

  const narrowChainCars = new Map<Set<string>, Car[]>();
  for (const car of cars) {
    if (!isDriving(car.state)) continue;
    const edge = edges.get(car.edgeId);
    if (!edge || !edge.narrow) continue;
    const chain = narrowChainMap.get(car.edgeId);
    if (!chain) continue;
    let chainCars = narrowChainCars.get(chain);
    if (!chainCars) {
      chainCars = [];
      narrowChainCars.set(chain, chainCars);
    }
    chainCars.push(car);
  }
  const narrowBlockedCache = new Map<Set<string>, Map<string, boolean>>();

  function isNarrowBlockedCached(edgeId: string, dir: 1 | -1, currentEdgeId?: string): boolean {
    ensureNarrowChains();
    const edge = edges.get(edgeId)!;
    const entryNode = dir === 1 ? edge.fromKey : edge.toKey;
    const chain = narrowChainMap.get(edgeId);
    if (!chain) return false;
    if (currentEdgeId && chain.has(currentEdgeId)) return false;

    const frameLock = chainFrameLock.get(chain);
    if (frameLock !== undefined && frameLock !== entryNode) return true;

    let cache = narrowBlockedCache.get(chain);
    if (!cache) {
      cache = new Map<string, boolean>();
      narrowBlockedCache.set(chain, cache);
    }
    const cached = cache.get(entryNode);
    if (cached !== undefined) return cached;

    const chainCars = narrowChainCars.get(chain) ?? [];
    for (const c of chainCars) {
      const cEdge = edges.get(c.edgeId);
      if (!cEdge) continue;
      const carExitNode = c.edgeDir === 1 ? cEdge.toKey : cEdge.fromKey;
      if (carExitNode === entryNode || reachableThroughNarrow(carExitNode, entryNode, chain, c.edgeId)) {
        cache.set(entryNode, true);
        return true;
      }
    }

    cache.set(entryNode, false);
    return false;
  }

  // ============ COLLISION AVOIDANCE ============

  // Group driving cars by edge+direction for same-edge gap following
  // Tunnel cars flow freely — skip collision avoidance entirely
  const laneGroups = new Map<string, Car[]>();
  for (const car of cars) {
    if (!isDriving(car.state)) continue;
    if (tunnelEdgeSet.has(car.edgeId)) continue;
    const key = `${car.edgeId}:${car.edgeDir}`;
    let group = laneGroups.get(key);
    if (!group) { group = []; laneGroups.set(key, group); }
    group.push(car);
  }

  const targetSpeeds = new Map<number, number>();

  // 1. Same-edge gap following: cars on the same edge in the same direction
  for (const [, group] of laneGroups) {
    // Sort so group[0] is the leader (furthest along in travel direction)
    group.sort((a, b) => a.edgeDir === 1 ? b.t - a.t : a.t - b.t);
    for (const c of group) targetSpeeds.set(c.id, getBaseSpeed(c.edgeId, c.isTruck));

    for (let i = 1; i < group.length; i++) {
      const front = group[i - 1];
      const behind = group[i];
      const edge = edges.get(behind.edgeId)!;
      const gap = Math.abs(front.t - behind.t) * edge.length;

      if (gap < MIN_GAP + CAR_LEN) {
        // Too close — hard stop to prevent overlap
        targetSpeeds.set(behind.id, 0);
      } else if (gap < MIN_GAP + CAR_LEN + 16) {
        // Approaching zone — gradual slow-down
        const closeness = 1 - (gap - MIN_GAP - CAR_LEN) / 16;
        const slowSpeed = front.speed * (0.3 + 0.7 * (1 - closeness));
        targetSpeeds.set(behind.id, Math.min(targetSpeeds.get(behind.id)!, slowSpeed));
      }
    }
  }

  // 2. Intersection reservation — only for TRUE intersections (3+ edges).
  //    Simple corners (2 edges) don't need reservation since traffic only flows one way.
  //    Closest car to each intersection node wins; others yield with smooth braking.
  const INTERSECTION_RANGE = CORNER_BRAKE_DIST + CAR_LEN;
  const nodeOwner = new Map<string, { carId: number; dist: number; edgeId: string }>();

  for (const car of cars) {
    if (!isDriving(car.state)) continue;
    const edge = edges.get(car.edgeId);
    if (!edge) continue;

    const distToEnd = car.edgeDir === 1 ? (1 - car.t) * edge.length : car.t * edge.length;
    const endNodeKey = car.edgeDir === 1 ? edge.toKey : edge.fromKey;

    // Only reserve nodes that are true intersections (3+ connected edges).
    // At traffic-light intersections, red-light cars won't enter — exclude them from ownership
    // so they don't block green-light cars approaching from the crossing axis.
    const endNode = nodes.get(endNodeKey);
    if (endNode && endNode.edges.size >= 3 && distToEnd < INTERSECTION_RANGE) {
      if (!isRedLight(car.edgeId, endNodeKey) && !isAmberLight(car.edgeId, endNodeKey)) {
        const existing = nodeOwner.get(endNodeKey);
        if (!existing || distToEnd < existing.dist) {
          nodeOwner.set(endNodeKey, { carId: car.id, dist: distToEnd, edgeId: car.edgeId });
        }
      }
    }

    // Hold the intersection we just came through (turning cars block it)
    const distFromStart = car.edgeDir === 1 ? car.t * edge.length : (1 - car.t) * edge.length;
    const startNodeKey = car.edgeDir === 1 ? edge.fromKey : edge.toKey;
    const startNode = nodes.get(startNodeKey);
    if (startNode && startNode.edges.size >= 3 && distFromStart < CAR_LEN) {
      const existing = nodeOwner.get(startNodeKey);
      if (!existing || 0 < existing.dist) {
        nodeOwner.set(startNodeKey, { carId: car.id, dist: 0, edgeId: car.edgeId });
      }
    }
  }

  // 3. Yield to intersection owner from a DIFFERENT edge — smooth deceleration
  for (const car of cars) {
    if (!isDriving(car.state)) continue;
    const edge = edges.get(car.edgeId);
    if (!edge) continue;

    const distToEnd = car.edgeDir === 1 ? (1 - car.t) * edge.length : car.t * edge.length;
    const endNodeKey = car.edgeDir === 1 ? edge.toKey : edge.fromKey;

    const owner = nodeOwner.get(endNodeKey);
    if (owner && owner.carId !== car.id && owner.edgeId !== car.edgeId) {
      // At traffic-light intersections, true-green cars proceed freely — the light
      // already serialises cross traffic. Amber cars must still stop.
      if (trafficLightByNode.has(endNodeKey) && !isRedLight(car.edgeId, endNodeKey) && !isAmberLight(car.edgeId, endNodeKey)) continue;

      const stopDist = MIN_GAP + CAR_LEN * 0.5;
      if (distToEnd <= stopDist) {
        targetSpeeds.set(car.id, 0);
      } else if (distToEnd < INTERSECTION_RANGE) {
        const range = INTERSECTION_RANGE - stopDist;
        const brakeFactor = (distToEnd - stopDist) / range;
        const base = getBaseSpeed(car.edgeId, car.isTruck);
        const brakeSpeed = base * Math.max(0, Math.min(1, brakeFactor));
        const current = targetSpeeds.get(car.id) ?? base;
        if (brakeSpeed < current) targetSpeeds.set(car.id, brakeSpeed);
      }
    }
  }

  // 3b. Traffic light signals — stop before entering intersection on red/amber.
  //     Red: hard stop a full car length back from the node.
  //     Amber: brake without a hard stop so committed cars (already past the stop
  //     line) can glide through while cars further back decelerate to a halt.
  for (const car of cars) {
    if (!isDriving(car.state)) continue;
    const edge = edges.get(car.edgeId);
    if (!edge) continue;

    const distToEnd = car.edgeDir === 1 ? (1 - car.t) * edge.length : car.t * edge.length;
    const endNodeKey = car.edgeDir === 1 ? edge.toKey : edge.fromKey;
    const stopDist = MIN_GAP + CAR_LEN; // one full car length back from node

    if (distToEnd < INTERSECTION_RANGE && isRedLight(car.edgeId, endNodeKey)) {
      // Red: hard stop at stop line
      if (distToEnd <= stopDist) {
        targetSpeeds.set(car.id, 0);
      } else {
        const range = INTERSECTION_RANGE - stopDist;
        const brakeFactor = (distToEnd - stopDist) / range;
        const base = getBaseSpeed(car.edgeId, car.isTruck);
        const brakeSpeed = base * Math.max(0, Math.min(1, brakeFactor));
        const current = targetSpeeds.get(car.id) ?? base;
        if (brakeSpeed < current) targetSpeeds.set(car.id, brakeSpeed);
      }
    } else if (distToEnd < INTERSECTION_RANGE && isAmberLight(car.edgeId, endNodeKey)) {
      // Amber: brake-only, no hard stop — cars already past the stop line proceed
      if (distToEnd > stopDist) {
        const range = INTERSECTION_RANGE - stopDist;
        const brakeFactor = (distToEnd - stopDist) / range;
        const base = getBaseSpeed(car.edgeId, car.isTruck);
        const brakeSpeed = base * Math.max(0, Math.min(1, brakeFactor));
        const current = targetSpeeds.get(car.id) ?? base;
        if (brakeSpeed < current) targetSpeeds.set(car.id, brakeSpeed);
      }
      // Cars at or inside stopDist (committed): leave their speed unchanged
    }
  }

  // 4. Cross-edge lookahead for ALL cars — check next edge and 2 edges ahead
  for (const car of cars) {
    if (!isDriving(car.state)) continue;
    if (car.pathIndex >= car.path.length || car.pathIndex + 1 >= car.path.length) continue;

    const edge = edges.get(car.edgeId);
    if (!edge) continue;

    const distToEnd = car.edgeDir === 1 ? (1 - car.t) * edge.length : car.t * edge.length;
    if (distToEnd > INTERSECTION_RANGE) continue; // too far to care

    // Check next edge for traffic
    const nextNodeKey = car.path[car.pathIndex];
    const nextNextKey = car.path[car.pathIndex + 1];
    const nextEdge = getEdgeBetween(nextNodeKey, nextNextKey);
    if (!nextEdge) continue;

    const nextDir: 1 | -1 = nextEdge.fromKey === nextNodeKey ? 1 : -1;

    // Narrow road locked to opposite direction — brake to stop before entering
    if (nextEdge.narrow && isNarrowBlockedCached(nextEdge.id, nextDir, car.edgeId)) {
      const stopDist = MIN_GAP;
      if (distToEnd <= stopDist) {
        targetSpeeds.set(car.id, 0);
      } else {
        const range = INTERSECTION_RANGE - stopDist;
        const brakeFactor = (distToEnd - stopDist) / range;
        const base = getBaseSpeed(car.edgeId, car.isTruck);
        const brakeSpeed = base * Math.max(0, brakeFactor);
        const current = targetSpeeds.get(car.id) ?? base;
        if (brakeSpeed < current) targetSpeeds.set(car.id, brakeSpeed);
      }
      continue; // skip normal lookahead for this car
    }

    // Approaching a narrow road from a wider road — slow down to narrow speed
    if (nextEdge.narrow && !edge.narrow) {
      const narrowBase = NARROW_SPEED;
      const current = targetSpeeds.get(car.id) ?? getBaseSpeed(car.edgeId, car.isTruck);
      if (distToEnd < CORNER_BRAKE_DIST && current > narrowBase) {
        const brakeFactor = distToEnd / CORNER_BRAKE_DIST;
        const brakeSpeed = narrowBase + (current - narrowBase) * brakeFactor;
        targetSpeeds.set(car.id, brakeSpeed);
      }
    }

    const nextStartT = nextDir === 1 ? 0 : 1;
    const nextLaneKey = `${nextEdge.id}:${nextDir}`;
    const nextGroup = laneGroups.get(nextLaneKey);

    if (nextGroup) {
      // Find closest car to the entry point on next edge
      let minNextDist = Infinity;
      for (const c of nextGroup) {
        const d = Math.abs(c.t - nextStartT) * nextEdge.length;
        if (d < minNextDist) minNextDist = d;
      }

      if (minNextDist < MIN_GAP + CAR_LEN) {
        // Traffic blocking the next edge — smooth braking
        const stopDist = MIN_GAP;
        if (distToEnd <= stopDist) {
          targetSpeeds.set(car.id, 0);
        } else {
          const range = INTERSECTION_RANGE - stopDist;
          const brakeFactor = (distToEnd - stopDist) / range;
          const base = getBaseSpeed(car.edgeId, car.isTruck);
          const brakeSpeed = base * 0.15 * Math.max(0, brakeFactor);
          const current = targetSpeeds.get(car.id) ?? base;
          if (brakeSpeed < current) targetSpeeds.set(car.id, brakeSpeed);
        }
      }
    }

    // Look 2 edges ahead for early gentle braking
    if (car.pathIndex + 2 < car.path.length) {
      const edge2NextKey = car.path[car.pathIndex + 2];
      const edge2 = getEdgeBetween(nextNextKey, edge2NextKey);
      if (edge2) {
        const dir2: 1 | -1 = edge2.fromKey === nextNextKey ? 1 : -1;
        const startT2 = dir2 === 1 ? 0 : 1;
        const laneKey2 = `${edge2.id}:${dir2}`;
        const group2 = laneGroups.get(laneKey2);
        if (group2) {
          for (const c of group2) {
            const d = Math.abs(c.t - startT2) * edge2.length;
            if (d < MIN_GAP + CAR_LEN) {
              // Congestion 2 edges away — gentle slowdown
              const base = getBaseSpeed(car.edgeId, car.isTruck);
              const brakeSpeed = base * 0.6;
              const current = targetSpeeds.get(car.id) ?? base;
              if (brakeSpeed < current) targetSpeeds.set(car.id, brakeSpeed);
              break;
            }
          }
        }
      }
    }
  }

  // 5. Corner braking: slow down approaching turns proportional to angle change
  for (const car of cars) {
    if (!isDriving(car.state)) continue;
    if (car.pathIndex >= car.path.length || car.pathIndex + 1 >= car.path.length) continue;

    const edge = edges.get(car.edgeId);
    if (!edge) continue;

    const distToEnd = car.edgeDir === 1 ? (1 - car.t) * edge.length : car.t * edge.length;
    if (distToEnd > CORNER_BRAKE_DIST) continue;

    const curAngle = computeEdgeAngle(edge, car.edgeDir);
    const nextNodeKey = car.path[car.pathIndex];
    const nextNextKey = car.path[car.pathIndex + 1];
    const nextEdge = getEdgeBetween(nextNodeKey, nextNextKey);
    if (!nextEdge) continue;
    const nextDir: 1 | -1 = nextEdge.fromKey === nextNodeKey ? 1 : -1;
    const nextAngle = computeEdgeAngle(nextEdge, nextDir);

    const turn = Math.abs(angleDiff(curAngle, nextAngle));
    if (turn < 0.1) continue;

    const base = getBaseSpeed(car.edgeId, car.isTruck);
    let cornerSpeed: number;
    if (turn >= Math.PI / 2) {
      cornerSpeed = CORNER_MIN_SPEED;
    } else {
      const t = turn / (Math.PI / 2);
      cornerSpeed = base + (CORNER_MIN_SPEED - base) * t;
    }

    const proximity = 1 - distToEnd / CORNER_BRAKE_DIST;
    const blendedSpeed = base + (cornerSpeed - base) * proximity;

    const current = targetSpeeds.get(car.id) ?? base;
    if (blendedSpeed < current) {
      targetSpeeds.set(car.id, blendedSpeed);
    }
  }

  // 6. Apply speeds with smooth acceleration/deceleration
  for (const car of cars) {
    if (!isDriving(car.state)) continue;
    const ts = targetSpeeds.get(car.id) ?? getBaseSpeed(car.edgeId, car.isTruck);
    if (car.speed < ts) {
      car.speed = Math.min(car.speed + CAR_ACCEL, ts);
    } else if (car.speed > ts) {
      car.speed = Math.max(car.speed - CAR_DECEL, ts);
    }

    // Tick u-turn cooldown
    if (car.uTurnCooldown > 0) car.uTurnCooldown--;

    // Reroute or u-turn if stuck in traffic
    if (car.speed <= 0) {
      car.stuckFrames++;
      if (car.stuckFrames >= UTURN_STUCK_THRESHOLD) {
        // Long stuck: attempt u-turn, fall back to in-place reroute
        car.stuckFrames = 0;
        if (!performUTurn(car)) {
          rerouteCarInPlace(car);
        }
      } else if (car.stuckFrames === 90) {
        // Medium stuck: try replanning from current position (counter keeps climbing)
        rerouteCarInPlace(car);
      }
    } else {
      car.stuckFrames = 0;
    }
  }

  // Move driving cars
  for (const car of cars) {
    if (!isDriving(car.state)) continue;
    if (car.speed <= 0) continue;

    const edge = edges.get(car.edgeId);
    if (!edge) continue;

    const dt = car.speed / edge.length;
    if (car.edgeDir === 1) {
      car.t += dt;
    } else {
      car.t -= dt;
    }

    const reachedEnd = (car.edgeDir === 1 && car.t >= 1) || (car.edgeDir === -1 && car.t <= 0);

    if (reachedEnd) {
      car.t = car.edgeDir === 1 ? 1 : 0;

      if (car.pathIndex < car.path.length) {
        const nextNodeKey = car.path[car.pathIndex];
        car.pathIndex++;

        if (car.pathIndex < car.path.length) {
          const nextNextKey = car.path[car.pathIndex];
          const nextEdge = getEdgeBetween(nextNodeKey, nextNextKey);
          if (nextEdge) {
            const nd: 1 | -1 = nextEdge.fromKey === nextNodeKey ? 1 : -1;
            // Guard: don't enter next edge if a car is too close to the entry point
            if (!isEdgeEntryClear(nextEdge.id, nextNodeKey, nextNextKey, car.edgeId)) {
              // Stay at end of current edge, stopped
              car.pathIndex--;
              car.speed = 0;
            } else {
              car.edgeId = nextEdge.id;
              car.edgeDir = nd;
              car.t = nd === 1 ? 0 : 1;
              if (nextEdge.narrow) lockNarrowChain(nextEdge.id, nd);
            }
          }
        } else {
          // Arrived at destination
          const prevState = car.state as Car['state'];
          const targetBuildingId = getArrivalTarget(car, prevState);
          const targetBuilding = buildingById.get(targetBuildingId);
          if (targetBuilding) {
            // Disabled factory — turn around
            if (targetBuilding.type === 'factory' && targetBuilding.disabled && (prevState === 'toWork' || prevState === 'toFactory')) {
              car.nextState = car.isTruck ? 'toStorage' : 'toHome';
              startDriving(car, cars.indexOf(car));
            } else {
              // Check if building is full or has a car mid-animation
              let blocked = false;
              const targetBuildingCars = buildingCarIndex.get(targetBuildingId);
              if ((targetBuilding.type === 'factory' || targetBuilding.type === 'storage') && targetBuilding.maxParkedCars > 0) {
                if (targetBuilding.type === 'storage' && !car.isTruck) {
                  // Storage: cars can enter freely (one at a time via animation check),
                  // but trucks don't block car entry
                  const carAnimating = hasAnimatingCar(targetBuildingCars, false);
                  if (carAnimating) blocked = true;
                } else {
                  const parkedCount = countParkedCars(targetBuildingCars);
                  const hasAnimating = hasAnimatingCar(targetBuildingCars);
                  if (parkedCount >= targetBuilding.maxParkedCars || hasAnimating) {
                    blocked = true;
                  }
                }
              }
              // Trucks can only enter factories when the parking lot is completely empty
              // Regular cars cannot enter a factory while a truck is inside
              if (targetBuilding.type === 'factory') {
                const truckInside = hasTruckInside(targetBuildingCars, car);
                if (car.isTruck) {
                  // Truck needs empty lot
                  const anyoneInside = hasAnyOccupant(targetBuildingCars, car);
                  if (anyoneInside) blocked = true;
                } else if (truckInside) {
                  blocked = true;
                }
              }

              if (blocked) {
                car.pathIndex--;
                car.speed = 0;
              } else {
                car.nextState = getNextState(car, prevState);
                car.parkStartX = car.x;
                car.parkStartY = car.y;
                car.parkProgress = 0;
                car.state = 'parking';
                addBuildingOccupant(buildingCarIndex, car);
                const updatedTargetBuildingCars = buildingCarIndex.get(targetBuildingId);

                if (targetBuilding.type === 'factory' || targetBuilding.type === 'storage') {
                  const bp = getFactoryParkPath(updatedTargetBuildingCars, targetBuildingId, car);
                  car.parkStartX = bp.p0x;
                  car.parkStartY = bp.p0y;
                  car.parkCx1 = bp.p1x;
                  car.parkCy1 = bp.p1y;
                  car.parkCx2 = bp.p2x;
                  car.parkCy2 = bp.p2y;
                  car.parkTargetX = bp.p3x;
                  car.parkTargetY = bp.p3y;
                  car.parkEndAngle = bp.endAngle;
                  car.parkSlot = bp.slot;
                } else {
                  // House: lane-aware entry
                  const hp = getHouseParkPath(targetBuildingId, car);
                  car.parkStartX = hp.p0x;
                  car.parkStartY = hp.p0y;
                  car.parkCx1 = hp.p1x;
                  car.parkCy1 = hp.p1y;
                  car.parkCx2 = hp.p2x;
                  car.parkCy2 = hp.p2y;
                  car.parkTargetX = hp.p3x;
                  car.parkTargetY = hp.p3y;
                  car.parkEndAngle = hp.endAngle;
                }
              }
            }
          }
        }
      }
    }

    if (isDriving(car.state)) {
      updateCarPosition(car);
    }
  }
}

// Reroute a driving car in place — keeps the car on its current edge, only changes path ahead
function rerouteCarInPlace(car: Car) {
  if (car.pathIndex >= car.path.length) return;
  const edge = edges.get(car.edgeId);
  if (!edge) return;

  // The node the car is heading toward
  const targetNode = car.path[car.pathIndex];
  // The node behind the car
  const behindNode = car.path[car.pathIndex - 1] ?? car.path[0];
  if (!targetNode) return;

  let destKey: string | null = null;
  if (car.state === 'toWork') {
    const sameColorSources = buildings.filter(b =>
      (b.type === 'factory' || b.type === 'storage') && b.color === car.color && !b.disabled);
    const result = pickBestPinSource(targetNode, sameColorSources);
    if (result) {
      car.workBuildingId = result.building.id;
      destKey = result.building.nodeKey;
    }
  } else if (car.state === 'toFactory') {
    const sameColorFactories = buildings.filter(b => b.type === 'factory' && b.color === car.color && !b.disabled);
    const result = pickBestFactory(targetNode, sameColorFactories);
    if (result) {
      car.workBuildingId = result.factory.id;
      destKey = result.factory.nodeKey;
    }
  } else if (car.state === 'toStorage') {
    const storage = buildingById.get(car.storageBuildingId);
    if (storage) destKey = storage.nodeKey;
  } else {
    const home = buildingById.get(car.homeBuildingId);
    if (home) destKey = home.nodeKey;
  }

  if (!destKey) return;
  const newPath = findPath(targetNode, destKey);
  if (!newPath || newPath.length < 2) return;

  // Keep car on current edge, only update the path ahead
  car.path = [behindNode, ...newPath];
  car.pathIndex = 1;
}

// Attempt a u-turn: reverse direction on current edge and replan
function performUTurn(car: Car): boolean {
  const edge = edges.get(car.edgeId);
  if (!edge) return false;

  // Guards: no u-turns on narrow, one-way, highway, or roundabout edges
  if (edge.narrow) return false;
  if (edge.oneway) return false;
  if (highwayEdgeSet.has(car.edgeId)) return false;
  if (roundaboutEdgeSet.has(car.edgeId)) return false;
  if (tunnelEdgeSet.has(car.edgeId)) return false;

  // Cooldown and anti-oscillation
  if (car.uTurnCooldown > 0) return false;
  if (car.lastUTurnEdgeId === car.edgeId) return false;

  // Don't u-turn near edge endpoints — regular rerouting at the node is better
  if (car.t < 0.1 || car.t > 0.9) return false;

  // Need valid path nodes
  const forwardNode = car.path[car.pathIndex];
  const behindNode = car.path[car.pathIndex - 1];
  if (!forwardNode || !behindNode) return false;

  // Check opposite lane is clear (oncoming cars on same edge)
  const newDir: 1 | -1 = car.edgeDir === 1 ? -1 : 1;
  const clearance = (MIN_GAP + CAR_LEN) * 2;
  for (const c of cars) {
    if (c.id === car.id) continue;
    if (c.edgeId !== car.edgeId) continue;
    if (!isDriving(c.state)) continue;
    if (c.edgeDir === newDir) {
      const dist = Math.abs(c.t - car.t) * edge.length;
      if (dist < clearance) return false;
    }
  }

  // Find destination for new path
  let destKey: string | null = null;
  if (car.state === 'toWork') {
    const work = buildingById.get(car.workBuildingId);
    if (work) destKey = work.nodeKey;
  } else if (car.state === 'toHome') {
    const home = buildingById.get(car.homeBuildingId);
    if (home) destKey = home.nodeKey;
  } else if (car.state === 'toFactory') {
    const work = buildingById.get(car.workBuildingId);
    if (work) destKey = work.nodeKey;
  } else if (car.state === 'toStorage') {
    const storage = buildingById.get(car.storageBuildingId);
    if (storage) destKey = storage.nodeKey;
  }
  if (!destKey) return false;

  // Compute new path from the node we'll now head toward
  const newPath = findPath(behindNode, destKey);
  if (!newPath || newPath.length < 2) return false;

  // Execute the u-turn
  car.edgeDir = newDir;
  car.path = [forwardNode, ...newPath];
  car.pathIndex = 1;
  car.speed = 0;
  car.stuckFrames = 0;
  car.uTurnCooldown = UTURN_COOLDOWN;
  car.lastUTurnEdgeId = car.edgeId;

  updateCarPosition(car);
  return true;
}

function startDriving(car: Car, carIndex: number, buildingCarIndex?: BuildingCarIndex) {
  removeBuildingOccupant(buildingCarIndex, car);

  // Determine origin building (where the car is departing from)
  const parkedAtId = getParkedBuildingId(car);
  const origin = buildingById.get(parkedAtId);
  if (!origin) {
    cars.splice(carIndex, 1);
    return;
  }

  let path: string[] | null = null;

  if (car.nextState === 'toWork') {
    // Regular car: re-evaluate which factory/storage to pick up from
    const sameColorSources = buildings.filter(b =>
      (b.type === 'factory' || b.type === 'storage') && b.color === car.color);
    const result = pickBestPinSource(origin.nodeKey, sameColorSources);
    if (result) {
      car.workBuildingId = result.building.id;
      path = result.path;
    }
  } else if (car.nextState === 'toHome') {
    // Regular car going home
    const home = buildingById.get(car.homeBuildingId);
    if (home) {
      path = findPath(origin.nodeKey, home.nodeKey);
    }
  } else if (car.nextState === 'toFactory') {
    // Truck: pick best factory — always allow targeting even if "need" is low
    const sameColorFactories = buildings.filter(b => b.type === 'factory' && b.color === car.color && !b.disabled);
    // Try scored selection first
    let result = pickBestFactory(origin.nodeKey, sameColorFactories);
    if (!result) {
      // Fallback: pick nearest reachable factory regardless of need
      let bestPath: string[] | null = null;
      let bestLen = Infinity;
      let bestFactory: typeof buildings[0] | null = null;
      for (const f of sameColorFactories) {
        const p = findPath(origin.nodeKey, f.nodeKey);
        if (p && p.length >= 2 && p.length < bestLen) {
          bestLen = p.length;
          bestPath = p;
          bestFactory = f;
        }
      }
      if (bestFactory && bestPath) {
        result = { factory: bestFactory, path: bestPath };
      }
    }
    if (result) {
      car.workBuildingId = result.factory.id;
      path = result.path;
    }
  } else if (car.nextState === 'toStorage') {
    // Truck: go home to storage
    const storage = buildingById.get(car.storageBuildingId);
    if (storage) {
      path = findPath(origin.nodeKey, storage.nodeKey);
    }
  }

  if (!path || path.length < 2) {
    car.state = 'parked';
    car.parkTimer = 60;
    addBuildingOccupant(buildingCarIndex, car);
    return;
  }

  const edge = getEdgeBetween(path[0], path[1]);
  if (!edge) {
    car.state = 'parked';
    car.parkTimer = 10;
    addBuildingOccupant(buildingCarIndex, car);
    return;
  }
  if (!isEdgeEntryClear(edge.id, path[0], path[1])) {
    car.state = 'parked';
    car.parkTimer = 10;
    addBuildingOccupant(buildingCarIndex, car);
    return;
  }

  car.state = car.nextState;
  car.path = path;
  car.pathIndex = 1;
  car.edgeId = edge.id;
  car.edgeDir = edge.fromKey === path[0] ? 1 : -1;
  car.t = car.edgeDir === 1 ? 0 : 1;
  car.speed = car.isTruck ? TRUCK_SPEED : CAR_SPEED;
  car.targetAngle = computeEdgeAngle(edge, car.edgeDir);
  if (edge.narrow) lockNarrowChain(edge.id, car.edgeDir);
  updateCarPosition(car);
}

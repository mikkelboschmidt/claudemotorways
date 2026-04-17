import { Car, Building } from './types.ts';
import { gameSpeed } from './speed.ts';
import { edges } from './graph.ts';
import { highways } from './highway.ts';
import { roundabouts } from './roundabout.ts';

export let score = 0;
export let collected = 0;
export let collectedPerMinute = 0;
export let generatedPerMinute = 0;
export let stalledVehicles = 0;
export let vehicleCount = 0;
export let productivityScore = 0;
export let peakProductivity = 0;
export let metricsExpanded = false;

// Real-time ms timestamps of each collection (for 15s rolling rate window)
const collectionTimes: number[] = [];
const RATE_WINDOW_MS = 15_000;

// Per-car stall tracking: id → {x, y, firstSlowMs}
// A car is stalled once it has been within STALL_RADIUS px for STALL_DURATION_MS
const stallTracker = new Map<number, { x: number; y: number; firstSlowMs: number }>();
const STALL_RADIUS = 8;        // px — less than this counts as not moving
const STALL_DURATION_MS = 6_000; // 6 real seconds

export function addScore(points: number) {
  score += points;
  if (points > 0) {
    collected += points;
    collectionTimes.push(performance.now());
  }
}

export function setScore(value: number) {
  score = value;
}

export function setCollected(value: number) {
  collected = value;
}

export function toggleMetricsExpanded() {
  metricsExpanded = !metricsExpanded;
}

// Pins per factory per sim-minute at 1× speed (900 frames / 60fps = 15s per pin, × 4 = 4/min)
const PINS_PER_FACTORY_PER_SIM_MIN = 4;

// Called every 1s from main.ts
export function updateMetrics(cars: Car[], buildings: Building[]) {
  const now = performance.now();
  const cutoff = now - RATE_WINDOW_MS;

  // Prune timestamps older than 15s
  let i = 0;
  while (i < collectionTimes.length && collectionTimes[i] < cutoff) i++;
  if (i > 0) collectionTimes.splice(0, i);

  // Collected per minute = count in last 15s × 4, normalized to 1× sim speed
  const effectiveSpeed = gameSpeed > 0 ? gameSpeed : 1;
  collectedPerMinute = Math.round(collectionTimes.length * (60_000 / RATE_WINDOW_MS) / effectiveSpeed);

  // Generated per minute = active (non-disabled) factories × 4 pins/sim-min
  const activeFactories = buildings.filter(b => b.type === 'factory' && !b.disabled).length;
  generatedPerMinute = activeFactories * PINS_PER_FACTORY_PER_SIM_MIN;

  // Vehicle counts
  vehicleCount = cars.length;

  // Stale = driving vehicles currently at speed 0
  const drivingStates = new Set(['toWork', 'toHome', 'toStorage', 'toFactory']);
  const driving = cars.filter(c => drivingStates.has(c.state));
  const drivingIds = new Set(driving.map(c => c.id));

  // Evict cars that are no longer driving
  for (const id of stallTracker.keys()) {
    if (!drivingIds.has(id)) stallTracker.delete(id);
  }

  // Update stall tracker for driving cars
  for (const car of driving) {
    const entry = stallTracker.get(car.id);
    if (entry) {
      const dist = Math.hypot(car.x - entry.x, car.y - entry.y);
      if (dist > STALL_RADIUS) {
        // Car made meaningful progress — reset
        stallTracker.set(car.id, { x: car.x, y: car.y, firstSlowMs: now });
      }
      // else: still within radius, keep firstSlowMs
    } else {
      stallTracker.set(car.id, { x: car.x, y: car.y, firstSlowMs: now });
    }
  }

  stalledVehicles = [...stallTracker.values()].filter(e => now - e.firstSlowMs >= STALL_DURATION_MS).length;

  // --- Productivity score ---
  // Base throughput: how many pins are being collected per minute
  const baseThroughput = collectedPerMinute;

  // Flow quality: penalize stalled vehicles and idle vehicles
  const staleRatio = driving.length > 0 ? 1 - stalledVehicles / driving.length : 1;
  const flowFactor = cars.length > 0 ? cars.filter(c => c.speed > 0).length / cars.length : 1;
  const flowQuality = staleRatio * (0.4 + 0.6 * flowFactor);

  // Scale multiplier: reward larger, more complex cities
  // Count active buildings and infrastructure
  const activeFactoryCount = activeFactories;
  const houseCount = buildings.filter(b => b.type === 'house').length;
  const storageCount = buildings.filter(b => b.type === 'storage').length;
  const totalBuildings = houseCount + activeFactoryCount + storageCount;
  const roadCount = edges.size;
  const highwayCount = highways.length;
  const roundaboutCount = roundabouts.length;

  // Scale grows logarithmically: a 20-building city with highways and roundabouts
  // gets ~2× multiplier vs a 3-building starter city
  const infraScore = totalBuildings + roadCount * 0.1 + highwayCount * 0.5 + roundaboutCount * 0.3;
  const scaleMultiplier = 1 + Math.log2(Math.max(1, infraScore)) * 0.15;

  // Burnout penalty: each burned factory drags productivity down
  const burnedFactories = buildings.filter(b => b.type === 'factory' && b.disabled).length;
  const burnoutPenalty = Math.max(0, 1 - burnedFactories * 0.1);

  productivityScore = Math.round(baseThroughput * flowQuality * scaleMultiplier * burnoutPenalty);
  if (productivityScore > peakProductivity) peakProductivity = productivityScore;
}

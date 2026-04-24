import { Car, Building } from './types.ts';
import { gameSpeed } from './speed.ts';
import { edges } from './graph.ts';
import { highways } from './highway.ts';
import { roundabouts } from './roundabout.ts';
import { getGameClockMs, updateGameClock } from './gameClock.ts';

export let score = 0;
export let collected = 0;
export let collectedPerMinute = 0;
export let generatedPerMinute = 0;
export let stalledVehicles = 0;
export let vehicleCount = 0;
export let productivityScore = 0;
export let displayProductivityScore = 0;
export let peakProductivity = 0;
export let metricsExpanded = false;
export let productivityBreakdown = {
  throughput: 0,
  flow: 100,
  logistics: 100,
  stability: 100,
  cityBonus: 0,
};
export const productivityHistory: { time: number; value: number }[] = [];
export const PRODUCTIVITY_CHART_WINDOW_MS = 180_000;

// Sim-clock timestamps of each collection (for a rolling productivity window)
const collectionTimes: number[] = [];
const RATE_WINDOW_MS = 30_000;
const ACTIVITY_BUCKET_MS = 5_000;
const ACTIVITY_BUCKET_COUNT = RATE_WINDOW_MS / ACTIVITY_BUCKET_MS;
const PRODUCTIVITY_SMOOTHING = 0.2;

// Per-car stall tracking: id → {x, y, firstGameMs}
// A car is stalled once it has been within STALL_RADIUS px for STALL_DURATION_MS
const stallTracker = new Map<number, { x: number; y: number; firstGameMs: number }>();
const STALL_RADIUS = 8;        // px — less than this counts as not moving
const STALL_DURATION_MS = 6_000; // 6 simulated seconds

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function addScore(points: number) {
  score += points;
  if (points > 0) {
    collected += points;
    collectionTimes.push(updateGameClock());
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
  const now = getGameClockMs();

  // When paused, game clock doesn't advance — metrics stay frozen
  if (gameSpeed === 0) return;

  const cutoff = now - RATE_WINDOW_MS;

  // Prune timestamps older than the rolling window
  let i = 0;
  while (i < collectionTimes.length && collectionTimes[i] < cutoff) i++;
  if (i > 0) collectionTimes.splice(0, i);

  // Collected per minute in simulation time. Playback speed should not affect it.
  collectedPerMinute = Math.round(collectionTimes.length * (60_000 / RATE_WINDOW_MS));

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
        stallTracker.set(car.id, { x: car.x, y: car.y, firstGameMs: now });
      }
      // else: still within radius, keep firstGameMs
    } else {
      stallTracker.set(car.id, { x: car.x, y: car.y, firstGameMs: now });
    }
  }

  stalledVehicles = [...stallTracker.values()].filter(e => now - e.firstGameMs >= STALL_DURATION_MS).length;

  // --- Productivity score ---
  const baseThroughput = collectedPerMinute;
  const activeFactoryCount = activeFactories;
  const houses = buildings.filter(b => b.type === 'house');
  const factories = buildings.filter(b => b.type === 'factory');
  const storages = buildings.filter(b => b.type === 'storage');

  const activeBucketFlags = new Array<boolean>(ACTIVITY_BUCKET_COUNT).fill(false);
  for (const time of collectionTimes) {
    const bucketIndex = Math.min(
      ACTIVITY_BUCKET_COUNT - 1,
      Math.max(0, Math.floor((time - cutoff) / ACTIVITY_BUCKET_MS)),
    );
    activeBucketFlags[bucketIndex] = true;
  }
  const activeBuckets = activeBucketFlags.reduce((sum, active) => sum + (active ? 1 : 0), 0);
  const continuity = activeBuckets / ACTIVITY_BUCKET_COUNT;
  const handlingRate = generatedPerMinute > 0 ? clamp01(collectedPerMinute / Math.max(1, generatedPerMinute)) : 1;

  const movingVehicles = cars.filter(c => c.speed > 0).length;
  const stalledRatio = driving.length > 0 ? stalledVehicles / driving.length : 0;
  const movingRatio = cars.length > 0 ? movingVehicles / cars.length : 1;
  const flowQuality = clamp01(0.55 * (1 - stalledRatio) + 0.45 * movingRatio);

  const storageFillRatios = storages
    .filter(b => b.maxPins > 0)
    .map(b => b.pins / b.maxPins);
  const storageUtilization = storageFillRatios.length > 0
    ? average(storageFillRatios.map(ratio => 1 - Math.min(1, Math.abs(ratio - 0.5) / 0.5)))
    : 0.6;
  const trucks = cars.filter(c => c.isTruck);
  const activeTruckRatio = trucks.length > 0
    ? trucks.filter(c => c.pinsCarried > 0 || c.state === 'toStorage' || c.state === 'toFactory').length / trucks.length
    : 0.6;
  const logisticsQuality = clamp01(0.55 * storageUtilization + 0.45 * activeTruckRatio);

  const factoryFillRatios = factories
    .filter(b => b.maxPins > 0)
    .map(b => b.pins / b.maxPins);
  const overflowPressure = factoryFillRatios.length > 0
    ? average(factoryFillRatios.map(ratio => clamp01((ratio - 0.65) / 0.35)))
    : 0;
  const stability = clamp01(1 - overflowPressure * 0.75 - stalledRatio * 0.5);

  const houseCount = houses.length;
  const storageCount = storages.length;
  const totalBuildings = houseCount + activeFactoryCount + storageCount;
  const roadCount = edges.size;
  const highwayCount = highways.length;
  const roundaboutCount = roundabouts.length;
  const builtTypes = [houseCount, activeFactoryCount, storageCount].filter(count => count > 0).length;
  const diversityBonus = builtTypes === 3 ? 0.12 : builtTypes === 2 ? 0.05 : 0;
  const infrastructureBonus = Math.min(0.2, roadCount * 0.003 + highwayCount * 0.03 + roundaboutCount * 0.025);
  const footprint = totalBuildings > 1
    ? (() => {
        const xs = buildings.map(b => b.gx + b.w / 2);
        const ys = buildings.map(b => b.gy + b.h / 2);
        return (Math.max(...xs) - Math.min(...xs)) + (Math.max(...ys) - Math.min(...ys));
      })()
    : 0;
  const expansionBonus = Math.min(0.2, footprint / 70);

  const houseById = new Map(houses.map(b => [b.id, b] as const));
  const factoryById = new Map(factories.map(b => [b.id, b] as const));
  const storageById = new Map(storages.map(b => [b.id, b] as const));
  const averageDistance = average([
    ...cars.filter(c => !c.isTruck).map(c => {
      const home = houseById.get(c.homeBuildingId);
      const work = factoryById.get(c.workBuildingId) ?? storageById.get(c.workBuildingId);
      if (!home || !work) return 0;
      return Math.hypot((home.gx + home.w / 2) - (work.gx + work.w / 2), (home.gy + home.h / 2) - (work.gy + work.h / 2));
    }),
    ...trucks.map(c => {
      const storage = storageById.get(c.storageBuildingId);
      const work = factoryById.get(c.workBuildingId);
      if (!storage || !work) return 0;
      return Math.hypot((storage.gx + storage.w / 2) - (work.gx + work.w / 2), (storage.gy + storage.h / 2) - (work.gy + work.h / 2));
    }),
  ].filter(distance => distance > 0));
  const distanceBonus = Math.min(0.18, averageDistance / 60);

  const cityBonus = 1 + diversityBonus + infrastructureBonus + expansionBonus + distanceBonus;
  const quality = 0.35 * flowQuality + 0.25 * logisticsQuality + 0.25 * stability + 0.15 * (0.55 * continuity + 0.45 * handlingRate);

  productivityScore = Math.round(baseThroughput * cityBonus * quality);
  productivityBreakdown = {
    throughput: baseThroughput,
    flow: Math.round(flowQuality * 100),
    logistics: Math.round(logisticsQuality * 100),
    stability: Math.round(stability * 100),
    cityBonus: Math.round((cityBonus - 1) * 100),
  };
  productivityHistory.push({ time: now, value: productivityScore });
  const chartCutoff = now - PRODUCTIVITY_CHART_WINDOW_MS;
  while (productivityHistory.length > 0 && productivityHistory[0].time < chartCutoff) {
    productivityHistory.shift();
  }
  displayProductivityScore += (productivityScore - displayProductivityScore) * PRODUCTIVITY_SMOOTHING;
  if (productivityScore > peakProductivity) peakProductivity = productivityScore;
}

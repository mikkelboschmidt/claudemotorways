import { FACTORY_MAX_PINS } from './constants.ts';
import type { Building, Car } from './types.ts';

export function factoryNeed(factory: Building, cars: Car[]): number {
  let carsAssigned = 0;
  for (const c of cars) {
    if (c.workBuildingId === factory.id && (c.state === 'toWork' || c.state === 'parking' || c.state === 'parked' || c.state === 'collecting')) {
      carsAssigned++;
    }
  }
  return factory.pins - carsAssigned + 1;
}

// Hysteresis margin: only switch away from currentBuildingId if the alternative
// scores at least this much higher. Prevents mid-trip target flipping when
// scores are near-equal.
const RETARGET_HYSTERESIS = 5;

export function pickBestFactory(
  fromNodeKey: string,
  factories: Building[],
  cars: Car[],
  findPath: (startKey: string, endKey: string) => string[] | null,
  currentBuildingId?: number,
): { factory: Building; path: string[] } | null {
  let best: { factory: Building; path: string[]; score: number } | null = null;
  let current: { factory: Building; path: string[]; score: number } | null = null;

  for (const factory of factories) {
    if (factory.disabled) continue;
    const need = factoryNeed(factory, cars);
    if (need <= 0 && factory.pins === 0) continue;

    const path = findPath(fromNodeKey, factory.nodeKey);
    if (!path || path.length < 2) continue;

    const score = need * 10 - path.length;
    const entry = { factory, path, score };
    if (!best || score > best.score) best = entry;
    if (currentBuildingId !== undefined && factory.id === currentBuildingId) current = entry;
  }

  if (current && best && best.factory.id !== current.factory.id && best.score - current.score < RETARGET_HYSTERESIS) {
    return { factory: current.factory, path: current.path };
  }
  return best ? { factory: best.factory, path: best.path } : null;
}

export function pickBestPinSource(
  fromNodeKey: string,
  targets: Building[],
  cars: Car[],
  findPath: (startKey: string, endKey: string) => string[] | null,
  currentBuildingId?: number,
): { building: Building; path: string[] } | null {
  let best: { building: Building; path: string[]; score: number } | null = null;
  let current: { building: Building; path: string[]; score: number } | null = null;

  for (const target of targets) {
    if (target.disabled) continue;
    let need: number;
    if (target.type === 'factory') {
      need = factoryNeed(target, cars);
      if (need <= 0 && target.pins === 0) continue;
    } else {
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
      score = need * 10 + 15 - path.length;
    } else {
      const urgency = target.pins / FACTORY_MAX_PINS;
      score = need * 10 * (1 + urgency * 2) - path.length;
    }
    const entry = { building: target, path, score };
    if (!best || score > best.score) best = entry;
    if (currentBuildingId !== undefined && target.id === currentBuildingId) current = entry;
  }

  if (current && best && best.building.id !== current.building.id && best.score - current.score < RETARGET_HYSTERESIS) {
    return { building: current.building, path: current.path };
  }
  return best ? { building: best.building, path: best.path } : null;
}


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

export function pickBestFactory(
  fromNodeKey: string,
  factories: Building[],
  cars: Car[],
  findPath: (startKey: string, endKey: string) => string[] | null,
): { factory: Building; path: string[] } | null {
  let best: { factory: Building; path: string[] } | null = null;
  let bestScore = -Infinity;

  for (const factory of factories) {
    if (factory.disabled) continue;
    const need = factoryNeed(factory, cars);
    if (need <= 0 && factory.pins === 0) continue;

    const path = findPath(fromNodeKey, factory.nodeKey);
    if (!path || path.length < 2) continue;

    const score = need * 10 - path.length;
    if (score > bestScore) {
      bestScore = score;
      best = { factory, path };
    }
  }
  return best;
}

export function pickBestPinSource(
  fromNodeKey: string,
  targets: Building[],
  cars: Car[],
  findPath: (startKey: string, endKey: string) => string[] | null,
): { building: Building; path: string[] } | null {
  let best: { building: Building; path: string[] } | null = null;
  let bestScore = -Infinity;

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
    if (score > bestScore) {
      bestScore = score;
      best = { building: target, path };
    }
  }
  return best;
}


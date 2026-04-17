import { CAR_LEN, CAR_WID, TRUCK_WID, LANE_W } from './constants.ts';
import { getBuildingCenter, getBuildingPixelPos, getConnectionPixelPos } from './buildings.ts';
import { Car } from './types.ts';
import type { Building } from './types.ts';
import { getFactorySprite, getStorageSprite, type ParkingRect } from './sprites.ts';

function getFactoryParkSlot(buildingCars: Set<Car> | undefined, building: Building, car: Car): number {
  // Find the farthest available slot. Slot 0 = nearest entrance, higher = deeper.
  const maxSlots = building.maxParkedCars || 3;
  const takenSlots = new Set<number>();
  if (buildingCars) for (const c of buildingCars) {
    if (c === car) continue;
    if (c.isTruck !== car.isTruck) continue; // trucks and cars use separate slot ranges
    takenSlots.add(c.parkSlot);
  }
  for (let s = maxSlots - 1; s >= 0; s--) {
    if (!takenSlots.has(s)) return s;
  }
  return 0;
}

export function getFactoryParkPath(buildingCars: Set<Car> | undefined, building: Building, car: Car): {
  p0x: number; p0y: number;
  p1x: number; p1y: number;
  p2x: number; p2y: number;
  p3x: number; p3y: number;
  endAngle: number;
  slot: number;
} {
  const pos = getBuildingPixelPos(building);
  const sprite = getFactorySprite(building.connectionSide, building.color);

  // Use sprite-defined parking rect: trucks use TruckParking (fall back to CarsParking), cars use CarsParking
  let rect: ParkingRect | null | undefined = null;
  if (car.isTruck) {
    rect = sprite?.truckParking ?? sprite?.carsParking;
  } else {
    rect = sprite?.carsParking;
  }

  const p0x = car.x;
  const p0y = car.y;

  if (rect) {
    const slot = getFactoryParkSlot(buildingCars, building, car);
    const vehW = car.isTruck ? TRUCK_WID : CAR_WID;
    const gap = 4;
    const spotSpacing = vehW + gap;

    // Slot layout and endAngle depend on connection side.
    // Left/right: cars enter horizontally, turn 90° to face down, line up along rect width.
    // Top/bottom: cars enter vertically, continue straight, line up along rect width.
    let p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number, endAngle: number;

    switch (building.connectionSide) {
      case 'left': {
        // Enters from left going right → turns to face down (π/2)
        p3x = pos.x + rect.x + vehW / 2 + gap / 2 + slot * spotSpacing;
        p3y = pos.y + rect.y + rect.h / 2;
        endAngle = Math.PI / 2;
        const midY = (p0y + p3y) / 2;
        p1x = p0x * 0.6 + p3x * 0.4;
        p1y = midY;
        p2x = p3x;
        p2y = midY;
        break;
      }
      case 'right': {
        // Enters from right going left → turns to face down (π/2)
        p3x = pos.x + rect.x + vehW / 2 + gap / 2 + slot * spotSpacing;
        p3y = pos.y + rect.y + rect.h / 2;
        endAngle = Math.PI / 2;
        const midY = (p0y + p3y) / 2;
        p1x = p0x * 0.6 + p3x * 0.4;
        p1y = midY;
        p2x = p3x;
        p2y = midY;
        break;
      }
      case 'top': {
        // Enters from top going down → parks facing down (π/2), gentle lateral shift
        p3x = pos.x + rect.x + vehW / 2 + gap / 2 + slot * spotSpacing;
        p3y = pos.y + rect.y + rect.h / 2;
        endAngle = Math.PI / 2;
        const midY = (p0y + p3y) / 2;
        p1x = p0x * 0.6 + p3x * 0.4;
        p1y = midY;
        p2x = p3x;
        p2y = midY;
        break;
      }
      case 'bottom': {
        // Enters from bottom going up → parks facing up (-π/2), gentle lateral shift
        p3x = pos.x + rect.x + vehW / 2 + gap / 2 + slot * spotSpacing;
        p3y = pos.y + rect.y + rect.h / 2;
        endAngle = -Math.PI / 2;
        const midY = (p0y + p3y) / 2;
        p1x = p0x * 0.6 + p3x * 0.4;
        p1y = midY;
        p2x = p3x;
        p2y = midY;
        break;
      }
    }

    return { p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, endAngle, slot };
  }

  // Fallback to center of building
  const center = getBuildingCenter(building);
  const slot = getFactoryParkSlot(buildingCars, building, car);
  const p1x = (p0x * 2 + center.x) / 3;
  const p1y = (p0y * 2 + center.y) / 3;
  const p2x = (p0x + center.x * 2) / 3;
  const p2y = (p0y + center.y * 2) / 3;
  return { p0x, p0y, p1x, p1y, p2x, p2y, p3x: center.x, p3y: center.y, endAngle: 0, slot };
}

export function getStorageParkPath(building: Building, car: Car): {
  p0x: number; p0y: number;
  p1x: number; p1y: number;
  p2x: number; p2y: number;
  p3x: number; p3y: number;
  endAngle: number;
  slot: number;
} {
  const pos = getBuildingPixelPos(building);
  const sprite = getStorageSprite(building.connectionSide, building.color);
  const rect: ParkingRect | null | undefined = car.isTruck ? sprite?.truckParking : sprite?.carsParking;

  const p0x = car.x;
  const p0y = car.y;

  if (rect) {
    // Park at center of the sprite-defined rect
    const p3x = pos.x + rect.x + rect.w / 2;
    const p3y = pos.y + rect.y + rect.h / 2;
    // End angle: align along the longer axis of the rect
    const endAngle = rect.w > rect.h ? 0 : Math.PI / 2;
    const p1x = (p0x * 2 + p3x) / 3;
    const p1y = (p0y * 2 + p3y) / 3;
    const p2x = (p0x + p3x * 2) / 3;
    const p2y = (p0y + p3y * 2) / 3;
    return { p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, endAngle, slot: car.isTruck ? -1 : 0 };
  }

  // Fallback to center of building
  const center = getBuildingCenter(building);
  const p1x = (p0x * 2 + center.x) / 3;
  const p1y = (p0y * 2 + center.y) / 3;
  const p2x = (p0x + center.x * 2) / 3;
  const p2y = (p0y + center.y * 2) / 3;
  return { p0x, p0y, p1x, p1y, p2x, p2y, p3x: center.x, p3y: center.y, endAngle: 0, slot: 0 };
}

export function getHouseParkPath(building: Building, car: Car): {
  p0x: number; p0y: number;
  p1x: number; p1y: number;
  p2x: number; p2y: number;
  p3x: number; p3y: number;
  endAngle: number;
} {
  const center = getBuildingCenter(building);
  const laneOff = LANE_W / 2;

  const p0x = car.x, p0y = car.y;
  let p3x: number, p3y: number, endAngle: number;

  switch (building.connectionSide) {
    case 'right':
      p3x = center.x;
      p3y = center.y - laneOff;
      endAngle = Math.PI;
      break;
    case 'left':
      p3x = center.x;
      p3y = center.y + laneOff;
      endAngle = 0;
      break;
    case 'top':
      p3x = center.x - laneOff;
      p3y = center.y;
      endAngle = Math.PI / 2;
      break;
    case 'bottom':
      p3x = center.x + laneOff;
      p3y = center.y;
      endAngle = -Math.PI / 2;
      break;
  }

  const p1x = (p0x * 2 + p3x) / 3;
  const p1y = (p0y * 2 + p3y) / 3;
  const p2x = (p0x + p3x * 2) / 3;
  const p2y = (p0y + p3y * 2) / 3;

  return { p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, endAngle };
}

export function getFactoryExitPath(building: Building, car: Car): {
  p0x: number; p0y: number;
  p1x: number; p1y: number;
  p2x: number; p2y: number;
  p3x: number; p3y: number;
} {
  const conn = getConnectionPixelPos(building);
  const laneOff = LANE_W / 2;

  const p0x = car.x;
  const p0y = car.y;

  let p3x: number, p3y: number;
  switch (building.connectionSide) {
    case 'left':
      p3x = conn.x; p3y = conn.y - laneOff;
      break;
    case 'right':
      p3x = conn.x; p3y = conn.y + laneOff;
      break;
    case 'top':
      p3x = conn.x + laneOff; p3y = conn.y;
      break;
    case 'bottom':
      p3x = conn.x - laneOff; p3y = conn.y;
      break;
  }

  const p1x = (p0x * 2 + p3x) / 3;
  const p1y = (p0y * 2 + p3y) / 3;
  const p2x = (p0x + p3x * 2) / 3;
  const p2y = (p0y + p3y * 2) / 3;

  return { p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y };
}

export function getHouseExitPoint(building: Building): { x: number; y: number } {
  const conn = getConnectionPixelPos(building);
  const laneOff = LANE_W / 2;

  switch (building.connectionSide) {
    case 'right':  return { x: conn.x, y: conn.y + laneOff };
    case 'left':   return { x: conn.x, y: conn.y - laneOff };
    case 'top':    return { x: conn.x + laneOff, y: conn.y };
    case 'bottom': return { x: conn.x - laneOff, y: conn.y };
  }
}


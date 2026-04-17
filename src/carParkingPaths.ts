import { CAR_LEN, CAR_WID, LANE_W } from './constants.ts';
import { getBuildingCenter, getBuildingPixelPos, getConnectionPixelPos } from './buildings.ts';
import { Car } from './types.ts';
import type { Building } from './types.ts';
import { getStorageSprite, type ParkingRect } from './sprites.ts';

function getFactoryParkSlot(buildingCars: Set<Car> | undefined, building: Building, car: Car): number {
  // Find the farthest available slot. Slot 0 = nearest entrance, higher = deeper.
  const maxSlots = building.maxParkedCars || 3;
  const takenSlots = new Set<number>();
  if (buildingCars) for (const c of buildingCars) {
    if (c === car) continue;
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
  const slot = getFactoryParkSlot(buildingCars, building, car);
  const spotSpacing = CAR_WID + 8;
  const margin = 6;

  const p0x = car.x;
  const p0y = car.y;
  let p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number, endAngle: number;

  switch (building.connectionSide) {
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


import { Building, ConnectionSide } from './types.ts';
import { nodeKey, nodes, addEdge, bumpGraphVersion, removeEdge } from './graph.ts';
import { GRID, HALF, PIN_SPAWN_INTERVAL, PIN_COOLDOWN, FACTORY_MAX_PINS, FACTORY_MAX_PARKED, STORAGE_W, STORAGE_H, STORAGE_MAX_PINS, STORAGE_MAX_PARKED } from './constants.ts';
import { resetSpawnTimer, evictCarsFromFactory, removeCarsForBuilding } from './cars.ts';
import { addScore } from './score.ts';
import { getFactorySprite, getStorageSprite } from './sprites.ts';

export const HOUSE_W = 1;
export const HOUSE_H = 1;
export const FACTORY_W = 3;
export const FACTORY_H = 2;
export const STORAGE_W_TILES = STORAGE_W;
export const STORAGE_H_TILES = STORAGE_H;

export const buildings: Building[] = [];

// Fast building lookup by ID
export const buildingById = new Map<number, Building>();

let pinSpawnTimer = 0;

export function updatePins() {
  // Tick down cooldowns every frame
  for (const b of buildings) {
    if (b.pinCooldown > 0) b.pinCooldown--;
  }

  pinSpawnTimer++;
  if (pinSpawnTimer < PIN_SPAWN_INTERVAL) return;
  pinSpawnTimer = 0;
  for (const b of buildings) {
    if (b.type !== 'factory' || b.disabled) continue;
    if (b.pins < b.maxPins) {
      b.pins++;
      b.pinCooldown = PIN_COOLDOWN;
    } else {
      // Pins overflowed — shut down the factory
      b.disabled = true;
      b.pins = 0;
      addScore(-20);
      evictCarsFromFactory(b.id);
    }
  }
}

let nextBuildingId = 4;

export function setNextBuildingId(id: number) {
  nextBuildingId = id;
}

// Connection point is the tile ADJACENT to the building (where the road node lives)
export function getConnectionPoint(b: Building): [number, number] {
  const midW = Math.floor(b.w / 2);
  const midH = Math.floor(b.h / 2);
  switch (b.connectionSide) {
    case 'right':  return [b.gx + b.w,     b.gy + midH];
    case 'left':   return [b.gx - 1,       b.gy + midH];
    case 'top':    return [b.gx + midW,     b.gy - 1];
    case 'bottom': return [b.gx + midW,     b.gy + b.h];
  }
}

// Check if a drag endpoint should connect to a building.
// For factories: only matches the exact connection tile with direction pointing in.
// For houses: only matches if the tile is ON the house itself (inside its bounds).
//   The road direction determines which side becomes the entrance.
export function getBuildingEdgeAt(gx: number, gy: number, roadDirGx: number, roadDirGy: number): { building: Building; side: ConnectionSide } | null {
  for (const b of buildings) {
    // All buildings: match if the tile is ON the building itself
    if (gx < b.gx || gx >= b.gx + b.w || gy < b.gy || gy >= b.gy + b.h) continue;
    // Factories only support left/right entrances
    if (b.type === 'factory') {
      if (roadDirGx > 0 && roadDirGy === 0) return { building: b, side: 'right' };
      if (roadDirGx < 0 && roadDirGy === 0) return { building: b, side: 'left' };
    } else {
      if (roadDirGx > 0 && roadDirGy === 0) return { building: b, side: 'right' };
      if (roadDirGx < 0 && roadDirGy === 0) return { building: b, side: 'left' };
      if (roadDirGy > 0 && roadDirGx === 0) return { building: b, side: 'bottom' };
      if (roadDirGy < 0 && roadDirGx === 0) return { building: b, side: 'top' };
    }
  }
  return null;
}

// isDragEndpoint: true when the user dragged directly to/from this building
// (start or end of the road drag landed on the building edge).
// false when a road was merely placed adjacent to the building.
export function connectBuildingOnSide(b: Building, side: ConnectionSide, dragGx: number, dragGy: number, isDragEndpoint: boolean) {
  // All buildings: change side when the user explicitly dragged to/from the building.
  // Factories only support left/right.
  const canChangeSide = isDragEndpoint && (b.type !== 'factory' || side === 'left' || side === 'right');

  if (b.connectionSide !== side && canChangeSide) {
    // Just change the connection side — keep existing road edges intact
    b.connectionSide = side;
    const [newCx, newCy] = getConnectionPoint(b);
    b.nodeKey = nodeKey(newCx, newCy);
  }

  const actualSide = b.connectionSide;
  const [cx, cy] = getConnectionPoint(b);

  if (isDragEndpoint) {
    // If drag tile is on the building itself, the road segments naturally pass
    // through the connection tile — no extra edges needed.
    // If drag tile is outside (adjacent, e.g. factory connection tile),
    // connect the connection point to the drag tile directly.
    const dragOnBuilding = dragGx >= b.gx && dragGx < b.gx + b.w &&
                           dragGy >= b.gy && dragGy < b.gy + b.h;
    if (!dragOnBuilding) {
      // Factory case: drag landed on the connection tile outside the building
      if (dragGx !== cx || dragGy !== cy) {
        // Bridge edges from drag tile to connection point
        if (actualSide === 'right' || actualSide === 'left') {
          const minY = Math.min(dragGy, cy);
          const maxY = Math.max(dragGy, cy);
          for (let y = minY; y < maxY; y++) {
            addEdge(cx, y, cx, y + 1);
          }
        } else {
          const minX = Math.min(dragGx, cx);
          const maxX = Math.max(dragGx, cx);
          for (let x = minX; x < maxX; x++) {
            addEdge(x, cy, x + 1, cy);
          }
        }
      }
      if (nodes.has(nodeKey(dragGx, dragGy)) && !segmentCutsBuilding(cx, cy, dragGx, dragGy)) {
        addEdge(cx, cy, dragGx, dragGy);
      }
    }
  }
  bumpGraphVersion();
}

export function initBuildingNodes() {
  for (const b of buildings) {
    const [cx, cy] = getConnectionPoint(b);
    b.nodeKey = nodeKey(cx, cy);
  }
}

export function addBuilding(gx: number, gy: number, type: 'house' | 'factory' | 'storage', color: string): Building | null {
  const newW = type === 'house' ? HOUSE_W : type === 'storage' ? STORAGE_W : FACTORY_W;
  const newH = type === 'house' ? HOUSE_H : type === 'storage' ? STORAGE_H : FACTORY_H;

  // Remove disabled (burned) buildings that overlap the new placement.
  // Use soft removal — only delete the building entry, preserve road edges.
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i];
    if (!b.disabled) continue;
    const touchX = gx < b.gx + b.w && gx + newW > b.gx;
    const touchY = gy < b.gy + b.h && gy + newH > b.gy;
    if (touchX && touchY) {
      evictCarsFromFactory(b.id);
      removeCarsForBuilding(b.id);
      buildingById.delete(b.id);
      buildings.splice(i, 1);
    }
  }

  for (const b of buildings) {
    const overlapX = gx < b.gx + b.w && gx + newW > b.gx;
    const overlapY = gy < b.gy + b.h && gy + newH > b.gy;
    if (overlapX && overlapY) return null;
  }

  // Reject placement if any tile in the footprint has a road node with edges
  for (let tx = gx; tx < gx + newW; tx++) {
    for (let ty = gy; ty < gy + newH; ty++) {
      const node = nodes.get(nodeKey(tx, ty));
      if (node && node.edges.size > 0) return null;
    }
  }

  let side: ConnectionSide = 'right';

  // Detect nearby roads and orient the entrance toward one
  // Factories only support left/right; houses and storage support all 4 sides
  {
    const candidates: ConnectionSide[] = type === 'factory'
      ? ['right', 'left']
      : ['right', 'left', 'bottom', 'top'];
    const midW = Math.floor(newW / 2);
    const midH = Math.floor(newH / 2);
    for (const s of candidates) {
      let cx: number, cy: number;
      switch (s) {
        case 'right':  cx = gx + newW;  cy = gy + midH; break;
        case 'left':   cx = gx - 1;     cy = gy + midH; break;
        case 'top':    cx = gx + midW;  cy = gy - 1;    break;
        case 'bottom': cx = gx + midW;  cy = gy + newH;  break;
      }
      const node = nodes.get(nodeKey(cx, cy));
      if (node && node.edges.size > 0) {
        side = s;
        break;
      }
    }
  }

  const building: Building = {
    id: nextBuildingId++,
    gx, gy, type, color,
    nodeKey: '',
    connectionSide: side,
    w: newW,
    h: newH,
    pins: 0,
    maxPins: type === 'factory' ? FACTORY_MAX_PINS : type === 'storage' ? STORAGE_MAX_PINS : 0,
    maxParkedCars: type === 'factory' ? FACTORY_MAX_PARKED : type === 'storage' ? STORAGE_MAX_PARKED : 0,
    pinCooldown: 0,
    disabled: false,
  };

  const [cx, cy] = getConnectionPoint(building);
  building.nodeKey = nodeKey(cx, cy);
  buildings.push(building);
  buildingById.set(building.id, building);
  bumpGraphVersion();
  resetSpawnTimer();
  return building;
}

export function removeBuilding(id: number): boolean {
  const idx = buildings.findIndex(b => b.id === id);
  if (idx === -1) return false;

  const b = buildings[idx];
  const [cx, cy] = getConnectionPoint(b);
  const connKey = nodeKey(cx, cy);

  const node = nodes.get(connKey);
  if (node) {
    const edgeIds = [...node.edges];
    for (const eid of edgeIds) {
      removeEdge(eid);
    }
  }

  buildingById.delete(b.id);
  buildings.splice(idx, 1);
  bumpGraphVersion();
  return true;
}

export function findBuildingAtPixel(px: number, py: number): Building | null {
  for (const b of buildings) {
    const bx = b.gx * GRID;
    const by = b.gy * GRID;
    const bw = b.w * GRID;
    const bh = b.h * GRID;
    if (px >= bx && px <= bx + bw && py >= by && py <= by + bh) {
      return b;
    }
  }
  return null;
}

export function getBuildingPixelPos(b: Building): { x: number; y: number; w: number; h: number } {
  return {
    x: b.gx * GRID,
    y: b.gy * GRID,
    w: b.w * GRID,
    h: b.h * GRID,
  };
}

// Connection dot pixel pos sits on the building wall (boundary between building and road tile)
export function getConnectionPixelPos(b: Building): { x: number; y: number } {
  const midW = Math.floor(b.w / 2);
  const midH = Math.floor(b.h / 2);
  switch (b.connectionSide) {
    case 'right':  return { x: (b.gx + b.w) * GRID,       y: (b.gy + midH) * GRID + HALF };
    case 'left':   return { x: b.gx * GRID,                y: (b.gy + midH) * GRID + HALF };
    case 'top':    return { x: (b.gx + midW) * GRID + HALF, y: b.gy * GRID };
    case 'bottom': return { x: (b.gx + midW) * GRID + HALF, y: (b.gy + b.h) * GRID };
  }
}

export function getBuildingCenter(b: Building): { x: number; y: number } {
  return {
    x: b.gx * GRID + b.w * GRID / 2,
    y: b.gy * GRID + b.h * GRID / 2,
  };
}

// Get the pixel position of a specific pin slot in a building
export function getPinPixelPos(b: Building, pinIndex: number): { x: number; y: number } {
  const pos = getBuildingPixelPos(b);

  // Try to get pin placement from sprite
  const sprite = b.type === 'storage'
    ? getStorageSprite(b.connectionSide, b.color)
    : b.type === 'factory'
      ? getFactorySprite(b.connectionSide, b.color)
      : null;
  const pp = sprite?.pinPlacement;

  if (pp) {
    const rows = b.type === 'storage' ? 4 : 2;
    const cols = Math.ceil(b.maxPins / rows);
    const spacing = Math.min(pp.w / cols, pp.h / rows);
    const gridW = cols * spacing;
    const gridH = rows * spacing;
    const startX = pos.x + pp.x + (pp.w - gridW) / 2;
    const startY = pos.y + pp.y + (pp.h - gridH) / 2;
    const col = pinIndex % cols;
    const row = Math.floor(pinIndex / cols);
    return {
      x: startX + col * spacing + spacing / 2,
      y: startY + row * spacing + spacing / 2,
    };
  }

  // Fallback: hardcoded layouts
  const spacing = 10;
  if (b.type === 'storage') {
    const cols = 4;
    const areaW = cols * spacing;
    const areaH = cols * spacing;
    const startX = pos.x + (pos.w - areaW) / 2;
    const startY = pos.y + (pos.h - areaH) / 2;
    const col = pinIndex % cols;
    const row = Math.floor(pinIndex / cols);
    return {
      x: startX + col * spacing + spacing / 2,
      y: startY + row * spacing + spacing / 2,
    };
  }
  // Factory: 3-column top-right layout
  const cols = 3;
  const areaW = cols * spacing;
  const startX = pos.x + pos.w - areaW - 8;
  const startY = pos.y + 8;
  const col = pinIndex % cols;
  const row = Math.floor(pinIndex / cols);
  return {
    x: startX + col * spacing + spacing / 2,
    y: startY + row * spacing + spacing / 2,
  };
}

// Check if tile (gx, gy) is occupied by any building
export function isInsideBuilding(gx: number, gy: number): boolean {
  for (const b of buildings) {
    if (gx >= b.gx && gx < b.gx + b.w && gy >= b.gy && gy < b.gy + b.h) {
      return true;
    }
  }
  return false;
}

// Check if a segment between two tiles would cut through a building's area
export function segmentCutsBuilding(gx1: number, gy1: number, gx2: number, gy2: number): boolean {
  // For diagonal segments, check both "corner" tiles the diagonal passes through
  const dx = gx2 - gx1;
  const dy = gy2 - gy1;
  if (dx !== 0 && dy !== 0) {
    // Diagonal: check the two tiles the path cuts through
    if (isInsideBuilding(gx1 + dx, gy1) || isInsideBuilding(gx1, gy1 + dy)) {
      return true;
    }
  }
  // Also check if either endpoint is inside a building
  if (isInsideBuilding(gx1, gy1) || isInsideBuilding(gx2, gy2)) {
    return true;
  }
  return false;
}

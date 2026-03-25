export type ConnectionSide = 'right' | 'left' | 'top' | 'bottom';

export interface Building {
  id: number;
  gx: number;
  gy: number;
  type: 'house' | 'factory';
  color: string;
  nodeKey: string;
  connectionSide: ConnectionSide;
  w: number; // grid cells wide
  h: number; // grid cells tall
  pins: number; // only used by factories — number of waiting pins
  maxPins: number;
  maxParkedCars: number; // max cars that can park inside (0 = unlimited)
  pinCooldown: number; // frames remaining before newest pin can be picked up
  disabled: boolean; // factory shut down — pins overflowed
}

export interface GraphNode {
  gx: number;
  gy: number;
  edges: Set<string>;
}

export interface Edge {
  id: string;
  fromKey: string;
  toKey: string;
  length: number; // pixel length of this edge (GRID or GRID_DIAG)
  // Precomputed pixel coordinates for hot-path rendering/physics
  fx: number; fy: number; // from pixel center
  tx: number; ty: number; // to pixel center
  narrow?: boolean; // narrow single-lane road
}

export interface Car {
  id: number;
  color: string;
  homeBuildingId: number;
  workBuildingId: number;
  path: string[];
  pathIndex: number;
  edgeId: string;
  edgeDir: 1 | -1;
  t: number;
  x: number;
  y: number;
  angle: number;
  targetAngle: number; // for smooth rotation
  speed: number;
  state: 'toWork' | 'toHome' | 'parking' | 'parked' | 'collecting' | 'departing';
  parkTimer: number;
  parkProgress: number;
  parkStartX: number;
  parkStartY: number;
  parkTargetX: number;
  parkTargetY: number;
  parkAngle: number;
  parkCx1: number; // cubic bezier control point 1
  parkCy1: number;
  parkCx2: number; // cubic bezier control point 2
  parkCy2: number;
  parkEndAngle: number; // angle when fully parked
  parkedAt: number; // frame counter when car parked (for FIFO ordering)
  parkSlot: number; // which slot in the factory this car occupies
  stuckFrames: number; // frames spent at speed 0 (for rerouting)
  nextState: 'toWork' | 'toHome';
  collectProgress: number; // 0→1 animation of pin flying to car
  pinSourceX: number; // factory pin origin (world px)
  pinSourceY: number;
}

export interface RoadPreview {
  startGx: number;
  startGy: number;
  endGx: number;
  endGy: number;
}

export type ToolType = 'addRoad' | 'addNarrow' | 'removeRoad' | 'addBuilding' | 'removeBuilding' | 'addHighway';

export const BUILDING_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];

import { buildings, buildingById, initBuildingNodes, setNextBuildingId } from './buildings.ts';
import { nodes, edges, addEdge, parseKey, bumpGraphVersion } from './graph.ts';
import { score, collected, setScore, setCollected } from './score.ts';
import { Building } from './types.ts';
import { highways, highwayEdgeSet, createHighway, resetHighways } from './highway.ts';
import { cars } from './cars.ts';
import { roundabouts, roundaboutEdgeSet, roundaboutConnectionEdgeSet, createRoundabout, resetRoundabouts, addRoundaboutConnectionEdge, getRoundaboutConnections } from './roundabout.ts';
import { remapColorToTheme } from './theme.ts';
import { FACTORY_MAX_PARKED, FACTORY_MAX_PINS, STORAGE_MAX_PARKED, STORAGE_MAX_PINS } from './constants.ts';
import { trafficLights, createTrafficLight, resetTrafficLights } from './trafficLights.ts';
import { tunnels, tunnelEdgeSet, createTunnel, resetTunnels } from './tunnel.ts';

const SAVE_KEY = 'claudemotorways_save';

export interface SaveData {
  name?: string;
  buildings: Building[];
  edges: [number, number, number, number, boolean?][]; // [gx1, gy1, gx2, gy2, narrow?]
  highways?: { startGx: number; startGy: number; endGx: number; endGy: number; midX?: number; midY?: number; mid1X?: number; mid1Y?: number; mid2X?: number; mid2Y?: number }[];
  roundabouts?: { gx: number; gy: number }[];
  roundaboutConnections?: { raGx: number; raGy: number; outerGx: number; outerGy: number; ringIndex: number }[];
  trafficLights?: { gx: number; gy: number }[];
  tunnels?: { startGx: number; startGy: number; endGx: number; endGy: number }[];
  score: number;
  collected?: number;
  nextBuildingId: number;
}

export function serializeState(): SaveData {
  const edgeList: [number, number, number, number, boolean?][] = [];
  for (const [, edge] of edges) {
    if (highwayEdgeSet.has(edge.id)) continue; // highway edges are recreated from highway data
    if (roundaboutEdgeSet.has(edge.id)) continue; // roundabout edges are recreated from roundabout data
    if (roundaboutConnectionEdgeSet.has(edge.id)) continue; // connection edges saved separately
    if (tunnelEdgeSet.has(edge.id)) continue; // tunnel edges are recreated from tunnel data
    const [gx1, gy1] = parseKey(edge.fromKey);
    const [gx2, gy2] = parseKey(edge.toKey);
    if (edge.narrow) {
      edgeList.push([gx1, gy1, gx2, gy2, true]);
    } else {
      edgeList.push([gx1, gy1, gx2, gy2]);
    }
  }

  const hwList = highways.map(hw => ({
    startGx: hw.startGx, startGy: hw.startGy,
    endGx: hw.endGx, endGy: hw.endGy,
    mid1X: hw.mid1X, mid1Y: hw.mid1Y,
    mid2X: hw.mid2X, mid2Y: hw.mid2Y,
  }));

  const raList = roundabouts.map(ra => ({ gx: ra.gx, gy: ra.gy }));
  const raConns = getRoundaboutConnections();

  const tlList = trafficLights.map(tl => ({ gx: tl.gx, gy: tl.gy }));

  const tnList = tunnels.map(tn => ({
    startGx: tn.startGx, startGy: tn.startGy,
    endGx: tn.endGx, endGy: tn.endGy,
  }));

  return {
    buildings: buildings.map(b => ({ ...b })),
    edges: edgeList,
    highways: hwList,
    roundabouts: raList,
    roundaboutConnections: raConns.length > 0 ? raConns : undefined,
    trafficLights: tlList.length > 0 ? tlList : undefined,
    tunnels: tnList.length > 0 ? tnList : undefined,
    score,
    collected,
    nextBuildingId: Math.max(...buildings.map(b => b.id), 0) + 1,
  };
}

export function loadFromData(data: SaveData): boolean {
  if (!data.buildings || !data.edges) return false;

  // Clear current state
  buildings.length = 0;
  buildingById.clear();
  nodes.clear();
  edges.clear();
  cars.length = 0;
  resetHighways();
  resetRoundabouts();
  resetTrafficLights();
  resetTunnels();

  // Restore buildings
  for (const b of data.buildings) {
    const restored = { ...b, color: remapColorToTheme(b.color) };
    if (restored.type === 'factory') {
      restored.maxPins = FACTORY_MAX_PINS;
      restored.maxParkedCars = FACTORY_MAX_PARKED;
    } else if (restored.type === 'storage') {
      restored.maxPins = STORAGE_MAX_PINS;
      restored.maxParkedCars = STORAGE_MAX_PARKED;
    }
    buildings.push(restored);
    buildingById.set(restored.id, restored);
  }

  // Restore edges (also creates nodes)
  for (const edgeTuple of data.edges) {
    const [gx1, gy1, gx2, gy2] = edgeTuple;
    addEdge(gx1, gy1, gx2, gy2, edgeTuple[4] || undefined);
  }

  // Restore highways (creates nodes + edges from saved endpoints)
  if (data.highways) {
    for (const hw of data.highways) {
      createHighway(hw.startGx, hw.startGy, hw.endGx, hw.endGy, hw.mid1X, hw.mid1Y, hw.mid2X, hw.mid2Y);
    }
  }

  // Restore roundabouts (creates ring nodes + edges from saved positions)
  if (data.roundabouts) {
    for (const ra of data.roundabouts) {
      createRoundabout(ra.gx, ra.gy);
    }
  }

  // Restore roundabout connection edges
  if (data.roundaboutConnections) {
    for (const conn of data.roundaboutConnections) {
      const ra = roundabouts.find(r => r.gx === conn.raGx && r.gy === conn.raGy);
      if (ra) {
        addRoundaboutConnectionEdge(ra, conn.outerGx, conn.outerGy, conn.ringIndex);
      }
    }
  }

  // Restore traffic lights
  if (data.trafficLights) {
    for (const tl of data.trafficLights) {
      createTrafficLight(tl.gx, tl.gy);
    }
  }

  // Restore tunnels
  if (data.tunnels) {
    for (const tn of data.tunnels) {
      createTunnel(tn.startGx, tn.startGy, tn.endGx, tn.endGy);
    }
  }

  setScore(data.score ?? 0);
  setCollected(data.collected ?? 0);
  initBuildingNodes();
  bumpGraphVersion();

  if (data.nextBuildingId) {
    setNextBuildingId(data.nextBuildingId);
  }

  return true;
}

export function saveGame() {
  const data = serializeState();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // silently ignore
  }
}

export function loadGame(): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data: SaveData = JSON.parse(raw);
    return loadFromData(data);
  } catch {
    return false;
  }
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}

export function downloadSave() {
  const data = serializeState();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'loomways-city.json';
  a.click();
  URL.revokeObjectURL(url);
}

export function uploadSave(): Promise<boolean> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(false); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data: SaveData = JSON.parse(reader.result as string);
          data.score = 0;
          data.collected = 0;
          if (loadFromData(data)) {
            saveGame();
            resolve(true);
          } else {
            resolve(false);
          }
        } catch { resolve(false); }
      };
      reader.readAsText(file);
    };
    input.click();
  });
}

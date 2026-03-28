import { buildings, buildingById, initBuildingNodes, setNextBuildingId } from './buildings.ts';
import { nodes, edges, addEdge, parseKey } from './graph.ts';
import { score, setScore } from './score.ts';
import { Building } from './types.ts';
import { highways, highwayEdgeSet, createHighway, resetHighways } from './highway.ts';
import { cars } from './cars.ts';

const SAVE_KEY = 'claudemotorways_save';

export interface SaveData {
  name?: string;
  buildings: Building[];
  edges: [number, number, number, number, boolean?][]; // [gx1, gy1, gx2, gy2, narrow?]
  highways?: { startGx: number; startGy: number; endGx: number; endGy: number; midX?: number; midY?: number; mid1X?: number; mid1Y?: number; mid2X?: number; mid2Y?: number }[];
  score: number;
  nextBuildingId: number;
}

export function serializeState(): SaveData {
  const edgeList: [number, number, number, number, boolean?][] = [];
  for (const [, edge] of edges) {
    if (highwayEdgeSet.has(edge.id)) continue; // highway edges are recreated from highway data
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

  return {
    buildings: buildings.map(b => ({ ...b })),
    edges: edgeList,
    highways: hwList,
    score,
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

  // Restore buildings
  for (const b of data.buildings) {
    buildings.push(b);
    buildingById.set(b.id, b);
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

  setScore(data.score ?? 0);
  initBuildingNodes();

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

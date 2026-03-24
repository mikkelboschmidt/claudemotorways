import { buildings, buildingById, initBuildingNodes, setNextBuildingId } from './buildings.ts';
import { nodes, edges, addEdge, parseKey } from './graph.ts';
import { score, setScore } from './score.ts';
import { Building } from './types.ts';
import { highways, highwayEdgeSet, createHighway, resetHighways } from './highway.ts';

const SAVE_KEY = 'claudemotorways_save';

interface SaveData {
  buildings: Building[];
  edges: [number, number, number, number][]; // [gx1, gy1, gx2, gy2]
  highways?: { startGx: number; startGy: number; endGx: number; endGy: number; midX?: number; midY?: number }[];
  score: number;
  nextBuildingId: number;
}

export function saveGame() {
  const edgeList: [number, number, number, number][] = [];
  for (const [, edge] of edges) {
    if (highwayEdgeSet.has(edge.id)) continue; // highway edges are recreated from highway data
    const [gx1, gy1] = parseKey(edge.fromKey);
    const [gx2, gy2] = parseKey(edge.toKey);
    edgeList.push([gx1, gy1, gx2, gy2]);
  }

  const hwList = highways.map(hw => ({
    startGx: hw.startGx, startGy: hw.startGy,
    endGx: hw.endGx, endGy: hw.endGy,
    midX: hw.midX, midY: hw.midY,
  }));

  const data: SaveData = {
    buildings: buildings.map(b => ({ ...b })),
    edges: edgeList,
    highways: hwList,
    score,
    nextBuildingId: Math.max(...buildings.map(b => b.id), 0) + 1,
  };

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
    if (!data.buildings || !data.edges) return false;

    // Clear current state
    buildings.length = 0;
    buildingById.clear();
    nodes.clear();
    edges.clear();
    resetHighways();

    // Restore buildings
    for (const b of data.buildings) {
      buildings.push(b);
      buildingById.set(b.id, b);
    }

    // Restore edges (also creates nodes)
    for (const [gx1, gy1, gx2, gy2] of data.edges) {
      addEdge(gx1, gy1, gx2, gy2);
    }

    // Restore highways (creates nodes + edges from saved endpoints)
    if (data.highways) {
      for (const hw of data.highways) {
        createHighway(hw.startGx, hw.startGy, hw.endGx, hw.endGy, hw.midX, hw.midY);
      }
    }

    setScore(data.score ?? 0);
    initBuildingNodes();

    if (data.nextBuildingId) {
      setNextBuildingId(data.nextBuildingId);
    }

    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}

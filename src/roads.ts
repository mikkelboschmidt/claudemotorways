import { GRID, ROAD_W, TOOLBAR_HEIGHT } from './constants.ts';
import { addEdge, bumpGraphVersion, removeEdge, nodeKey, nodes, getNodeEdges } from './graph.ts';
import { segmentCutsBuilding, findBuildingAtPixel, addBuilding, removeBuilding, getBuildingEdgeAt, connectBuildingOnSide } from './buildings.ts';
import { RoadPreview } from './types.ts';
import { activeTool, selectedColor, selectedBuildingType } from './toolbar.ts';
import { removeCarsForEdge, removeCarsForBuilding } from './cars.ts';
import { saveGame } from './save.ts';
import { highwayPhase, highwayStartGx, highwayStartGy, draggingHighwayId, setHighwayPhase, setHighwayStart, setHighwayPreviewEnd, setDraggingHighwayId, createHighway, findHighwayAtPixel, findHighwayHandleAtPixel, removeHighway, updateHighwayMid, rebuildHighway, highways } from './highway.ts';

let dragging = false;
let dragStartGx = 0;
let dragStartGy = 0;
let currentGx = 0;
let currentGy = 0;

export let roadPreview: RoadPreview | null = null;

// Hover position in grid coords (null when not over game area)
export let hoverGx: number | null = null;
export let hoverGy: number | null = null;

// Remove-road drag state (tile-based)
let removeRoadDragging = false;
let removeStartGx = 0;
let removeStartGy = 0;
export const pendingRemoveTiles = new Set<string>();

function computeRemoveTiles(gx1: number, gy1: number, gx2: number, gy2: number) {
  pendingRemoveTiles.clear();
  const dx = gx2 - gx1;
  const dy = gy2 - gy1;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  const stepX = steps > 0 ? Math.sign(dx) : 0;
  const stepY = steps > 0 ? Math.sign(dy) : 0;
  // Walk from start to end, inclusive of both endpoints
  for (let i = 0; i <= steps; i++) {
    const gx = gx1 + stepX * i;
    const gy = gy1 + stepY * i;
    const key = nodeKey(gx, gy);
    if (nodes.has(key)) pendingRemoveTiles.add(key);
  }
}

function snapToGrid(px: number): number {
  return Math.floor(px / GRID);
}

// Snap cursor to nearest 45-degree line from the start point
function snapTo8Dir(startGx: number, startGy: number, rawGx: number, rawGy: number): [number, number] {
  const dx = rawGx - startGx;
  const dy = rawGy - startGy;
  if (dx === 0 && dy === 0) return [startGx, startGy];

  const angle = Math.atan2(dy, dx);
  // Snap angle to nearest 45° increment
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const dirX = Math.round(Math.cos(snapped));
  const dirY = Math.round(Math.sin(snapped));

  // Project distance: how many steps along this direction?
  let steps: number;
  if (dirX === 0) {
    steps = Math.abs(dy);
  } else if (dirY === 0) {
    steps = Math.abs(dx);
  } else {
    // Diagonal: use the max of abs(dx), abs(dy) projected onto the direction
    steps = Math.max(Math.abs(dx), Math.abs(dy));
  }

  return [startGx + dirX * steps, startGy + dirY * steps];
}

export function initRoadInput(canvas: HTMLCanvasElement) {
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    if (py >= canvas.height - TOOLBAR_HEIGHT) return;

    if (activeTool === 'addRoad') {
      dragStartGx = snapToGrid(px);
      dragStartGy = snapToGrid(py);
      currentGx = dragStartGx;
      currentGy = dragStartGy;
      dragging = true;
      roadPreview = null;
    } else if (activeTool === 'removeRoad') {
      // Check if clicking on a highway first
      const hw = findHighwayAtPixel(px, py);
      if (hw) {
        removeHighway(hw.id);
        saveGame();
        return;
      }
      removeRoadDragging = true;
      removeStartGx = snapToGrid(px);
      removeStartGy = snapToGrid(py);
      pendingRemoveTiles.clear();
      const key = nodeKey(removeStartGx, removeStartGy);
      if (nodes.has(key)) pendingRemoveTiles.add(key);
    } else if (activeTool === 'addBuilding') {
      const gridX = Math.floor(px / GRID);
      const gridY = Math.floor(py / GRID);
      if (addBuilding(gridX, gridY, selectedBuildingType, selectedColor)) {
        saveGame();
      }
    } else if (activeTool === 'removeBuilding') {
      const building = findBuildingAtPixel(px, py);
      if (building) {
        removeCarsForBuilding(building.id);
        removeBuilding(building.id);
        saveGame();
      }
    } else if (activeTool === 'addHighway') {
      // Check for handle drag first
      const handle = findHighwayHandleAtPixel(px, py);
      if (handle && highwayPhase === 'idle') {
        setDraggingHighwayId(handle.id);
        return;
      }

      const gx = snapToGrid(px);
      const gy = snapToGrid(py);
      if (highwayPhase === 'idle') {
        // Start: must be on an existing road node
        if (nodes.has(nodeKey(gx, gy))) {
          setHighwayStart(gx, gy);
          setHighwayPhase('pickEnd');
        }
      } else if (highwayPhase === 'pickEnd') {
        // End: must be on an existing road node, different from start, at least 3 tiles apart
        const key = nodeKey(gx, gy);
        if (nodes.has(key)) {
          const dist = Math.hypot(gx - highwayStartGx, gy - highwayStartGy);
          if (dist >= 3) {
            createHighway(highwayStartGx, highwayStartGy, gx, gy);
            saveGame();
          }
          setHighwayPhase('idle');
        }
      }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    // Highway handle drag — update midpoint visually
    if (draggingHighwayId >= 0) {
      const hw = highways.find(h => h.id === draggingHighwayId);
      if (hw) updateHighwayMid(hw, px, py);
      return;
    }

    // Update hover position for ghost previews
    if (py < canvas.height - TOOLBAR_HEIGHT) {
      if (activeTool === 'addBuilding') {
        hoverGx = Math.floor(px / GRID);
        hoverGy = Math.floor(py / GRID);
      } else if (activeTool === 'addRoad') {
        hoverGx = snapToGrid(px);
        hoverGy = snapToGrid(py);
      } else {
        hoverGx = null;
        hoverGy = null;
      }

      // Highway preview
      if (activeTool === 'addHighway' && highwayPhase === 'pickEnd') {
        setHighwayPreviewEnd(px, py);
      }
    } else {
      hoverGx = null;
      hoverGy = null;
    }

    // Recompute tiles for remove-road drag
    if (removeRoadDragging && activeTool === 'removeRoad' && py < canvas.height - TOOLBAR_HEIGHT) {
      const rawGx = snapToGrid(px);
      const rawGy = snapToGrid(py);
      const [endGx, endGy] = snapTo8Dir(removeStartGx, removeStartGy, rawGx, rawGy);
      computeRemoveTiles(removeStartGx, removeStartGy, endGx, endGy);
    }

    // Road drag preview
    if (dragging && activeTool === 'addRoad') {
      const rawGx = snapToGrid(px);
      const rawGy = snapToGrid(py);

      const [snappedGx, snappedGy] = snapTo8Dir(dragStartGx, dragStartGy, rawGx, rawGy);
      currentGx = snappedGx;
      currentGy = snappedGy;

      if (currentGx !== dragStartGx || currentGy !== dragStartGy) {
        roadPreview = {
          startGx: dragStartGx,
          startGy: dragStartGy,
          endGx: currentGx,
          endGy: currentGy,
        };
      } else {
        roadPreview = null;
      }
    }
  });

  canvas.addEventListener('mouseup', () => {
    // Finalize highway handle drag
    if (draggingHighwayId >= 0) {
      const hw = highways.find(h => h.id === draggingHighwayId);
      if (hw) {
        rebuildHighway(hw);
        saveGame();
      }
      setDraggingHighwayId(-1);
      return;
    }

    if (removeRoadDragging) {
      removeRoadDragging = false;
      if (pendingRemoveTiles.size > 0) {
        for (const tileKey of pendingRemoveTiles) {
          const edgeIds = getNodeEdges(tileKey);
          for (const eid of edgeIds) {
            removeCarsForEdge(eid);
            removeEdge(eid);
          }
        }
        bumpGraphVersion();
        pendingRemoveTiles.clear();
        saveGame();
      }
      return;
    }

    if (!dragging) return;
    dragging = false;

    if (activeTool === 'addRoad' && (currentGx !== dragStartGx || currentGy !== dragStartGy)) {
      createRoadSegments(dragStartGx, dragStartGy, currentGx, currentGy);
      saveGame();
    }
    roadPreview = null;
  });

  canvas.addEventListener('mouseleave', () => {
    dragging = false;
    removeRoadDragging = false;
    pendingRemoveTiles.clear();
    roadPreview = null;
    hoverGx = null;
    hoverGy = null;
    setHighwayPhase('idle');
    if (draggingHighwayId >= 0) {
      const hw = highways.find(h => h.id === draggingHighwayId);
      if (hw) rebuildHighway(hw);
      setDraggingHighwayId(-1);
    }
  });

  // Escape or right-click cancels highway placement
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && highwayPhase === 'pickEnd') {
      setHighwayPhase('idle');
    }
  });
  canvas.addEventListener('contextmenu', (e) => {
    if (highwayPhase === 'pickEnd') {
      e.preventDefault();
      setHighwayPhase('idle');
    }
  });
}

function createRoadSegments(gx1: number, gy1: number, gx2: number, gy2: number) {
  const dx = gx2 - gx1;
  const dy = gy2 - gy1;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) return;

  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);

  // Direction for building edge detection
  const dirGx = stepX;
  const dirGy = stepY;
  const startHit = getBuildingEdgeAt(gx1, gy1, dirGx, dirGy);
  const endHit = getBuildingEdgeAt(gx2, gy2, -dirGx, -dirGy);

  let added = false;

  for (let i = 0; i < steps; i++) {
    const x1 = gx1 + stepX * i;
    const y1 = gy1 + stepY * i;
    const x2 = x1 + stepX;
    const y2 = y1 + stepY;

    // Skip if segment cuts through a building interior
    if (segmentCutsBuilding(x1, y1, x2, y2)) continue;

    if (addEdge(x1, y1, x2, y2)) added = true;
  }

  if (added) {
    bumpGraphVersion();
  }

  // isDragEndpoint=true: the user dragged directly to/from this building
  if (startHit) {
    connectBuildingOnSide(startHit.building, startHit.side, gx1, gy1, true);
  }
  if (endHit) {
    connectBuildingOnSide(endHit.building, endHit.side, gx2, gy2, true);
  }

}

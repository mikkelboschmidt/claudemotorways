import { GRID, ROAD_W } from './constants.ts';
import { screenToWorld } from './camera.ts';
import { addEdge, bumpGraphVersion, removeEdge, nodeKey, nodes, getNodeEdges } from './graph.ts';
import { segmentCutsBuilding, findBuildingAtPixel, addBuilding, removeBuilding, getBuildingEdgeAt, connectBuildingOnSide } from './buildings.ts';
import { RoadPreview } from './types.ts';
import { activeTool, selectedColor, selectedBuildingType } from './toolbar.ts';
import { removeCarsForEdge, removeCarsForBuilding } from './cars.ts';
import { saveGame } from './save.ts';
import { playSfx } from './sfx.ts';
import { highwayPhase, highwayStartGx, highwayStartGy, draggingHighwayId, draggingHandleIndex, setHighwayPhase, setHighwayStart, setHighwayPreviewEnd, setDraggingHighwayId, setDraggingHandleIndex, createHighway, findHighwayAtPixel, findHighwayHandleAtPixel, removeHighway, updateHighwayMid, rebuildHighway, highways } from './highway.ts';
import { createRoundabout, removeRoundabout, findRoundaboutAtPixel, segmentCutsRoundabout, roundaboutEdgeSet, roundaboutConnectionEdgeSet, findRoundaboutAtTile, findBestRoundaboutEntry, addRoundaboutConnectionEdge, Roundabout } from './roundabout.ts';
import { recordRoad, recordHighway, recordRoundabout } from './run.ts';

let dragging = false;
let dragStartGx = 0;
let dragStartGy = 0;
let currentGx = 0;
let currentGy = 0;

// Track screen start position for drag threshold (touch needs this)
let dragStartSx = 0;
let dragStartSy = 0;
let dragConfirmed = false; // true once movement exceeds threshold
const DRAG_THRESHOLD = 8; // pixels of screen movement before drag activates

// Whether input is from touch (disables hover ghost)
let isTouch = false;

// Pending tap action (deferred to pointerup to avoid pinch-zoom false triggers)
let pendingTap: (() => void) | null = null;

// Callback to get active touch count (set from main.ts to avoid circular import)
let getActiveTouchCount: () => number = () => 0;
export function setTouchCountGetter(fn: () => number) { getActiveTouchCount = fn; }

export let roadPreview: RoadPreview | null = null;

// Hover position in grid coords (null when not over game area)
export let hoverGx: number | null = null;
export let hoverGy: number | null = null;

// Remove-road drag state (tile-based)
let removeRoadDragging = false;
let removeStartGx = 0;
let removeStartGy = 0;
export const pendingRemoveTiles = new Set<string>();

export function cancelRoadDrag() {
  dragging = false;
  dragConfirmed = false;
  removeRoadDragging = false;
  pendingTap = null;
  pendingRemoveTiles.clear();
  roadPreview = null;
  hoverGx = null;
  hoverGy = null;
  if (draggingHighwayId >= 0) {
    const hw = highways.find(h => h.id === draggingHighwayId);
    if (hw) rebuildHighway(hw);
    setDraggingHighwayId(-1);
  }
  // Cancel highway placement in progress
  if (highwayPhase !== 'idle') {
    setHighwayPhase('idle');
  }
}

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
  canvas.addEventListener('pointerdown', (e) => {
    // Ignore multi-touch (handled by touch pan/zoom in main.ts)
    if (getActiveTouchCount() >= 2) return;

    isTouch = e.pointerType === 'touch';
    canvas.setPointerCapture(e.pointerId);

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Convert screen coords to world coords for all game-area interactions
    const [px, py] = screenToWorld(sx, sy);

    // Store screen start position for drag threshold
    dragStartSx = sx;
    dragStartSy = sy;
    dragConfirmed = false;

    if (activeTool === 'addRoad' || activeTool === 'addNarrow') {
      dragStartGx = snapToGrid(px);
      dragStartGy = snapToGrid(py);
      currentGx = dragStartGx;
      currentGy = dragStartGy;
      dragging = true;
      roadPreview = null;
    } else if (activeTool === 'removeRoad' || activeTool === 'demolish') {
      // Demolish: try building first, then fall back to road/highway removal
      if (activeTool === 'demolish') {
        const building = findBuildingAtPixel(px, py);
        if (building) {
          const bid = building.id;
          pendingTap = () => {
            removeCarsForBuilding(bid);
            removeBuilding(bid);
            playSfx('demolish');
            saveGame();
          };
          return;
        }
      }
      // Check if clicking on a roundabout
      const ra = findRoundaboutAtPixel(px, py);
      if (ra) {
        const raId = ra.id;
        const raEdgeIds = [...ra.edgeIds];
        pendingTap = () => {
          for (const eid of raEdgeIds) {
            removeCarsForEdge(eid);
          }
          removeRoundabout(raId);
          playSfx('demolish');
          saveGame();
        };
        return;
      }
      // Check if clicking on a highway
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
      const bType = selectedBuildingType;
      const bColor = selectedColor;
      pendingTap = () => {
        if (addBuilding(gridX, gridY, bType, bColor)) {
          playSfx('build');
          saveGame();
        }
      };
    } else if (activeTool === 'removeBuilding') {
      const building = findBuildingAtPixel(px, py);
      if (building) {
        const bid = building.id;
        pendingTap = () => {
          removeCarsForBuilding(bid);
          removeBuilding(bid);
          playSfx('demolish');
          saveGame();
        };
      }
    } else if (activeTool === 'addRoundabout') {
      const gridX = Math.floor(px / GRID) - 1; // center the 3x3 on the clicked tile
      const gridY = Math.floor(py / GRID) - 1;
      pendingTap = () => {
        if (createRoundabout(gridX, gridY)) {
          recordRoundabout();
          playSfx('build');
          saveGame();
        }
      };
    } else if (activeTool === 'addHighway') {
      // Check for handle drag first
      const handle = findHighwayHandleAtPixel(px, py);
      if (handle && highwayPhase === 'idle') {
        setDraggingHighwayId(handle.highway.id);
        setDraggingHandleIndex(handle.handleIndex);
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
            recordHighway();
            playSfx('road');
            saveGame();
          }
          setHighwayPhase('idle');
        }
      }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const [px, py] = screenToWorld(sx, sy);

    // Check drag threshold for touch — don't activate drag until finger moves enough
    if ((dragging || removeRoadDragging) && !dragConfirmed) {
      const dist = Math.hypot(sx - dragStartSx, sy - dragStartSy);
      if (dist < DRAG_THRESHOLD) return;
      dragConfirmed = true;
    }

    // Highway handle drag — update control point visually (world coords)
    if (draggingHighwayId >= 0) {
      const hw = highways.find(h => h.id === draggingHighwayId);
      if (hw) updateHighwayMid(hw, draggingHandleIndex, px, py);
      return;
    }

    // Highway preview (world coords) — must update for both mouse and touch
    if (activeTool === 'addHighway' && highwayPhase === 'pickEnd') {
      setHighwayPreviewEnd(px, py);
    }

    // Update hover position for ghost previews (skip for touch — no hover state)
    if (!isTouch) {
      if (activeTool === 'addBuilding') {
        hoverGx = Math.floor(px / GRID);
        hoverGy = Math.floor(py / GRID);
      } else if (activeTool === 'addRoundabout') {
        hoverGx = Math.floor(px / GRID) - 1;
        hoverGy = Math.floor(py / GRID) - 1;
      } else if (activeTool === 'addRoad' || activeTool === 'addNarrow') {
        hoverGx = snapToGrid(px);
        hoverGy = snapToGrid(py);
      } else {
        hoverGx = null;
        hoverGy = null;
      }
    }

    // Recompute tiles for remove-road drag
    if (removeRoadDragging && dragConfirmed && (activeTool === 'removeRoad' || activeTool === 'demolish')) {
      const rawGx = snapToGrid(px);
      const rawGy = snapToGrid(py);
      const [endGx, endGy] = snapTo8Dir(removeStartGx, removeStartGy, rawGx, rawGy);
      computeRemoveTiles(removeStartGx, removeStartGy, endGx, endGy);
    }

    // Road drag preview
    if (dragging && dragConfirmed && (activeTool === 'addRoad' || activeTool === 'addNarrow')) {
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

  canvas.addEventListener('pointerup', () => {
    // Execute deferred tap action (building place/remove) if no drag/pinch occurred
    if (pendingTap && !dragConfirmed && getActiveTouchCount() < 2) {
      pendingTap();
    }
    pendingTap = null;

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
      if (dragConfirmed && pendingRemoveTiles.size > 0) {
        for (const tileKey of pendingRemoveTiles) {
          const edgeIds = getNodeEdges(tileKey);
          for (const eid of edgeIds) {
            if (roundaboutEdgeSet.has(eid)) continue; // don't break roundabouts with drag removal
            roundaboutConnectionEdgeSet.delete(eid); // clean up if it was a connection edge
            removeCarsForEdge(eid);
            removeEdge(eid);
          }
        }
        bumpGraphVersion();
        pendingRemoveTiles.clear();
        saveGame();
      } else {
        pendingRemoveTiles.clear();
      }
      dragConfirmed = false;
      return;
    }

    if (!dragging) { dragConfirmed = false; return; }
    dragging = false;

    if (dragConfirmed && (activeTool === 'addRoad' || activeTool === 'addNarrow') && (currentGx !== dragStartGx || currentGy !== dragStartGy)) {
      createRoadSegments(dragStartGx, dragStartGy, currentGx, currentGy, activeTool === 'addNarrow');
      playSfx('road');
      saveGame();
    }
    roadPreview = null;
    dragConfirmed = false;
  });

  canvas.addEventListener('pointercancel', () => {
    cancelRoadDrag();
  });

  // Mouse leave still useful for desktop — cancel drags when cursor leaves canvas
  canvas.addEventListener('mouseleave', () => {
    if (!isTouch) cancelRoadDrag();
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

function connectRoadToRoundabout(ra: Roundabout, outerGx: number, outerGy: number, ringIndex: number) {
  addRoundaboutConnectionEdge(ra, outerGx, outerGy, ringIndex);
}

function createRoadSegments(gx1: number, gy1: number, gx2: number, gy2: number, narrow: boolean = false) {
  const dx = gx2 - gx1;
  const dy = gy2 - gy1;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) return;

  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);

  // Check if start or end is on a roundabout — auto-snap to best entry
  let startRa = findRoundaboutAtTile(gx1, gy1);
  let endRa = findRoundaboutAtTile(gx2, gy2);
  let startEntry = startRa ? findBestRoundaboutEntry(startRa, gx2, gy2) : null;
  let endEntry = endRa ? findBestRoundaboutEntry(endRa, gx1, gy1) : null;

  // Direction for building edge detection
  const dirGx = stepX;
  const dirGy = stepY;
  const startHit = !startRa ? getBuildingEdgeAt(gx1, gy1, dirGx, dirGy) : null;
  const endHit = !endRa ? getBuildingEdgeAt(gx2, gy2, -dirGx, -dirGy) : null;

  let added = false;

  // Track the first and last successfully placed tile for roundabout connections
  let firstPlacedGx = -1, firstPlacedGy = -1;
  let lastPlacedGx = -1, lastPlacedGy = -1;

  for (let i = 0; i < steps; i++) {
    const x1 = gx1 + stepX * i;
    const y1 = gy1 + stepY * i;
    const x2 = x1 + stepX;
    const y2 = y1 + stepY;

    // Skip if segment cuts through a building or roundabout interior
    if (segmentCutsBuilding(x1, y1, x2, y2)) continue;
    if (segmentCutsRoundabout(x1, y1, x2, y2)) continue;

    if (addEdge(x1, y1, x2, y2, narrow || undefined)) added = true;

    // Track endpoints of placed segments
    if (firstPlacedGx === -1) {
      firstPlacedGx = x1;
      firstPlacedGy = y1;
    }
    lastPlacedGx = x2;
    lastPlacedGy = y2;
  }

  // If endpoints weren't on a roundabout, check if the road's next segment
  // would enter one (i.e., road stopped just outside a roundabout because
  // segments were blocked by segmentCutsRoundabout)
  if (!startRa && firstPlacedGx !== -1) {
    const prevGx = firstPlacedGx - stepX;
    const prevGy = firstPlacedGy - stepY;
    startRa = findRoundaboutAtTile(prevGx, prevGy);
    if (startRa) startEntry = findBestRoundaboutEntry(startRa, gx2, gy2);
  }
  if (!endRa && lastPlacedGx !== -1) {
    const nextGx = lastPlacedGx + stepX;
    const nextGy = lastPlacedGy + stepY;
    endRa = findRoundaboutAtTile(nextGx, nextGy);
    if (endRa) endEntry = findBestRoundaboutEntry(endRa, gx1, gy1);
  }

  // Connect road endpoints to roundabout ring nodes
  // Use the nearest placed tile as the connection point
  if (startEntry && startRa && firstPlacedGx !== -1) {
    connectRoadToRoundabout(startRa, firstPlacedGx, firstPlacedGy, startEntry.ringIndex);
    added = true;
  }
  if (endEntry && endRa && lastPlacedGx !== -1) {
    connectRoadToRoundabout(endRa, lastPlacedGx, lastPlacedGy, endEntry.ringIndex);
    added = true;
  }

  if (added) {
    bumpGraphVersion();
    recordRoad(narrow);
  }

  // isDragEndpoint=true: the user dragged directly to/from this building
  if (startHit) {
    connectBuildingOnSide(startHit.building, startHit.side, gx1, gy1, true);
  }
  if (endHit) {
    connectBuildingOnSide(endHit.building, endHit.side, gx2, gy2, true);
  }

}

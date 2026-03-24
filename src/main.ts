import { TOOLBAR_HEIGHT } from './constants.ts';
import { initBuildingNodes, updatePins } from './buildings.ts';
import { initRoadInput, roadPreview } from './roads.ts';
import { spawnCars, updateCars } from './cars.ts';
import { render, getToolbarLayout } from './renderer.ts';
import { setActiveTool, setSelectedColor, setSelectedBuildingType } from './toolbar.ts';
import { saveGame, loadGame, clearSave } from './save.ts';
import { tickPathfindingFrame } from './pathfinding.ts';
import { gameSpeed, setGameSpeed, SPEED_OPTIONS, SPEED_LABELS } from './speed.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

resize();
window.addEventListener('resize', resize);

// Load saved game or initialize fresh
if (!loadGame()) {
  initBuildingNodes();
}
initRoadInput(canvas);

// Auto-save every 5 seconds (counted in sim ticks)
let saveTimer = 0;

// FPS tracking
let fps = 0;
let fpsFrames = 0;
let fpsLastTime = performance.now();

// Toolbar click handling
canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;

  // Only handle clicks in toolbar area
  if (py < canvas.height - TOOLBAR_HEIGHT) return;

  ctx.font = '13px sans-serif';
  const layout = getToolbarLayout(ctx, canvas.width, canvas.height);

  // Check reset button
  if (layout.resetButton) {
    const rb = layout.resetButton;
    if (px >= rb.x && px <= rb.x + rb.w && py >= rb.y && py <= rb.y + rb.h) {
      clearSave();
      window.location.reload();
      return;
    }
  }

  // Check speed buttons
  for (const btn of layout.speedButtons) {
    if (px >= btn.x && px <= btn.x + btn.w && py >= btn.y && py <= btn.y + btn.h) {
      setGameSpeed(btn.speed);
      e.stopPropagation();
      return;
    }
  }

  for (const btn of layout.buttons) {
    if (px >= btn.x && px <= btn.x + btn.w && py >= btn.y && py <= btn.y + btn.h) {
      setActiveTool(btn.type);
      e.stopPropagation();
      return;
    }
  }

  for (const btn of layout.buildingTypeButtons) {
    if (px >= btn.x && px <= btn.x + btn.w && py >= btn.y && py <= btn.y + btn.h) {
      setSelectedBuildingType(btn.type);
      e.stopPropagation();
      return;
    }
  }

  for (const btn of layout.colorButtons) {
    if (px >= btn.x && px <= btn.x + btn.w && py >= btn.y && py <= btn.y + btn.h) {
      setSelectedColor(btn.color);
      e.stopPropagation();
      return;
    }
  }
}, true);

function simulationTick() {
  tickPathfindingFrame();
  updatePins();
  spawnCars();
  updateCars();

  saveTimer++;
  if (saveTimer >= 300) {
    saveTimer = 0;
    saveGame();
  }
}

function gameLoop() {
  // FPS counter
  fpsFrames++;
  const now = performance.now();
  if (now - fpsLastTime >= 1000) {
    fps = fpsFrames;
    fpsFrames = 0;
    fpsLastTime = now;
  }

  // Run simulation ticks based on speed
  const ticks = gameSpeed;
  for (let i = 0; i < ticks; i++) {
    simulationTick();
  }

  render(ctx, canvas.width, canvas.height, roadPreview, fps);

  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

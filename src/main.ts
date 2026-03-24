import { TOOLBAR_HEIGHT } from './constants.ts';
import { initBuildingNodes, updatePins } from './buildings.ts';
import { initRoadInput, roadPreview } from './roads.ts';
import { spawnCars, updateCars } from './cars.ts';
import { render, getToolbarLayout } from './renderer.ts';
import { setActiveTool, setSelectedColor, setSelectedBuildingType } from './toolbar.ts';
import { saveGame, loadGame, clearSave } from './save.ts';
import { tickPathfindingFrame } from './pathfinding.ts';
import { gameSpeed, setGameSpeed, SPEED_OPTIONS, SPEED_LABELS } from './speed.ts';
import { pan, zoomAt } from './camera.ts';
import { toggleMusic, ensureMusicStarted } from './music.ts';

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

// Start music on first user interaction (browser requires gesture for audio)
canvas.addEventListener('mousedown', () => ensureMusicStarted(), { once: true });
canvas.addEventListener('touchstart', () => ensureMusicStarted(), { once: true });

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

  // Check music toggle button
  if (layout.musicButton) {
    const mb = layout.musicButton;
    if (px >= mb.x && px <= mb.x + mb.w && py >= mb.y && py <= mb.y + mb.h) {
      toggleMusic();
      e.stopPropagation();
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

// Pan & zoom: trackpad two-finger scroll → pan, pinch → zoom
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey) {
    // Pinch-zoom gesture (trackpad reports ctrlKey + deltaY)
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = Math.pow(0.99, e.deltaY);
    zoomAt(sx, sy, factor);
  } else {
    // Two-finger scroll → pan
    pan(-e.deltaX, -e.deltaY);
  }
}, { passive: false });

// Touch: two-finger pan & pinch-zoom
let touchIds: number[] = [];
let lastTouchX = 0;
let lastTouchY = 0;
let lastPinchDist = 0;

function getTouchCenter(e: TouchEvent): [number, number] {
  const rect = canvas.getBoundingClientRect();
  let cx = 0, cy = 0;
  for (let i = 0; i < e.touches.length; i++) {
    cx += e.touches[i].clientX - rect.left;
    cy += e.touches[i].clientY - rect.top;
  }
  return [cx / e.touches.length, cy / e.touches.length];
}

function getPinchDist(e: TouchEvent): number {
  if (e.touches.length < 2) return 0;
  const dx = e.touches[0].clientX - e.touches[1].clientX;
  const dy = e.touches[0].clientY - e.touches[1].clientY;
  return Math.hypot(dx, dy);
}

canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    e.preventDefault();
    touchIds = [e.touches[0].identifier, e.touches[1].identifier];
    [lastTouchX, lastTouchY] = getTouchCenter(e);
    lastPinchDist = getPinchDist(e);
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const [cx, cy] = getTouchCenter(e);
    // Pan
    pan(cx - lastTouchX, cy - lastTouchY);
    // Pinch zoom
    const dist = getPinchDist(e);
    if (lastPinchDist > 0 && dist > 0) {
      const factor = dist / lastPinchDist;
      zoomAt(cx, cy, factor);
    }
    lastTouchX = cx;
    lastTouchY = cy;
    lastPinchDist = dist;
  }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) {
    touchIds = [];
    lastPinchDist = 0;
  }
});

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

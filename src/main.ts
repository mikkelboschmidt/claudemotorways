import { buildings, updatePins } from './buildings.ts';
import { initRoadInput, roadPreview, cancelRoadDrag, setTouchCountGetter } from './roads.ts';
import { spawnCars, updateCars, cars } from './cars.ts';
import { render, getToolbarLayout } from './renderer.ts';
import { setActiveTool, setSelectedColor, selectedColor, setSelectedBuildingType, toggleGearMenu, closeGearMenu, gearMenuOpen, demoModalOpen, showDemoModal, closeDemoModal, cityModalOpen, showCityModal, closeCityModal } from './toolbar.ts';
import { saveGame, loadGame, loadFromData, downloadSave, uploadSave } from './save.ts';
import { tickPathfindingFrame } from './pathfinding.ts';
import { gameSpeed, setGameSpeed } from './speed.ts';
import { pan, zoomAt } from './camera.ts';
import { toggleMusic, ensureMusicStarted } from './music.ts';
import { fetchCities, loadCity } from './cities.ts';
import { startRun, endRun, updatePeaks } from './run.ts';
import { score } from './score.ts';
import { getBuildingColors, theme } from './theme.ts';

// Apply theme's page background at startup
document.body.style.background = theme.pageBg;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

resize();
window.addEventListener('resize', resize);

// Load saved game or show start modal
const hadSave = loadGame();
if (hadSave) {
  startRun('save-restored');
} else {
  showDemoModal();
}
initRoadInput(canvas);
setTouchCountGetter(() => activeTouchCount);
fetchCities();

// End run when browser closes or tab is hidden (visibilitychange is more reliable on mobile)
window.addEventListener('beforeunload', () => endRun('browser-close'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    endRun('tab-hidden');
  } else {
    startRun('save-restored');
  }
});

// Auto-save every 5 seconds (counted in sim ticks)
let saveTimer = 0;

// FPS tracking
let fps = 0;
let fpsFrames = 0;
let fpsLastTime = performance.now();

// Start music on first user interaction (browser requires gesture for audio)
canvas.addEventListener('pointerdown', () => ensureMusicStarted(), { once: true });

// Track active touch count so single-finger gestures can be disambiguated from pan/zoom
let activeTouchCount = 0;

// Helper: check if point is inside rect
function hitRect(px: number, py: number, r: { x: number; y: number; w: number; h: number }): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

// Toolbar click handling — floating buttons
canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;

  ctx.font = '13px sans-serif';
  const layout = getToolbarLayout(ctx, canvas.width, canvas.height);

  // Demo modal — blocks all other interaction
  if (demoModalOpen) {
    if (hitRect(px, py, layout.demoOpenButton)) {
      closeDemoModal();
      loadCity('simple-city');
      startRun('demo-city', 'simple-city');
    } else if (hitRect(px, py, layout.demoDismissButton)) {
      closeDemoModal();
      loadFromData({ buildings: [], edges: [], score: 0, nextBuildingId: 0 });
      saveGame();
      startRun('fresh');
    } else if (hitRect(px, py, layout.demoCloseButton)) {
      closeDemoModal();
    }
    e.stopImmediatePropagation();
    return;
  }

  // City modal — blocks other interaction when open
  if (cityModalOpen) {
    if (hitRect(px, py, layout.cityCloseButton)) {
      closeCityModal();
    } else {
      for (const btn of layout.cityRowButtons) {
        if (hitRect(px, py, btn)) {
          closeCityModal();
          loadCity(btn.file);
          startRun('city-loaded', btn.file);
          break;
        }
      }
    }
    e.stopImmediatePropagation();
    return;
  }

  // Gear button
  if (hitRect(px, py, layout.gearButton)) {
    toggleGearMenu();
    e.stopImmediatePropagation();
    return;
  }

  // Gear menu items (only when open)
  if (gearMenuOpen) {
    if (hitRect(px, py, layout.resetButton)) {
      closeGearMenu();
      endRun('reset');
      loadFromData({ buildings: [], edges: [], score: 0, nextBuildingId: 0 });
      saveGame();
      showDemoModal();
      e.stopImmediatePropagation();
      return;
    }
    if (hitRect(px, py, layout.musicButton)) {
      toggleMusic();
      e.stopImmediatePropagation();
      return;
    }
    if (hitRect(px, py, layout.saveButton)) {
      downloadSave();
      e.stopImmediatePropagation();
      return;
    }
    if (hitRect(px, py, layout.loadButton)) {
      uploadSave();
      e.stopImmediatePropagation();
      return;
    }
    if (hitRect(px, py, layout.citiesButton)) {
      closeGearMenu();
      showCityModal();
      e.stopImmediatePropagation();
      return;
    }
    for (const btn of layout.speedButtons) {
      if (hitRect(px, py, btn)) {
        setGameSpeed(btn.speed);
        e.stopImmediatePropagation();
        return;
      }
    }
    // Click anywhere else closes menu
    closeGearMenu();
    e.stopImmediatePropagation();
    return;
  }

  // Tool buttons (left column — includes building types)
  for (const btn of layout.buttons) {
    if (hitRect(px, py, btn)) {
      if (btn.buildingType) {
        setActiveTool('addBuilding');
        setSelectedBuildingType(btn.buildingType);
      } else {
        setActiveTool(btn.type);
      }
      e.stopImmediatePropagation();
      return;
    }
  }

  // Color circle — cycle to next color on tap
  if (layout.colorButton && hitRect(px, py, layout.colorButton)) {
    const buildingColors = getBuildingColors();
    const idx = buildingColors.indexOf(selectedColor);
    const next = buildingColors[(idx + 1) % buildingColors.length];
    setSelectedColor(next);
    e.stopImmediatePropagation();
    return;
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
  activeTouchCount = e.touches.length;
  if (e.touches.length >= 2) {
    e.preventDefault();
    // Cancel any in-progress road drag when second finger arrives
    cancelRoadDrag();
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
  activeTouchCount = e.touches.length;
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
    updatePeaks(score, cars.length);
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

  // Run simulation ticks based on speed (paused while modal is open)
  if (!demoModalOpen && !cityModalOpen) {
    const ticks = gameSpeed;
    for (let i = 0; i < ticks; i++) {
      simulationTick();
    }
  }

  render(ctx, canvas.width, canvas.height, roadPreview, fps);

  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

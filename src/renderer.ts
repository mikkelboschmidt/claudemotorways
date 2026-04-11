import { GRID, HALF, ROAD_W, DASH_LEN, DASH_GAP, CAR_LEN, CAR_WID, HIGHWAY_ROAD_W, NARROW_ROAD_W, PIN_COOLDOWN, TRUCK_LEN, TRUCK_WID, TUNNEL_ROAD_W } from './constants.ts';
import { currentThemeId, theme, themeAssets } from './theme.ts';
import { camX, camY, zoom } from './camera.ts';
import { edges, graphVersion, nodes, parseKey } from './graph.ts';
import { buildings, getBuildingPixelPos, getConnectionPixelPos, getConnectionPoint, HOUSE_W, HOUSE_H, FACTORY_W, FACTORY_H, STORAGE_W_TILES, STORAGE_H_TILES } from './buildings.ts';
import { hoverGx, hoverGy, pendingRemoveTiles } from './roads.ts';
import { cars } from './cars.ts';
import { Car, RoadPreview, ToolType } from './types.ts';
import { activeTool, selectedColor, selectedBuildingType, gearMenuOpen, demoModalOpen, cityModalOpen } from './toolbar.ts';
import { score } from './score.ts';
import { gameSpeed, SPEED_OPTIONS, SPEED_LABELS } from './speed.ts';
import { highways, highwayEdgeSet, highwayPhase, highwayStartGx, highwayStartGy, highwayPreviewEndPx, highwayPreviewEndPy, computeBezierControls, draggingHighwayId, draggingHandleIndex } from './highway.ts';
import { musicEnabled } from './music.ts';
import { cities } from './cities.ts';
import { roundabouts, roundaboutConnectionEdgeSet, roundaboutEdgeSet } from './roundabout.ts';
import { getHouseSprite, getFactorySprite, getStorageSprite, drawSpriteLayer, PinPlacement } from './sprites.ts';
import { trafficLights } from './trafficLights.ts';
import { tunnels, tunnelEdgeSet, tunnelPhase, tunnelStartGx, tunnelStartGy, tunnelPreviewEndPx, tunnelPreviewEndPy } from './tunnel.ts';

// SVG icon image cache — keyed by (rawSvg + colorOverride)
const iconCache = new Map<string, HTMLImageElement>();
const splashCache = new Map<string, HTMLImageElement>();
const pinGlowCache = new Map<string, HTMLCanvasElement>();
// Truck SVG images with Pin_n hidden (drawn programmatically) — keyed by (rawSvg + color)
const truckImgCache = new Map<string, HTMLImageElement>();
// Truck pin rect data — keyed by rawSvg (theme-specific)
interface TruckPinRect { x: number; y: number; w: number; h: number }
interface TruckPinData { svgW: number; svgH: number; rects: TruckPinRect[] }
const truckPinDataCache = new Map<string, TruckPinData>();
const trackWideNodeKeys = new Set<string>();
const trackConnectorCache: { x: number; y: number; wide: boolean }[] = [];
let trackCacheGraphVersion = -1;
let spaceSurfacePattern: CanvasPattern | null = null;
let spaceSurfacePatternCtx: CanvasRenderingContext2D | null = null;
let spaceSurfaceGradient: CanvasGradient | null = null;
let spaceSurfaceGradientHeight = 0;
let spaceSurfaceTexture: HTMLCanvasElement | null = null;
const SPACE_PATTERN_SIZE = 256;

function darkenHex(hex: string, factor: number): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  return `rgb(${r},${g},${b})`;
}

function getIconImage(rawSvg: string, colorOverride?: string): HTMLImageElement {
  const key = rawSvg + (colorOverride ?? '');
  let img = iconCache.get(key);
  if (img) return img;
  let svg = rawSvg;
  if (colorOverride) {
    // Replace themed color layers exported from SVGs.
    svg = svg.replace(/(id="RoofMain(?:_\d+)?"[^>]*fill=")([^"]*)(")/g, `$1${colorOverride}$3`);
    svg = svg.replace(/(id="RoofShadow(?:_\d+)?"[^>]*fill=")([^"]*)(")/g, `$1${darkenHex(colorOverride, 0.7)}$3`);
    svg = svg.replace(/(id="RoofDarkest(?:_\d+)?"[^>]*fill=")([^"]*)(")/g, `$1${darkenHex(colorOverride, 0.55)}$3`);
  }
  img = new Image();
  img.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
  iconCache.set(key, img);
  return img;
}

// Invalidate cached icons when color changes so CurrentColor layers update
let lastIconColor = '';
let lastIconThemeId = currentThemeId;
function invalidateIconCacheIfNeeded() {
  if (selectedColor !== lastIconColor || currentThemeId !== lastIconThemeId) {
    iconCache.clear();
    truckImgCache.clear();
    lastIconColor = selectedColor;
    lastIconThemeId = currentThemeId;
  }
}

// Parse Pin_n rect positions from a truck SVG, handling rotate(-90 px py) transforms.
// Returns rects in SVG coordinate space, plus the SVG's own width/height.
function getTruckPinData(rawSvg: string): TruckPinData {
  const cached = truckPinDataCache.get(rawSvg);
  if (cached) return cached;

  const vbMatch = rawSvg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
  const svgW = vbMatch ? parseFloat(vbMatch[1]) : 52;
  const svgH = vbMatch ? parseFloat(vbMatch[2]) : 28;

  const rects: TruckPinRect[] = [];
  for (let pin = 1; pin <= 6; pin++) {
    const elemMatch = rawSvg.match(new RegExp(`<rect[^>]*id="Pin_${pin}"[^>]*/?>`, 'i'));
    if (!elemMatch) continue;
    const elem = elemMatch[0];
    const xm = elem.match(/\bx="([^"]*)"/);
    const ym = elem.match(/\by="([^"]*)"/);
    const wm = elem.match(/\bwidth="([^"]*)"/);
    const hm = elem.match(/\bheight="([^"]*)"/);
    if (!xm || !ym || !wm || !hm) continue;
    const x = parseFloat(xm[1]);
    const y = parseFloat(ym[1]);
    const w = parseFloat(wm[1]);
    const h = parseFloat(hm[1]);
    if (elem.match(/transform="rotate\(-90/)) {
      // rotate(-90, px, py) around rect's own top-left: new bbox = {x, y: y-w, w: h, h: w}
      rects.push({ x, y: y - w, w: h, h: w });
    } else {
      rects.push({ x, y, w, h });
    }
  }

  const data: TruckPinData = { svgW, svgH, rects };
  truckPinDataCache.set(rawSvg, data);
  return data;
}

// Get truck SVG image with Pin_n elements hidden (pins drawn programmatically).
function getTruckImage(rawSvg: string, color: string): HTMLImageElement {
  const key = rawSvg + color;
  let img = truckImgCache.get(key);
  if (img) return img;

  let svg = rawSvg;
  svg = svg.replace(/(id="RoofMain(?:_\d+)?"[^>]*fill=")([^"]*)(")/g, `$1${color}$3`);
  svg = svg.replace(/(id="RoofShadow(?:_\d+)?"[^>]*fill=")([^"]*)(")/g, `$1${darkenHex(color, 0.7)}$3`);
  svg = svg.replace(/(id="RoofDarkest(?:_\d+)?"[^>]*fill=")([^"]*)(")/g, `$1${darkenHex(color, 0.55)}$3`);
  // Hide the Pins group (both SVGs wrap all Pin_n in <g id="Pins">).
  // Using the same safe pattern as sprites.ts PinPlacement: insert display="none" after the id attribute.
  svg = svg.replace(/(<g[^>]*id="Pins")/, '$1 display="none"');

  img = new Image();
  img.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
  truckImgCache.set(key, img);
  return img;
}

// Draw truck pin indicators using Pin_n rects from the SVG, scaled to the truck's drawn size.
// Inactive pins render dark; active (carried) pins render white — matching factory pin style.
function drawTruckPins(
  ctx: CanvasRenderingContext2D,
  rawSvg: string,
  carLen: number,
  carWid: number,
  pinsCarried: number,
  color: string,
) {
  const pinData = getTruckPinData(rawSvg);
  if (pinData.rects.length === 0) return;

  const scaleX = carLen / pinData.svgW;
  const scaleY = carWid / pinData.svgH;
  const offsetX = -carLen / 2;
  const offsetY = -carWid / 2;

  const activePins = Math.max(0, Math.min(pinData.rects.length, pinsCarried));
  const darkestColor = darkenHex(color, 0.55);

  for (let i = 0; i < pinData.rects.length; i++) {
    const rect = pinData.rects[i];
    ctx.fillStyle = i < activePins ? '#FFFFFF' : darkestColor;
    ctx.fillRect(
      offsetX + rect.x * scaleX,
      offsetY + rect.y * scaleY,
      rect.w * scaleX,
      rect.h * scaleY,
    );
  }
}

function getSplashImage(): HTMLImageElement {
  const url = themeAssets.splashUrl;
  let img = splashCache.get(url);
  if (img) return img;
  img = new Image();
  img.src = url;
  splashCache.set(url, img);
  return img;
}

function getPinGlowSprite(color: string): HTMLCanvasElement {
  let sprite = pinGlowCache.get(color);
  if (sprite) return sprite;

  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const cx = size / 2;
  const cy = size / 2;
  const outer = size * 0.45;
  const inner = size * 0.14;
  const glow = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  glow.addColorStop(0, 'rgba(255,255,255,0.95)');
  glow.addColorStop(0.2, 'rgba(255,255,255,0.75)');
  glow.addColorStop(0.45, colorToRgba(color, 0.7));
  glow.addColorStop(1, colorToRgba(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, 1.6, 0, Math.PI * 2);
  ctx.fill();

  pinGlowCache.set(color, canvas);
  return canvas;
}

function fract(n: number): number {
  return n - Math.floor(n);
}

function noise2(x: number, y: number, seed: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123);
}

function smoothNoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const a = noise2(ix, iy, seed);
  const b = noise2(ix + 1, iy, seed);
  const c = noise2(ix, iy + 1, seed);
  const d = noise2(ix + 1, iy + 1, seed);

  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const top = a + (b - a) * ux;
  const bottom = c + (d - c) * ux;
  return top + (bottom - top) * uy;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function periodicSmoothNoise2(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;

  const x0 = mod(ix, period);
  const y0 = mod(iy, period);
  const x1 = mod(ix + 1, period);
  const y1 = mod(iy + 1, period);

  const a = noise2(x0, y0, seed);
  const b = noise2(x1, y0, seed);
  const c = noise2(x0, y1, seed);
  const d = noise2(x1, y1, seed);

  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const top = a + (b - a) * ux;
  const bottom = c + (d - c) * ux;
  return top + (bottom - top) * uy;
}

function ensureSpaceSurfaceTexture(): HTMLCanvasElement {
  if (spaceSurfaceTexture) return spaceSurfaceTexture;

  const texture = document.createElement('canvas');
  texture.width = SPACE_PATTERN_SIZE;
  texture.height = SPACE_PATTERN_SIZE;
  const textureCtx = texture.getContext('2d');
  if (!textureCtx) return texture;

  const image = textureCtx.createImageData(SPACE_PATTERN_SIZE, SPACE_PATTERN_SIZE);
  const data = image.data;

  for (let y = 0; y < SPACE_PATTERN_SIZE; y++) {
    for (let x = 0; x < SPACE_PATTERN_SIZE; x++) {
      const fine = periodicSmoothNoise2(x / 8, y / 8, SPACE_PATTERN_SIZE / 8, 1.37);
      const medium = periodicSmoothNoise2(x / 20, y / 20, SPACE_PATTERN_SIZE / 20, 2.41);
      const broad = periodicSmoothNoise2(x / 68, y / 68, SPACE_PATTERN_SIZE / 68, 3.19);
      const fleck = noise2(x / 2, y / 2, 5.73);
      const shadow = noise2(x / 3.5, y / 3.5, 8.11);

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      if (fleck > 0.91) {
        r = 224 + Math.floor(broad * 18);
        g = 186 + Math.floor(medium * 16);
        b = 142 + Math.floor(fine * 10);
        a = Math.max(a, 26 + Math.floor((fleck - 0.91) * 150));
      } else if (shadow > 0.92) {
        r = 16 + Math.floor(broad * 12);
        g = 6 + Math.floor(medium * 8);
        b = 22 + Math.floor(fine * 10);
        a = Math.max(a, 22 + Math.floor((shadow - 0.92) * 150));
      }

      const offset = (y * SPACE_PATTERN_SIZE + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  }

  textureCtx.putImageData(image, 0, 0);
  spaceSurfaceTexture = texture;
  return texture;
}

function ensureSpaceSurfacePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (spaceSurfacePattern && spaceSurfacePatternCtx === ctx) return spaceSurfacePattern;
  const texture = ensureSpaceSurfaceTexture();
  spaceSurfacePattern = ctx.createPattern(texture, 'repeat');
  spaceSurfacePatternCtx = ctx;
  return spaceSurfacePattern;
}

function ensureSpaceSurfaceGradient(ctx: CanvasRenderingContext2D, height: number): CanvasGradient {
  if (!spaceSurfaceGradient || spaceSurfaceGradientHeight !== height) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(255,228,182,0.03)');
    gradient.addColorStop(0.4, 'rgba(107,71,42,0.045)');
    gradient.addColorStop(1, 'rgba(24,10,8,0.3)');
    spaceSurfaceGradient = gradient;
    spaceSurfaceGradientHeight = height;
  }
  return spaceSurfaceGradient;
}

function drawSpaceSurface(ctx: CanvasRenderingContext2D, width: number, height: number, worldLeft: number, worldTop: number, worldRight: number, worldBottom: number) {
  const pattern = ensureSpaceSurfacePattern(ctx);
  if (!pattern) return;

  ctx.save();
  if ('setTransform' in pattern) {
    pattern.setTransform(new DOMMatrix());
  }
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = pattern;
  ctx.fillRect(worldLeft, worldTop, worldRight - worldLeft, worldBottom - worldTop);
  ctx.restore();
}

function drawSvgIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rawSvg: string, colorOverride?: string) {
  const img = getIconImage(rawSvg, colorOverride);
  if (!img.complete) return;
  const size = r * 2; // fill the full button diameter
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  ctx.restore();
}

export function render(ctx: CanvasRenderingContext2D, width: number, height: number, preview: RoadPreview | null, fps: number = 0) {
  // Clear entire canvas
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);

  // Clip game area
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  // Apply camera transform: scale then translate
  ctx.scale(zoom, zoom);
  ctx.translate(-camX, -camY);

  const worldLeft = camX;
  const worldTop = camY;
  const worldRight = camX + width / zoom;
  const worldBottom = camY + height / zoom;

  if (currentThemeId === 'space') {
    drawSpaceSurface(ctx, width, height, worldLeft, worldTop, worldRight, worldBottom);
  }

  // Faint grid — only draw visible lines

  ctx.strokeStyle = theme.gridLine;
  ctx.lineWidth = 1 / zoom; // keep 1px on screen
  const gridStartX = Math.floor(worldLeft / GRID) * GRID;
  const gridStartY = Math.floor(worldTop / GRID) * GRID;
  ctx.beginPath();
  for (let x = gridStartX; x <= worldRight; x += GRID) {
    ctx.moveTo(x, worldTop);
    ctx.lineTo(x, worldBottom);
  }
  for (let y = gridStartY; y <= worldBottom; y += GRID) {
    ctx.moveTo(worldLeft, y);
    ctx.lineTo(worldRight, y);
  }
  ctx.stroke();

  drawTunnels(ctx);         // Underground paths — below everything
  drawTunnelCars(ctx);       // Underground cars as colored dots
  drawBuildingGrounds(ctx);
  drawRoads(ctx);
  drawTunnelEntrances(ctx);  // Surface markers at entrance/exit nodes
  drawRoundabouts(ctx);
  drawRoundaboutConnectionNodes(ctx);
  drawTrafficLights(ctx);
  drawCars(ctx, 'road');   // Road cars below buildings

  if (preview) {
    drawRoadPreview(ctx, preview);
  }

  drawHoverGhost(ctx);
  drawBuildingShadows(ctx);
  drawBuildingBodies(ctx);
  drawCollectingPins(ctx);

  drawHighways(ctx);       // Highways + their cars on top of everything
  drawHighwayPreview(ctx);
  drawTunnelPreview(ctx);

  // Restore from camera transform + clip
  ctx.restore();

  if (currentThemeId === 'space') {
    ctx.fillStyle = ensureSpaceSurfaceGradient(ctx, height);
    ctx.fillRect(0, 0, width, height);
  }

  // Score and toolbar drawn in screen space
  drawScore(ctx, width);
  drawToolbar(ctx, width, height, fps);
  if (cityModalOpen) drawCityModal(ctx, width, height);
  if (demoModalOpen) drawDemoModal(ctx, width, height);
}

/** Offset a line segment perpendicular by `d` pixels (positive = left of direction) */
function offsetLine(fx: number, fy: number, tx: number, ty: number, d: number): [number, number, number, number] {
  const dx = tx - fx;
  const dy = ty - fy;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * d;
  const ny = dx / len * d;
  return [fx + nx, fy + ny, tx + nx, ty + ny];
}

function rebuildTrackRenderCache() {
  trackWideNodeKeys.clear();
  trackConnectorCache.length = 0;
  const buildingNodeKeys = new Set<string>();
  for (const building of buildings) {
    buildingNodeKeys.add(building.nodeKey);
  }

  for (const [key, node] of nodes) {
    if (key.startsWith('hw')) continue;

    let edgeCount = 0;
    let wideCount = 0;
    let narrowCount = 0;
    let onlyAngle = 0;
    let hasMultipleDirections = false;
    let ncx = 0;
    let ncy = 0;
    let gotCenter = false;

    for (const eid of node.edges) {
      const e = edges.get(eid);
      if (!e || highwayEdgeSet.has(eid) || roundaboutEdgeSet.has(eid) || tunnelEdgeSet.has(eid)) continue;

      if (!gotCenter) {
        const isFrom = e.fromKey === key;
        ncx = isFrom ? e.fx : e.tx;
        ncy = isFrom ? e.fy : e.ty;
        gotCenter = true;
      }

      if (e.narrow) narrowCount++;
      else wideCount++;

      const isFrom = e.fromKey === key;
      const awayDx = isFrom ? e.tx - e.fx : e.fx - e.tx;
      const awayDy = isFrom ? e.ty - e.fy : e.fy - e.ty;
      const angle = Math.atan2(awayDy, awayDx);
      if (edgeCount === 0) {
        onlyAngle = angle;
      } else if (edgeCount === 1) {
        let diff = Math.abs(angle - onlyAngle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff < Math.PI - 0.01) hasMultipleDirections = true;
      } else {
        hasMultipleDirections = true;
      }
      edgeCount++;
    }

    if (edgeCount === 0) continue;
    if (!gotCenter) {
      ncx = node.gx * GRID + HALF;
      ncy = node.gy * GRID + HALF;
    }

    if (wideCount > 0) {
      trackWideNodeKeys.add(key);
    }

    const hasBuildingStub = buildingNodeKeys.has(key);
    const isRA = key.startsWith('ra');
    const hasMixedWidths = wideCount > 0 && narrowCount > 0;
    const needsCircle = hasBuildingStub
      || edgeCount === 1
      || edgeCount >= 3
      || hasMultipleDirections
      || hasMixedWidths
      || isRA;

    if (needsCircle) {
      trackConnectorCache.push({ x: ncx, y: ncy, wide: wideCount > 0 || isRA });
    }
  }

  trackCacheGraphVersion = graphVersion;
}

function ensureTrackRenderCache() {
  if (trackCacheGraphVersion === graphVersion) return;
  rebuildTrackRenderCache();
}

function drawRoads(ctx: CanvasRenderingContext2D) {
  if (theme.roadStyle === 'tracks') {
    drawRoadsTracks(ctx);
  } else {
    drawRoadsSolid(ctx);
  }

  // Red tile overlay for tiles pending removal (shared)
  if (pendingRemoveTiles.size > 0) {
    ctx.fillStyle = theme.removeTileOverlay;
    for (const tileKey of pendingRemoveTiles) {
      const [gx, gy] = parseKey(tileKey);
      ctx.fillRect(gx * GRID, gy * GRID, GRID, GRID);
    }
  }
}

function drawRoadsTracks(ctx: CanvasRenderingContext2D) {
  ensureTrackRenderCache();
  const tw = theme.trackWidth;
  const trackOff = theme.trackSpacing / 2; // half the center-to-center distance

  ctx.strokeStyle = theme.trackColor;
  ctx.lineWidth = tw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Draw straight track segments — double-track for wide roads, single center line for narrow
  for (const side of [-1, 1]) {
    ctx.beginPath();
    for (const [, edge] of edges) {
      if (highwayEdgeSet.has(edge.id)) continue;
      if (roundaboutEdgeSet.has(edge.id)) continue;
      if (tunnelEdgeSet.has(edge.id)) continue;
      if (edge.narrow) continue; // narrow drawn separately below
      const [ox1, oy1, ox2, oy2] = offsetLine(edge.fx, edge.fy, edge.tx, edge.ty, side * trackOff);
      ctx.moveTo(ox1, oy1);
      ctx.lineTo(ox2, oy2);
    }
    ctx.stroke();
  }

  // Single-track for narrow roads (center line only)
  ctx.beginPath();
  for (const [, edge] of edges) {
    if (highwayEdgeSet.has(edge.id)) continue;
    if (roundaboutEdgeSet.has(edge.id)) continue;
    if (tunnelEdgeSet.has(edge.id)) continue;
    if (!edge.narrow) continue;
    ctx.moveTo(edge.fx, edge.fy);
    ctx.lineTo(edge.tx, edge.ty);
  }
  ctx.stroke();

  // Smooth connectors at every junction node
  drawTrackConnectors(ctx, trackOff);

  // Track stubs from building connection tiles to building walls
  for (const b of buildings) {
    const [cx, cy] = parseKey(b.nodeKey);
    const node = nodes.get(b.nodeKey);
    if (!node || node.edges.size === 0) continue;
    const wallPos = getConnectionPixelPos(b);
    const sfx = cx * GRID + HALF;
    const sfy = cy * GRID + HALF;
    const hasWide = trackWideNodeKeys.has(b.nodeKey);
    if (hasWide) {
      for (const side of [-1, 1]) {
        const [ox1, oy1, ox2, oy2] = offsetLine(sfx, sfy, wallPos.x, wallPos.y, side * trackOff);
        ctx.beginPath();
        ctx.moveTo(ox1, oy1);
        ctx.lineTo(ox2, oy2);
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(sfx, sfy);
      ctx.lineTo(wallPos.x, wallPos.y);
      ctx.stroke();
    }
  }
}

/** At every road node that bends, branches, dead-ends, or has a building
 *  connected, draw a full circle at radius trackOff. All track endpoints sit
 *  on this circle, so the ring naturally connects every rail through the junction. */
function drawTrackConnectors(ctx: CanvasRenderingContext2D, trackOff: number) {
  ensureTrackRenderCache();
  ctx.strokeStyle = theme.trackColor;
  ctx.lineWidth = theme.trackWidth;
  ctx.lineCap = 'round';

  for (const connector of trackConnectorCache) {
    ctx.beginPath();
    if (connector.wide) {
      ctx.arc(connector.x, connector.y, trackOff, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.arc(connector.x, connector.y, theme.trackWidth * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = theme.trackColor;
      ctx.fill();
    }
  }
}

function drawRoadsSolid(ctx: CanvasRenderingContext2D) {
  // Draw regular (bidirectional) road segments
  ctx.strokeStyle = theme.road;
  ctx.lineWidth = ROAD_W;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  for (const [, edge] of edges) {
    if (highwayEdgeSet.has(edge.id)) continue;
    if (roundaboutEdgeSet.has(edge.id)) continue;
    if (tunnelEdgeSet.has(edge.id)) continue;
    if (edge.narrow) continue; // narrow drawn separately
    ctx.moveTo(edge.fx, edge.fy);
    ctx.lineTo(edge.tx, edge.ty);
  }
  ctx.stroke();

  // Draw one-way (narrow) road segments
  ctx.strokeStyle = theme.road;
  ctx.lineWidth = NARROW_ROAD_W;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  for (const [, edge] of edges) {
    if (highwayEdgeSet.has(edge.id)) continue;
    if (roundaboutEdgeSet.has(edge.id)) continue;
    if (tunnelEdgeSet.has(edge.id)) continue;
    if (!edge.narrow) continue;
    ctx.moveTo(edge.fx, edge.fy);
    ctx.lineTo(edge.tx, edge.ty);
  }
  ctx.stroke();

  // Draw round joints at all nodes for smooth corners (skip highway intermediate nodes)
  ctx.fillStyle = theme.road;
  for (const [key, node] of nodes) {
    if (key.startsWith('hw') || key.startsWith('ra')) continue;
    let hasWide = false;
    let hasRoad = false;
    for (const eid of node.edges) {
      const e = edges.get(eid);
      if (!e || highwayEdgeSet.has(eid) || roundaboutEdgeSet.has(eid) || tunnelEdgeSet.has(eid)) continue;
      hasRoad = true;
      if (!e.narrow) { hasWide = true; break; }
    }
    if (!hasRoad) continue;
    const r = hasWide ? ROAD_W / 2 : NARROW_ROAD_W / 2;
    ctx.beginPath();
    ctx.arc(node.gx * GRID + HALF, node.gy * GRID + HALF, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw stubs from building connection tiles to building walls
  ctx.strokeStyle = theme.road;
  ctx.lineWidth = ROAD_W;
  ctx.lineCap = 'butt';
  for (const b of buildings) {
    const [cx, cy] = getConnectionPoint(b);
    const node = nodes.get(`${cx},${cy}`);
    if (!node || node.edges.size === 0) continue;
    const wallPos = getConnectionPixelPos(b);
    ctx.beginPath();
    ctx.moveTo(cx * GRID + HALF, cy * GRID + HALF);
    ctx.lineTo(wallPos.x, wallPos.y);
    ctx.stroke();
  }

  // Dashed center lines for regular roads only
  ctx.strokeStyle = theme.roadDash;
  ctx.lineWidth = 2;
  ctx.lineCap = 'butt';
  ctx.setLineDash([DASH_LEN, DASH_GAP]);

  ctx.beginPath();
  for (const [, edge] of edges) {
    if (edge.narrow) continue;
    if (roundaboutEdgeSet.has(edge.id)) continue;
    if (tunnelEdgeSet.has(edge.id)) continue;
    ctx.moveTo(edge.fx, edge.fy);
    ctx.lineTo(edge.tx, edge.ty);
  }
  ctx.stroke();

  ctx.setLineDash([]);


  // Red tile overlay for tiles pending removal
  if (pendingRemoveTiles.size > 0) {
    ctx.fillStyle = theme.removeTileOverlay;
    for (const tileKey of pendingRemoveTiles) {
      const [gx, gy] = parseKey(tileKey);
      ctx.fillRect(gx * GRID, gy * GRID, GRID, GRID);
    }
  }
}

// Evaluate cubic bezier at parameter t
function evalBez(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}
// Derivative of cubic bezier at parameter t
function evalBezDeriv(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

// Smoothstep for nicer easing
function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}

const HW_SAMPLES = 40;
const TAPER_T = 0.15; // 15% of curve at each end is transition zone

// Compute tapered half-width at parameter t
function taperHalfW(t: number, baseHalfW: number): number {
  const roadHalfW = ROAD_W / 2;
  if (t < TAPER_T) return roadHalfW + (baseHalfW - roadHalfW) * smoothstep(t / TAPER_T);
  if (t > 1 - TAPER_T) return roadHalfW + (baseHalfW - roadHalfW) * smoothstep((1 - t) / TAPER_T);
  return baseHalfW;
}

// Expand 3-char hex (#abc) to 6-char (#aabbcc)
function expandHex(c: string): string {
  if (c.length === 4) return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  return c;
}

// Interpolate hex color
function lerpColor(c0: string, c1: string, f: number): string {
  const a = expandHex(c0), b = expandHex(c1);
  const r0 = parseInt(a.slice(1, 3), 16), g0 = parseInt(a.slice(3, 5), 16), b0 = parseInt(a.slice(5, 7), 16);
  const r1 = parseInt(b.slice(1, 3), 16), g1 = parseInt(b.slice(3, 5), 16), b1 = parseInt(b.slice(5, 7), 16);
  const r = Math.round(r0 + (r1 - r0) * f), g = Math.round(g0 + (g1 - g0) * f), bb = Math.round(b0 + (b1 - b0) * f);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bb).toString(16).slice(1);
}

// Build offset polygon edges that widen from endHalfW at endpoints to midHalfW in the center
function buildWideningEdges(
  p0x: number, p0y: number, p1x: number, p1y: number,
  p2x: number, p2y: number, p3x: number, p3y: number,
  endHalfW: number, midHalfW: number
) {
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  for (let i = 0; i <= HW_SAMPLES; i++) {
    const t = i / HW_SAMPLES;
    const x = evalBez(t, p0x, p1x, p2x, p3x);
    const y = evalBez(t, p0y, p1y, p2y, p3y);
    const dx = evalBezDeriv(t, p0x, p1x, p2x, p3x);
    const dy = evalBezDeriv(t, p0y, p1y, p2y, p3y);
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    // sine blend: 0 at ends, 1 in middle
    const hw = endHalfW + (midHalfW - endHalfW) * Math.sin(t * Math.PI);
    left.push({ x: x + nx * hw, y: y + ny * hw });
    right.push({ x: x - nx * hw, y: y - ny * hw });
  }
  return { left, right };
}

// Build offset polygon edges for a bezier with constant width (no taper)
function buildConstantEdges(
  p0x: number, p0y: number, p1x: number, p1y: number,
  p2x: number, p2y: number, p3x: number, p3y: number,
  halfW: number
) {
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  for (let i = 0; i <= HW_SAMPLES; i++) {
    const t = i / HW_SAMPLES;
    const x = evalBez(t, p0x, p1x, p2x, p3x);
    const y = evalBez(t, p0y, p1y, p2y, p3y);
    const dx = evalBezDeriv(t, p0x, p1x, p2x, p3x);
    const dy = evalBezDeriv(t, p0y, p1y, p2y, p3y);
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    left.push({ x: x + nx * halfW, y: y + ny * halfW });
    right.push({ x: x - nx * halfW, y: y - ny * halfW });
  }
  return { left, right };
}

// Build offset polygon edges for a bezier with tapered width
function buildTaperedEdges(
  p0x: number, p0y: number, p1x: number, p1y: number,
  p2x: number, p2y: number, p3x: number, p3y: number,
  halfW: number, offX = 0, offY = 0
) {
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  for (let i = 0; i <= HW_SAMPLES; i++) {
    const t = i / HW_SAMPLES;
    const x = evalBez(t, p0x, p1x, p2x, p3x) + offX;
    const y = evalBez(t, p0y, p1y, p2y, p3y) + offY;
    const dx = evalBezDeriv(t, p0x, p1x, p2x, p3x);
    const dy = evalBezDeriv(t, p0y, p1y, p2y, p3y);
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const hw = taperHalfW(t, halfW);
    left.push({ x: x + nx * hw, y: y + ny * hw });
    right.push({ x: x - nx * hw, y: y - ny * hw });
  }
  return { left, right };
}

// Fill a polygon from left edge forward + right edge backward
function fillTaperedPoly(ctx: CanvasRenderingContext2D, left: { x: number; y: number }[], right: { x: number; y: number }[]) {
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fill();
}

function drawRoundabouts(ctx: CanvasRenderingContext2D) {
  for (const ra of roundabouts) {
    const cx = (ra.gx + 1) * GRID + HALF;
    const cy = (ra.gy + 1) * GRID + HALF;
    const ringR = GRID; // ring nodes are 1 tile from center = 40px

    if (theme.roadStyle === 'tracks') {
      // Track style: two concentric circles as rails
      const tw = theme.trackWidth;
      const outerR = ringR + theme.trackSpacing / 2;
      const innerR = ringR - theme.trackSpacing / 2;
      ctx.strokeStyle = theme.trackColor;
      ctx.lineWidth = tw;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // Solid style: filled annulus
      ctx.fillStyle = theme.road;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR + ROAD_W / 2, 0, Math.PI * 2);
      ctx.arc(cx, cy, ringR - ROAD_W / 2, 0, Math.PI * 2, true);
      ctx.fill();

      // Green island
      ctx.fillStyle = theme.bg;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR - ROAD_W / 2, 0, Math.PI * 2);
      ctx.fill();

      // Island border
      ctx.strokeStyle = theme.roundaboutIslandBorder;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR - ROAD_W / 2, 0, Math.PI * 2);
      ctx.stroke();

      // Dashed center line (circle)
      ctx.strokeStyle = theme.roadDash;
      ctx.lineWidth = 2;
      ctx.setLineDash([DASH_LEN, DASH_GAP]);
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawRoundaboutConnectionNodes(ctx: CanvasRenderingContext2D) {
  if (roundaboutConnectionEdgeSet.size === 0) return;

  if (theme.roadStyle === 'tracks') {
    const trackOff = theme.trackSpacing / 2;
    ctx.strokeStyle = theme.trackColor;
    ctx.lineWidth = theme.trackWidth;
    ctx.lineCap = 'round';

    for (const eid of roundaboutConnectionEdgeSet) {
      const edge = edges.get(eid);
      if (!edge) continue;
      ctx.beginPath();
      ctx.arc(edge.tx, edge.ty, trackOff, 0, Math.PI * 2);
      ctx.stroke();
    }
    return;
  }

  ctx.fillStyle = theme.road;
  for (const eid of roundaboutConnectionEdgeSet) {
    const edge = edges.get(eid);
    if (!edge) continue;
    ctx.beginPath();
    ctx.arc(edge.tx, edge.ty, ROAD_W / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTrafficLights(ctx: CanvasRenderingContext2D) {
  if (trafficLights.length === 0) return;

  const isSpace = currentThemeId === 'space';

  for (const tl of trafficLights) {
    const cx = tl.gx * GRID + HALF;
    const cy = tl.gy * GRID + HALF;
    const rot = tl.diagonal ? Math.PI / 4 : 0;

    if (isSpace) {
      drawTrafficLightArrows(ctx, cx, cy, rot, tl.greenAxis);
    } else {
      drawTrafficLightDots(ctx, cx, cy, rot, tl.greenAxis);
    }
  }
}

function drawTrafficLightDots(ctx: CanvasRenderingContext2D, cx: number, cy: number, rot: number, greenAxis: 'ns' | 'ew') {
  const size = 8;
  const dotR = 3;
  const off = 4.5;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.roundRect(-size, -size, size * 2, size * 2, 3);
  ctx.fill();

  const nsColor = greenAxis === 'ns' ? '#33cc33' : '#ff3333';
  const ewColor = greenAxis === 'ew' ? '#33cc33' : '#ff3333';

  // North
  ctx.fillStyle = nsColor;
  ctx.beginPath();
  ctx.arc(0, -off, dotR, 0, Math.PI * 2);
  ctx.fill();
  // South
  ctx.beginPath();
  ctx.arc(0, off, dotR, 0, Math.PI * 2);
  ctx.fill();

  // East
  ctx.fillStyle = ewColor;
  ctx.beginPath();
  ctx.arc(off, 0, dotR, 0, Math.PI * 2);
  ctx.fill();
  // West
  ctx.beginPath();
  ctx.arc(-off, 0, dotR, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawTrafficLightArrows(ctx: CanvasRenderingContext2D, cx: number, cy: number, rot: number, greenAxis: 'ns' | 'ew') {
  const arrowLen = 10;
  const headLen = 4;
  const headW = 3;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  // Background circle
  ctx.fillStyle = 'rgba(20, 20, 30, 0.85)';
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();

  const greenColor = '#4CFFF9';
  const blockedColor = colorToRgba(theme.road, 0.1);

  // Vertical axis (ns)
  ctx.strokeStyle = greenAxis === 'ns' ? greenColor : blockedColor;
  ctx.lineWidth = 1.8;
  drawDoubleArrow(ctx, 0, -arrowLen, 0, arrowLen, headLen, headW);

  // Horizontal axis (ew)
  ctx.strokeStyle = greenAxis === 'ew' ? greenColor : blockedColor;
  drawDoubleArrow(ctx, -arrowLen, 0, arrowLen, 0, headLen, headW);

  ctx.restore();
}

function drawDoubleArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, headLen: number, headW: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  // Shaft
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Arrowhead at end
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - ux * headLen + px * headW, y2 - uy * headLen + py * headW);
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - ux * headLen - px * headW, y2 - uy * headLen - py * headW);
  ctx.stroke();

  // Arrowhead at start
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 + ux * headLen + px * headW, y1 + uy * headLen + py * headW);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 + ux * headLen - px * headW, y1 + uy * headLen - py * headW);
  ctx.stroke();
}

function drawHighways(ctx: CanvasRenderingContext2D) {
  const isTracks = theme.roadStyle === 'tracks';
  const roadTrackOff = theme.trackSpacing / 2;           // match road circles
  const hwTrackOff = (theme.highwayTrackSpacing || theme.trackSpacing) / 2; // wide middle

  for (const hw of highways) {
    ctx.save();

    if (isTracks) {
      // ── Track-style highway ──

      // Gradient fill: transparent at ends → semi-transparent white in the middle
      const surface = buildTaperedEdges(hw.p0x, hw.p0y, hw.p1x, hw.p1y, hw.p2x, hw.p2y, hw.p3x, hw.p3y, HIGHWAY_ROAD_W / 2);
      for (let i = 0; i < surface.left.length - 1; i++) {
        const t = (i + 0.5) / HW_SAMPLES;
        const alpha = Math.sin(t * Math.PI) * 0.12;
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(surface.left[i].x, surface.left[i].y);
        ctx.lineTo(surface.left[i + 1].x, surface.left[i + 1].y);
        ctx.lineTo(surface.right[i + 1].x, surface.right[i + 1].y);
        ctx.lineTo(surface.right[i].x, surface.right[i].y);
        ctx.closePath();
        ctx.fill();
      }

      // Track lines: taper from road spacing at endpoints to highway spacing in middle
      const tracks = buildWideningEdges(hw.p0x, hw.p0y, hw.p1x, hw.p1y, hw.p2x, hw.p2y, hw.p3x, hw.p3y, roadTrackOff, hwTrackOff);
      const baseColor = theme.trackColor;
      const fastColor = theme.highwayTrackFastColor || baseColor;
      ctx.lineWidth = theme.trackWidth + 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Draw gradient color segments for each track
      for (const side of [tracks.left, tracks.right]) {
        for (let i = 0; i < side.length - 1; i++) {
          const t = (i + 0.5) / HW_SAMPLES;
          const blend = Math.sin(t * Math.PI);
          ctx.strokeStyle = lerpColor(baseColor, fastColor, blend);
          ctx.beginPath();
          ctx.moveTo(side[i].x, side[i].y);
          ctx.lineTo(side[i + 1].x, side[i + 1].y);
          ctx.stroke();
        }
      }

      // Circles at start and end — same radius as road connector circles
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = theme.trackWidth;
      ctx.beginPath();
      ctx.arc(hw.p0x, hw.p0y, roadTrackOff, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hw.p3x, hw.p3y, roadTrackOff, 0, Math.PI * 2);
      ctx.stroke();

    } else {
      // ── Solid-style highway (original) ──

      // 1) Shadow (wider, offset)
      const shadow = buildTaperedEdges(hw.p0x, hw.p0y, hw.p1x, hw.p1y, hw.p2x, hw.p2y, hw.p3x, hw.p3y, (HIGHWAY_ROAD_W + 6) / 2, 3, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      fillTaperedPoly(ctx, shadow.left, shadow.right);

      // 2) Outline
      const outline = buildTaperedEdges(hw.p0x, hw.p0y, hw.p1x, hw.p1y, hw.p2x, hw.p2y, hw.p3x, hw.p3y, (HIGHWAY_ROAD_W + 4) / 2);
      ctx.fillStyle = theme.highwayOutline;
      fillTaperedPoly(ctx, outline.left, outline.right);

      // 3) Surface with color gradient at ends
      const surface = buildTaperedEdges(hw.p0x, hw.p0y, hw.p1x, hw.p1y, hw.p2x, hw.p2y, hw.p3x, hw.p3y, HIGHWAY_ROAD_W / 2);

      const taperSamples = Math.ceil(TAPER_T * HW_SAMPLES);
      ctx.fillStyle = theme.highwaySurface;
      ctx.beginPath();
      ctx.moveTo(surface.left[taperSamples].x, surface.left[taperSamples].y);
      for (let i = taperSamples + 1; i <= HW_SAMPLES - taperSamples; i++) ctx.lineTo(surface.left[i].x, surface.left[i].y);
      for (let i = HW_SAMPLES - taperSamples; i >= taperSamples; i--) ctx.lineTo(surface.right[i].x, surface.right[i].y);
      ctx.closePath();
      ctx.fill();

      for (let i = 0; i < taperSamples; i++) {
        const t = (i + 0.5) / HW_SAMPLES;
        const f = smoothstep(t / TAPER_T);
        ctx.fillStyle = lerpColor(theme.road, theme.highwaySurface, f);
        ctx.beginPath();
        ctx.moveTo(surface.left[i].x, surface.left[i].y);
        ctx.lineTo(surface.left[i + 1].x, surface.left[i + 1].y);
        ctx.lineTo(surface.right[i + 1].x, surface.right[i + 1].y);
        ctx.lineTo(surface.right[i].x, surface.right[i].y);
        ctx.closePath();
        ctx.fill();
      }

      for (let i = HW_SAMPLES - taperSamples; i < HW_SAMPLES; i++) {
        const t = (i + 0.5) / HW_SAMPLES;
        const f = smoothstep((1 - t) / TAPER_T);
        ctx.fillStyle = lerpColor(theme.road, theme.highwaySurface, f);
        ctx.beginPath();
        ctx.moveTo(surface.left[i].x, surface.left[i].y);
        ctx.lineTo(surface.left[i + 1].x, surface.left[i + 1].y);
        ctx.lineTo(surface.right[i + 1].x, surface.right[i + 1].y);
        ctx.lineTo(surface.right[i].x, surface.right[i].y);
        ctx.closePath();
        ctx.fill();
      }

      // 4) Dashed center line
      ctx.setLineDash([DASH_LEN, DASH_GAP]);
      ctx.strokeStyle = theme.highwayDash;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hw.p0x, hw.p0y);
      ctx.bezierCurveTo(hw.p1x, hw.p1y, hw.p2x, hw.p2y, hw.p3x, hw.p3y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Draw cars on this highway's edges so they layer correctly
    const hwEdges = new Set(hw.edgeIds);
    drawCars(ctx, hwEdges);
  }

  // Draw draggable control point handles when highway tool is active
  if (activeTool === 'addHighway' || draggingHighwayId >= 0) {
    for (const hw of highways) {
      for (const [idx, hx, hy] of [[1, hw.mid1X, hw.mid1Y], [2, hw.mid2X, hw.mid2Y]] as [number, number, number][]) {
        const isDragging = hw.id === draggingHighwayId && idx === draggingHandleIndex;
        ctx.beginPath();
        ctx.arc(hx, hy, isDragging ? 8 : 6, 0, Math.PI * 2);
        ctx.fillStyle = isDragging ? theme.handleActive : theme.handleInactive;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }
}

function drawHighwayPreview(ctx: CanvasRenderingContext2D) {
  if (highwayPhase !== 'pickEnd') return;

  const p0x = highwayStartGx * GRID + HALF;
  const p0y = highwayStartGy * GRID + HALF;
  const p3x = highwayPreviewEndPx;
  const p3y = highwayPreviewEndPy;

  if (Math.hypot(p3x - p0x, p3y - p0y) < GRID) return;

  const { p1x, p1y, p2x, p2y } = computeBezierControls(p0x, p0y, p3x, p3y);
  const isTracks = theme.roadStyle === 'tracks';
  const roadTrackOff = theme.trackSpacing / 2;
  const hwTrackOff = (theme.highwayTrackSpacing || theme.trackSpacing) / 2;

  ctx.save();
  ctx.globalAlpha = 0.5;

  if (isTracks) {
    // Gradient fill: transparent at ends → semi-transparent white in middle
    const surface = buildTaperedEdges(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, HIGHWAY_ROAD_W / 2);
    for (let i = 0; i < surface.left.length - 1; i++) {
      const t = (i + 0.5) / HW_SAMPLES;
      const alpha = Math.sin(t * Math.PI) * 0.08;
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(surface.left[i].x, surface.left[i].y);
      ctx.lineTo(surface.left[i + 1].x, surface.left[i + 1].y);
      ctx.lineTo(surface.right[i + 1].x, surface.right[i + 1].y);
      ctx.lineTo(surface.right[i].x, surface.right[i].y);
      ctx.closePath();
      ctx.fill();
    }

    // Track lines: taper from road spacing at endpoints to highway spacing in middle
    const tracks = buildWideningEdges(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, roadTrackOff, hwTrackOff);
    const baseColor = theme.trackColor;
    const fastColor = theme.highwayTrackFastColor || baseColor;
    ctx.lineWidth = theme.trackWidth + 1;
    ctx.lineCap = 'round';
    for (const side of [tracks.left, tracks.right]) {
      for (let i = 0; i < side.length - 1; i++) {
        const t = (i + 0.5) / HW_SAMPLES;
        ctx.strokeStyle = lerpColor(baseColor, fastColor, Math.sin(t * Math.PI));
        ctx.beginPath();
        ctx.moveTo(side[i].x, side[i].y);
        ctx.lineTo(side[i + 1].x, side[i + 1].y);
        ctx.stroke();
      }
    }
  } else {
    const surface = buildTaperedEdges(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, HIGHWAY_ROAD_W / 2);
    ctx.fillStyle = theme.highwaySurface;
    fillTaperedPoly(ctx, surface.left, surface.right);
  }
  ctx.restore();

  // Start point indicator
  ctx.fillStyle = theme.handleInactive;
  ctx.beginPath();
  ctx.arc(p0x, p0y, 6, 0, Math.PI * 2);
  ctx.fill();
}

function drawRoadPreview(ctx: CanvasRenderingContext2D, preview: RoadPreview) {
  const px1 = preview.startGx * GRID + HALF;
  const py1 = preview.startGy * GRID + HALF;
  const px2 = preview.endGx * GRID + HALF;
  const py2 = preview.endGy * GRID + HALF;
  const isNarrow = activeTool === 'addNarrow';
  const roadW = isNarrow ? NARROW_ROAD_W : ROAD_W;

  ctx.strokeStyle = theme.previewRoad;
  ctx.lineWidth = roadW;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px1, py1);
  ctx.lineTo(px2, py2);
  ctx.stroke();

  if (!isNarrow) {
    // Preview dashed center line
    ctx.strokeStyle = theme.previewDash;
    ctx.lineWidth = 2;
    ctx.lineCap = 'butt';
    ctx.setLineDash([DASH_LEN, DASH_GAP]);
    ctx.beginPath();
    ctx.moveTo(px1, py1);
    ctx.lineTo(px2, py2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawHoverGhost(ctx: CanvasRenderingContext2D) {
  if (hoverGx === null || hoverGy === null) return;

  if (activeTool === 'addRoundabout') {
    const px = hoverGx * GRID;
    const py = hoverGy * GRID;
    const pw = 3 * GRID;
    const ph = 3 * GRID;
    const cx = (hoverGx + 1) * GRID + HALF;
    const cy = (hoverGy + 1) * GRID + HALF;

    ctx.fillStyle = theme.previewShadow;
    ctx.fillRect(px, py, pw, ph);
    // Road ring preview
    ctx.strokeStyle = theme.previewRoad;
    ctx.lineWidth = ROAD_W;
    ctx.beginPath();
    ctx.arc(cx, cy, GRID, 0, Math.PI * 2);
    ctx.stroke();
    // Island preview
    ctx.fillStyle = theme.previewIsland;
    ctx.beginPath();
    ctx.arc(cx, cy, GRID - ROAD_W / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (activeTool === 'addBuilding') {
    const w = selectedBuildingType === 'house' ? HOUSE_W : selectedBuildingType === 'storage' ? STORAGE_W_TILES : FACTORY_W;
    const h = selectedBuildingType === 'house' ? HOUSE_H : selectedBuildingType === 'storage' ? STORAGE_H_TILES : FACTORY_H;
    const px = hoverGx * GRID;
    const py = hoverGy * GRID;
    const pw = w * GRID;
    const ph = h * GRID;

    ctx.fillStyle = theme.previewShadow;
    ctx.fillRect(px + 2, py + 2, pw - 4, ph - 4);
    ctx.strokeStyle = selectedColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(px + 2, py + 2, pw - 4, ph - 4);
    ctx.setLineDash([]);
  } else if (activeTool === 'addRoad') {
    // Show a dot at the tile center where the road will start
    ctx.fillStyle = theme.previewRoadDot;
    ctx.beginPath();
    ctx.arc(hoverGx * GRID + HALF, hoverGy * GRID + HALF, ROAD_W / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Ground layer: drawn below roads so cars drive over it
function spriteColor(b: typeof buildings[0]): string {
  return b.disabled ? theme.disabledBuilding : b.color;
}

function drawBuildingGrounds(ctx: CanvasRenderingContext2D) {
  for (const b of buildings) {
    const pos = getBuildingPixelPos(b);
    const color = spriteColor(b);
    if (b.type === 'house') {
      const sprite = getHouseSprite(b.connectionSide, color);
      if (sprite) drawSpriteLayer(ctx, sprite.ground, sprite, pos.x, pos.y);
    } else if (b.type === 'factory') {
      const sprite = getFactorySprite(b.connectionSide, color);
      if (sprite) drawSpriteLayer(ctx, sprite.ground, sprite, pos.x, pos.y);
    } else if (b.type === 'storage') {
      const sprite = getStorageSprite(b.connectionSide, color);
      if (sprite) drawSpriteLayer(ctx, sprite.ground, sprite, pos.x, pos.y);
    }
  }
}

// Shadow layer: drawn above cars, below building bodies
function drawBuildingShadows(ctx: CanvasRenderingContext2D) {
  for (const b of buildings) {
    const pos = getBuildingPixelPos(b);
    const color = spriteColor(b);
    if (b.type === 'house') {
      const sprite = getHouseSprite(b.connectionSide, color);
      if (sprite) drawSpriteLayer(ctx, sprite.shadow, sprite, pos.x, pos.y);
    } else if (b.type === 'factory') {
      const sprite = getFactorySprite(b.connectionSide, color);
      if (sprite) drawSpriteLayer(ctx, sprite.shadow, sprite, pos.x, pos.y);
    } else if (b.type === 'storage') {
      const sprite = getStorageSprite(b.connectionSide, color);
      if (sprite) drawSpriteLayer(ctx, sprite.shadow, sprite, pos.x, pos.y);
    }
  }
}

// Building body layer: drawn on top of everything
function drawBuildingBodies(ctx: CanvasRenderingContext2D) {
  for (const b of buildings) {
    const pos = getBuildingPixelPos(b);
    const color = spriteColor(b);

    if (b.type === 'house') {
      const sprite = getHouseSprite(b.connectionSide, color);
      if (sprite) {
        drawSpriteLayer(ctx, sprite.building, sprite, pos.x, pos.y);
      }
    } else if (b.type === 'factory') {
      const sprite = getFactorySprite(b.connectionSide, color);
      if (sprite) {
        drawSpriteLayer(ctx, sprite.building, sprite, pos.x, pos.y);
        drawFactoryPins(ctx, pos.x, pos.y, sprite.pinRects, b.pins, b.pinCooldown, b.disabled, color);
      } else {
        drawFactory(ctx, b, pos);
      }
    } else if (b.type === 'storage') {
      const sprite = getStorageSprite(b.connectionSide, color);
      if (sprite) {
        drawSpriteLayer(ctx, sprite.building, sprite, pos.x, pos.y);
      } else {
        drawStorage(ctx, b, pos);
      }
      if (b.maxPins > 0) {
        drawStoragePinGrid(ctx, pos.x, pos.y, pos.w, pos.h, b.pins, b.maxPins, b.pinCooldown, color, sprite?.pinPlacement ?? null, b.disabled);
      }
    }
  }
}

function drawFactory(ctx: CanvasRenderingContext2D, b: typeof buildings[0], pos: { x: number; y: number; w: number; h: number }) {
  const m = 2; // outer margin
  const color = b.disabled ? theme.disabledBuilding : b.color;

  // Parking lot background (tinted version of the color)
  const tintFn = theme.buildingBgTint === 'darken' ? darkenColor : lightenColor;
  ctx.fillStyle = b.disabled ? theme.disabledParkingBg : tintFn(color, theme.buildingBgTintAmount);
  ctx.beginPath();
  ctx.roundRect(pos.x + m, pos.y + m, pos.w - m * 2, pos.h - m * 2, 3);
  ctx.fill();

  // Colored outline
  ctx.strokeStyle = b.disabled ? theme.disabledBorder : color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(pos.x + m, pos.y + m, pos.w - m * 2, pos.h - m * 2, 3);
  ctx.stroke();

  // Inner building (solid color) — positioned opposite the parking spots
  // For left/right connection: lane at top, spots at bottom → building at top
  // For top/bottom connection: lane on left, spots on right → building on left
  const pad = 4;
  let bx: number, by: number, bw: number, bh: number;
  switch (b.connectionSide) {
    case 'left':
    case 'right':
      // Building occupies top ~40% of the factory
      bx = pos.x + pad;
      by = pos.y + pad;
      bw = pos.w - pad * 2;
      bh = pos.h * 0.4 - pad;
      break;
    case 'top':
    case 'bottom':
      // Building occupies left ~40%
      bx = pos.x + pad;
      by = pos.y + pad;
      bw = pos.w * 0.4 - pad;
      bh = pos.h - pad * 2;
      break;
  }

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 2);
  ctx.fill();

  // Subtle dark outline on inner building
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 2);
  ctx.stroke();

}

function drawFactoryPins(
  ctx: CanvasRenderingContext2D,
  buildingX: number,
  buildingY: number,
  pinRects: { x: number; y: number; w: number; h: number }[],
  pins: number,
  pinCooldown: number,
  disabled: boolean,
  color: string,
) {
  if (pinRects.length === 0) return;

  const activePins = Math.max(0, Math.min(pinRects.length, pins));
  const spawnT = activePins > 0 && pinCooldown > 0 ? 1 - pinCooldown / PIN_COOLDOWN : 1;
  const darkestColor = darkenColor(color, 0.55);
  const activeColor = disabled ? darkenColor(color, 0.25) : '#FFFFFF';

  for (let i = 0; i < pinRects.length; i++) {
    const rect = pinRects[i];
    const isActive = i < activePins;
    const isNewest = i === activePins - 1 && pinCooldown > 0;

    ctx.save();
    ctx.globalAlpha = isNewest ? Math.max(0, Math.min(1, spawnT)) : 1;
    ctx.fillStyle = isActive ? activeColor : darkestColor;
    ctx.fillRect(buildingX + rect.x, buildingY + rect.y, rect.w, rect.h);
    ctx.restore();
  }
}

function drawStorage(ctx: CanvasRenderingContext2D, b: typeof buildings[0], pos: { x: number; y: number; w: number; h: number }) {
  const m = 2;
  const color = b.color;

  // Warehouse background
  const storageTintFn = theme.buildingBgTint === 'darken' ? darkenColor : lightenColor;
  ctx.fillStyle = storageTintFn(color, theme.storageBgTintAmount);
  ctx.beginPath();
  ctx.roundRect(pos.x + m, pos.y + m, pos.w - m * 2, pos.h - m * 2, 4);
  ctx.fill();

  // Colored border
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(pos.x + m, pos.y + m, pos.w - m * 2, pos.h - m * 2, 4);
  ctx.stroke();

  // Warehouse roof stripes
  ctx.strokeStyle = storageTintFn(color, theme.storageStripeTintAmount);
  ctx.lineWidth = 1.5;
  const stripes = 4;
  for (let i = 1; i < stripes; i++) {
    const sy = pos.y + m + (pos.h - m * 2) * i / stripes;
    ctx.beginPath();
    ctx.moveTo(pos.x + m + 4, sy);
    ctx.lineTo(pos.x + pos.w - m - 4, sy);
    ctx.stroke();
  }

  // Small "S" label
  ctx.fillStyle = color;
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('S', pos.x + pos.w / 2, pos.y + pos.h / 2);
}

function lightenColor(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `rgb(${lr},${lg},${lb})`;
}

function darkenColor(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r * (1 - amount))},${Math.round(g * (1 - amount))},${Math.round(b * (1 - amount))})`;
}

function colorToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawBuildingDonut(ctx: CanvasRenderingContext2D, fx: number, fy: number, fw: number, fh: number, pins: number, maxPins: number, pinCooldown: number, type: 'factory' | 'storage', pinPlacement: PinPlacement | null) {
  if (maxPins === 0) return;

  // Donut center and sizing
  let cx: number, cy: number;
  const outerRadius = type === 'storage' ? 14 : 10;

  if (pinPlacement) {
    cx = fx + pinPlacement.x + pinPlacement.w / 2;
    cy = fy + pinPlacement.y + pinPlacement.h / 2;
  } else {
    if (type === 'storage') {
      cx = fx + fw / 2;
      cy = fy + fh / 2;
    } else {
      cx = fx + fw - 22;
      cy = fy + 18;
    }
  }

  const strokeWidth = outerRadius * 0.6;
  const drawRadius = outerRadius - strokeWidth / 2;

  // Spawn animation: newest pin step animates in
  const spawnT = pins > 0 && pinCooldown > 0 ? 1 - pinCooldown / PIN_COOLDOWN : 1;
  const stepFraction = 1 / maxPins;
  const settledFill = Math.max(0, (pins - 1) / maxPins);
  const animatedFill = settledFill + stepFraction * spawnT;
  const effectiveFill = pins > 0 ? animatedFill : 0;

  // Arc angles: start at top (-PI/2), sweep clockwise
  const startAngle = -Math.PI / 2;
  const fullAngle = Math.PI * 2;

  // Empty ring (full circle background)
  ctx.strokeStyle = theme.donutEmptyRing;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, drawRadius, 0, fullAngle);
  ctx.stroke();

  // Filled arc (partial sweep based on fill)
  if (pins > 0) {
    const sweepAngle = effectiveFill * fullAngle;
    const alpha = spawnT < 1 ? 0.7 + 0.3 * spawnT : 1;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = theme.donutFill;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, drawRadius, startAngle, startAngle + sweepAngle);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawStoragePinGrid(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  pins: number,
  maxPins: number,
  pinCooldown: number,
  color: string,
  pinPlacement: PinPlacement | null,
  disabled = false,
) {
  if (maxPins === 0) return;

  const gridCols = 5;
  const gridRows = 5;
  const maxCells = gridCols * gridRows;
  const activePins = Math.max(0, Math.min(Math.min(maxPins, maxCells), pins));
  const spawnT = activePins > 0 && pinCooldown > 0 ? 1 - pinCooldown / PIN_COOLDOWN : 1;
  const inactiveColor = darkenColor(color, 0.55);

  let areaX: number;
  let areaY: number;
  let areaW: number;
  let areaH: number;

  if (pinPlacement) {
    areaX = fx + pinPlacement.x;
    areaY = fy + pinPlacement.y;
    areaW = pinPlacement.w;
    areaH = pinPlacement.h;
  } else {
    areaW = Math.min(18, fw - 12);
    areaH = Math.min(18, fh - 12);
    areaX = fx + (fw - areaW) / 2;
    areaY = fy + (fh - areaH) / 2;
  }

  const gap = Math.max(1, Math.floor(Math.min(areaW, areaH) / 12));
  const squareSize = Math.max(2, Math.floor(Math.min(
    (areaW - gap * (gridCols - 1)) / gridCols,
    (areaH - gap * (gridRows - 1)) / gridRows,
  )));
  const totalW = squareSize * gridCols + gap * (gridCols - 1);
  const totalH = squareSize * gridRows + gap * (gridRows - 1);
  const startX = areaX + (areaW - totalW) / 2;
  const startY = areaY + (areaH - totalH) / 2;

  const radius = squareSize / 2;
  for (let i = 0; i < maxCells; i++) {
    const col = i % gridCols;
    const row = Math.floor(i / gridCols);
    const cx = startX + col * (squareSize + gap) + radius;
    const cy = startY + row * (squareSize + gap) + radius;
    const isActive = i < activePins;
    const isNewest = i === activePins - 1 && pinCooldown > 0;
    ctx.globalAlpha = isNewest ? Math.max(0, Math.min(1, spawnT)) : 1;
    ctx.fillStyle = disabled
      ? (isActive ? darkenColor(color, 0.25) : inactiveColor)
      : (isActive ? '#FFFFFF' : 'rgba(255,255,255,0.18)');
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawCarriedPinGlow(ctx: CanvasRenderingContext2D, glowColor: string) {
  const sprite = getPinGlowSprite(glowColor);
  const size = sprite.width;
  ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
}

function drawCars(ctx: CanvasRenderingContext2D, filter?: 'road' | Set<string>) {
  for (const car of cars) {
    if (filter === 'road') {
      if (highwayEdgeSet.has(car.edgeId)) continue;
      if (tunnelEdgeSet.has(car.edgeId)) continue;
    } else if (filter instanceof Set) {
      if (!filter.has(car.edgeId)) continue;
    }
    const carLen = car.isTruck ? TRUCK_LEN : CAR_LEN;
    const carWid = car.isTruck ? TRUCK_WID : CAR_WID;
    const renderPos = getVehicleRenderOrigin(car, carLen);
    const vehicleSvg = car.isTruck ? themeAssets.sprites.truck : themeAssets.sprites.car;
    const vehicleImg = car.isTruck ? getTruckImage(vehicleSvg, car.color) : getIconImage(vehicleSvg, car.color);

    ctx.save();
    ctx.translate(renderPos.x, renderPos.y);
    ctx.rotate(car.angle);

    ctx.globalAlpha = 1;

    const drawVehicleCargo = () => {
      if (car.isTruck) {
        drawTruckPins(ctx, vehicleSvg, carLen, carWid, car.pinsCarried, car.color);
      } else if (car.carryingPin) {
        drawCarriedPinGlow(ctx, car.color);
      }
    };

    if (vehicleImg.complete && vehicleImg.naturalWidth > 0) {
      ctx.drawImage(vehicleImg, -carLen / 2, -carWid / 2, carLen, carWid);
      drawVehicleCargo();
      ctx.restore();
      continue;
    }

    // Draw vehicles centered on their body midpoint so the visible rotation pivot is centered.
    const hh = carWid / 2;
    const r = car.isTruck ? 2 : 3;
    ctx.fillStyle = car.isTruck ? darkenColor(car.color, 0.2) : car.color;
    ctx.beginPath();
    ctx.roundRect(-carLen / 2, -hh, carLen, carWid, r);
    ctx.fill();

    ctx.strokeStyle = theme.carOutline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-carLen / 2, -hh, carLen, carWid, r);
    ctx.stroke();

    if (car.isTruck) {
      // Truck: cab at front, cargo bed behind
      const cabLen = carLen * 0.35;
      ctx.fillStyle = car.color;
      ctx.beginPath();
      ctx.roundRect(carLen / 2 - cabLen, -hh + 1, cabLen - 1, carWid - 2, 2);
      ctx.fill();
    } else {
      // Windshield
      ctx.fillStyle = theme.windshield;
      ctx.fillRect(carLen / 2 - 4, -carWid / 2 + 2, 3, carWid - 4);
    }

    drawVehicleCargo();

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function getVehicleRenderOrigin(car: Car, carLen: number) {
  // Physics track the rear axle; rendering is shifted forward so the visible body rotates around its center.
  const centerOffset = carLen * 0.2;
  return {
    x: car.x + Math.cos(car.angle) * centerOffset,
    y: car.y + Math.sin(car.angle) * centerOffset,
  };
}

function drawCollectingPins(ctx: CanvasRenderingContext2D) {
  for (const car of cars) {
    if (car.state !== 'collecting') continue;
    const carLen = car.isTruck ? TRUCK_LEN : CAR_LEN;
    const renderPos = getVehicleRenderOrigin(car, carLen);
    const t = car.collectProgress;
    // Ease-out curve for snappy start, gentle arrival
    const et = 1 - (1 - t) * (1 - t);
    const px = car.pinSourceX + (renderPos.x - car.pinSourceX) * et;
    const py = car.pinSourceY + (renderPos.y - car.pinSourceY) * et;
    // Pin fades out as it arrives
    const alpha = 1 - t * 0.5;
    // Pin grows slightly then shrinks
    const scale = 1 + 0.3 * Math.sin(t * Math.PI);
    const radius = 3.5 * scale;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = theme.collectingPin;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ============ TUNNELS ============

function drawTunnels(ctx: CanvasRenderingContext2D) {
  if (tunnels.length === 0) return;

  ctx.save();
  const tunnelAlpha = theme.roadStyle === 'tracks' ? 0.15 : 0.08;
  ctx.globalAlpha = tunnelAlpha;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = TUNNEL_ROAD_W;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([6, 4]);

  // Tunnels are straight lines — draw directly from known start/end positions
  const ext = 4;
  for (const tn of tunnels) {
    const sx = tn.startGx * GRID + HALF;
    const sy = tn.startGy * GRID + HALF;
    const ex = tn.endGx * GRID + HALF;
    const ey = tn.endGy * GRID + HALF;
    const dx = ex - sx, dy = ey - sy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;

    ctx.beginPath();
    ctx.moveTo(sx - ux * ext, sy - uy * ext);
    ctx.lineTo(ex + ux * ext, ey + uy * ext);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawTunnelCars(ctx: CanvasRenderingContext2D) {
  for (const car of cars) {
    if (!tunnelEdgeSet.has(car.edgeId)) continue;
    // Underground cars are simple colored dots
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.arc(car.x, car.y, car.isTruck ? 5 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawTunnelEntrances(ctx: CanvasRenderingContext2D) {
  if (tunnels.length === 0) return;

  for (const tn of tunnels) {
    const sx = tn.startGx * GRID + HALF;
    const sy = tn.startGy * GRID + HALF;
    const ex = tn.endGx * GRID + HALF;
    const ey = tn.endGy * GRID + HALF;

    drawEntranceMarker(ctx, sx, sy, ex, ey);
    drawEntranceMarker(ctx, ex, ey, sx, sy);
  }
}

function drawEntranceMarker(ctx: CanvasRenderingContext2D, x: number, y: number, towardsX: number, towardsY: number) {
  const dx = towardsX - x;
  const dy = towardsY - y;
  const angle = Math.atan2(dy, dx);
  const r = 10;
  const offset = r * 0.5;

  ctx.save();
  ctx.translate(x + Math.cos(angle) * offset, y + Math.sin(angle) * offset);
  ctx.rotate(angle);

  // Gradient from dark (arc top) to transparent (straight edge)
  // In rotated space: arc is on the right (+x), straight edge is on the left
  const grad = ctx.createLinearGradient(-r, 0, r, 0);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.6)');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  ctx.fill();

  // Stroke only the curved arc side
  ctx.strokeStyle = theme.road;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();

  ctx.restore();
}

function drawTunnelPreview(ctx: CanvasRenderingContext2D) {
  if (tunnelPhase !== 'pickEnd') return;

  const sx = tunnelStartGx * GRID + HALF;
  const sy = tunnelStartGy * GRID + HALF;

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = TUNNEL_ROAD_W;
  ctx.lineCap = 'round';
  ctx.setLineDash([6, 4]);

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(tunnelPreviewEndPx, tunnelPreviewEndPy);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawScore(ctx: CanvasRenderingContext2D, width: number) {
  const text = `Points: ${score}  Cars: ${cars.length}`;
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = theme.scoreShadow;
  ctx.fillText(text, width - 14, 16);
  ctx.fillStyle = theme.scoreText;
  ctx.fillText(text, width - 15, 15);
}

// ============ FLOATING TOOLBAR ============

const BTN_SIZE = 44;      // circular button diameter
const BTN_GAP = 10;       // gap between buttons
const BTN_MARGIN = 12;    // margin from screen edge
const GEAR_SIZE = 48;     // gear button diameter

// Draw a circular button with icon
function drawCircleButton(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, active: boolean, drawIcon: (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => void) {
  // Drop shadow — draw an opaque circle offset below, then cover it with the icon
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Icon (SVG provides its own background, clipped to circle)
  drawIcon(ctx, cx, cy, r);

  if (active) {
    // Active: white ring
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Inactive: solid dark outline
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// SVG-based icon drawing functions
function iconRoad(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  drawSvgIcon(ctx, cx, cy, r, themeAssets.icons.roadNormal);
}

function iconNarrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  drawSvgIcon(ctx, cx, cy, r, themeAssets.icons.roadNarrow);
}

function iconHighway(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  drawSvgIcon(ctx, cx, cy, r, themeAssets.icons.roadHighway);
}

function iconDemolishIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  drawSvgIcon(ctx, cx, cy, r, themeAssets.icons.demolish);
}

function iconRoundabout(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  drawSvgIcon(ctx, cx, cy, r, themeAssets.icons.roundabout);
}

function iconHouse(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  drawSvgIcon(ctx, cx, cy, r, themeAssets.icons.house, selectedColor);
}

function iconFactory(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  drawSvgIcon(ctx, cx, cy, r, themeAssets.icons.factory, selectedColor);
}

function iconStorage(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  drawSvgIcon(ctx, cx, cy, r, themeAssets.icons.storage, selectedColor);
}

function iconTrafficLight(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  drawSvgIcon(ctx, cx, cy, r, themeAssets.icons.trafficLight);
}

function iconTunnel(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // Procedural tunnel icon: dark background circle with tunnel arch
  ctx.fillStyle = 'rgba(44, 62, 80, 0.85)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  const ir = r * 0.55;
  // Tunnel arch (semicircle)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.beginPath();
  ctx.arc(cx, cy + ir * 0.2, ir, Math.PI, 0);
  ctx.lineTo(cx + ir, cy + ir * 0.6);
  ctx.lineTo(cx - ir, cy + ir * 0.6);
  ctx.closePath();
  ctx.fill();

  // Arch outline
  ctx.strokeStyle = theme.road;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy + ir * 0.2, ir, Math.PI, 0);
  ctx.stroke();

  // Dashed road leading in
  ctx.strokeStyle = theme.road;
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 2]);
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy + ir * 0.2);
  ctx.lineTo(cx, cy - ir * 0.4);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// Gear icon
function iconGear(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const ir = r * 0.35;
  const or = r * 0.6;
  const teeth = 6;
  ctx.fillStyle = theme.gearIcon;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a1 = (i / teeth) * Math.PI * 2 - Math.PI / teeth / 2;
    const a2 = a1 + Math.PI / teeth * 0.6;
    const a3 = a1 + Math.PI / teeth;
    ctx.lineTo(cx + Math.cos(a1) * or, cy + Math.sin(a1) * or);
    ctx.lineTo(cx + Math.cos(a2) * or, cy + Math.sin(a2) * or);
    ctx.lineTo(cx + Math.cos(a2) * ir * 1.3, cy + Math.sin(a2) * ir * 1.3);
    ctx.lineTo(cx + Math.cos(a3) * ir * 1.3, cy + Math.sin(a3) * ir * 1.3);
  }
  ctx.closePath();
  ctx.fill();
  // Center hole
  ctx.fillStyle = gearMenuOpen ? theme.gearHoleOpen : theme.gearHoleClosed;
  ctx.beginPath();
  ctx.arc(cx, cy, ir * 0.6, 0, Math.PI * 2);
  ctx.fill();
}

interface ToolIconDef {
  type: ToolType;
  buildingType?: 'house' | 'factory' | 'storage';
  icon: (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => void;
}

const TOOL_ICONS: ToolIconDef[] = [
  { type: 'addRoad', icon: iconRoad },
  { type: 'addNarrow', icon: iconNarrow },
  { type: 'addHighway', icon: iconHighway },
  { type: 'addRoundabout', icon: iconRoundabout },
  { type: 'addTrafficLight', icon: iconTrafficLight },
  { type: 'addTunnel', icon: iconTunnel },
  // Color circle goes here (index 6) — handled separately
  { type: 'addBuilding', buildingType: 'house', icon: iconHouse },
  { type: 'addBuilding', buildingType: 'factory', icon: iconFactory },
  { type: 'addBuilding', buildingType: 'storage', icon: iconStorage },
  { type: 'demolish', icon: iconDemolishIcon },
];

const COLOR_SLOT_INDEX = 6; // color circle inserted before house

function getGearMenuLayout(width: number, height: number) {
  const gearR = GEAR_SIZE / 2;
  const gearCx = width - BTN_MARGIN - gearR;
  const gearCy = height - BTN_MARGIN - gearR;
  const gearButton = { x: gearCx - gearR, y: gearCy - gearR, w: GEAR_SIZE, h: GEAR_SIZE };

  const menuW = 180;
  const pad = 10;
  const rowH = 32;
  const rowGap = 10;
  const fpsBlockH = 28;
  const menuH = pad * 2 + fpsBlockH + rowH * 5 + rowGap * 4;
  const menuX = width - BTN_MARGIN - menuW;
  const menuY = gearCy - gearR - BTN_GAP - menuH;

  let my = menuY + pad;
  const fpsY = my;
  my += fpsBlockH;

  const speedBtnW = 34;
  const speedGap = 4;
  let sx = menuX + pad;
  const speedButtons: { speed: number; x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < SPEED_OPTIONS.length; i++) {
    speedButtons.push({ speed: SPEED_OPTIONS[i], x: sx, y: my, w: speedBtnW, h: rowH });
    sx += speedBtnW + speedGap;
  }
  my += rowH + rowGap;

  const musicButton = { x: menuX + pad, y: my, w: menuW - pad * 2, h: rowH };
  my += rowH + rowGap;

  const halfW = (menuW - pad * 2 - 6) / 2;

  const saveButton = { x: menuX + pad, y: my, w: halfW, h: rowH };
  const loadButton = { x: menuX + pad + halfW + 6, y: my, w: halfW, h: rowH };
  my += rowH + rowGap;

  const citiesButton = { x: menuX + pad, y: my, w: menuW - pad * 2, h: rowH };
  my += rowH + rowGap;

  const resetButton = { x: menuX + pad, y: my, w: menuW - pad * 2, h: rowH };

  return {
    gearR,
    gearCx,
    gearCy,
    gearButton,
    menuW,
    menuH,
    menuX,
    menuY,
    pad,
    fpsY,
    speedButtons,
    musicButton,
    saveButton,
    loadButton,
    citiesButton,
    resetButton,
  };
}

function isToolActive(def: ToolIconDef): boolean {
  if (def.buildingType) {
    return activeTool === 'addBuilding' && selectedBuildingType === def.buildingType;
  }
  return activeTool === def.type;
}

function drawToolbar(ctx: CanvasRenderingContext2D, width: number, height: number, fps: number = 0) {
  invalidateIconCacheIfNeeded();
  const r = BTN_SIZE / 2;
  const totalSlots = TOOL_ICONS.length + 1; // +1 for color circle
  const startY = height / 2 - (totalSlots * (BTN_SIZE + BTN_GAP) - BTN_GAP) / 2;

  // Left column: tool buttons with color circle inserted at COLOR_SLOT_INDEX
  let slot = 0;
  for (let i = 0; i < TOOL_ICONS.length; i++) {
    if (i === COLOR_SLOT_INDEX) {
      // Draw color button using SVG icon with CurrentColor
      const cx = BTN_MARGIN + r;
      const cy = startY + slot * (BTN_SIZE + BTN_GAP) + r;
      drawCircleButton(ctx, cx, cy, r, false, (ctx2, cx2, cy2, r2) => {
        drawSvgIcon(ctx2, cx2, cy2, r2, themeAssets.icons.color, selectedColor);
      });
      slot++;
    }
    const def = TOOL_ICONS[i];
    const cx = BTN_MARGIN + r;
    const cy = startY + slot * (BTN_SIZE + BTN_GAP) + r;
    drawCircleButton(ctx, cx, cy, r, isToolActive(def), def.icon);
    slot++;
  }

  // Gear button — bottom right
  const gearLayout = getGearMenuLayout(width, height);
  const { gearR, gearCx, gearCy } = gearLayout;
  // Drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = gearMenuOpen ? theme.gearBtnOpen : theme.gearBtnClosed;
  ctx.beginPath();
  ctx.arc(gearCx, gearCy, gearR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Thin white outline
  ctx.strokeStyle = theme.gearBtnOutline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(gearCx, gearCy, gearR, 0, Math.PI * 2);
  ctx.stroke();

  iconGear(ctx, gearCx, gearCy, gearR);

  // Gear menu — popup above gear button
  if (gearMenuOpen) {
    const { menuW, menuH, menuX, menuY, pad, fpsY, speedButtons, musicButton, saveButton, loadButton, citiesButton, resetButton } = gearLayout;

    // Background
    ctx.fillStyle = theme.menuBg;
    ctx.beginPath();
    ctx.roundRect(menuX, menuY, menuW, menuH, 8);
    ctx.fill();

    // FPS display
    const fpsText = `${fps} FPS`;
    ctx.font = 'bold 12px monospace';
    const fpsColor = fps >= 50 ? theme.fpsGood : fps >= 30 ? theme.fpsOk : theme.fpsBad;
    ctx.fillStyle = fpsColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fpsText, menuX + pad, fpsY + 10);

    // Speed buttons row
    ctx.font = '13px sans-serif';
    for (let i = 0; i < speedButtons.length; i++) {
      const btn = speedButtons[i];
      const spd = btn.speed;
      const isActive = gameSpeed === spd;
      ctx.fillStyle = isActive ? theme.speedActive : theme.speedInactive;
      ctx.beginPath();
      ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 6);
      ctx.fill();
      if (isActive) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 6);
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.font = spd === 0 ? 'bold 14px sans-serif' : '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(SPEED_LABELS[i as 0 | 1 | 2 | 3], btn.x + btn.w / 2, btn.y + btn.h / 2);
      ctx.font = '13px sans-serif';
    }

    // Music button
    const musicLabel = musicEnabled ? '♫ On' : '♫ Off';
    ctx.fillStyle = musicEnabled ? theme.musicOn : theme.musicOff;
    ctx.beginPath();
    ctx.roundRect(musicButton.x, musicButton.y, musicButton.w, musicButton.h, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(musicLabel, musicButton.x + musicButton.w / 2, musicButton.y + musicButton.h / 2);

    // Save / Load row
    ctx.fillStyle = theme.saveLoadBtn;
    ctx.beginPath();
    ctx.roundRect(saveButton.x, saveButton.y, saveButton.w, saveButton.h, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Save', saveButton.x + saveButton.w / 2, saveButton.y + saveButton.h / 2);

    ctx.fillStyle = theme.saveLoadBtn;
    ctx.beginPath();
    ctx.roundRect(loadButton.x, loadButton.y, loadButton.w, loadButton.h, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('Load', loadButton.x + loadButton.w / 2, loadButton.y + loadButton.h / 2);

    // Cities button — opens city picker modal
    ctx.fillStyle = theme.citiesBtn;
    ctx.beginPath();
    ctx.roundRect(citiesButton.x, citiesButton.y, citiesButton.w, citiesButton.h, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Cities', citiesButton.x + citiesButton.w / 2, citiesButton.y + citiesButton.h / 2);

    // Reset button
    ctx.fillStyle = theme.resetBtn;
    ctx.beginPath();
    ctx.roundRect(resetButton.x, resetButton.y, resetButton.w, resetButton.h, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Reset', resetButton.x + resetButton.w / 2, resetButton.y + resetButton.h / 2);
  }

  // Current selection label — bottom left
  let label = '';
  switch (activeTool) {
    case 'addRoad': label = currentThemeId === 'space' ? 'Dual Rail' : 'Road'; break;
    case 'addNarrow': label = currentThemeId === 'space' ? 'Single Rail' : 'Narrow Road'; break;
    case 'addHighway': label = currentThemeId === 'space' ? 'High-Speed Rail' : 'Highway'; break;
    case 'addRoundabout': label = currentThemeId === 'space' ? 'Rail Junction' : 'Roundabout'; break;
    case 'addTrafficLight': label = currentThemeId === 'space' ? 'Signal Node' : 'Traffic Light'; break;
    case 'addTunnel': label = currentThemeId === 'space' ? 'Sub-terrain Rail' : 'Tunnel'; break;
    case 'demolish': label = 'Demolish'; break;
    case 'addBuilding':
      switch (selectedBuildingType) {
        case 'house': label = currentThemeId === 'space' ? 'Processing Unit' : 'Residential'; break;
        case 'factory': label = currentThemeId === 'space' ? 'Mine' : 'Factory'; break;
        case 'storage': label = 'Storage'; break;
      }
      break;
  }
  if (label) {
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = theme.labelShadow;
    ctx.fillText(label, BTN_MARGIN + 1, height - BTN_MARGIN + 1);
    ctx.fillStyle = theme.labelText;
    ctx.fillText(label, BTN_MARGIN, height - BTN_MARGIN);
  }
}

const MODAL_BTN_W = 130;
const MODAL_BTN_H = 42;
const MODAL_RADIUS = 14;

function getModalMetrics(width: number, height: number) {
  const size = Math.min(width * 0.7, height * 0.8);
  const mx = (width - size) / 2;
  const my = (height - size) / 2;
  return { size, mx, my };
}

function drawDemoModal(ctx: CanvasRenderingContext2D, width: number, height: number) {
  // Dim overlay
  ctx.fillStyle = theme.overlayDim;
  ctx.fillRect(0, 0, width, height);

  const { size, mx, my } = getModalMetrics(width, height);

  // Shadow
  ctx.save();
  ctx.shadowColor = theme.modalShadow;
  ctx.shadowBlur = 32;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.roundRect(mx, my, size, size, MODAL_RADIUS);
  ctx.fill();
  ctx.restore();

  // Splash image (is the modal)
  const splashImg = getSplashImage();
  if (splashImg.complete && splashImg.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(mx, my, size, size, MODAL_RADIUS);
    ctx.clip();
    ctx.drawImage(splashImg, mx, my, size, size);
    ctx.restore();
  }

  // White outline
  ctx.strokeStyle = theme.modalOutline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(mx, my, size, size, MODAL_RADIUS);
  ctx.stroke();

  // Close button (top-right)
  const closeSize = 28;
  const closePad = 8;
  const closeX = mx + size - closeSize - closePad;
  const closeY = my + closePad;
  ctx.fillStyle = theme.closeButtonBg;
  ctx.beginPath();
  ctx.arc(closeX + closeSize / 2, closeY + closeSize / 2, closeSize / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = theme.btnBorder;
  ctx.lineWidth = 2;
  const xPad = 8;
  ctx.beginPath();
  ctx.moveTo(closeX + xPad, closeY + xPad);
  ctx.lineTo(closeX + closeSize - xPad, closeY + closeSize - xPad);
  ctx.moveTo(closeX + closeSize - xPad, closeY + xPad);
  ctx.lineTo(closeX + xPad, closeY + closeSize - xPad);
  ctx.stroke();

  // Gradient fade at bottom for button readability
  const gradH = 100;
  const grad = ctx.createLinearGradient(0, my + size - gradH, 0, my + size);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, theme.bottomGradientEnd);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(mx, my, size, size, MODAL_RADIUS);
  ctx.clip();
  ctx.fillStyle = grad;
  ctx.fillRect(mx, my + size - gradH, size, gradH);
  ctx.restore();

  // Buttons overlaid on bottom of image
  const gap = 14;
  const pillRadius = MODAL_BTN_H / 2;
  const totalBtnW = MODAL_BTN_W * 2 + gap;
  const btnStartX = mx + (size - totalBtnW) / 2;
  const btnY = my + size - MODAL_BTN_H - 46;

  // Animated multi-color glow for buttons
  const glowColors = theme.glowColors;
  const t = performance.now() / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3); // pulsate intensity
  const colorIdx = t * 0.8; // slow color cycle
  const c0 = glowColors[Math.floor(colorIdx) % glowColors.length];
  const c1 = glowColors[(Math.floor(colorIdx) + 1) % glowColors.length];
  const frac = colorIdx % 1;
  const gr = Math.round(c0[0] + (c1[0] - c0[0]) * frac);
  const gg = Math.round(c0[1] + (c1[1] - c0[1]) * frac);
  const gb = Math.round(c0[2] + (c1[2] - c0[2]) * frac);
  const glowAlpha = 0.5 + 0.4 * pulse;
  const glowBlur = 12 + 10 * pulse;

  // Helper to draw a glowing button
  const drawGlowBtn = (bx: number, grad: CanvasGradient, label: string) => {
    // Multi-color glow layers
    ctx.save();
    ctx.shadowColor = `rgba(${gr}, ${gg}, ${gb}, ${glowAlpha})`;
    ctx.shadowBlur = glowBlur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(bx, btnY, MODAL_BTN_W, MODAL_BTN_H, pillRadius);
    ctx.fill();
    // Second glow pass for richer effect
    ctx.shadowBlur = glowBlur * 1.5;
    ctx.shadowColor = `rgba(${gr}, ${gg}, ${gb}, ${glowAlpha * 0.4})`;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = theme.btnBorder;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx, btnY, MODAL_BTN_W, MODAL_BTN_H, pillRadius);
    ctx.stroke();
    ctx.fillStyle = theme.btnText;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + MODAL_BTN_W / 2, btnY + MODAL_BTN_H / 2);
  };

  // Demo City button
  const demoGrad = ctx.createLinearGradient(0, btnY, 0, btnY + MODAL_BTN_H);
  demoGrad.addColorStop(0, theme.demoBtnGradTop);
  demoGrad.addColorStop(1, theme.demoBtnGradBottom);
  drawGlowBtn(btnStartX, demoGrad, 'Demo City');

  // Start Fresh button
  const freshGrad = ctx.createLinearGradient(0, btnY, 0, btnY + MODAL_BTN_H);
  freshGrad.addColorStop(0, theme.freshBtnGradTop);
  freshGrad.addColorStop(1, theme.freshBtnGradBottom);
  drawGlowBtn(btnStartX + MODAL_BTN_W + gap, freshGrad, 'Start Fresh');
}

const CITY_MODAL_W = 320;
const CITY_MODAL_PAD = 16;
const CITY_ROW_H = 44;
const CITY_ROW_GAP = 8;

function getCityModalMetrics(width: number, height: number) {
  const cityCount = cities.length;
  const headerH = 48;
  const contentH = cityCount * (CITY_ROW_H + CITY_ROW_GAP) - CITY_ROW_GAP;
  const modalH = headerH + contentH + CITY_MODAL_PAD * 2;
  const mx = (width - CITY_MODAL_W) / 2;
  const my = (height - modalH) / 2;
  return { modalH, mx, my, headerH };
}

function drawCityModal(ctx: CanvasRenderingContext2D, width: number, height: number) {
  // Dim overlay
  ctx.fillStyle = theme.overlayDim;
  ctx.fillRect(0, 0, width, height);

  const cityCount = cities.length;
  const { modalH, mx, my, headerH } = getCityModalMetrics(width, height);

  // Shadow + background
  ctx.save();
  ctx.shadowColor = theme.modalShadow;
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = theme.cityModalBg;
  ctx.beginPath();
  ctx.roundRect(mx, my, CITY_MODAL_W, modalH, 12);
  ctx.fill();
  ctx.restore();

  // Outline
  ctx.strokeStyle = theme.cityModalOutline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(mx, my, CITY_MODAL_W, modalH, 12);
  ctx.stroke();

  // Header
  ctx.fillStyle = theme.cityRowText;
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Choose a City', mx + CITY_MODAL_W / 2, my + headerH / 2);

  // Close button (top-right)
  const closeSize = 28;
  const closePad = 10;
  const closeX = mx + CITY_MODAL_W - closeSize - closePad;
  const closeY = my + closePad;
  ctx.fillStyle = theme.cityCloseBg;
  ctx.beginPath();
  ctx.arc(closeX + closeSize / 2, closeY + closeSize / 2, closeSize / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = theme.btnBorder;
  ctx.lineWidth = 2;
  const xInset = 8;
  ctx.beginPath();
  ctx.moveTo(closeX + xInset, closeY + xInset);
  ctx.lineTo(closeX + closeSize - xInset, closeY + closeSize - xInset);
  ctx.moveTo(closeX + closeSize - xInset, closeY + xInset);
  ctx.lineTo(closeX + xInset, closeY + closeSize - xInset);
  ctx.stroke();

  // City rows
  let rowY = my + headerH;
  for (let i = 0; i < cityCount; i++) {
    const rowX = mx + CITY_MODAL_PAD;
    const rowW = CITY_MODAL_W - CITY_MODAL_PAD * 2;

    ctx.fillStyle = theme.cityRowBg;
    ctx.beginPath();
    ctx.roundRect(rowX, rowY, rowW, CITY_ROW_H, 8);
    ctx.fill();

    ctx.fillStyle = theme.cityRowText;
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cities[i].name, mx + CITY_MODAL_W / 2, rowY + CITY_ROW_H / 2);

    rowY += CITY_ROW_H + CITY_ROW_GAP;
  }

  if (cityCount === 0) {
    ctx.fillStyle = theme.cityEmptyText;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No cities available', mx + CITY_MODAL_W / 2, my + headerH + 20);
  }
}

export function getToolbarLayout(_ctx: CanvasRenderingContext2D, width: number, height: number) {
  const r = BTN_SIZE / 2;

  // Left column: tool buttons + color circle inserted at COLOR_SLOT_INDEX
  const totalSlots = TOOL_ICONS.length + 1;
  const startY = height / 2 - (totalSlots * (BTN_SIZE + BTN_GAP) - BTN_GAP) / 2;

  const buttons: { type: ToolType; buildingType?: 'house' | 'factory' | 'storage'; x: number; y: number; w: number; h: number }[] = [];
  let colorButton: { x: number; y: number; w: number; h: number } | null = null;
  let slot = 0;
  for (let i = 0; i < TOOL_ICONS.length; i++) {
    if (i === COLOR_SLOT_INDEX) {
      const cx = BTN_MARGIN + r;
      const cy = startY + slot * (BTN_SIZE + BTN_GAP) + r;
      colorButton = { x: cx - r, y: cy - r, w: BTN_SIZE, h: BTN_SIZE };
      slot++;
    }
    const def = TOOL_ICONS[i];
    const cx = BTN_MARGIN + r;
    const cy = startY + slot * (BTN_SIZE + BTN_GAP) + r;
    buttons.push({ type: def.type, buildingType: def.buildingType, x: cx - r, y: cy - r, w: BTN_SIZE, h: BTN_SIZE });
    slot++;
  }

  const {
    gearButton,
    speedButtons,
    musicButton,
    saveButton,
    loadButton,
    citiesButton,
    resetButton,
  } = getGearMenuLayout(width, height);

  // Demo modal buttons
  const { size: modalSize, mx: modalX, my: modalY } = getModalMetrics(width, height);
  const modalGap = 14;
  const modalTotalW = MODAL_BTN_W * 2 + modalGap;
  const modalBtnStartX = modalX + (modalSize - modalTotalW) / 2;
  const modalBtnY = modalY + modalSize - MODAL_BTN_H - 46;
  const demoOpenButton = { x: modalBtnStartX, y: modalBtnY, w: MODAL_BTN_W, h: MODAL_BTN_H };
  const demoDismissButton = { x: modalBtnStartX + MODAL_BTN_W + modalGap, y: modalBtnY, w: MODAL_BTN_W, h: MODAL_BTN_H };
  const closeSize = 28;
  const closePad = 8;
  const demoCloseButton = { x: modalX + modalSize - closeSize - closePad, y: modalY + closePad, w: closeSize, h: closeSize };

  // City modal hit areas
  const { modalH: cityMH, mx: cityMX, my: cityMY, headerH: cityHeaderH } = getCityModalMetrics(width, height);
  const cityCloseSize = 28;
  const cityClosePad = 10;
  const cityCloseButton = { x: cityMX + CITY_MODAL_W - cityCloseSize - cityClosePad, y: cityMY + cityClosePad, w: cityCloseSize, h: cityCloseSize };
  const cityRowButtons: { file: string; x: number; y: number; w: number; h: number }[] = [];
  let cityRowY = cityMY + cityHeaderH;
  for (let ci = 0; ci < cities.length; ci++) {
    cityRowButtons.push({
      file: cities[ci].file,
      x: cityMX + CITY_MODAL_PAD,
      y: cityRowY,
      w: CITY_MODAL_W - CITY_MODAL_PAD * 2,
      h: CITY_ROW_H,
    });
    cityRowY += CITY_ROW_H + CITY_ROW_GAP;
  }

  return { buttons, colorButton, resetButton, musicButton, speedButtons, gearButton, saveButton, loadButton, citiesButton, cityCloseButton, cityRowButtons, demoOpenButton, demoDismissButton, demoCloseButton };
}

import { GRID, HALF, ROAD_W, DASH_LEN, DASH_GAP, CAR_LEN, CAR_WID, BG_COLOR, ROAD_COLOR, HIGHWAY_COLOR, HIGHWAY_ROAD_W, NARROW_ROAD_W, PIN_COOLDOWN, TRUCK_LEN, TRUCK_WID } from './constants.ts';
import { camX, camY, zoom } from './camera.ts';
import { edges, nodes, parseKey } from './graph.ts';
import { buildings, getBuildingPixelPos, getConnectionPixelPos, getConnectionPoint, HOUSE_W, HOUSE_H, FACTORY_W, FACTORY_H, STORAGE_W_TILES, STORAGE_H_TILES } from './buildings.ts';
import { hoverGx, hoverGy, pendingRemoveTiles } from './roads.ts';
import { cars } from './cars.ts';
import { RoadPreview, ToolType, BUILDING_COLORS } from './types.ts';
import { activeTool, selectedColor, selectedBuildingType, gearMenuOpen, demoModalOpen, cityModalOpen } from './toolbar.ts';
import { score } from './score.ts';
import { gameSpeed, SPEED_OPTIONS, SPEED_LABELS } from './speed.ts';
import { highways, highwayEdgeSet, highwayPhase, highwayStartGx, highwayStartGy, highwayPreviewEndPx, highwayPreviewEndPy, computeBezierControls, draggingHighwayId } from './highway.ts';
import { musicEnabled } from './music.ts';
import { cities } from './cities.ts';
import { getHouseSprite, getFactorySprite, getStorageSprite, drawSpriteLayer, PinPlacement } from './sprites.ts';
import splashUrl from '../assets/splashscreen.png';

const splashImg = new Image();
splashImg.src = splashUrl;

export function render(ctx: CanvasRenderingContext2D, width: number, height: number, preview: RoadPreview | null, fps: number = 0) {
  // Clear entire canvas
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, height);

  // Clip game area
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  // Apply camera transform: scale then translate
  ctx.scale(zoom, zoom);
  ctx.translate(-camX, -camY);

  // Faint grid — only draw visible lines
  const worldLeft = camX;
  const worldTop = camY;
  const worldRight = camX + width / zoom;
  const worldBottom = camY + height / zoom;

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
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

  drawBuildingGrounds(ctx);
  drawRoads(ctx);
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

  // Restore from camera transform + clip
  ctx.restore();

  // Score and toolbar drawn in screen space
  drawScore(ctx, width);
  drawToolbar(ctx, width, height, fps);
  if (cityModalOpen) drawCityModal(ctx, width, height);
  if (demoModalOpen) drawDemoModal(ctx, width, height);
}

function drawRoads(ctx: CanvasRenderingContext2D) {
  // Draw regular (bidirectional) road segments
  ctx.strokeStyle = ROAD_COLOR;
  ctx.lineWidth = ROAD_W;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  for (const [, edge] of edges) {
    if (highwayEdgeSet.has(edge.id)) continue;
    if (edge.narrow) continue; // narrow drawn separately
    ctx.moveTo(edge.fx, edge.fy);
    ctx.lineTo(edge.tx, edge.ty);
  }
  ctx.stroke();

  // Draw one-way (narrow) road segments
  ctx.strokeStyle = ROAD_COLOR;
  ctx.lineWidth = NARROW_ROAD_W;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  for (const [, edge] of edges) {
    if (highwayEdgeSet.has(edge.id)) continue;
    if (!edge.narrow) continue;
    ctx.moveTo(edge.fx, edge.fy);
    ctx.lineTo(edge.tx, edge.ty);
  }
  ctx.stroke();

  // Draw round joints at all nodes for smooth corners (skip highway intermediate nodes)
  ctx.fillStyle = ROAD_COLOR;
  for (const [key, node] of nodes) {
    if (key.startsWith('hw')) continue;
    // Use narrow radius if ALL edges on this node are narrow
    let hasWide = false;
    for (const eid of node.edges) {
      const e = edges.get(eid);
      if (e && !e.narrow && !highwayEdgeSet.has(eid)) { hasWide = true; break; }
    }
    const r = hasWide ? ROAD_W / 2 : NARROW_ROAD_W / 2;
    ctx.beginPath();
    ctx.arc(node.gx * GRID + HALF, node.gy * GRID + HALF, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw stubs from building connection tiles to building walls
  ctx.strokeStyle = ROAD_COLOR;
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
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.lineCap = 'butt';
  ctx.setLineDash([DASH_LEN, DASH_GAP]);

  ctx.beginPath();
  for (const [, edge] of edges) {
    if (edge.narrow) continue; // no center dashes on narrow roads
    ctx.moveTo(edge.fx, edge.fy);
    ctx.lineTo(edge.tx, edge.ty);
  }
  ctx.stroke();

  ctx.setLineDash([]);


  // Red tile overlay for tiles pending removal
  if (pendingRemoveTiles.size > 0) {
    ctx.fillStyle = 'rgba(231, 76, 60, 0.45)';
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

function drawHighways(ctx: CanvasRenderingContext2D) {
  for (const hw of highways) {
    ctx.save();

    // 1) Shadow (wider, offset)
    const shadow = buildTaperedEdges(hw.p0x, hw.p0y, hw.p1x, hw.p1y, hw.p2x, hw.p2y, hw.p3x, hw.p3y, (HIGHWAY_ROAD_W + 6) / 2, 3, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    fillTaperedPoly(ctx, shadow.left, shadow.right);

    // 2) Outline
    const outline = buildTaperedEdges(hw.p0x, hw.p0y, hw.p1x, hw.p1y, hw.p2x, hw.p2y, hw.p3x, hw.p3y, (HIGHWAY_ROAD_W + 4) / 2);
    ctx.fillStyle = '#444';
    fillTaperedPoly(ctx, outline.left, outline.right);

    // 3) Surface with color gradient at ends
    const surface = buildTaperedEdges(hw.p0x, hw.p0y, hw.p1x, hw.p1y, hw.p2x, hw.p2y, hw.p3x, hw.p3y, HIGHWAY_ROAD_W / 2);

    // Draw middle section as one polygon
    const taperSamples = Math.ceil(TAPER_T * HW_SAMPLES);
    ctx.fillStyle = HIGHWAY_COLOR;
    ctx.beginPath();
    ctx.moveTo(surface.left[taperSamples].x, surface.left[taperSamples].y);
    for (let i = taperSamples + 1; i <= HW_SAMPLES - taperSamples; i++) ctx.lineTo(surface.left[i].x, surface.left[i].y);
    for (let i = HW_SAMPLES - taperSamples; i >= taperSamples; i--) ctx.lineTo(surface.right[i].x, surface.right[i].y);
    ctx.closePath();
    ctx.fill();

    // Draw start transition quads with color gradient
    for (let i = 0; i < taperSamples; i++) {
      const t = (i + 0.5) / HW_SAMPLES;
      const f = smoothstep(t / TAPER_T);
      ctx.fillStyle = lerpColor(ROAD_COLOR, HIGHWAY_COLOR, f);
      ctx.beginPath();
      ctx.moveTo(surface.left[i].x, surface.left[i].y);
      ctx.lineTo(surface.left[i + 1].x, surface.left[i + 1].y);
      ctx.lineTo(surface.right[i + 1].x, surface.right[i + 1].y);
      ctx.lineTo(surface.right[i].x, surface.right[i].y);
      ctx.closePath();
      ctx.fill();
    }

    // Draw end transition quads with color gradient
    for (let i = HW_SAMPLES - taperSamples; i < HW_SAMPLES; i++) {
      const t = (i + 0.5) / HW_SAMPLES;
      const f = smoothstep((1 - t) / TAPER_T);
      ctx.fillStyle = lerpColor(ROAD_COLOR, HIGHWAY_COLOR, f);
      ctx.beginPath();
      ctx.moveTo(surface.left[i].x, surface.left[i].y);
      ctx.lineTo(surface.left[i + 1].x, surface.left[i + 1].y);
      ctx.lineTo(surface.right[i + 1].x, surface.right[i + 1].y);
      ctx.lineTo(surface.right[i].x, surface.right[i].y);
      ctx.closePath();
      ctx.fill();
    }

    // 4) Dashed center line (standard bezier stroke)
    ctx.setLineDash([DASH_LEN, DASH_GAP]);
    ctx.strokeStyle = '#dda63a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hw.p0x, hw.p0y);
    ctx.bezierCurveTo(hw.p1x, hw.p1y, hw.p2x, hw.p2y, hw.p3x, hw.p3y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();

    // Draw cars on this highway's edges so they layer correctly
    const hwEdges = new Set(hw.edgeIds);
    drawCars(ctx, hwEdges);
  }

  // Draw draggable midpoint handles when highway tool is active
  if (activeTool === 'addHighway' || draggingHighwayId >= 0) {
    for (const hw of highways) {
      const isDragging = hw.id === draggingHighwayId;
      // Handle circle
      ctx.beginPath();
      ctx.arc(hw.midX, hw.midY, isDragging ? 8 : 6, 0, Math.PI * 2);
      ctx.fillStyle = isDragging ? '#e74c3c' : '#3498db';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
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

  ctx.save();
  ctx.globalAlpha = 0.5;

  // Tapered surface preview
  const surface = buildTaperedEdges(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, HIGHWAY_ROAD_W / 2);
  ctx.fillStyle = HIGHWAY_COLOR;
  fillTaperedPoly(ctx, surface.left, surface.right);

  // Dashed center line
  ctx.setLineDash([DASH_LEN, DASH_GAP]);
  ctx.strokeStyle = '#dda63a';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p0x, p0y);
  ctx.bezierCurveTo(p1x, p1y, p2x, p2y, p3x, p3y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Start point indicator
  ctx.fillStyle = '#3498db';
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

  ctx.strokeStyle = 'rgba(100,100,100,0.5)';
  ctx.lineWidth = roadW;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px1, py1);
  ctx.lineTo(px2, py2);
  ctx.stroke();

  if (!isNarrow) {
    // Preview dashed center line
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
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

  if (activeTool === 'addBuilding') {
    const w = selectedBuildingType === 'house' ? HOUSE_W : selectedBuildingType === 'storage' ? STORAGE_W_TILES : FACTORY_W;
    const h = selectedBuildingType === 'house' ? HOUSE_H : selectedBuildingType === 'storage' ? STORAGE_H_TILES : FACTORY_H;
    const px = hoverGx * GRID;
    const py = hoverGy * GRID;
    const pw = w * GRID;
    const ph = h * GRID;

    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(px + 2, py + 2, pw - 4, ph - 4);
    ctx.strokeStyle = selectedColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(px + 2, py + 2, pw - 4, ph - 4);
    ctx.setLineDash([]);
  } else if (activeTool === 'addRoad') {
    // Show a dot at the tile center where the road will start
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.arc(hoverGx * GRID + HALF, hoverGy * GRID + HALF, ROAD_W / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Ground layer: drawn below roads so cars drive over it
const DISABLED_COLOR = '#555555';

function spriteColor(b: typeof buildings[0]): string {
  return b.disabled ? DISABLED_COLOR : b.color;
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
      } else {
        drawFactory(ctx, b, pos);
      }
      // Draw pins on top of building layer
      if (!b.disabled && b.maxPins > 0) {
        const factorySprite = getFactorySprite(b.connectionSide, color);
        drawBuildingPins(ctx, pos.x, pos.y, pos.w, pos.h, b.pins, b.maxPins, b.pinCooldown, 'factory', factorySprite?.pinPlacement ?? null);
      }
    } else if (b.type === 'storage') {
      const sprite = getStorageSprite(b.connectionSide, color);
      if (sprite) {
        drawSpriteLayer(ctx, sprite.building, sprite, pos.x, pos.y);
      } else {
        drawStorage(ctx, b, pos);
      }
      if (b.maxPins > 0) {
        drawBuildingPins(ctx, pos.x, pos.y, pos.w, pos.h, b.pins, b.maxPins, 0, 'storage', sprite?.pinPlacement ?? null);
      }
    }
  }
}

function drawFactory(ctx: CanvasRenderingContext2D, b: typeof buildings[0], pos: { x: number; y: number; w: number; h: number }) {
  const m = 2; // outer margin
  const color = b.disabled ? '#555' : b.color;

  // Parking lot background (lighter tinted version of the color)
  ctx.fillStyle = b.disabled ? '#3a3a3a' : lightenColor(color, 0.55);
  ctx.beginPath();
  ctx.roundRect(pos.x + m, pos.y + m, pos.w - m * 2, pos.h - m * 2, 3);
  ctx.fill();

  // Colored outline
  ctx.strokeStyle = b.disabled ? '#444' : color;
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

  // Draw pins inside the building area (skip if disabled)
  if (!b.disabled) {
    drawBuildingPins(ctx, bx, by, bw, bh, b.pins, b.maxPins, b.pinCooldown, 'factory', null);
  }
}

function drawStorage(ctx: CanvasRenderingContext2D, b: typeof buildings[0], pos: { x: number; y: number; w: number; h: number }) {
  const m = 2;
  const color = b.color;

  // Warehouse background
  ctx.fillStyle = lightenColor(color, 0.6);
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
  ctx.strokeStyle = lightenColor(color, 0.3);
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

function drawBuildingPins(ctx: CanvasRenderingContext2D, fx: number, fy: number, fw: number, fh: number, pins: number, maxPins: number, pinCooldown: number, type: 'factory' | 'storage', pinPlacement: PinPlacement | null) {
  if (maxPins === 0) return;
  const baseRadius = 3.5;

  let startX: number, startY: number, cols: number, spacing: number;

  if (pinPlacement) {
    // Use SVG-defined pin placement area — fit a grid inside it
    const rows = type === 'storage' ? 4 : 2;
    cols = Math.ceil(maxPins / rows);
    spacing = Math.min(pinPlacement.w / cols, pinPlacement.h / rows);
    const gridW = cols * spacing;
    const gridH = rows * spacing;
    startX = fx + pinPlacement.x + (pinPlacement.w - gridW) / 2;
    startY = fy + pinPlacement.y + (pinPlacement.h - gridH) / 2;
  } else {
    // Fallback: hardcoded layouts
    cols = type === 'storage' ? 4 : 3;
    spacing = 10;
    const areaW = cols * spacing;
    if (type === 'storage') {
      const areaH = cols * spacing;
      startX = fx + (fw - areaW) / 2;
      startY = fy + (fh - areaH) / 2;
    } else {
      startX = fx + fw - areaW - 8;
      startY = fy + 8;
    }
  }

  // Spawn animation progress for the newest pin (0 = just spawned, 1 = fully settled)
  const spawnT = pins > 0 && pinCooldown > 0 ? 1 - pinCooldown / PIN_COOLDOWN : 1;

  for (let i = 0; i < maxPins; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const px = startX + col * spacing + spacing / 2;
    const py = startY + row * spacing + spacing / 2;

    if (i < pins) {
      const isNewest = i === pins - 1 && spawnT < 1;
      if (isNewest) {
        // Elastic bounce: overshoot then settle
        // t goes 0→1, scale overshoots to ~1.4 then bounces to 1.0
        const t = spawnT;
        const bounce = t < 0.4
          ? t / 0.4 * 1.5                           // grow to 1.5x
          : 1 + 0.5 * Math.cos((t - 0.4) / 0.6 * Math.PI * 2) * (1 - t); // bounce and settle
        const r = baseRadius * Math.max(0, bounce);
        const alpha = Math.min(1, t * 3); // fade in over first third
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(px, py, baseRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, baseRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawCars(ctx: CanvasRenderingContext2D, filter?: 'road' | Set<string>) {
  for (const car of cars) {
    if (filter === 'road') {
      if (highwayEdgeSet.has(car.edgeId)) continue;
    } else if (filter instanceof Set) {
      if (!filter.has(car.edgeId)) continue;
    }
    const carLen = car.isTruck ? TRUCK_LEN : CAR_LEN;
    const carWid = car.isTruck ? TRUCK_WID : CAR_WID;

    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    // Pivot is at the rear axle — offset drawing so rear is at origin
    const rearOffset = carLen * 0.3; // rear axle ~30% from back

    ctx.globalAlpha = 1;

    // Car body with rounded corners, shifted so rear axle is at pivot
    const hh = carWid / 2;
    const r = car.isTruck ? 2 : 3;
    ctx.fillStyle = car.isTruck ? darkenColor(car.color, 0.2) : car.color;
    ctx.beginPath();
    ctx.roundRect(-rearOffset, -hh, carLen, carWid, r);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-rearOffset, -hh, carLen, carWid, r);
    ctx.stroke();

    if (car.isTruck) {
      // Truck: cab at front, cargo bed behind
      const cabLen = carLen * 0.35;
      ctx.fillStyle = car.color;
      ctx.beginPath();
      ctx.roundRect(carLen - rearOffset - cabLen, -hh + 1, cabLen - 1, carWid - 2, 2);
      ctx.fill();
      // Cargo pin dots
      if (car.pinsCarried > 0) {
        const bedLeft = -rearOffset + 2;
        const bedRight = carLen - rearOffset - cabLen - 1;
        const bedW = bedRight - bedLeft;
        const dotR = 1.5;
        const cols = 3;
        const rows = 2;
        const spacingX = bedW / (cols + 1);
        const spacingY = (carWid - 4) / (rows + 1);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        for (let d = 0; d < car.pinsCarried && d < 6; d++) {
          const col = d % cols;
          const row = Math.floor(d / cols);
          const dx = bedLeft + spacingX * (col + 1);
          const dy = -hh + 2 + spacingY * (row + 1);
          ctx.beginPath();
          ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      // Windshield
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(carLen - rearOffset - 4, -carWid / 2 + 2, 3, carWid - 4);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function drawCollectingPins(ctx: CanvasRenderingContext2D) {
  for (const car of cars) {
    if (car.state !== 'collecting') continue;
    const t = car.collectProgress;
    // Ease-out curve for snappy start, gentle arrival
    const et = 1 - (1 - t) * (1 - t);
    const px = car.pinSourceX + (car.x - car.pinSourceX) * et;
    const py = car.pinSourceY + (car.y - car.pinSourceY) * et;
    // Pin fades out as it arrives
    const alpha = 1 - t * 0.5;
    // Pin grows slightly then shrinks
    const scale = 1 + 0.3 * Math.sin(t * Math.PI);
    const radius = 3.5 * scale;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawScore(ctx: CanvasRenderingContext2D, width: number) {
  const text = `Points: ${score}  Cars: ${cars.length}`;
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillText(text, width - 14, 16);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, width - 15, 15);
}

// ============ FLOATING TOOLBAR ============

const BTN_SIZE = 44;      // circular button diameter
const BTN_GAP = 10;       // gap between buttons
const BTN_MARGIN = 12;    // margin from screen edge
const GEAR_SIZE = 48;     // gear button diameter

// Draw a circular button with icon
function drawCircleButton(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, active: boolean, drawIcon: (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => void) {
  // Drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;

  // Background
  ctx.fillStyle = active ? '#000' : 'rgba(44, 62, 80, 0.85)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Thin white outline
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Active ring
  if (active) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Icon
  drawIcon(ctx, cx, cy, r);
}

// Icon drawing functions
function iconRoad(ctx: CanvasRenderingContext2D, cx: number, cy: number, _r: number) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx + 10, cy);
  ctx.stroke();
  // Center dashes
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx + 10, cy);
  ctx.stroke();
  ctx.setLineDash([]);
}

function iconNarrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, _r: number) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx + 10, cy);
  ctx.stroke();
}

function iconHighway(ctx: CanvasRenderingContext2D, cx: number, cy: number, _r: number) {
  // Two parallel lines with yellow dash
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy - 4);
  ctx.lineTo(cx + 10, cy - 4);
  ctx.moveTo(cx - 10, cy + 4);
  ctx.lineTo(cx + 10, cy + 4);
  ctx.stroke();
  ctx.strokeStyle = '#f1c40f';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx + 10, cy);
  ctx.stroke();
  ctx.setLineDash([]);
}

function iconRemove(ctx: CanvasRenderingContext2D, cx: number, cy: number, _r: number) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 7, cy - 7);
  ctx.lineTo(cx + 7, cy + 7);
  ctx.moveTo(cx + 7, cy - 7);
  ctx.lineTo(cx - 7, cy + 7);
  ctx.stroke();
}

function iconBuilding(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // Show the icon of the currently selected building type
  switch (selectedBuildingType) {
    case 'factory': iconFactory(ctx, cx, cy, r); break;
    case 'storage': iconStorage(ctx, cx, cy, r); break;
    default: iconHouse(ctx, cx, cy, r); break;
  }
}

function iconDemolish(ctx: CanvasRenderingContext2D, cx: number, cy: number, _r: number) {
  // Hammer shape
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  // Handle
  ctx.moveTo(cx - 6, cy + 8);
  ctx.lineTo(cx + 4, cy - 2);
  ctx.stroke();
  // Head
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx + 2, cy - 4);
  ctx.lineTo(cx + 9, cy - 8);
  ctx.lineTo(cx + 7, cy - 1);
  ctx.lineTo(cx, cy - 1);
  ctx.closePath();
  ctx.fill();
}

// Building sub-type icons
function iconHouse(ctx: CanvasRenderingContext2D, cx: number, cy: number, _r: number) {
  ctx.fillStyle = selectedColor;
  ctx.fillRect(cx - 6, cy - 2, 12, 10);
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy - 2);
  ctx.lineTo(cx, cy - 9);
  ctx.lineTo(cx + 8, cy - 2);
  ctx.closePath();
  ctx.fill();
}

function iconFactory(ctx: CanvasRenderingContext2D, cx: number, cy: number, _r: number) {
  ctx.fillStyle = selectedColor;
  ctx.fillRect(cx - 8, cy - 2, 16, 10);
  // Chimney
  ctx.fillRect(cx + 3, cy - 8, 4, 6);
}

function iconStorage(ctx: CanvasRenderingContext2D, cx: number, cy: number, _r: number) {
  ctx.strokeStyle = selectedColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - 7, cy - 7, 14, 14);
  // Grid lines
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 7);
  ctx.lineTo(cx, cy + 7);
  ctx.moveTo(cx - 7, cy);
  ctx.lineTo(cx + 7, cy);
  ctx.stroke();
}

// Gear icon
function iconGear(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const ir = r * 0.35;
  const or = r * 0.6;
  const teeth = 6;
  ctx.fillStyle = '#fff';
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
  ctx.fillStyle = gearMenuOpen ? '#3498db' : 'rgba(44, 62, 80, 0.85)';
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
  { type: 'removeRoad', icon: iconRemove },
  // Color circle goes here (index 4) — handled separately
  { type: 'addBuilding', buildingType: 'house', icon: iconHouse },
  { type: 'addBuilding', buildingType: 'factory', icon: iconFactory },
  { type: 'addBuilding', buildingType: 'storage', icon: iconStorage },
  { type: 'removeBuilding', icon: iconDemolish },
];

const COLOR_SLOT_INDEX = 4; // color circle inserted before house

function isToolActive(def: ToolIconDef): boolean {
  if (def.buildingType) {
    return activeTool === 'addBuilding' && selectedBuildingType === def.buildingType;
  }
  return activeTool === def.type;
}

function drawToolbar(ctx: CanvasRenderingContext2D, width: number, height: number, fps: number = 0) {
  const r = BTN_SIZE / 2;
  const totalSlots = TOOL_ICONS.length + 1; // +1 for color circle
  const startY = height / 2 - (totalSlots * (BTN_SIZE + BTN_GAP) - BTN_GAP) / 2;

  // Left column: tool buttons with color circle inserted at COLOR_SLOT_INDEX
  let slot = 0;
  for (let i = 0; i < TOOL_ICONS.length; i++) {
    if (i === COLOR_SLOT_INDEX) {
      // Draw color circle
      const cx = BTN_MARGIN + r;
      const cy = startY + slot * (BTN_SIZE + BTN_GAP) + r;

      // Drop shadow
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = selectedColor;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Thin white outline
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      // Draw small refresh/cycle icon to indicate color is changeable
      const iconR = r * 0.45;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, iconR, -Math.PI * 0.7, Math.PI * 0.5);
      ctx.stroke();
      // Arrowhead at end of arc
      const arrowAngle = Math.PI * 0.5;
      const ax = cx + Math.cos(arrowAngle) * iconR;
      const ay = cy + Math.sin(arrowAngle) * iconR;
      const arrowSize = 4;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.moveTo(ax + arrowSize * Math.cos(arrowAngle - 0.3), ay + arrowSize * Math.sin(arrowAngle - 0.3));
      ctx.lineTo(ax + arrowSize * Math.cos(arrowAngle + Math.PI / 2 + 0.3), ay + arrowSize * Math.sin(arrowAngle + Math.PI / 2 + 0.3));
      ctx.lineTo(ax + arrowSize * Math.cos(arrowAngle + Math.PI - 0.3), ay + arrowSize * Math.sin(arrowAngle + Math.PI - 0.3));
      ctx.closePath();
      ctx.fill();
      slot++;
    }
    const def = TOOL_ICONS[i];
    const cx = BTN_MARGIN + r;
    const cy = startY + slot * (BTN_SIZE + BTN_GAP) + r;
    drawCircleButton(ctx, cx, cy, r, isToolActive(def), def.icon);
    slot++;
  }

  // Gear button — bottom right
  const gearR = GEAR_SIZE / 2;
  const gearCx = width - BTN_MARGIN - gearR;
  const gearCy = height - BTN_MARGIN - gearR;
  // Drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = gearMenuOpen ? '#3498db' : 'rgba(44, 62, 80, 0.85)';
  ctx.beginPath();
  ctx.arc(gearCx, gearCy, gearR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Thin white outline
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(gearCx, gearCy, gearR, 0, Math.PI * 2);
  ctx.stroke();

  iconGear(ctx, gearCx, gearCy, gearR);

  // Gear menu — popup above gear button
  if (gearMenuOpen) {
    const menuW = 180;
    const pad = 10;
    // Compute dynamic height: base items + save/load row + cities button
    const menuH = 160 + 42 + 42;
    const menuX = width - BTN_MARGIN - menuW;
    const menuY = gearCy - gearR - BTN_GAP - menuH;

    // Background
    ctx.fillStyle = 'rgba(44, 62, 80, 0.95)';
    ctx.beginPath();
    ctx.roundRect(menuX, menuY, menuW, menuH, 8);
    ctx.fill();

    let my = menuY + pad;

    // FPS display
    const fpsText = `${fps} FPS`;
    ctx.font = 'bold 12px monospace';
    const fpsColor = fps >= 50 ? '#2ecc71' : fps >= 30 ? '#f1c40f' : '#e74c3c';
    ctx.fillStyle = fpsColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fpsText, menuX + pad, my + 10);
    my += 28;

    // Speed buttons row
    const speedBtnW = 34;
    const speedGap = 4;
    let sx = menuX + pad;
    ctx.font = '13px sans-serif';
    for (let i = 0; i < SPEED_OPTIONS.length; i++) {
      const spd = SPEED_OPTIONS[i];
      const isActive = gameSpeed === spd;
      ctx.fillStyle = isActive ? '#3498db' : '#34495e';
      ctx.beginPath();
      ctx.roundRect(sx, my, speedBtnW, 32, 6);
      ctx.fill();
      if (isActive) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(sx, my, speedBtnW, 32, 6);
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.font = spd === 0 ? 'bold 14px sans-serif' : '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(SPEED_LABELS[i], sx + speedBtnW / 2, my + 16);
      ctx.font = '13px sans-serif';
      sx += speedBtnW + speedGap;
    }
    my += 42;

    // Music button
    const musicLabel = musicEnabled ? '♫ On' : '♫ Off';
    ctx.fillStyle = musicEnabled ? '#27ae60' : '#34495e';
    ctx.beginPath();
    ctx.roundRect(menuX + pad, my, menuW - pad * 2, 32, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(musicLabel, menuX + menuW / 2, my + 16);
    my += 42;

    // Save / Load row
    const halfW = (menuW - pad * 2 - 6) / 2;
    ctx.fillStyle = '#2980b9';
    ctx.beginPath();
    ctx.roundRect(menuX + pad, my, halfW, 32, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Save', menuX + pad + halfW / 2, my + 16);

    ctx.fillStyle = '#2980b9';
    ctx.beginPath();
    ctx.roundRect(menuX + pad + halfW + 6, my, halfW, 32, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('Load', menuX + pad + halfW + 6 + halfW / 2, my + 16);
    my += 42;

    // Cities button — opens city picker modal
    ctx.fillStyle = '#2c3e50';
    ctx.beginPath();
    ctx.roundRect(menuX + pad, my, menuW - pad * 2, 32, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Cities', menuX + menuW / 2, my + 16);
    my += 42;

    // Reset button
    ctx.fillStyle = '#8B0000';
    ctx.beginPath();
    ctx.roundRect(menuX + pad, my, menuW - pad * 2, 32, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Reset', menuX + menuW / 2, my + 16);
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
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, width, height);

  const { size, mx, my } = getModalMetrics(width, height);

  // Shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.roundRect(mx, my, size, size, MODAL_RADIUS);
  ctx.fill();
  ctx.restore();

  // Splash image (is the modal)
  if (splashImg.complete && splashImg.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(mx, my, size, size, MODAL_RADIUS);
    ctx.clip();
    ctx.drawImage(splashImg, mx, my, size, size);
    ctx.restore();
  }

  // White outline
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(mx, my, size, size, MODAL_RADIUS);
  ctx.stroke();

  // Close button (top-right)
  const closeSize = 28;
  const closePad = 8;
  const closeX = mx + size - closeSize - closePad;
  const closeY = my + closePad;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.beginPath();
  ctx.arc(closeX + closeSize / 2, closeY + closeSize / 2, closeSize / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
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
  grad.addColorStop(1, 'rgba(0,0,0,0.65)');
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

  // Animated multi-color glow for buttons (colors from splash image)
  const glowColors = [
    [255, 160, 60],   // orange
    [255, 215, 0],    // yellow
    [0, 206, 209],    // cyan/teal
    [224, 64, 64],    // red
    [66, 170, 110],   // green
  ];
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
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx, btnY, MODAL_BTN_W, MODAL_BTN_H, pillRadius);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + MODAL_BTN_W / 2, btnY + MODAL_BTN_H / 2);
  };

  // Demo City button
  const demoGrad = ctx.createLinearGradient(0, btnY, 0, btnY + MODAL_BTN_H);
  demoGrad.addColorStop(0, 'rgba(255, 160, 60, 0.95)');
  demoGrad.addColorStop(1, 'rgba(210, 100, 20, 0.95)');
  drawGlowBtn(btnStartX, demoGrad, 'Demo City');

  // Start Fresh button
  const freshGrad = ctx.createLinearGradient(0, btnY, 0, btnY + MODAL_BTN_H);
  freshGrad.addColorStop(0, 'rgba(66, 170, 110, 0.92)');
  freshGrad.addColorStop(1, 'rgba(30, 110, 65, 0.92)');
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
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, width, height);

  const cityCount = cities.length;
  const { modalH, mx, my, headerH } = getCityModalMetrics(width, height);

  // Shadow + background
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = 'rgba(44, 62, 80, 0.97)';
  ctx.beginPath();
  ctx.roundRect(mx, my, CITY_MODAL_W, modalH, 12);
  ctx.fill();
  ctx.restore();

  // White outline
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(mx, my, CITY_MODAL_W, modalH, 12);
  ctx.stroke();

  // Header
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Choose a City', mx + CITY_MODAL_W / 2, my + headerH / 2);

  // Close button (top-right)
  const closeSize = 28;
  const closePad = 10;
  const closeX = mx + CITY_MODAL_W - closeSize - closePad;
  const closeY = my + closePad;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.beginPath();
  ctx.arc(closeX + closeSize / 2, closeY + closeSize / 2, closeSize / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
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

    ctx.fillStyle = '#34495e';
    ctx.beginPath();
    ctx.roundRect(rowX, rowY, rowW, CITY_ROW_H, 8);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cities[i].name, mx + CITY_MODAL_W / 2, rowY + CITY_ROW_H / 2);

    rowY += CITY_ROW_H + CITY_ROW_GAP;
  }

  if (cityCount === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
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

  // Gear button
  const gearR = GEAR_SIZE / 2;
  const gearCx = width - BTN_MARGIN - gearR;
  const gearCy = height - BTN_MARGIN - gearR;
  const gearButton = { x: gearCx - gearR, y: gearCy - gearR, w: GEAR_SIZE, h: GEAR_SIZE };

  // Gear menu items
  const menuW = 180;
  const pad = 10;
  const menuH = 160 + 42 + 42;
  const menuX = width - BTN_MARGIN - menuW;
  const menuY = gearCy - gearR - BTN_GAP - menuH;

  // Speed buttons
  let my = menuY + pad + 28;
  const speedBtnW = 34;
  const speedGap = 4;
  let sx = menuX + pad;
  const speedButtons: { speed: number; x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < SPEED_OPTIONS.length; i++) {
    speedButtons.push({ speed: SPEED_OPTIONS[i], x: sx, y: my, w: speedBtnW, h: 32 });
    sx += speedBtnW + speedGap;
  }
  my += 42;

  // Music button
  const musicButton = { x: menuX + pad, y: my, w: menuW - pad * 2, h: 32 };
  my += 42;

  // Save / Load buttons
  const halfW = (menuW - pad * 2 - 6) / 2;
  const saveButton = { x: menuX + pad, y: my, w: halfW, h: 32 };
  const loadButton = { x: menuX + pad + halfW + 6, y: my, w: halfW, h: 32 };
  my += 42;

  // Cities button (opens city modal)
  const citiesButton = { x: menuX + pad, y: my, w: menuW - pad * 2, h: 32 };
  my += 42;

  // Reset button
  const resetButton = { x: menuX + pad, y: my, w: menuW - pad * 2, h: 32 };

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

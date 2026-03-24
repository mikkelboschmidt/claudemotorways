import { GRID, HALF, ROAD_W, DASH_LEN, DASH_GAP, CAR_LEN, CAR_WID, BG_COLOR, ROAD_COLOR, TOOLBAR_HEIGHT, HIGHWAY_COLOR, HIGHWAY_ROAD_W, NARROW_ROAD_W, NARROW_ARROW_SPACING } from './constants.ts';
import { camX, camY, zoom } from './camera.ts';
import { edges, nodes, parseKey } from './graph.ts';
import { buildings, getBuildingPixelPos, getConnectionPixelPos, getConnectionPoint, HOUSE_W, HOUSE_H, FACTORY_W, FACTORY_H } from './buildings.ts';
import { hoverGx, hoverGy, pendingRemoveTiles } from './roads.ts';
import { cars } from './cars.ts';
import { RoadPreview, ToolType, BUILDING_COLORS } from './types.ts';
import { activeTool, selectedColor, selectedBuildingType } from './toolbar.ts';
import { score } from './score.ts';
import { gameSpeed, SPEED_OPTIONS, SPEED_LABELS } from './speed.ts';
import { highways, highwayEdgeSet, highwayPhase, highwayStartGx, highwayStartGy, highwayPreviewEndPx, highwayPreviewEndPy, computeBezierControls, draggingHighwayId } from './highway.ts';
import { musicEnabled } from './music.ts';

export function render(ctx: CanvasRenderingContext2D, width: number, height: number, preview: RoadPreview | null, fps: number = 0) {
  const gameHeight = height - TOOLBAR_HEIGHT;

  // Clear entire canvas
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, width, gameHeight);

  // Clip game area so nothing draws over toolbar
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, gameHeight);
  ctx.clip();

  // Apply camera transform: scale then translate
  ctx.scale(zoom, zoom);
  ctx.translate(-camX, -camY);

  // Faint grid — only draw visible lines
  const worldLeft = camX;
  const worldTop = camY;
  const worldRight = camX + width / zoom;
  const worldBottom = camY + gameHeight / zoom;

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

  drawRoads(ctx);
  drawHighways(ctx);

  if (preview) {
    drawRoadPreview(ctx, preview);
  }

  drawHighwayPreview(ctx);
  drawHoverGhost(ctx);
  drawBuildings(ctx);
  drawCars(ctx);

  // Restore from camera transform + clip
  ctx.restore();

  // Score and toolbar drawn in screen space
  drawScore(ctx, width);
  drawToolbar(ctx, width, height, fps);
}

function drawRoads(ctx: CanvasRenderingContext2D) {
  // Draw road segments as thick lines with round caps
  ctx.strokeStyle = ROAD_COLOR;
  ctx.lineWidth = ROAD_W;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Batch all road segments into one path (skip highway sub-edges)
  ctx.beginPath();
  for (const [, edge] of edges) {
    if (highwayEdgeSet.has(edge.id)) continue;
    ctx.moveTo(edge.fx, edge.fy);
    ctx.lineTo(edge.tx, edge.ty);
  }
  ctx.stroke();

  // Draw round joints at all nodes for smooth corners (skip highway intermediate nodes)
  ctx.fillStyle = ROAD_COLOR;
  for (const [key, node] of nodes) {
    if (key.startsWith('hw')) continue;
    ctx.beginPath();
    ctx.arc(node.gx * GRID + HALF, node.gy * GRID + HALF, ROAD_W / 2, 0, Math.PI * 2);
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

  // Dashed center lines — batch into one path
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.lineCap = 'butt';
  ctx.setLineDash([DASH_LEN, DASH_GAP]);

  ctx.beginPath();
  for (const [, edge] of edges) {
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

function drawHighways(ctx: CanvasRenderingContext2D) {
  for (const hw of highways) {
    // Shadow for elevated look
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = HIGHWAY_ROAD_W + 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hw.p0x + 3, hw.p0y + 3);
    ctx.bezierCurveTo(hw.p1x + 3, hw.p1y + 3, hw.p2x + 3, hw.p2y + 3, hw.p3x + 3, hw.p3y + 3);
    ctx.stroke();

    // Edge outline
    ctx.strokeStyle = '#444';
    ctx.lineWidth = HIGHWAY_ROAD_W + 4;
    ctx.beginPath();
    ctx.moveTo(hw.p0x, hw.p0y);
    ctx.bezierCurveTo(hw.p1x, hw.p1y, hw.p2x, hw.p2y, hw.p3x, hw.p3y);
    ctx.stroke();

    // Highway surface
    ctx.strokeStyle = HIGHWAY_COLOR;
    ctx.lineWidth = HIGHWAY_ROAD_W;
    ctx.beginPath();
    ctx.moveTo(hw.p0x, hw.p0y);
    ctx.bezierCurveTo(hw.p1x, hw.p1y, hw.p2x, hw.p2y, hw.p3x, hw.p3y);
    ctx.stroke();

    // Dashed center line
    ctx.setLineDash([DASH_LEN, DASH_GAP]);
    ctx.strokeStyle = '#dda63a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hw.p0x, hw.p0y);
    ctx.bezierCurveTo(hw.p1x, hw.p1y, hw.p2x, hw.p2y, hw.p3x, hw.p3y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Ramp indicators at endpoints (small circles)
    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.arc(hw.p0x, hw.p0y, HIGHWAY_ROAD_W / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hw.p3x, hw.p3y, HIGHWAY_ROAD_W / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
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
  ctx.strokeStyle = HIGHWAY_COLOR;
  ctx.lineWidth = HIGHWAY_ROAD_W;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(p0x, p0y);
  ctx.bezierCurveTo(p1x, p1y, p2x, p2y, p3x, p3y);
  ctx.stroke();

  ctx.setLineDash([DASH_LEN, DASH_GAP]);
  ctx.strokeStyle = '#dda63a';
  ctx.lineWidth = 2;
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

  ctx.strokeStyle = 'rgba(100,100,100,0.5)';
  ctx.lineWidth = ROAD_W;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px1, py1);
  ctx.lineTo(px2, py2);
  ctx.stroke();

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

function drawHoverGhost(ctx: CanvasRenderingContext2D) {
  if (hoverGx === null || hoverGy === null) return;

  if (activeTool === 'addBuilding') {
    const w = selectedBuildingType === 'house' ? HOUSE_W : FACTORY_W;
    const h = selectedBuildingType === 'house' ? HOUSE_H : FACTORY_H;
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

function drawBuildings(ctx: CanvasRenderingContext2D) {
  for (const b of buildings) {
    const pos = getBuildingPixelPos(b);
    const conn = getConnectionPixelPos(b);

    if (b.type === 'house') {
      ctx.fillStyle = b.color;
      ctx.fillRect(pos.x + 2, pos.y + 2, pos.w - 4, pos.h - 4);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 2;
      ctx.strokeRect(pos.x + 2, pos.y + 2, pos.w - 4, pos.h - 4);

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('H', pos.x + pos.w / 2, pos.y + pos.h / 2);
    } else {
      drawFactory(ctx, b, pos);
    }

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(conn.x, conn.y, 4, 0, Math.PI * 2);
    ctx.fill();
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
    drawFactoryPins(ctx, bx, by, bw, bh, b.pins, b.maxPins);
  }
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

function drawFactoryPins(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pins: number, maxPins: number) {
  if (maxPins === 0) return;
  // Pins in top-right area
  const cols = 3;
  const rows = Math.ceil(maxPins / cols);
  const radius = 3.5;
  const spacing = 10;
  const areaW = cols * spacing;
  const areaH = rows * spacing;
  const startX = x + w - areaW - 4;
  const startY = y + 6;

  for (let i = 0; i < maxPins; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const px = startX + col * spacing + spacing / 2;
    const py = startY + row * spacing + spacing / 2;

    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);

    if (i < pins) {
      ctx.fillStyle = '#fff';
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function drawCars(ctx: CanvasRenderingContext2D) {
  for (const car of cars) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    // Pivot is at the rear axle — offset drawing so rear is at origin
    const rearOffset = CAR_LEN * 0.3; // rear axle ~30% from back

    const alpha = (car.state === 'parked') ? 0.6 : 1;
    ctx.globalAlpha = alpha;

    // Car body with rounded corners, shifted so rear axle is at pivot
    const hh = CAR_WID / 2;
    const r = 3;
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.roundRect(-rearOffset, -hh, CAR_LEN, CAR_WID, r);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-rearOffset, -hh, CAR_LEN, CAR_WID, r);
    ctx.stroke();

    // Windshield
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(CAR_LEN - rearOffset - 4, -CAR_WID / 2 + 2, 3, CAR_WID - 4);

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function drawScore(ctx: CanvasRenderingContext2D, width: number) {
  const text = `Score: ${score}`;
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillText(text, width - 14, 16);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, width - 15, 15);
}

function drawToolbar(ctx: CanvasRenderingContext2D, width: number, height: number, fps: number = 0) {
  const y = height - TOOLBAR_HEIGHT;

  ctx.fillStyle = '#2c3e50';
  ctx.fillRect(0, y, width, TOOLBAR_HEIGHT);
  ctx.strokeStyle = '#4a6785';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();

  const tools: { type: ToolType; label: string }[] = [
    { type: 'addRoad', label: 'Road' },
    { type: 'addHighway', label: 'Highway' },
    { type: 'removeRoad', label: 'Remove' },
    { type: 'addBuilding', label: 'Building' },
    { type: 'removeBuilding', label: 'Demolish' },
  ];

  let x = 15;
  const btnH = 40;
  const btnY = y + (TOOLBAR_HEIGHT - btnH) / 2;

  ctx.font = '13px sans-serif';

  for (const tool of tools) {
    const btnW = ctx.measureText(tool.label).width + 30;
    const isActive = activeTool === tool.type;

    ctx.fillStyle = isActive ? '#3498db' : '#34495e';
    ctx.beginPath();
    ctx.roundRect(x, btnY, btnW, btnH, 6);
    ctx.fill();

    if (isActive) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, btnY, btnW, btnH, 6);
      ctx.stroke();
    }

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tool.label, x + btnW / 2, btnY + btnH / 2);

    x += btnW + 10;
  }

  if (activeTool === 'addBuilding') {
    x += 10;
    ctx.strokeStyle = '#4a6785';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, btnY + 4);
    ctx.lineTo(x, btnY + btnH - 4);
    ctx.stroke();
    x += 15;

    const houseW = 50;
    const factoryW = 60;

    ctx.fillStyle = selectedBuildingType === 'house' ? '#3498db' : '#34495e';
    ctx.beginPath();
    ctx.roundRect(x, btnY, houseW, btnH, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('House', x + houseW / 2, btnY + btnH / 2);
    x += houseW + 6;

    ctx.fillStyle = selectedBuildingType === 'factory' ? '#3498db' : '#34495e';
    ctx.beginPath();
    ctx.roundRect(x, btnY, factoryW, btnH, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('Factory', x + factoryW / 2, btnY + btnH / 2);
    x += factoryW + 15;

    const swatchSize = 28;
    for (const color of BUILDING_COLORS) {
      const isSelected = selectedColor === color;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, btnY + (btnH - swatchSize) / 2, swatchSize, swatchSize, 4);
      ctx.fill();
      if (isSelected) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(x, btnY + (btnH - swatchSize) / 2, swatchSize, swatchSize, 4);
        ctx.stroke();
      }
      x += swatchSize + 6;
    }
  }

  // Speed controls + Reset — right-aligned
  const resetLabel = 'Reset';
  const resetW = ctx.measureText(resetLabel).width + 24;
  const resetX = width - resetW - 15;
  ctx.fillStyle = '#8B0000';
  ctx.beginPath();
  ctx.roundRect(resetX, btnY, resetW, btnH, 6);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(resetLabel, resetX + resetW / 2, btnY + btnH / 2);

  // Music toggle — left of Reset
  const musicLabel = musicEnabled ? '♫ On' : '♫ Off';
  const musicW = ctx.measureText(musicLabel).width + 24;
  const musicX = resetX - musicW - 10;
  ctx.fillStyle = musicEnabled ? '#27ae60' : '#34495e';
  ctx.beginPath();
  ctx.roundRect(musicX, btnY, musicW, btnH, 6);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(musicLabel, musicX + musicW / 2, btnY + btnH / 2);

  // Speed buttons + FPS — left of music
  const speedBtnW = 32;
  const speedGap = 4;
  const speedGroupW = SPEED_OPTIONS.length * speedBtnW + (SPEED_OPTIONS.length - 1) * speedGap;
  // FPS label sits left of speed buttons
  const fpsText = `${fps} FPS`;
  ctx.font = 'bold 12px monospace';
  const fpsW = ctx.measureText(fpsText).width;
  const fpsGap = 12;
  let sx = musicX - speedGroupW - fpsW - fpsGap - 20;
  // Draw FPS
  const fpsColor = fps >= 50 ? '#2ecc71' : fps >= 30 ? '#f1c40f' : '#e74c3c';
  ctx.fillStyle = fpsColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(fpsText, sx, btnY + btnH / 2);
  sx += fpsW + fpsGap;
  ctx.font = '13px sans-serif';
  for (let i = 0; i < SPEED_OPTIONS.length; i++) {
    const spd = SPEED_OPTIONS[i];
    const isActive = gameSpeed === spd;
    ctx.fillStyle = isActive ? '#3498db' : '#34495e';
    ctx.beginPath();
    ctx.roundRect(sx, btnY, speedBtnW, btnH, 6);
    ctx.fill();
    if (isActive) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(sx, btnY, speedBtnW, btnH, 6);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.font = spd === 0 ? 'bold 15px sans-serif' : '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(SPEED_LABELS[i], sx + speedBtnW / 2, btnY + btnH / 2);
    ctx.font = '13px sans-serif';
    sx += speedBtnW + speedGap;
  }
}

export function getToolbarLayout(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const y = height - TOOLBAR_HEIGHT;
  const tools: { type: ToolType; label: string }[] = [
    { type: 'addRoad', label: 'Road' },
    { type: 'addHighway', label: 'Highway' },
    { type: 'removeRoad', label: 'Remove' },
    { type: 'addBuilding', label: 'Building' },
    { type: 'removeBuilding', label: 'Demolish' },
  ];

  const btnH = 40;
  const btnY = y + (TOOLBAR_HEIGHT - btnH) / 2;
  let x = 15;
  ctx.font = '13px sans-serif';

  const buttons: { type: ToolType; x: number; y: number; w: number; h: number }[] = [];
  for (const tool of tools) {
    const btnW = ctx.measureText(tool.label).width + 30;
    buttons.push({ type: tool.type, x, y: btnY, w: btnW, h: btnH });
    x += btnW + 10;
  }

  const buildingTypeButtons: { type: 'house' | 'factory'; x: number; y: number; w: number; h: number }[] = [];
  const colorButtons: { color: string; x: number; y: number; w: number; h: number }[] = [];

  if (activeTool === 'addBuilding') {
    x += 10 + 15;
    const houseW = 50;
    const factoryW = 60;
    buildingTypeButtons.push({ type: 'house', x, y: btnY, w: houseW, h: btnH });
    x += houseW + 6;
    buildingTypeButtons.push({ type: 'factory', x, y: btnY, w: factoryW, h: btnH });
    x += factoryW + 15;

    const swatchSize = 28;
    for (const color of BUILDING_COLORS) {
      colorButtons.push({ color, x, y: btnY + (btnH - swatchSize) / 2, w: swatchSize, h: swatchSize });
      x += swatchSize + 6;
    }
  }

  // Reset button
  const resetLabel = 'Reset';
  const resetW = ctx.measureText(resetLabel).width + 24;
  const resetX = width - resetW - 15;
  const resetButton = { x: resetX, y: btnY, w: resetW, h: btnH };

  // Music toggle button
  const musicLabel = musicEnabled ? '♫ On' : '♫ Off';
  const musicW = ctx.measureText(musicLabel).width + 24;
  const musicX = resetX - musicW - 10;
  const musicButton = { x: musicX, y: btnY, w: musicW, h: btnH };

  // Speed buttons
  const speedBtnW = 32;
  const speedGap = 4;
  const speedGroupW = SPEED_OPTIONS.length * speedBtnW + (SPEED_OPTIONS.length - 1) * speedGap;
  let sx = musicX - speedGroupW - 20;
  const speedButtons: { speed: number; x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < SPEED_OPTIONS.length; i++) {
    speedButtons.push({ speed: SPEED_OPTIONS[i], x: sx, y: btnY, w: speedBtnW, h: btnH });
    sx += speedBtnW + speedGap;
  }

  return { buttons, buildingTypeButtons, colorButtons, resetButton, musicButton, speedButtons };
}

import { GRID } from './constants.ts';
import { ConnectionSide } from './types.ts';
import { currentThemeId, themeAssets } from './theme.ts';

interface SpriteLayer {
  image: HTMLImageElement;
  ready: boolean;
}

export interface PinPlacement {
  x: number;      // pixel offset from building top-left
  y: number;
  w: number;
  h: number;
}

export interface LayeredSprite {
  ground: SpriteLayer;   // drawn below roads/cars
  shadow: SpriteLayer;   // drawn above cars, below buildings
  building: SpriteLayer; // drawn above shadow
  anchorX: number;
  anchorY: number;
  width: number;
  height: number;
  pinPlacement: PinPlacement | null;
}

interface SpriteDef {
  raw: string;
  anchorTileX: number;
  anchorTileY: number;
  widthTiles: number;
  heightTiles: number;
  colorIds: { id: string; property: 'fill' | 'stroke'; role: 'main' | 'shadow' }[];
  groundIds: string[];
  shadowIds: string[];
  buildingIds: string[];
}

const HOUSE_COMMON: Omit<SpriteDef, 'raw'> = {
  anchorTileX: 1,
  anchorTileY: 1,
  widthTiles: 3,
  heightTiles: 3,
  colorIds: [
    { id: 'RoofMain', property: 'fill', role: 'main' },
    { id: 'RoofShadow', property: 'fill', role: 'shadow' },
  ],
  groundIds: ['Ground'],
  shadowIds: ['Shadows'],
  buildingIds: ['Building'],
};

const FACTORY_COMMON: Omit<SpriteDef, 'raw'> = {
  anchorTileX: 1,
  anchorTileY: 1,
  widthTiles: 5,
  heightTiles: 4,
  colorIds: [
    { id: 'RoofMain', property: 'fill', role: 'main' },
    { id: 'RoofShadow', property: 'fill', role: 'shadow' },
  ],
  groundIds: ['Ground'],
  shadowIds: ['Shadows'],
  buildingIds: ['Building'],
};

const STORAGE_COMMON: Omit<SpriteDef, 'raw'> = {
  anchorTileX: 1,
  anchorTileY: 1,
  widthTiles: 4,
  heightTiles: 4,
  colorIds: [
    { id: 'RoofMain', property: 'fill', role: 'main' },
    { id: 'RoofShadow', property: 'fill', role: 'shadow' },
  ],
  groundIds: ['Ground'],
  shadowIds: ['Shadows'],
  buildingIds: ['Building'],
};

function getSpriteDef(type: 'house' | 'factory' | 'storage', side: ConnectionSide): SpriteDef | null {
  if (type === 'house') {
    return { raw: themeAssets.sprites.house[side], ...HOUSE_COMMON };
  }
  if (type === 'factory') {
    return { raw: themeAssets.sprites.factory[side], ...FACTORY_COMMON };
  }
  return { raw: themeAssets.sprites.storage[side], ...STORAGE_COMMON };
}

function darkenColor(hex: string, factor: number): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  return `rgb(${r},${g},${b})`;
}

// Replace all fill attributes on direct and nested elements within a group id.
// Handles id="RoofShadow", id="RoofShadow_2", etc. Skips fill="none".
function replaceGroupFills(svg: string, groupId: string, fillColor: string): string {
  const idPattern = new RegExp(`id="${groupId}(?:_\\d+)?"`, 'g');
  const matches = [...svg.matchAll(idPattern)];
  if (matches.length === 0) return svg;

  // Collect [groupContentStart, groupContentEnd] ranges for all matching groups
  // Process in reverse order so slice offsets stay valid
  const ranges: Array<[number, number]> = [];

  for (const match of matches) {
    const tagStart = svg.lastIndexOf('<', match.index!);
    const openTagEnd = svg.indexOf('>', tagStart);
    if (openTagEnd === -1) continue;
    // Self-closing element (rect, circle, path) — not a group container
    if (svg[openTagEnd - 1] === '/') continue;

    // Find matching closing </g> by depth
    let depth = 1;
    let pos = openTagEnd + 1;
    let closeStart = -1;
    while (pos < svg.length && depth > 0) {
      const nextOpen = svg.indexOf('<g', pos);
      const nextClose = svg.indexOf('</g>', pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 2;
      } else {
        depth--;
        if (depth === 0) closeStart = nextClose;
        pos = nextClose + 4;
      }
    }
    if (closeStart !== -1) ranges.push([openTagEnd + 1, closeStart]);
  }

  // Apply replacements in reverse order to preserve offsets
  let result = svg;
  for (const [start, end] of ranges.reverse()) {
    const inner = result.slice(start, end).replace(/fill="(?!none")[^"]*"/g, `fill="${fillColor}"`);
    result = result.slice(0, start) + inner + result.slice(end);
  }
  return result;
}

function colorize(svgRaw: string, def: SpriteDef, color: string): string {
  let svg = svgRaw;
  // Remove background rects (no id, just width+height+fill)
  svg = svg.replace(/<rect width="\d+" height="\d+" fill="[^"]*"\/>\n?/g, '');

  for (const c of def.colorIds) {
    const fillColor = c.role === 'main' ? color : darkenColor(color, 0.7);
    // Match id="RoofMain" or id="RoofMain_2" etc (Figma appends _N for duplicates)
    const idPattern = `${c.id}(?:_\\d+)?`;
    // Try replacing fill directly on the element with this id (for leaf elements like <rect>)
    const regex = new RegExp(`(id="${idPattern}"[^>]*${c.property}=")([^"]*)(")`, 'g');
    svg = svg.replace(regex, `$1${fillColor}$3`);
    const regex2 = new RegExp(`(${c.property}=")([^"]*)("[^>]*id="${idPattern}")`, 'g');
    svg = svg.replace(regex2, `$1${fillColor}$3`);
    // Also replace fills within the group subtree (for <g> containers whose children have hardcoded fills)
    svg = replaceGroupFills(svg, c.id, fillColor);
  }
  return svg;
}

function filterLayer(svg: string, allIds: string[], keepIds: string[]): string {
  let result = svg;
  for (const id of allIds) {
    if (!keepIds.includes(id)) {
      result = result.replace(
        new RegExp(`(<[^>]*id="${id}")`, 'g'),
        `$1 display="none"`
      );
    }
  }
  return result;
}

function svgToImage(svg: string): SpriteLayer {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  const layer: SpriteLayer = { image: img, ready: false };
  img.onload = () => { URL.revokeObjectURL(url); layer.ready = true; };
  img.src = url;
  if (img.complete && img.naturalWidth > 0) layer.ready = true;
  return layer;
}

// Extract PinPlacement rect from SVG raw string.
// Returns pixel offset relative to the building's top-left corner.
// SVG coordinates map 1:1 to sprite pixels (viewBox matches tile dimensions × GRID).
function extractPinPlacement(svgRaw: string, def: SpriteDef): PinPlacement | null {
  const match = svgRaw.match(/<rect[^>]*id="PinPlacement"[^>]*\/>/);
  if (!match) return null;
  const tag = match[0];
  const x = parseFloat(tag.match(/\bx="([^"]*)"/)![1]);
  const y = parseFloat(tag.match(/\by="([^"]*)"/)![1]);
  const w = parseFloat(tag.match(/\bwidth="([^"]*)"/)![1]);
  const h = parseFloat(tag.match(/\bheight="([^"]*)"/)![1]);
  // Anchor in SVG space is where the building's top-left sits
  const anchorSvgX = def.anchorTileX * GRID;
  const anchorSvgY = def.anchorTileY * GRID;
  return {
    x: x - anchorSvgX,
    y: y - anchorSvgY,
    w,
    h,
  };
}

// Cache: "type:side:color" → LayeredSprite
const spriteCache = new Map<string, LayeredSprite>();

function buildSprite(def: SpriteDef, color: string): LayeredSprite {
  const svg = colorize(def.raw, def, color);
  const allLayerIds = [...def.groundIds, ...def.shadowIds, ...def.buildingIds];
  // Hide PinPlacement rect from all layers (it's just metadata)
  let filtered = svg;
  filtered = filtered.replace(/(<[^>]*id="PinPlacement")/, '$1 display="none"');

  return {
    ground: svgToImage(filterLayer(filtered, allLayerIds, def.groundIds)),
    shadow: svgToImage(filterLayer(filtered, allLayerIds, def.shadowIds)),
    building: svgToImage(filterLayer(filtered, allLayerIds, def.buildingIds)),
    anchorX: def.anchorTileX * GRID,
    anchorY: def.anchorTileY * GRID,
    width: def.widthTiles * GRID,
    height: def.heightTiles * GRID,
    pinPlacement: extractPinPlacement(def.raw, def),
  };
}

export function getHouseSprite(side: ConnectionSide, color: string): LayeredSprite | null {
  const def = getSpriteDef('house', side);
  if (!def) return null;

  const cacheKey = `${currentThemeId}:house:${side}:${color}`;
  const cached = spriteCache.get(cacheKey);
  if (cached) return cached;

  const sprite = buildSprite(def, color);
  spriteCache.set(cacheKey, sprite);
  return sprite;
}

export function getFactorySprite(side: ConnectionSide, color: string): LayeredSprite | null {
  const def = getSpriteDef('factory', side);
  if (!def) return null;

  const cacheKey = `${currentThemeId}:factory:${side}:${color}`;
  const cached = spriteCache.get(cacheKey);
  if (cached) return cached;

  const sprite = buildSprite(def, color);
  spriteCache.set(cacheKey, sprite);
  return sprite;
}

export function getStorageSprite(side: ConnectionSide, color: string): LayeredSprite | null {
  const def = getSpriteDef('storage', side);
  if (!def) return null;

  const cacheKey = `${currentThemeId}:storage:${side}:${color}`;
  const cached = spriteCache.get(cacheKey);
  if (cached) return cached;

  const sprite = buildSprite(def, color);
  spriteCache.set(cacheKey, sprite);
  return sprite;
}

export function drawSpriteLayer(ctx: CanvasRenderingContext2D, layer: SpriteLayer, sprite: LayeredSprite, buildingPixelX: number, buildingPixelY: number) {
  if (!layer.ready) return;
  ctx.drawImage(
    layer.image,
    buildingPixelX - sprite.anchorX,
    buildingPixelY - sprite.anchorY,
    sprite.width,
    sprite.height,
  );
}

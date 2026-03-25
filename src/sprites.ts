import { GRID } from './constants.ts';
import { ConnectionSide } from './types.ts';
import houseRightRaw from '../assets/House-Right.svg?raw';
import houseLeftRaw from '../assets/House-Left.svg?raw';
import houseTopRaw from '../assets/House-Top.svg?raw';
import houseBottomRaw from '../assets/House-Bottom.svg?raw';
import factoryRaw from '../assets/Factory.svg?raw';
import storageRightRaw from '../assets/Storage-Right.svg?raw';
import storageLeftRaw from '../assets/Storage-Left.svg?raw';
import storageTopRaw from '../assets/Storage-Top.svg?raw';
import storageBottomRaw from '../assets/Storage-Bottom.svg?raw';

interface SpriteLayer {
  image: HTMLImageElement;
  ready: boolean;
}

export interface LayeredSprite {
  ground: SpriteLayer;   // drawn below roads/cars
  shadow: SpriteLayer;   // drawn above cars, below buildings
  building: SpriteLayer; // drawn above shadow
  anchorX: number;
  anchorY: number;
  width: number;
  height: number;
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

const SPRITE_DEFS: Record<string, SpriteDef> = {
  'house:right':  { raw: houseRightRaw, ...HOUSE_COMMON },
  'house:left':   { raw: houseLeftRaw, ...HOUSE_COMMON },
  'house:top':    { raw: houseTopRaw, ...HOUSE_COMMON },
  'house:bottom': { raw: houseBottomRaw, ...HOUSE_COMMON },
  'factory:left': { raw: factoryRaw, ...FACTORY_COMMON },
  'storage:right':  { raw: storageRightRaw, ...STORAGE_COMMON },
  'storage:left':   { raw: storageLeftRaw, ...STORAGE_COMMON },
  'storage:top':    { raw: storageTopRaw, ...STORAGE_COMMON },
  'storage:bottom': { raw: storageBottomRaw, ...STORAGE_COMMON },
};

function darkenColor(hex: string, factor: number): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  return `rgb(${r},${g},${b})`;
}

function colorize(svgRaw: string, def: SpriteDef, color: string): string {
  let svg = svgRaw;
  // Remove background rects (no id, just width+height+fill)
  svg = svg.replace(/<rect width="\d+" height="\d+" fill="[^"]*"\/>\n?/g, '');

  for (const c of def.colorIds) {
    const fillColor = c.role === 'main' ? color : darkenColor(color, 0.7);
    // Match id="RoofMain" or id="RoofMain_2" etc (Figma appends _N for duplicates)
    const idPattern = `${c.id}(?:_\\d+)?`;
    // property after id
    const regex = new RegExp(`(id="${idPattern}"[^>]*${c.property}=")([^"]*)(")`, 'g');
    svg = svg.replace(regex, `$1${fillColor}$3`);
    // property before id
    const regex2 = new RegExp(`(${c.property}=")([^"]*)("[^>]*id="${idPattern}")`, 'g');
    svg = svg.replace(regex2, `$1${fillColor}$3`);
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

// Cache: "type:side:color" → LayeredSprite
const spriteCache = new Map<string, LayeredSprite>();

export function getHouseSprite(side: ConnectionSide, color: string): LayeredSprite | null {
  const defKey = `house:${side}`;
  const def = SPRITE_DEFS[defKey];
  if (!def) return null;

  const cacheKey = `${defKey}:${color}`;
  const cached = spriteCache.get(cacheKey);
  if (cached) return cached;

  const svg = colorize(def.raw, def, color);
  const allLayerIds = [...def.groundIds, ...def.shadowIds, ...def.buildingIds];

  const sprite: LayeredSprite = {
    ground: svgToImage(filterLayer(svg, allLayerIds, def.groundIds)),
    shadow: svgToImage(filterLayer(svg, allLayerIds, def.shadowIds)),
    building: svgToImage(filterLayer(svg, allLayerIds, def.buildingIds)),
    anchorX: def.anchorTileX * GRID,
    anchorY: def.anchorTileY * GRID,
    width: def.widthTiles * GRID,
    height: def.heightTiles * GRID,
  };

  spriteCache.set(cacheKey, sprite);
  return sprite;
}

export function getFactorySprite(side: ConnectionSide, color: string): LayeredSprite | null {
  const defKey = `factory:${side}`;
  const def = SPRITE_DEFS[defKey];
  if (!def) return null;

  const cacheKey = `${defKey}:${color}`;
  const cached = spriteCache.get(cacheKey);
  if (cached) return cached;

  const svg = colorize(def.raw, def, color);
  const allLayerIds = [...def.groundIds, ...def.shadowIds, ...def.buildingIds];

  const sprite: LayeredSprite = {
    ground: svgToImage(filterLayer(svg, allLayerIds, def.groundIds)),
    shadow: svgToImage(filterLayer(svg, allLayerIds, def.shadowIds)),
    building: svgToImage(filterLayer(svg, allLayerIds, def.buildingIds)),
    anchorX: def.anchorTileX * GRID,
    anchorY: def.anchorTileY * GRID,
    width: def.widthTiles * GRID,
    height: def.heightTiles * GRID,
  };

  spriteCache.set(cacheKey, sprite);
  return sprite;
}

export function getStorageSprite(side: ConnectionSide, color: string): LayeredSprite | null {
  const defKey = `storage:${side}`;
  const def = SPRITE_DEFS[defKey];
  if (!def) return null;

  const cacheKey = `${defKey}:${color}`;
  const cached = spriteCache.get(cacheKey);
  if (cached) return cached;

  const svg = colorize(def.raw, def, color);
  const allLayerIds = [...def.groundIds, ...def.shadowIds, ...def.buildingIds];

  const sprite: LayeredSprite = {
    ground: svgToImage(filterLayer(svg, allLayerIds, def.groundIds)),
    shadow: svgToImage(filterLayer(svg, allLayerIds, def.shadowIds)),
    building: svgToImage(filterLayer(svg, allLayerIds, def.buildingIds)),
    anchorX: def.anchorTileX * GRID,
    anchorY: def.anchorTileY * GRID,
    width: def.widthTiles * GRID,
    height: def.heightTiles * GRID,
  };

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

import { ThemeAssetBundle, earthAssets, spaceAssets } from './themeAssets.ts';

export interface GameTheme {
  // Core surfaces
  pageBg: string;           // HTML body background
  bg: string;               // game canvas background / terrain
  gridLine: string;         // faint grid overlay

  // Roads
  road: string;             // regular + narrow road surface
  roadDash: string;         // center line dashes
  highwaySurface: string;   // highway fill
  highwayOutline: string;   // highway border
  highwayDash: string;      // highway center line dashes
  removeTileOverlay: string; // pending-removal red overlay

  /** Road rendering style: 'solid' = filled road surface, 'tracks' = parallel rail lines */
  roadStyle: 'solid' | 'tracks';
  /** Track line width (only used when roadStyle === 'tracks') */
  trackWidth: number;
  /** Track color (only used when roadStyle === 'tracks') */
  trackColor: string;
  /** Center-to-center distance between the two track lines (px) */
  trackSpacing: number;
  /** Highway track spacing override — wider than regular tracks (px). Falls back to trackSpacing if 0. */
  highwayTrackSpacing: number;
  /** Highway track color at the fast middle section */
  highwayTrackFastColor: string;

  // Roundabout
  roundaboutIslandBorder: string;

  // Highway control handles
  handleActive: string;
  handleInactive: string;

  // Road / building preview
  previewRoad: string;
  previewDash: string;
  previewIsland: string;    // roundabout island ghost
  previewShadow: string;    // building ghost shadow
  previewRoadDot: string;   // road start dot

  // Buildings (fallback renderer)
  disabledBuilding: string;
  disabledParkingBg: string;
  disabledBorder: string;
  /** 'lighten' or 'darken' — which direction to tint building backgrounds */
  buildingBgTint: 'lighten' | 'darken';
  buildingBgTintAmount: number;
  storageBgTintAmount: number;
  storageStripeTintAmount: number;

  // Building colors (player-selectable)
  buildingColors: string[];

  // Donut / pin indicator
  donutEmptyRing: string;
  donutFill: string;

  // Cars
  windshield: string;
  cargoDots: string;
  carOutline: string;

  // Collecting pin animation
  collectingPin: string;

  // Score
  scoreShadow: string;
  scoreText: string;

  // Toolbar buttons
  btnShadow: string;
  btnActiveRing: string;
  btnInactiveOutline: string;

  // Gear button + menu
  gearIcon: string;
  gearHoleOpen: string;
  gearHoleClosed: string;
  gearBtnOpen: string;
  gearBtnClosed: string;
  gearBtnOutline: string;
  menuBg: string;

  // FPS colors
  fpsGood: string;
  fpsOk: string;
  fpsBad: string;

  // Speed / menu buttons
  speedActive: string;
  speedInactive: string;
  musicOn: string;
  musicOff: string;
  saveLoadBtn: string;
  citiesBtn: string;
  resetBtn: string;

  // Label
  labelShadow: string;
  labelText: string;

  // Modals
  overlayDim: string;
  modalShadow: string;
  modalOutline: string;
  closeButtonBg: string;
  bottomGradientEnd: string;

  // Demo modal glow + buttons
  glowColors: [number, number, number][];
  demoBtnGradTop: string;
  demoBtnGradBottom: string;
  freshBtnGradTop: string;
  freshBtnGradBottom: string;
  btnBorder: string;
  btnText: string;

  // City modal
  cityModalBg: string;
  cityModalOutline: string;
  cityCloseBg: string;
  cityRowBg: string;
  cityRowText: string;
  cityEmptyText: string;
}

export type ThemeId = 'earth' | 'space';

interface ThemeConfig {
  id: ThemeId;
  label: string;
  palette: GameTheme;
  assets: ThemeAssetBundle;
}

const LEGACY_SPACE_COLORS = ['#e06040', '#4aa8d8', '#50d890', '#d4a030', '#b060d0'];

// ─── Classic (original green motorways) ───

export const classicTheme: GameTheme = {
  pageBg: '#2c3e50',
  bg: '#4a7c59',
  gridLine: 'rgba(255,255,255,0.05)',

  road: '#555',
  roadDash: '#fff',
  highwaySurface: '#666',
  highwayOutline: '#444',
  highwayDash: '#dda63a',
  removeTileOverlay: 'rgba(231, 76, 60, 0.45)',
  roadStyle: 'solid',
  trackWidth: 0,
  trackColor: '',
  trackSpacing: 0,
  highwayTrackSpacing: 0,
  highwayTrackFastColor: '',

  roundaboutIslandBorder: 'rgba(255,255,255,0.12)',

  handleActive: '#e74c3c',
  handleInactive: '#3498db',

  previewRoad: 'rgba(100,100,100,0.5)',
  previewDash: 'rgba(255,255,255,0.3)',
  previewIsland: 'rgba(74,124,89,0.5)',
  previewShadow: 'rgba(0,0,0,0.25)',
  previewRoadDot: 'rgba(255,255,255,0.4)',

  disabledBuilding: '#555555',
  disabledParkingBg: '#3a3a3a',
  disabledBorder: '#444',
  buildingBgTint: 'lighten',
  buildingBgTintAmount: 0.55,
  storageBgTintAmount: 0.6,
  storageStripeTintAmount: 0.3,

  buildingColors: ['#FF009D', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'],

  donutEmptyRing: 'rgba(255,255,255,0.2)',
  donutFill: '#fff',

  windshield: 'rgba(255,255,255,0.7)',
  cargoDots: 'rgba(255,255,255,0.8)',
  carOutline: 'rgba(0,0,0,0.3)',

  collectingPin: '#fff',

  scoreShadow: 'rgba(0,0,0,0.4)',
  scoreText: '#fff',

  btnShadow: '#000',
  btnActiveRing: '#fff',
  btnInactiveOutline: 'rgba(0, 0, 0, 0.5)',

  gearIcon: '#fff',
  gearHoleOpen: '#3498db',
  gearHoleClosed: 'rgba(44, 62, 80, 0.85)',
  gearBtnOpen: '#3498db',
  gearBtnClosed: 'rgba(44, 62, 80, 0.85)',
  gearBtnOutline: 'rgba(255, 255, 255, 0.25)',
  menuBg: 'rgba(44, 62, 80, 0.95)',

  fpsGood: '#2ecc71',
  fpsOk: '#f1c40f',
  fpsBad: '#e74c3c',

  speedActive: '#3498db',
  speedInactive: '#34495e',
  musicOn: '#27ae60',
  musicOff: '#34495e',
  saveLoadBtn: '#2980b9',
  citiesBtn: '#2c3e50',
  resetBtn: '#8B0000',

  labelShadow: 'rgba(0, 0, 0, 0.4)',
  labelText: '#fff',

  overlayDim: 'rgba(0, 0, 0, 0.5)',
  modalShadow: 'rgba(0, 0, 0, 0.6)',
  modalOutline: '#fff',
  closeButtonBg: 'rgba(0, 0, 0, 0.5)',
  bottomGradientEnd: 'rgba(0,0,0,0.65)',

  glowColors: [
    [255, 160, 60],
    [255, 215, 0],
    [0, 206, 209],
    [224, 64, 64],
    [66, 170, 110],
  ],
  demoBtnGradTop: 'rgba(255, 160, 60, 0.95)',
  demoBtnGradBottom: 'rgba(210, 100, 20, 0.95)',
  freshBtnGradTop: 'rgba(66, 170, 110, 0.92)',
  freshBtnGradBottom: 'rgba(30, 110, 65, 0.92)',
  btnBorder: '#fff',
  btnText: '#fff',

  cityModalBg: 'rgba(44, 62, 80, 0.97)',
  cityModalOutline: 'rgba(255, 255, 255, 0.3)',
  cityCloseBg: 'rgba(255, 255, 255, 0.1)',
  cityRowBg: '#34495e',
  cityRowText: '#fff',
  cityEmptyText: 'rgba(255,255,255,0.5)',
};

// ─── Lunar (dark space mining) ───

export const lunarTheme: GameTheme = {
  pageBg: '#1a0e08',
  bg: '#59412F',
  gridLine: 'rgba(255,255,255,0.03)',

  road: '#59412F',
  roadDash: 'rgba(0,0,0,0)',
  highwaySurface: '#59412F',
  highwayOutline: '#3a2a1a',
  highwayDash: '#4CFFF9',
  removeTileOverlay: 'rgba(231, 76, 60, 0.45)',
  roadStyle: 'tracks',
  trackWidth: 2,
  trackColor: '#4CFFF9',
  trackSpacing: 12,
  highwayTrackSpacing: 22,
  highwayTrackFastColor: '#FFD700',

  roundaboutIslandBorder: 'rgba(255,255,255,0.08)',

  handleActive: '#e06040',
  handleInactive: '#4aa8d8',

  previewRoad: 'rgba(100,100,100,0.5)',
  previewDash: 'rgba(255,255,255,0.3)',
  previewIsland: 'rgba(26,26,46,0.5)',
  previewShadow: 'rgba(0,0,0,0.25)',
  previewRoadDot: 'rgba(255,255,255,0.4)',

  disabledBuilding: '#3a3a50',
  disabledParkingBg: '#252538',
  disabledBorder: '#2a2a3e',
  buildingBgTint: 'darken',
  buildingBgTintAmount: 0.6,
  storageBgTintAmount: 0.6,
  storageStripeTintAmount: 0.3,

  buildingColors: ['#FF009D', '#FFD428', '#2A7BFF', '#A1FF00', '#FFE7D3'],

  donutEmptyRing: 'rgba(255,255,255,0.2)',
  donutFill: '#fff',

  windshield: 'rgba(255,255,255,0.7)',
  cargoDots: 'rgba(255,255,255,0.8)',
  carOutline: 'rgba(0,0,0,0.3)',

  collectingPin: '#fff',

  scoreShadow: 'rgba(0,0,0,0.4)',
  scoreText: '#fff',

  btnShadow: '#000',
  btnActiveRing: '#fff',
  btnInactiveOutline: 'rgba(0, 0, 0, 0.5)',

  gearIcon: '#fff',
  gearHoleOpen: '#4aa8d8',
  gearHoleClosed: 'rgba(20, 20, 40, 0.85)',
  gearBtnOpen: '#4aa8d8',
  gearBtnClosed: 'rgba(20, 20, 40, 0.85)',
  gearBtnOutline: 'rgba(255, 255, 255, 0.25)',
  menuBg: 'rgba(15, 15, 30, 0.95)',

  fpsGood: '#50d890',
  fpsOk: '#d4a030',
  fpsBad: '#e06040',

  speedActive: '#4aa8d8',
  speedInactive: '#1e1e36',
  musicOn: '#3a9a60',
  musicOff: '#1e1e36',
  saveLoadBtn: '#2a5a8a',
  citiesBtn: '#1a1a2e',
  resetBtn: '#8B0000',

  labelShadow: 'rgba(0, 0, 0, 0.4)',
  labelText: '#fff',

  overlayDim: 'rgba(0, 0, 0, 0.5)',
  modalShadow: 'rgba(0, 0, 0, 0.6)',
  modalOutline: '#fff',
  closeButtonBg: 'rgba(0, 0, 0, 0.5)',
  bottomGradientEnd: 'rgba(0,0,0,0.65)',

  glowColors: [
    [100, 180, 220],
    [180, 120, 220],
    [60, 200, 160],
    [220, 160, 60],
    [80, 140, 240],
  ],
  demoBtnGradTop: 'rgba(100, 180, 220, 0.95)',
  demoBtnGradBottom: 'rgba(50, 120, 180, 0.95)',
  freshBtnGradTop: 'rgba(60, 200, 160, 0.92)',
  freshBtnGradBottom: 'rgba(30, 140, 100, 0.92)',
  btnBorder: '#fff',
  btnText: '#fff',

  cityModalBg: 'rgba(15, 15, 30, 0.97)',
  cityModalOutline: 'rgba(255, 255, 255, 0.3)',
  cityCloseBg: 'rgba(255, 255, 255, 0.1)',
  cityRowBg: '#1e1e36',
  cityRowText: '#fff',
  cityEmptyText: 'rgba(255,255,255,0.5)',
};

const THEME_STORAGE_KEY = 'claudemotorways_theme';

const themeConfigs: Record<ThemeId, ThemeConfig> = {
  earth: { id: 'earth', label: 'Earth', palette: classicTheme, assets: earthAssets },
  space: { id: 'space', label: 'Space', palette: lunarTheme, assets: spaceAssets },
};

export const THEME_OPTIONS = [themeConfigs.earth, themeConfigs.space] as const;
const THEME_COLOR_SETS: Record<ThemeId, string[][]> = {
  earth: [themeConfigs.earth.palette.buildingColors],
  space: [themeConfigs.space.palette.buildingColors, LEGACY_SPACE_COLORS],
};

function readStoredThemeId(): ThemeId {
  try {
    if (typeof localStorage === 'undefined') return 'space';
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'earth' || stored === 'space') return stored;
  } catch {
    // localStorage may be unavailable in some embedded contexts
  }
  return 'space';
}

function persistThemeId(themeId: ThemeId) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
  } catch {
    // ignore persistence failures
  }
}

function applyThemeConfig(config: ThemeConfig, persist: boolean) {
  currentThemeId = config.id;
  theme = config.palette;
  themeAssets = config.assets;
  if (typeof document !== 'undefined') {
    document.body.style.background = config.palette.pageBg;
  }
  if (persist) persistThemeId(config.id);
}

export let currentThemeId: ThemeId = readStoredThemeId();
export let theme: GameTheme = themeConfigs[currentThemeId].palette;
export let themeAssets: ThemeAssetBundle = themeConfigs[currentThemeId].assets;

export function getBuildingColors(): string[] {
  return theme.buildingColors;
}

export function getThemeLabel(themeId: ThemeId): string {
  return themeConfigs[themeId].label;
}

export function setThemeById(themeId: ThemeId) {
  applyThemeConfig(themeConfigs[themeId], true);
}

export function toggleTheme() {
  setThemeById(currentThemeId === 'space' ? 'earth' : 'space');
}

export function setTheme(t: GameTheme) {
  if (t === classicTheme) {
    setThemeById('earth');
    return;
  }
  if (t === lunarTheme) {
    setThemeById('space');
    return;
  }
  theme = t;
  if (typeof document !== 'undefined') {
    document.body.style.background = t.pageBg;
  }
}

export function remapColorBetweenPalettes(color: string, fromColors: string[], toColors: string[]): string {
  const normalizedColor = color.toLowerCase();
  const index = fromColors.findIndex(entry => entry.toLowerCase() === normalizedColor);
  return index >= 0 && index < toColors.length ? toColors[index] : color;
}

export function remapColorToTheme(color: string, targetThemeId: ThemeId = currentThemeId): string {
  const targetColors = themeConfigs[targetThemeId].palette.buildingColors;
  const normalizedColor = color.toLowerCase();
  for (const themeId of Object.keys(THEME_COLOR_SETS) as ThemeId[]) {
    for (const palette of THEME_COLOR_SETS[themeId]) {
      const index = palette.findIndex(entry => entry.toLowerCase() === normalizedColor);
      if (index >= 0 && index < targetColors.length) {
        return targetColors[index];
      }
    }
  }
  return color;
}

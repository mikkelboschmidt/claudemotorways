import { ToolType } from './types.ts';
import { ThemeId, getBuildingColors, remapColorToTheme } from './theme.ts';

export let activeTool: ToolType = 'addRoad';
export let selectedColor: string = getBuildingColors()[0];
export let selectedBuildingType: 'house' | 'factory' | 'storage' = 'house';
export let gearMenuOpen = false;
export let demoModalOpen = false;
export let cityModalOpen = false;
export let productivityInfoModalOpen = false;
export let productivityInfoScroll = 0;

export function setActiveTool(tool: ToolType) {
  activeTool = tool;
}

export function setSelectedColor(color: string) {
  selectedColor = color;
}

export function remapSelectedColor(targetThemeId: ThemeId, nextColors: string[] = getBuildingColors()) {
  selectedColor = remapColorToTheme(selectedColor, targetThemeId);
  if (!nextColors.some(color => color.toLowerCase() === selectedColor.toLowerCase())) {
    selectedColor = nextColors[0];
  }
}

export function setSelectedBuildingType(type: 'house' | 'factory' | 'storage') {
  selectedBuildingType = type;
}

export function toggleGearMenu() {
  gearMenuOpen = !gearMenuOpen;
}

export function closeGearMenu() {
  gearMenuOpen = false;
}

export function showDemoModal() {
  demoModalOpen = true;
}

export function closeDemoModal() {
  demoModalOpen = false;
}

export function showCityModal() {
  cityModalOpen = true;
}

export function closeCityModal() {
  cityModalOpen = false;
}

export function showProductivityInfoModal() {
  productivityInfoModalOpen = true;
  productivityInfoScroll = 0;
}

export function closeProductivityInfoModal() {
  productivityInfoModalOpen = false;
}

export function scrollProductivityInfoModal(delta: number, maxScroll: number) {
  productivityInfoScroll = Math.max(0, Math.min(maxScroll, productivityInfoScroll + delta));
}

import { ToolType, BUILDING_COLORS } from './types.ts';

export let activeTool: ToolType = 'addRoad';
export let selectedColor: string = BUILDING_COLORS[0];
export let selectedBuildingType: 'house' | 'factory' | 'storage' = 'house';
export let gearMenuOpen = false;

export function setActiveTool(tool: ToolType) {
  activeTool = tool;
}

export function setSelectedColor(color: string) {
  selectedColor = color;
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

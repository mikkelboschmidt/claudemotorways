import { ToolType, BUILDING_COLORS } from './types.ts';

export let activeTool: ToolType = 'addRoad';
export let selectedColor: string = BUILDING_COLORS[0];
export let selectedBuildingType: 'house' | 'factory' = 'house';

export function setActiveTool(tool: ToolType) {
  activeTool = tool;
}

export function setSelectedColor(color: string) {
  selectedColor = color;
}

export function setSelectedBuildingType(type: 'house' | 'factory') {
  selectedBuildingType = type;
}

import { track } from './analytics.ts';

type StartType = 'fresh' | 'demo-city' | 'save-restored' | 'city-loaded';

interface RunState {
  runId: string;
  startTime: number;
  startType: StartType;
  cityName: string | undefined;
  housesPlaced: number;
  factoriesPlaced: number;
  storagesPlaced: number;
  roadsPlaced: number;
  narrowRoadsPlaced: number;
  highwaysPlaced: number;
  buildingsDemolished: number;
  factoryBurnouts: number;
  peakScore: number;
  peakCars: number;
  peakProductivity: number;
  milestonesHit: Set<string>;
}

let run: RunState | null = null;

function createRun(startType: StartType, cityName?: string): RunState {
  return {
    runId: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
    startTime: Date.now(),
    startType,
    cityName,
    housesPlaced: 0,
    factoriesPlaced: 0,
    storagesPlaced: 0,
    roadsPlaced: 0,
    narrowRoadsPlaced: 0,
    highwaysPlaced: 0,
    buildingsDemolished: 0,
    factoryBurnouts: 0,
    peakScore: 0,
    peakCars: 0,
    peakProductivity: 0,
    milestonesHit: new Set(),
  };
}

export function startRun(startType: StartType, cityName?: string) {
  if (run) {
    endRun('new-run');
  }
  run = createRun(startType, cityName);
  track('run-started', {
    runId: run.runId,
    startType,
    ...(cityName ? { cityName } : {}),
  });
}

export function endRun(reason: string) {
  if (!run) return;
  const durationSeconds = Math.round((Date.now() - run.startTime) / 1000);
  const totalBuildings = run.housesPlaced + run.factoriesPlaced + run.storagesPlaced;
  const totalRoads = run.roadsPlaced + run.narrowRoadsPlaced;

  track('run-ended', {
    runId: run.runId,
    reason,
    durationSeconds,
    startType: run.startType,
    ...(run.cityName ? { cityName: run.cityName } : {}),
    finalScore: run.peakScore,
    peakCars: run.peakCars,
    peakProductivity: run.peakProductivity,
    housesPlaced: run.housesPlaced,
    factoriesPlaced: run.factoriesPlaced,
    storagesPlaced: run.storagesPlaced,
    totalBuildings,
    totalRoads,
    narrowRoads: run.narrowRoadsPlaced,
    highways: run.highwaysPlaced,
    factoryBurnouts: run.factoryBurnouts,
    buildingsDemolished: run.buildingsDemolished,
    narrowRoadRatio: totalRoads > 0 ? Math.round((run.narrowRoadsPlaced / totalRoads) * 100) : 0,
  });
  run = null;
}

function checkMilestone(milestone: string) {
  if (!run || run.milestonesHit.has(milestone)) return;
  run.milestonesHit.add(milestone);
  track('run-milestone', { runId: run.runId, milestone });
}

export function recordBuilding(type: 'house' | 'factory' | 'storage') {
  if (!run) return;
  if (type === 'house') run.housesPlaced++;
  else if (type === 'factory') run.factoriesPlaced++;
  else if (type === 'storage') run.storagesPlaced++;

  const total = run.housesPlaced + run.factoriesPlaced + run.storagesPlaced;
  if (type === 'house' && run.housesPlaced === 1) checkMilestone('first-building-house');
  if (type === 'factory' && run.factoriesPlaced === 1) checkMilestone('first-building-factory');
  if (type === 'storage' && run.storagesPlaced === 1) checkMilestone('first-building-storage');
  if (total === 5) checkMilestone('5-buildings');
  if (total === 10) checkMilestone('10-buildings');
  if (total === 20) checkMilestone('20-buildings');
}

export function recordRoad(narrow: boolean) {
  if (!run) return;
  if (narrow) {
    run.narrowRoadsPlaced++;
    if (run.narrowRoadsPlaced === 1) checkMilestone('first-road-narrow');
  } else {
    run.roadsPlaced++;
    if (run.roadsPlaced === 1) checkMilestone('first-road-normal');
  }

  const total = run.roadsPlaced + run.narrowRoadsPlaced;
  if (total === 10) checkMilestone('10-roads');
  if (total === 25) checkMilestone('25-roads');
  if (total === 50) checkMilestone('50-roads');
}

export function recordHighway() {
  if (!run) return;
  run.highwaysPlaced++;
  if (run.highwaysPlaced === 1) checkMilestone('first-road-highway');
}

export function recordRoundabout() {
  if (!run) return;
  checkMilestone('first-road-roundabout');
}

export function recordDemolish() {
  if (!run) return;
  run.buildingsDemolished++;
}

export function recordBurnout() {
  if (!run) return;
  run.factoryBurnouts++;
  if (run.factoryBurnouts === 1) checkMilestone('first-burnout');
}

export function updatePeaks(score: number, carCount: number, productivity: number) {
  if (!run) return;
  if (score > run.peakScore) run.peakScore = score;
  if (carCount > run.peakCars) run.peakCars = carCount;
  if (productivity > run.peakProductivity) run.peakProductivity = productivity;

  if (run.peakScore >= 100) checkMilestone('score-100');
  if (run.peakScore >= 500) checkMilestone('score-500');
  if (run.peakProductivity >= 5) checkMilestone('productivity-5');
  if (run.peakProductivity >= 10) checkMilestone('productivity-10');
  if (run.peakProductivity >= 20) checkMilestone('productivity-20');
  if (run.peakProductivity >= 30) checkMilestone('productivity-30');
  if (run.peakProductivity >= 50) checkMilestone('productivity-50');
  if (run.peakProductivity >= 75) checkMilestone('productivity-75');
  if (run.peakProductivity >= 100) checkMilestone('productivity-100');
  if (run.peakProductivity >= 125) checkMilestone('productivity-125');
  if (run.peakProductivity >= 150) checkMilestone('productivity-150');
  if (run.peakProductivity >= 200) checkMilestone('productivity-200');
  if (run.peakProductivity >= 300) checkMilestone('productivity-300');
  if (run.peakProductivity >= 500) checkMilestone('productivity-500');
  if (run.peakProductivity >= 1000) checkMilestone('productivity-1000');
}

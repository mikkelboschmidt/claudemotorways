# Agent Context Map

Purpose: fast orientation for Codex and Claude Code with minimal token spend.

## Runtime Call Graph (high level)

`main.ts`
- input/event wiring
- simulation scheduling
- render call

Per frame:
1. update FPS counters
2. run `simulationTick()` `gameSpeed` times unless modal blocks sim
3. call `render(ctx, width, height, preview, fps)`

Per simulation tick:
1. `tickPathfindingFrame()`
2. `updateTrafficLights()`
3. `updatePins()`
4. `spawnCars()`
5. `updateCars()`

## State Ownership

- Graph: `nodes`, `edges` in `graph.ts`
- Buildings: `buildings[]`, `buildingById`
- Vehicles: `cars[]`
- Transport systems: `highways[]`, `roundabouts[]`, `tunnels[]`, `trafficLights[]`
- UI/tool state: `toolbar.ts`
- Camera: `camera.ts`

## Most-Changed / Most-Expensive Files

- `src/renderer.ts`: largest render hot path and visual layering.
- `src/cars.ts`: largest simulation/collision/path behavior hot path.

Open these only after identifying exact subsection needed.

## Recommended Entry Points by Concern

- "Car behaves wrong": `cars.ts` -> `updateCars`, `updateCarPosition`, spawn/path helpers.
- "Wrong route": `pathfinding.ts` + car target selection helpers in `cars.ts`.
- "Tool input issue": `main.ts` + `roads.ts` + `toolbar.ts`.
- "Visual layering/overdraw": `renderer.ts`.
- "City not loading": `cities.ts` + `server/index.ts`.

## Invariants to Preserve

- Graph edges/nodes are canonicalized and shared globally.
- Save/load must preserve gameplay-critical state.
- Theme assets in `assets/*` are hand-authored and immutable.
- UI modals can pause simulation but not rendering.

## Validation Checklist

1. `npm run build` passes.
2. Manual browser check for touched gameplay flow.
3. If mechanics changed, update `PRD.md`.


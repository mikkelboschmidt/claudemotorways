# Agent Task Map

Use this to start a task with minimum token spend.

## Universal startup (all tasks)

1. Read [`START_HERE.md`](./START_HERE.md)
2. Read [`CLAUDE.md`](./CLAUDE.md)
3. Read only relevant section in [`PRD_QUICK.md`](./PRD_QUICK.md)

## Task -> Files to open first

### Rendering bug / FPS

- `src/main.ts`
- `src/renderer.ts`
- `src/rendererCulling.ts`
- `src/rendererColor.ts`
- `src/sprites.ts` (if sprite issue)

### Car behavior / traffic flow

- `src/cars.ts`
- `src/carTargeting.ts`
- `src/carParkingPaths.ts`
- `src/pathfinding.ts`
- `src/trafficLights.ts` (if intersection/signal related)

### Road placement / geometry

- `src/roads.ts`
- `src/graph.ts`
- `src/highway.ts`
- `src/roundabout.ts`
- `src/tunnel.ts`

### Buildings / pins / burnout

- `src/buildings.ts`
- `src/cars.ts`
- `src/carTargeting.ts`
- `src/constants.ts`

### Toolbar / modal / click hitboxes

- `src/main.ts`
- `src/renderer.ts`
- `src/rendererModals.ts`
- `src/toolbar.ts`

### Save/load / cities

- `src/save.ts`
- `src/cities.ts`
- `server/index.ts`

### Theme / visual style

- `src/theme.ts`
- `src/themeAssets.ts`
- `src/sprites.ts`
- `src/renderer.ts`

## Avoid reading by default

- `PRD.md` full file (use section lookup only)
- `assets/*` (art source, no code edits)
- Unrelated large files (`renderer.ts`, `cars.ts`) outside your task

## Done checklist

1. `npm run build`
2. Manual browser check for touched behavior
3. Update `PRD.md` only if mechanics or user-visible behavior changed


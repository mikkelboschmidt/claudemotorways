# Claude Motorways — Start Here (Low-Token)

Use this file first in every new agent chat.

## Fast Start (always)

1. Read [`CLAUDE.md`](./CLAUDE.md) for repository rules and architecture ownership.
2. Read only the relevant sections from [`PRD_QUICK.md`](./PRD_QUICK.md).
3. Open only domain files needed for your task.

## Task-Based Read Order

### Bug fix in gameplay logic

1. `src/main.ts` (loop/input wiring)
2. Domain file:
   - vehicles: `src/cars.ts`
   - roads/placement: `src/roads.ts`
   - intersections/signals: `src/trafficLights.ts`, `src/roundabout.ts`, `src/tunnel.ts`
3. `src/pathfinding.ts` (if route choice involved)

### Rendering/performance

1. `src/main.ts` (`gameLoop`, tick vs render cadence)
2. `src/renderer.ts`
3. Domain render dependencies: `src/sprites.ts`, `src/theme.ts`, `src/highway.ts`

### Save/load or city presets

1. `src/save.ts`
2. `src/cities.ts`
3. `server/index.ts` (city manifest API)

### Theme/art changes

1. `src/theme.ts`
2. `src/themeAssets.ts`
3. `src/sprites.ts`

## Skip List (unless needed)

- `PRD.md` full read (use `PRD_QUICK.md` first)
- `assets/*` (hand-authored art, do not edit)
- Unrelated mechanics files

## Build/Verify

```bash
npm run build
```

No automated tests exist; verify behavior in browser.

## Large Files Warning

- `src/renderer.ts` and `src/cars.ts` are the highest token sinks.
- Use their section indexes first and jump directly to the relevant region.


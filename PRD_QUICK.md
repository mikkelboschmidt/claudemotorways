# Claude Motorways — PRD Quick Reference

This is the low-token operational summary for coding agents.
`PRD.md` remains the full source of truth.

## Core Loop

- Render loop uses `requestAnimationFrame`.
- Simulation runs `gameSpeed` ticks per frame (`0/1/2/3`).
- Per tick: pathfinding frame tick, traffic lights, pin updates, spawn, car updates.

## Core Entities

- House: 1x1, spawns cars, max 2 cars per house.
- Factory: 3x2, spawns pins, can burn out at overflow, max pins 6.
- Storage: 2x2, receives truck-delivered pins, max pins 16.
- Car: house <-> factory/storage, scores +1 per pin pickup.
- Truck: storage <-> factory shuttle, capacity 6, no direct scoring.

## Roads & Transit Types

- Regular roads: 2-lane baseline.
- Narrow roads: single-lane chain lock by direction.
- Highways: bezier, preferred by pathfinding, faster travel.
- Roundabouts: 3x3, one-way ring, 8-way external connect support.
- Traffic lights: demand-driven switching at 3+ edge nodes.
- Tunnels: underground path, reduced interaction constraints.

## Routing

- Weighted Dijkstra (`findPath`).
- Edge cost includes length + congestion penalty.
- Highway and tunnel factors reduce effective path cost.

## Driving & Collision

- Lane offset + corner smoothing.
- Same-edge following, intersection reservation, traffic-light checks, lookahead braking.
- Stuck handling:
  - ~90 frames stopped: reroute in place
  - ~600 frames stopped: attempt u-turn (guarded by edge type/cooldown)

## Rendering Layers (world)

1. terrain/background
2. tunnels + tunnel cars
3. roads/roundabouts/signals
4. road cars
5. buildings/shadows/bodies
6. highway visuals + highway cars
7. previews/overlays
8. screen-space UI/modals

## Save/Load

- Auto-save to localStorage.
- JSON export/import supported.
- City presets loaded from server manifest.

## File Ownership Map

- Loop/input: `src/main.ts`
- Rendering: `src/renderer.ts`
- Vehicles/simulation: `src/cars.ts`
- Buildings/pins: `src/buildings.ts`
- Roads graph: `src/roads.ts`, `src/graph.ts`
- Pathfinding: `src/pathfinding.ts`
- Signals: `src/trafficLights.ts`
- Highways/roundabouts/tunnels: dedicated files
- Save/cities: `src/save.ts`, `src/cities.ts`, `server/index.ts`

## Agent Guardrails

- Do not edit `assets/*`.
- Prefer focused reads: only files tied to current task.
- After behavior changes, update `PRD.md` (not only this quick file).


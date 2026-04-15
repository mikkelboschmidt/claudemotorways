# Claude Motorways — Agent Instructions

## What Is This?

A logistics puzzle game rendered on an HTML canvas. Players build road networks connecting houses → factories → storage depots. Cars spawn from houses, drive to factories/storages to collect pins, and return home for points. Trucks shuttle bulk pins factory → storage. If factories overflow, they burn out (−20 pts).

**Stack**: TypeScript + Vite (client), Express (city-list API), no framework, no tests, deployed to GitHub Pages.

## Quick Start

```bash
npm install
npm run dev          # Vite dev server + Express API (respects CONDUCTOR_PORT env var)
npm run build        # TypeScript check + Vite production build
```

Verify changes by running the game in the browser — there is no test suite.

## Minimal Context Path (Read This First)

For new chats/contexts, read in this order:

1. `START_HERE.md`
2. This file (`CLAUDE.md`)
3. `PRD_QUICK.md`
4. Only then open relevant source files for the active task

Supporting context map:

- `docs/AGENT_CONTEXT.md` for runtime graph, ownership, and entry points.

Avoid opening `src/renderer.ts` and `src/cars.ts` unless your task specifically needs them.

## Architecture — File → Responsibility

| File | What it owns | Key exports |
|---|---|---|
| `main.ts` | Game loop, pointer/touch input, tool dispatch | `gameLoop()` |
| `renderer.ts` | All canvas drawing (roads, cars, buildings, UI overlays) | `render()` |
| `cars.ts` | Car/truck spawning, driving physics, parking, collision avoidance | `cars[]`, `updateCars()` |
| `buildings.ts` | Building placement, pin production, burn-out logic | `buildings[]` |
| `roads.ts` | Road edge creation/deletion, narrow road chains | `addEdge()`, `removeEdge()` |
| `highway.ts` | Highway placement, bezier curves, control handles | `highways[]` |
| `roundabout.ts` | Roundabout placement, ring nodes, 8-way connections | `roundabouts[]` |
| `tunnel.ts` | Tunnel placement, underground edges | `tunnels[]` |
| `trafficLights.ts` | Traffic light placement, demand-driven phase switching | `trafficLights[]` |
| `graph.ts` | Road graph data structure (nodes + edges) | `nodes`, `edges` |
| `pathfinding.ts` | Weighted Dijkstra, congestion penalties | `findPath()` |
| `save.ts` | localStorage auto-save, JSON export/import | `saveGame()`, `loadGame()` |
| `theme.ts` | Theme definitions (classic/lunar), color palettes | `classicTheme`, `lunarTheme` |
| `themeAssets.ts` | SVG asset loading per theme bundle | `loadThemeAssets()` |
| `sprites.ts` | SVG sprite rendering with programmatic color replacement | `drawBuilding()` |
| `toolbar.ts` | Floating toolbar layout and hit-testing | `drawToolbar()` |
| `camera.ts` | Pan/zoom, screen↔world coordinate transforms | `camera` |
| `score.ts` | Score tracking | `score` |
| `speed.ts` | Game speed multiplier (pause/1×/2×/3×) | `speed` |
| `analytics.ts` | PostHog event tracking (run lifecycle, milestones) | `trackMilestone()` |
| `run.ts` | Run session management (start/end/summary) | `startRun()`, `endRun()` |
| `cities.ts` | City preset loading from manifest | `loadCity()` |
| `music.ts` / `sfx.ts` | Audio | — |
| `types.ts` | Shared interfaces: `Building`, `Car`, `Edge`, `GraphNode`, etc. | — |
| `constants.ts` | Grid size, speeds, thresholds | `GRID`, `GRID_DIAG` |
| `server/index.ts` | Express API serving city list (`/api/cities`) on CONDUCTOR_PORT+1 | — |

Game state lives in module-level arrays/maps (e.g. `buildings[]`, `cars[]`, `edges`) — there is no central store.

## Key Conventions

- **SVG assets are hand-crafted** — never modify files in `assets/`. The user handles all sprite artwork.
- Source is organized by domain: one file per game system, named for what it manages.
- Two theme asset bundles: `assets/EarthTheme/` and `assets/SpaceTheme/`.
- Deployed to GitHub Pages at `loomways.com` (password-gated) and `mineloops.com` (public).

## PRD — When and How to Read It

`PRD.md` is the authoritative spec for all game mechanics, UI, analytics, and deployment. **Read only the sections relevant to your task**, not the whole document. The PRD has a table of contents — use it to jump to what you need.

Use `PRD_QUICK.md` first for low-token orientation, then open `PRD.md` sections only as needed.

| If your task involves… | Read these PRD sections |
|---|---|
| Buildings, pins, burn-out | Buildings, Scoring |
| Road types, placement | Roads |
| Cars, trucks, driving | Vehicles, Driving Physics, Collision Avoidance |
| Routing, congestion | Pathfinding |
| Save/load, city presets | Save / Load, City Presets |
| UI, toolbar, gear menu | Toolbar |
| Themes, colors, rendering | Theme System, Visual Layers |
| Analytics, PostHog | Analytics |
| Deployment, domains | Deployment |

After implementing any user-facing feature or behavioral change, **update `PRD.md`** to reflect the change. Match the existing style: concise technical prose, specific numbers, markdown tables.

## Analytics

Run `/posthog-checkup` to get a 7-day PostHog report: DAUs, domain split, geography, progress funnel with conversion rates, and game-specific recommendations.

# Claude Motorways — Product Requirements Document

A logistics puzzle game where players build road networks connecting residential houses to factories and storage depots. Cars spawn from houses, drive to factories to collect pins, and return home for points. Trucks shuttle bulk pins from factories to storage buildings. If factories overflow, they burn out.

---

## Buildings

### House (1×1 tile)

- Residential building that spawns cars.
- **Entrance**: Auto-orients toward the nearest road on placement. Can be changed by dragging a road directly to/from the house.
- **Car limit**: Up to 2 cars per house on the map at once.
- **Parking**: Cars return home after collecting a pin, park for ~2s (120 frames), then head out again.
- **Connection**: The road node sits ON the house tile. Dragging a road onto the house sets the entrance side based on drag direction. Changing the entrance side preserves existing road edges.
- **Cannot be disabled.**

### Factory (3×2 tiles)

- Produces pins over time. Cars and trucks visit to collect them.
- **Entrance**: Supports all 4 sides. Auto-orients toward the nearest road on placement (like storage/houses). Can be changed by dragging a road directly to/from the factory. For `top`/`bottom` entrances, the connection point is right-aligned (rightmost tile) rather than centered.
- **Pin spawning**: Every ~15s (900 frames), the factory produces one pin if below capacity.
- **Pin cooldown**: A freshly spawned pin cannot be picked up for ~1s (60 frames).
- **Capacity**: 6 pins, 3 parking slots.
- **Donut indicator**: Pin count is displayed as a single donut (circle with variable stroke width). Empty = thin ring, full = solid disc. Each pin adds 1/6 of the fill. New pin steps animate in with a fade. The donut replaces the earlier dot grid.
- **Overflow / Burn-out**: If the factory is at max pins when a new pin would spawn, it **burns out** — all pins are lost, all parked cars are evicted, and the player loses 20 points. The building turns gray and stops producing. A burned-out factory can be demolished or replaced by placing a new building on top.
- **Parking layout**: Cars enter along a driving lane on one side, then pull into parking slots via cubic bezier curves. Slot 0 is nearest the entrance, slot 2 is deepest. Departure order is FIFO (earliest parked car leaves first). Only one car may be mid-animation (parking, collecting, or departing) at a time.
- **Truck exclusivity**: A truck can only enter a factory with a completely empty parking lot. While a truck is inside, regular cars are blocked from entering.

### Storage (2×2 tiles)

- Bulk pin buffer between factories and houses. Does not produce pins.
- **Entrance**: Auto-orients toward the nearest road, same as houses. Fixed after placement.
- **Capacity**: 16 pins, 1 parking slot (truck only for delivery; regular cars also park to collect).
- **Donut indicator**: Same as factory — a single donut whose stroke width represents fill level (each pin = 1/16 of fill).
- **Receives pins from trucks**: A truck arrives, deposits all carried pins (capped at storage max).
- **Serves regular cars**: Cars can collect pins from storage the same way they collect from factories (+1 score per pin).
- **Cannot be disabled.**

### Building Placement Rules

- Buildings cannot overlap. Buildings cannot be placed on tiles that contain road segments. Disabled (burned) buildings can be replaced — placing a new building on a burned-out one removes the old building but preserves its road edges.
- All building types auto-orient their entrance toward the nearest adjacent road node. If no road is nearby, they default to `right`.
- All building types come in 5 colors: rust (`#e06040`), cyan (`#4aa8d8`), mint (`#50d890`), amber (`#d4a030`), violet (`#b060d0`). Cars, trucks, and buildings are color-matched — a rust car only visits rust factories/storages.

---

## Roads

### Regular Road

- **Width**: 30px visual, two lanes (15px each).
- **Speed**: 1.5 px/frame.
- **Placement**: Click-and-drag between grid intersections. Supports 8 directions (horizontal, vertical, 4 diagonals). The path is decomposed into tile-to-tile edge segments.
- **Visual**: Theme-dependent. Classic: solid dark surface with white dashed center line. Lunar: two parallel cyan track rails (`#4CFFF9`, 2px each).

### Narrow Road

- **Width**: 18px visual, single lane.
- **Speed**: ~1.05 px/frame (70% of regular).
- **One-way chain**: Connected narrow edges form a chain. Only one direction of travel is allowed at a time across the entire chain. A car entering from one end blocks entry from the opposite end. Per-frame locking prevents race conditions.
- **Transition**: Cars approaching a narrow road from a regular road brake smoothly and steer into the center lane over a 15px blend zone.

### Highway

- **Width**: 36px visual (regular + 6px).
- **Speed**: 2.25 px/frame (150% of regular). Trucks get 1.3× their base speed on highways.
- **Placement**: Two-click placement (start node, then end node, both must be on existing roads, ≥3 tiles apart). Creates a cubic bezier curve between them.
- **Control handles**: After placement, two draggable handles at t≈1/3 and t≈2/3 along the curve allow precise shaping of the highway path.
- **Visual**: Elevated look with shadow, lavender surface (`#6a6a8a`), cyan dashed center line (`#6ab0c0`).
- **Pathfinding bonus**: Highways are weighted at 0.65× cost, making them strongly preferred routes.

### Roundabout (3×3 tiles)

- **Size**: Occupies a 3×3 tile area on the grid.
- **Placement**: Single click places the roundabout centered on the clicked tile. All 9 tiles must be clear of buildings, other roundabouts, and road nodes (except at the 4 cardinal ring node positions).
- **Ring nodes**: 8 nodes spaced at 45° intervals around a circular arc (radius = GRID). 4 cardinal nodes at integer grid positions — E (gx+2, gy+1), S (gx+1, gy+2), W (gx, gy+1), N (gx+1, gy) — and 4 diagonal nodes at synthetic positions (SE, SW, NW, NE).
- **8-way connections**: External roads can connect to any of the 8 ring nodes. When dragging a road to or from a roundabout tile, the system auto-detects the best of 8 connection points (every 45°) based on approach angle. A connecting edge bridges from the nearest road tile outside the roundabout to the chosen ring node. Roads that stop just outside a roundabout (because interior segments are blocked) also auto-connect if the next tile along the drag direction is inside the roundabout's 3×3 area. Roads cannot be placed through the roundabout's interior tiles.
- **Traffic flow**: One-way counter-clockwise. All 8 ring edges have a `oneway` constraint. Each arc segment is ~48.3px.
- **Visual**: Theme-dependent. Classic: solid annulus with island and dashed center line. Lunar: two concentric cyan track circles (inner + outer rails).
- **Demolish**: Click on the roundabout with the demolish tool to remove it as a whole unit. Drag-removal of road tiles does not break roundabout ring edges.
- **Persistence**: Saved as `{ gx, gy }` positions plus connection edges `{ outerGx, outerGy, ringIndex }`. Ring edges are recreated on load; connection edges are restored separately.

### Traffic Light

- **Placement**: Click on any intersection node (3+ connected edges) with the traffic light tool. Clicking an existing traffic light removes it. Can also be removed with the demolish tool.
- **Behavior**: Demand-driven switching with a ~6s max green phase (360 frames). When the timer expires, the light only switches if cars are waiting on the blocked axis (within braking range of the intersection). If no one is waiting, the current green holds indefinitely. Standard intersections alternate N/S vs E/W (classified by `|dy| >= |dx|`). All-diagonal intersections (every meeting edge is 45°) alternate NE/SW vs NW/SE instead.
- **Diagonal detection**: Recomputed each tick. If ALL edges at the node are diagonal (`dx !== 0 && dy !== 0`), the traffic light uses diagonal axes and the visual rotates 45°. If even one edge is cardinal, standard orientation is used.
- **Car interaction**: Cars approaching a red light brake smoothly to a stop before the intersection, using the same distance thresholds as intersection reservation (46px range, 18px stop distance). The traffic light check runs after intersection reservation but before cross-edge lookahead.
- **Auto-removal**: If the underlying road node is removed or drops below 3 edges, the traffic light is automatically cleaned up.
- **Visual (Earth)**: A dark rounded square at the intersection center with 4 colored dots. Green dots indicate the active axis; red dots indicate the stopped axis. Rotates 45° for all-diagonal intersections.
- **Visual (Space)**: A dark circle with two double-ended arrows. The green axis arrow is cyan (`#4CFFF9`), the blocked axis arrow is the road color at 10% opacity (barely visible). Rotates 45° for diagonal intersections.
- **Persistence**: Saved as `{ gx, gy }` positions. Timer state and diagonal flag are not saved — recomputed on load.
- **Space theme label**: "Signal Node".

### Road–Building Connections

- **Houses**: The connection tile is the house tile itself. Dragging a road onto a house automatically connects it. The drag direction determines which side becomes the entrance (drag right → right entrance, etc.). Only pure horizontal/vertical drags are matched.
- **Factories**: Dragging a road onto a factory tile sets the entrance side based on drag direction (all 4 sides). The connection tile is the tile **adjacent** to the building on its entrance side. For `top`/`bottom`, the connection tile is right-aligned (rightmost column) rather than centered.
- **Storage**: Dragging a road onto a storage tile sets the entrance side based on drag direction (all 4 sides). The connection tile is the tile **adjacent** to the building on its entrance side.

---

## Vehicles

### Car

- **Size**: 16×10 px.
- **Speed**: 1.5 px/frame base, 0.04 acceleration, 0.06 deceleration.
- **Spawning**: One spawn check every ~3s (180 frames). Each house can have up to 2 cars on the map. Cars are created heading toward the best available pin source (factory or storage of the same color), weighted by pin need and distance.
- **Cargo marker**: After a car picks up a pin from a factory or storage, it shows a filled white circle on its roof until it finishes parking back at its house.
- **Rotation**: Cars and trucks render rotated around their visual center rather than around the rear axle.
- **Lifecycle**:
  1. Spawn at house → drive to factory/storage (`toWork`)
  2. Park at factory/storage → collect 1 pin (animated fly from building to car, ~30 frames)
  3. Depart → drive home (`toHome`)
  4. Park at house for ~2s
  5. Repeat
- **Scoring**: +1 point each time a car collects a pin.
- **Stuck reroute**: If a car is stopped for 90 frames (~1.5s), it replans its path in place via Dijkstra, potentially switching to a different factory. The car stays on its current edge — only the path ahead changes.
- **U-turn**: If a car remains stopped for 600 frames (~10s, configurable via `UTURN_STUCK_THRESHOLD`), it performs a u-turn — reversing direction on its current edge and replanning from the node behind it. The car smoothly rotates 180° and switches to the opposite lane. U-turns are blocked on narrow roads, one-way edges, highways, and roundabouts. A 300-frame cooldown (`UTURN_COOLDOWN`) prevents rapid successive u-turns, and a car cannot u-turn twice on the same edge.

### Truck

- **Size**: 22×12 px.
- **Speed**: 1.2 px/frame base (80% of car speed). 1.56 px/frame on highways.
- **Capacity**: 6 pins per load (one full factory).
- **Spawning**: One spawn check every ~5s (300 frames). Each storage building has exactly 1 truck. The truck heads to the factory with the highest pin need.
- **Lifecycle**:
  1. Spawn at storage → drive to factory (`toFactory`)
  2. Wait for empty parking lot, then park
  3. Collect pins one at a time (each with fly animation), wait until carrying 6 or factory burns out
  4. Depart → drive to storage (`toStorage`)
  5. Park at storage → deposit all carried pins instantly
  6. Depart → repeat
- **Factory exclusivity**: Trucks require an empty factory parking lot. Regular cars cannot enter while a truck is inside.
- **No scoring**: Truck pin transfers don't award points — only final car pickups score.
- **Visual**: Darker body with a lighter cab at front. Carried pins shown as colored dots on the cargo bed.

---

## Driving Physics

### Lane Tracking

Cars drive on the right side of two-lane roads, offset by half a lane width (7.5px) from the road center. On narrow roads, cars drive on the center line (0 offset). When transitioning between road types, the lane offset blends smoothly over 15px, and the car's heading tilts slightly to simulate steering into the lane change.

### Corner Smoothing

At road junctions, cars follow a quadratic bezier arc instead of making sharp turns:
- The smoothing zone extends 15px on each side of the junction node.
- Three control points: P0 (on current edge, lane-offset), P1 (junction node, averaged lane offset), P2 (on next edge, lane-offset).
- The car's heading follows the bezier tangent through the curve.

### Corner Braking

Cars slow down before turns proportional to the angle change:
- 90°+ turns: brake to 0.35 px/frame.
- 45° turns: brake to ~0.8 px/frame.
- Braking starts 30px before the junction, blended by proximity.

### Parking Animations

All parking and departing uses cubic bezier curves. The car's angle follows the bezier tangent directly (no lerp lag). Factory parking slots are arranged along one side of the building with a driving lane on the other. House parking pulls the car straight into the building center on the entry lane side.

---

## Collision Avoidance

Six checks run every frame, in order:

1. **Same-edge gap following**: Cars on the same edge in the same direction maintain a minimum gap of 26px (10px gap + 16px car length). Within 42px, they gradually brake.
2. **Intersection reservation**: At true intersections (3+ edges), the closest car claims the node. Other cars from different edges yield.
3. **Yield braking**: Cars that don't own the intersection brake smoothly over 46px to a stop 18px before the node.
4. **Traffic light**: Cars approaching a red traffic light brake smoothly to a stop before the intersection, same distance thresholds as yield braking.
5. **Cross-edge lookahead**: Check the next 2 edges for traffic. If the next edge entry is blocked, brake to 15% speed. If 2 edges ahead is congested, brake to 60%. Also handles narrow-road one-way blocking.
6. **Corner braking**: Angle-based speed limit approaching turns (see above).

Target speeds are applied via smooth acceleration/deceleration each frame.

---

## Pathfinding

Weighted Dijkstra shortest path on the road graph.

- **Edge weight** = `length × highwayFactor × (1 + congestionPenalty)`
- **Highway factor**: 0.65 (strongly preferred).
- **Congestion**: Counts stopped cars (speed ≤ 0.1) and moving cars on each edge. Density = count / (length / 40). Penalty = 1.8^density - 1 (exponential).
- **Car routing**: Regular cars use `pickBestPinSource()` which scores all reachable factories and storages by `need × 10 - pathLength`, where need = available pins minus cars already heading there.
- **Truck routing**: Uses `pickBestFactory()` with the same scoring formula but only considers factories.

---

## Scoring

| Event | Points |
|---|---|
| Car collects a pin from factory or storage | +1 |
| Factory burns out (pin overflow) | -20 |

Truck pin transfers (factory → storage) do not score.

---

## Game Speed

Four speed settings: Pause (0×), Normal (1×), Fast (2×), Turbo (3×). The game loop runs physics ticks N times per render frame based on the multiplier. Pause freezes simulation but allows building.

---

## Save / Load

The game auto-saves to `localStorage` every 5 seconds and after every build action. The active theme selection is stored separately in `localStorage`. Saved data includes:
- All buildings (type, position, color, pins, disabled state, connection side)
- All road edges (coordinates, narrow flag)
- All highways (start, end, two control points)
- All roundabouts (grid position) and their connection edges (outer tile, ring index)
- All traffic lights (grid position)
- Score and next building ID

Cars and trucks are not saved — they respawn naturally after load.

### Download / Upload

The player can export the current city as a JSON file via the gear menu's **Save City** button (downloads `loomways-city.json`). The **Load City** button opens a file picker to import a previously exported city; score resets to 0 on import.

---

## Splash Screen

A canvas-rendered modal shown on first visit (no `localStorage` save data). The game simulation pauses while the modal is open; rendering continues so the UI stays responsive.

| Property | Value |
|---|---|
| Splash image | Theme-specific `assets/EarthTheme/splashscreen.png` or `assets/SpaceTheme/splashscreen.png` — branded "LoomWays" artwork with tagline "Connect. Collect. Construct." |
| Modal size | `min(70% viewport width, 80% viewport height)`, centered |
| Overlay | Semi-transparent black (`rgba(0,0,0,0.5)`) covering full canvas |
| Background | Dark rounded rectangle (14 px radius) with drop shadow |
| Image clipping | Splash image fills modal area, clipped to the rounded rectangle |
| Bottom gradient | 100 px fade from transparent to `rgba(0,0,0,0.65)` over the image bottom |
| Close button | White ✕ circle, top-right corner of modal |

### Buttons (overlaid on splash image, bottom-center)

| Button | Color | Action |
|---|---|---|
| **Demo City** | Orange `rgba(232,126,35,0.92)` | Closes modal, loads `simple-city.json` preset |
| **Start Fresh** | Green `rgba(46,139,87,0.88)` | Closes modal, initialises empty map, saves game |

Each button is 130 × 36 px with a 10 px border radius, white 2 px outline and white centered text. The two buttons sit side-by-side with a 12 px gap, 16 px above the modal bottom edge.

---

## City Presets

Pre-built demo cities are stored as JSON files in `public/cities/`, listed in `cities/manifest.json` (array of `{ name, file }` entries).

- **Gear menu selector**: All preset cities from the manifest appear as buttons in the gear menu. Clicking one loads that city (score resets to 0).
- Adding a new preset: place the `.json` save file in `public/cities/` and add an entry to `manifest.json`.

---

## Toolbar

Floating circular buttons (44px diameter) arranged in a vertical column on the left edge of the screen, vertically centered. The game renders full-screen with no fixed toolbar bar — all UI overlays the game canvas.

### Left Column (top to bottom)

| Icon | Tool | Description |
|---|---|---|
| Road SVG | `addRoad` | Drag to place two-lane roads |
| Narrow SVG | `addNarrow` | Drag to place single-lane roads |
| Highway SVG | `addHighway` | Two-click placement + two draggable control handles |
| Roundabout SVG | `addRoundabout` | Click to place a 3×3 roundabout centered on the clicked tile |
| **Color SVG** | — | Shows the selected building color via `CurrentColor` layer. Tap to cycle to the next color |
| House SVG | `addBuilding` (house) | Place a house |
| Factory SVG | `addBuilding` (factory) | Place a factory |
| Storage SVG | `addBuilding` (storage) | Place a storage depot |
| Traffic Light icon | `addTrafficLight` | Click an intersection (3+ edges) to toggle a traffic light |
| Demolish SVG | `demolish` | Tap a building/roundabout to remove it, or drag across road tiles to delete edges/highways |

- All toolbar icons are loaded from the active theme asset bundle (`assets/EarthTheme/` or `assets/SpaceTheme/`) and rendered onto the canvas. SVGs with a layer `id="CurrentColor"` have their fill dynamically replaced with the selected building color.
- The active tool has a black background with a white ring outline; inactive tools use a semi-transparent dark background (`rgba(44, 62, 80, 0.85)`).

### Gear Menu (bottom-right)

A gear button (48px diameter) sits in the bottom-right corner. Tapping it opens a popup menu above the button containing:

1. **FPS counter** — color-coded: green (≥50), yellow (≥30), red (<30).
2. **Speed controls** — row of buttons: ⏸ 1× 2× 3×.
3. **Music toggle** — On/Off button.
4. **Theme switcher** — segmented `Earth` / `Space` buttons. Switching themes swaps both the UI color palette and the active asset bundle, and remaps existing building/vehicle colors by palette index so the current city updates immediately.
5. **Reset button** — dark red, reloads the game and clears save data.
6. **Save City** — downloads the current game state as a `.json` file (`loomways-city.json`).
7. **Load City** — opens a file picker to upload a previously saved `.json` city file. Score resets to 0 on load.
8. **City selector** — lists all preset cities from `cities/manifest.json`. Clicking a city loads it (score resets to 0).

Tapping anywhere outside the menu closes it.

---

## Touch & Mobile Support

The game is fully playable on touch devices. The canvas uses pointer events for tool interactions and touch events for multi-finger gestures.

- **Single finger**: Operates the active tool (place roads, place buildings, etc.) — same as mouse click/drag. Highway control handles use a screen-space hit radius (22px) so they remain easy to tap at any zoom level.
- **Two-finger pinch**: Zoom in/out. Any in-progress road drag or highway placement is cancelled when a second finger touches down.
- **Two-finger pan**: Drag the camera with two fingers.
- **Tool/UI taps**: Tapping floating toolbar buttons and gear menu items works via `pointerdown` hit-testing against the button layout.

---

## Analytics (Run-Based)

All analytics are sent to PostHog (anonymous, no user identification). Tracking is organised around **runs** — a run begins when the player starts or loads a game and ends when they reset, load a different city, close the browser, or background the tab.

### Run Lifecycle

A run ends (`run-ended`) on any of the following triggers:

| Reason | Source |
|---|---|
| `reset` | Player clicks Reset in the gear menu |
| `new-run` | `startRun()` called while a run is already active (e.g. loading a city) |
| `browser-close` | `beforeunload` event |
| `tab-hidden` | `visibilitychange` → `hidden` (reliable on mobile) |

When a hidden tab becomes visible again, a new run starts with `startType: save-restored`.

### Events

| Event | Trigger | Key Properties |
|---|---|---|
| `run-started` | New/loaded game begins | `runId`, `startType` (`fresh`, `demo-city`, `save-restored`, `city-loaded`), `cityName` |
| `run-milestone` | First-time threshold crossed in a run | `runId`, `milestone` |
| `run-ended` | Run concludes | `runId`, `reason`, `durationSeconds`, `startType`, full summary (see below) |

### Run Summary (`run-ended` properties)

`finalScore`, `peakCars`, `housesPlaced`, `factoriesPlaced`, `storagesPlaced`, `totalBuildings`, `totalRoads`, `narrowRoads`, `highways`, `factoryBurnouts`, `buildingsDemolished`, `narrowRoadRatio`.

### Milestones

Milestones use consistent `first-building-*` and `first-road-*` prefixes for easy PostHog filtering.

`first-building-house`, `first-building-factory`, `first-building-storage`, `first-road-normal`, `first-road-narrow`, `first-road-highway`, `first-road-roundabout`, `first-burnout`, `5-buildings`, `10-buildings`, `20-buildings`, `10-roads`, `25-roads`, `50-roads`, `score-100`, `score-500`.

### Design Principles

- **Track decisions, not noise** — building/road placements are counted per run, not fired as individual events.
- **Summarise each run** — the `run-ended` event is the primary data source for comparing player strategies.
- **Milestones mark progression** — sparse events that show how a run evolves over time.
- **Mobile-reliable end detection** — `visibilitychange` is preferred over `beforeunload` for capturing run-end on iOS/Android.

### PostHog Dashboard Widgets

#### Engagement & Retention
| Widget | Type | Query |
|---|---|---|
| Daily/weekly active players | Trend | Unique users firing `run-started` |
| Runs per day | Trend | Total `run-started` count |
| Session start type breakdown | Pie | `run-started` by `startType` |
| Return rate | Retention | Users who fired `run-started` → fired `run-started` again |

#### Run Quality (from `run-ended`)
| Widget | Type | Query |
|---|---|---|
| Median run duration | Trend | `durationSeconds` (median) over time |
| Run duration distribution | Histogram | `durationSeconds` bucketed |
| Average final score | Trend | `finalScore` (mean) over time |
| Score distribution | Histogram | `finalScore` bucketed |
| Peak cars per run | Trend | `peakCars` (mean/p90) |
| Buildings per run | Stacked bar | `housesPlaced`, `factoriesPlaced`, `storagesPlaced` averages |
| Narrow road ratio | Trend | `narrowRoadRatio` average |
| Highway adoption | Trend | % of runs with `highways > 0` |
| Burnout rate | Trend | `factoryBurnouts` (mean per run) |
| Run end reasons | Pie | `run-ended` by `reason` |

#### Player Progression (from `run-milestone`)
| Widget | Type | Query |
|---|---|---|
| Milestone funnel | Funnel | `first-building-house` → `first-building-factory` → `first-building-storage` → `first-road-highway` → `score-100` → `score-500` |
| Milestone reach rates | Bar | % of runs hitting each milestone |
| Road type discovery | Bar | % of runs hitting each `first-road-*` milestone |

#### Start Type Comparison
| Widget | Type | Query |
|---|---|---|
| Score by start type | Bar | `finalScore` average by `startType` |
| Duration by start type | Bar | `durationSeconds` by `startType` |
| Demo → Fresh conversion | Funnel | `run-started` with `demo-city` → later `run-started` with `fresh` |

---

## Theme System

All colors are defined in `src/theme.ts` via the `GameTheme` interface. Two themes ship out of the box:

| Theme | Key | Description |
|---|---|---|
| Classic | `classicTheme` | Original green motorways look (`#4a7c59` terrain, solid gray roads) |
| Lunar | `lunarTheme` | Planet mining aesthetic (active by default) |

Switch themes by calling `setTheme(classicTheme)` or `setTheme(lunarTheme)`.

### Runtime Theme Switching

- The gear menu exposes `Earth` and `Space` theme buttons.
- Switching themes updates the active palette and asset bundle immediately.
- Existing buildings and vehicles are recolored by palette index so an in-progress city flips coherently between themes.
- Loaded saves and imported cities normalize their stored building colors to the currently active theme palette on load.

### Theme Asset Bundles

- **Earth theme assets** live in `assets/EarthTheme/` and pair with the classic palette.
- **Space theme assets** live in `assets/SpaceTheme/` and pair with the lunar palette.
- Each bundle includes the splash image, toolbar SVG icons, and all house/factory/storage sprites.

### Road Rendering Styles

The theme controls how roads are drawn via `roadStyle`:

- **`solid`** (classic) — Filled road surface with dashed white center lines and round node joints.
- **`tracks`** (lunar) — Two parallel rail lines per lane, each `trackWidth` px wide in `trackColor`. No filled road surface or dashed center lines. Roundabouts draw two concentric track circles instead of a filled annulus.

### Lunar Theme Colors

| Element | Color | Hex |
|---|---|---|
| Background (terrain) | Dusty brown | `#59412F` |
| Page background | Dark brown | `#1a0e08` |
| Track rails | Bright cyan | `#4CFFF9` |
| Track width | — | 2 px per rail |
| Highway center line | Bright cyan | `#4CFFF9` |
| Grid lines | Very faint white | `rgba(255,255,255,0.03)` |
| UI panels | Near-black | `rgba(15,15,30,0.95)` |
| Disabled buildings | Muted dark | `#3a3a50` |

Building colors are high-contrast neon tones that pop against the dark background: pink `#FF009D`, yellow `#FFD428`, blue `#2A7BFF`, lime `#A1FF00`, and pale peach `#FFE7D3`. Fallback building renderers use `darkenColor()` for backgrounds (not `lightenColor()`) to maintain the dark palette.

---

## Deployment

The game is deployed to **GitHub Pages** with the custom domain **loomways.com**. The `public/CNAME` file maps the GitHub Pages site to `loomways.com`. Deployment is automated via a GitHub Actions workflow on push to `main`.

---

## Visual Layers (Render Order)

1. **Background**: Theme terrain fill (lunar: dusty brown `#59412F`, classic: green `#4a7c59`) with very faint grid lines.
2. **Building grounds**: SVG ground layer (driveways, pads) drawn below roads.
3. **Roads**: Regular → narrow → highway. Solid surfaces + dashes (classic) or parallel track rails (lunar).
4. **Road preview / hover ghost**: Shown during placement.
5. **Cars and trucks**: All vehicles.
6. **Building shadows**: SVG shadow layer drawn above vehicles.
7. **Building bodies**: SVG building layer drawn on top. Donut fill indicators rendered over buildings.
8. **Collecting pin animations**: Flying pin dots from building to car.
9. **UI**: Score display and toolbar (screen-space, not affected by camera).

Buildings use an SVG sprite system with programmatic color replacement. Each SVG has three layer groups (`Ground`, `Shadows`, `Building`) filtered by hiding non-target groups. Colors are replaced by matching element IDs (`RoofMain` → building color, `RoofShadow` → darkened variant). Disabled buildings render in muted dark (`#3a3a50`).

**SVG assets are manually authored and must never be modified programmatically.** All SVG files in `assets/` are hand-crafted — changes to sprites should be made by the designer, not by code or automation.

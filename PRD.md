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
- **Entrance**: Supports `left` and `right` sides only. Auto-orients toward the nearest road on placement (like storage/houses). Can be changed by dragging a road directly to/from the factory.
- **Pin spawning**: Every ~15s (900 frames), the factory produces one pin if below capacity.
- **Pin cooldown**: A freshly spawned pin cannot be picked up for ~1s (60 frames).
- **Capacity**: 6 pins, 3 parking slots.
- **Overflow / Burn-out**: If the factory is at max pins when a new pin would spawn, it **burns out** — all pins are lost, all parked cars are evicted, and the player loses 20 points. The building turns gray and stops producing. A burned-out factory can be demolished or replaced by placing a new building on top.
- **Parking layout**: Cars enter along a driving lane on one side, then pull into parking slots via cubic bezier curves. Slot 0 is nearest the entrance, slot 2 is deepest. Departure order is FIFO (earliest parked car leaves first). Only one car may be mid-animation (parking, collecting, or departing) at a time.
- **Truck exclusivity**: A truck can only enter a factory with a completely empty parking lot. While a truck is inside, regular cars are blocked from entering.

### Storage (2×2 tiles)

- Bulk pin buffer between factories and houses. Does not produce pins.
- **Entrance**: Auto-orients toward the nearest road, same as houses. Fixed after placement.
- **Capacity**: 18 pins, 1 parking slot (truck only for delivery; regular cars also park to collect).
- **Receives pins from trucks**: A truck arrives, deposits all carried pins (capped at storage max).
- **Serves regular cars**: Cars can collect pins from storage the same way they collect from factories (+1 score per pin).
- **Cannot be disabled.**

### Building Placement Rules

- Buildings cannot overlap. Buildings cannot be placed on tiles that contain road segments. Disabled (burned) buildings can be replaced — placing a new building on a burned-out one removes the old building but preserves its road edges.
- All building types auto-orient their entrance toward the nearest adjacent road node. If no road is nearby, they default to `right`. Factories only support `left` and `right` entrances.
- All building types come in 5 colors: red (`#e74c3c`), blue (`#3498db`), green (`#2ecc71`), orange (`#f39c12`), purple (`#9b59b6`). Cars, trucks, and buildings are color-matched — a red car only visits red factories/storages.

---

## Roads

### Regular Road

- **Width**: 30px visual, two lanes (15px each).
- **Speed**: 1.5 px/frame.
- **Placement**: Click-and-drag between grid intersections. Supports 8 directions (horizontal, vertical, 4 diagonals). The path is decomposed into tile-to-tile edge segments.
- **Visual**: Dark gray surface with white dashed center line.

### Narrow Road

- **Width**: 18px visual, single lane.
- **Speed**: ~1.05 px/frame (70% of regular).
- **One-way chain**: Connected narrow edges form a chain. Only one direction of travel is allowed at a time across the entire chain. A car entering from one end blocks entry from the opposite end. Per-frame locking prevents race conditions.
- **Transition**: Cars approaching a narrow road from a regular road brake smoothly and steer into the center lane over a 15px blend zone.

### Highway

- **Width**: 36px visual (regular + 6px).
- **Speed**: 2.25 px/frame (150% of regular). Trucks get 1.3× their base speed on highways.
- **Placement**: Two-click placement (start node, then end node, both must be on existing roads, ≥3 tiles apart). Creates a cubic bezier curve between them.
- **Midpoint handle**: After placement, the highway's midpoint can be dragged to adjust the curve shape.
- **Visual**: Elevated look with shadow, gray surface (#666), yellow dashed center line.
- **Pathfinding bonus**: Highways are weighted at 0.65× cost, making them strongly preferred routes.

### Road–Building Connections

- **Houses**: The connection tile is the house tile itself. Dragging a road onto a house automatically connects it. The drag direction determines which side becomes the entrance (drag right → right entrance, etc.). Only pure horizontal/vertical drags are matched.
- **Factories**: Dragging a road onto a factory tile sets the entrance side based on drag direction (left/right only). The connection tile is the tile **adjacent** to the building on its entrance side.
- **Storage**: Dragging a road onto a storage tile sets the entrance side based on drag direction (all 4 sides). The connection tile is the tile **adjacent** to the building on its entrance side.

---

## Vehicles

### Car

- **Size**: 16×10 px.
- **Speed**: 1.5 px/frame base, 0.04 acceleration, 0.06 deceleration.
- **Spawning**: One spawn check every ~3s (180 frames). Each house can have up to 2 cars on the map. Cars are created heading toward the best available pin source (factory or storage of the same color), weighted by pin need and distance.
- **Lifecycle**:
  1. Spawn at house → drive to factory/storage (`toWork`)
  2. Park at factory/storage → collect 1 pin (animated fly from building to car, ~30 frames)
  3. Depart → drive home (`toHome`)
  4. Park at house for ~2s
  5. Repeat
- **Scoring**: +1 point each time a car collects a pin.
- **Stuck reroute**: If a car is stopped for >90 frames, it recalculates its path via Dijkstra, potentially switching to a different factory.

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

Five checks run every frame, in order:

1. **Same-edge gap following**: Cars on the same edge in the same direction maintain a minimum gap of 26px (10px gap + 16px car length). Within 42px, they gradually brake.
2. **Intersection reservation**: At true intersections (3+ edges), the closest car claims the node. Other cars from different edges yield.
3. **Yield braking**: Cars that don't own the intersection brake smoothly over 46px to a stop 18px before the node.
4. **Cross-edge lookahead**: Check the next 2 edges for traffic. If the next edge entry is blocked, brake to 15% speed. If 2 edges ahead is congested, brake to 60%. Also handles narrow-road one-way blocking.
5. **Corner braking**: Angle-based speed limit approaching turns (see above).

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

The game auto-saves to `localStorage` every 5 seconds and after every build action. Saved data includes:
- All buildings (type, position, color, pins, disabled state, connection side)
- All road edges (coordinates, narrow flag)
- All highways (start, end, midpoint)
- Score and next building ID

Cars and trucks are not saved — they respawn naturally after load.

### Download / Upload

The player can export the current city as a JSON file via the gear menu's **Save City** button (downloads `loomways-city.json`). The **Load City** button opens a file picker to import a previously exported city; score resets to 0 on import.

---

## Splash Screen

A canvas-rendered modal shown on first visit (no `localStorage` save data). The game simulation pauses while the modal is open; rendering continues so the UI stays responsive.

| Property | Value |
|---|---|
| Splash image | `assets/splashscreen.png` — branded "LoomWays" artwork with tagline "Connect. Collect. Construct." |
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
| Road lines | `addRoad` | Drag to place two-lane roads |
| Narrow line | `addNarrow` | Drag to place single-lane roads |
| Highway lines | `addHighway` | Two-click placement + draggable midpoint |
| X cross | `removeRoad` | Drag across road tiles to delete edges |
| **Color circle** | — | Filled circle showing the selected building color. Tap to cycle to the next color |
| House icon | `addBuilding` (house) | Place a house |
| Factory icon | `addBuilding` (factory) | Place a factory |
| Storage icon | `addBuilding` (storage) | Place a storage depot |
| Hammer icon | `removeBuilding` | Tap a building to remove it and its connected edges |

- The active tool has a black background with a white ring outline; inactive tools use a semi-transparent dark background (`rgba(44, 62, 80, 0.85)`).
- Building icons (house, factory, storage) are drawn in the currently selected color.
- The Building tool button dynamically shows the icon of the selected building sub-type.

### Gear Menu (bottom-right)

A gear button (48px diameter) sits in the bottom-right corner. Tapping it opens a popup menu above the button containing:

1. **FPS counter** — color-coded: green (≥50), yellow (≥30), red (<30).
2. **Speed controls** — row of buttons: ⏸ 1× 2× 3×.
3. **Music toggle** — On/Off button.
4. **Reset button** — dark red, reloads the game and clears save data.
5. **Save City** — downloads the current game state as a `.json` file (`loomways-city.json`).
6. **Load City** — opens a file picker to upload a previously saved `.json` city file. Score resets to 0 on load.
7. **City selector** — lists all preset cities from `cities/manifest.json`. Clicking a city loads it (score resets to 0).

Tapping anywhere outside the menu closes it.

---

## Touch & Mobile Support

The game is fully playable on touch devices. The canvas uses pointer events for tool interactions and touch events for multi-finger gestures.

- **Single finger**: Operates the active tool (place roads, place buildings, etc.) — same as mouse click/drag. Highway midpoint handles use a screen-space hit radius (22px) so they remain easy to tap at any zoom level.
- **Two-finger pinch**: Zoom in/out. Any in-progress road drag or highway placement is cancelled when a second finger touches down.
- **Two-finger pan**: Drag the camera with two fingers.
- **Tool/UI taps**: Tapping floating toolbar buttons and gear menu items works via `pointerdown` hit-testing against the button layout.

---

## Deployment

The game is deployed to **GitHub Pages** with the custom domain **loomways.com**. The `public/CNAME` file maps the GitHub Pages site to `loomways.com`. Deployment is automated via a GitHub Actions workflow on push to `main`.

---

## Visual Layers (Render Order)

1. **Background**: Green grass grid with faint lines.
2. **Building grounds**: SVG ground layer (driveways, pads) drawn below roads.
3. **Roads**: Regular → narrow → highway surfaces and dashes.
4. **Road preview / hover ghost**: Shown during placement.
5. **Cars and trucks**: All vehicles.
6. **Building shadows**: SVG shadow layer drawn above vehicles.
7. **Building bodies**: SVG building layer drawn on top. Pins rendered over buildings.
8. **Collecting pin animations**: Flying pin dots from building to car.
9. **UI**: Score display and toolbar (screen-space, not affected by camera).

Buildings use an SVG sprite system with programmatic color replacement. Each SVG has three layer groups (`Ground`, `Shadows`, `Building`) filtered by hiding non-target groups. Colors are replaced by matching element IDs (`RoofMain` → building color, `RoofShadow` → darkened variant). Disabled buildings render in gray (`#555555`).

**SVG assets are manually authored and must never be modified programmatically.** All SVG files in `assets/` are hand-crafted — changes to sprites should be made by the designer, not by code or automation.

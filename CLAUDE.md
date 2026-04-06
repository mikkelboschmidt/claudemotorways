# Claude Motorways — Agent Instructions

## PRD Maintenance (Required)

After implementing any user-facing feature, behavioral change, or new game mechanic, **update `PRD.md`** to reflect the change before completing the task. Match the existing style: concise technical prose, specific numbers, and markdown tables where appropriate. If a section needs to be added, place it logically among existing sections.

## Project Setup

```bash
npm install
npm run dev        # Vite dev server (respects CONDUCTOR_PORT env var)
npm run build      # TypeScript + Vite production build
```

## Key Conventions

- **SVG assets are hand-crafted** — never modify files in `assets/`. The user handles all sprite artwork.
- **No test suite** — verify changes by running the game in the browser.
- Source is organized by domain in `src/` (e.g., `cars.ts`, `buildings.ts`, `roads.ts`, `save.ts`, `cities.ts`).
- Game state lives in module-level arrays/maps exported from each domain file.
- Deployed to GitHub Pages at `loomways.com` via the GitHub Actions workflow.

## Reference Document

**Always read `PRD.md` at the start of any session.** It is the authoritative source for all game mechanics, UI behaviour, analytics design, deployment setup, and domain configuration. Do not rely on memory or assumptions — the PRD is kept up to date with every change.

# Plan: HAR-55 — Refactor scene layers into modular components

## Problem
HarborScene.tsx is 1239 lines — water, ships, land, atmosphere, labels, interaction all in one file.

## Approach
Extract pure utility modules. HarborScene stays as the React component owning scene/camera/renderer, but layer logic moves to `src/scene/`.

## New files

1. `src/scene/constants.ts` — CATEGORY_STYLES, world dims, coordinate conversion, shared types
2. `src/scene/land.ts` — Land polygon loading, point-in-polygon, GeoJSON rendering
3. `src/scene/ocean.ts` — Water tile creation and per-frame animation
4. `src/scene/ships.ts` — Ship geometry, collision resolution, reconciliation, per-frame animation
5. `src/scene/atmosphere.ts` — Wind particles, fog, day/night, mood
6. `src/scene/labels.ts` — Harbor label data and per-frame projection

HarborScene.tsx becomes ~300 lines: setup, animation loop calling layer functions, events, JSX.

## Constraints
- Pure extraction, NO behavior changes
- Visual output identical to baseline
- No new lint errors, build passes

## Acceptance criteria
- HarborScene.tsx < 350 lines
- Each scene module focused on one concern
- Identical rendering verified via Playwright screenshot
- `bun run build` succeeds

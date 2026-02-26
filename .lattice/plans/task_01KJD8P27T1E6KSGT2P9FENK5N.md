# HAR-72: Align ocean footprint to land polygon edges

1. Replace fixed `WATER_OVERSCAN_*` bounds in `src/scene/ocean.ts` with land-derived bounds computed from `landPolygonRings`.
2. Add a small configurable shoreline pad so water reaches the coast but does not visibly spill beyond the loaded land footprint.
3. Keep a world-bounds fallback when land data has not loaded yet, and re-check behavior with lint/typecheck for regressions.

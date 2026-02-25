# HAR-49: Fix NJ seed-fill square artifact with coastline boundary constraint

1. Add coastline input to `build-nj-seed-fill.ts`.
2. Derive per-row eastern coastline frontier from clipped NJ coastline lines.
3. Clip NJ seed-fill mask to remain west of that frontier (plus small margin).
4. Rebuild NJ polygons, merge into active harbor land file, and verify artifact is removed.

# HAR-74: Expand ocean bounds to true land extents (unclamped)

1. Diagnose mismatch between world bounds and loaded land polygon extents.
2. Expand ocean bounds to union(world bounds, land-derived bounds) without clamping to world, with safety margin.
3. Validate with lint/build and log resulting bound sizes.

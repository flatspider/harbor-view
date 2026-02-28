# HAR-84: Remove southern block artifact from harbor land geojson and collisions

1. Confirm the exact offending polygon feature in `public/assets/data/nyc-harbor-land.geojson` by bbox/coordinates so only the synthetic blocky geometry is targeted.
2. Remove that feature from the land GeoJSON (and corresponding source GeoJSON if present) to keep render and collision source data consistent.
3. Validate by re-checking feature bounds/counts and running a quick project check to ensure no runtime or build regressions.

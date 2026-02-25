# HAR-46: Generate NJ polygons and merge with restored NYC land

1. Build NJ-side polygon candidate from `Coastline_of_New_Jersey.geojson`.
2. Merge restored `nyc-harbor-land.geojson` + NJ polygons into final `nyc-harbor-land.geojson`.
3. Verify final polygons contain both NYC and NJ seed points used by harbor rendering.

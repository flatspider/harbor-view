# HAR-48: Implement seed-based NJ mainland fill from water mask

1. Add script to rasterize harbor water polygons into grid cells.
2. Flood-fill non-water cells from NJ seed points to extract NJ mainland mask.
3. Convert mask to coarse polygons and write `nj-land-polygons.geojson`.
4. Merge with active NYC land file and verify output.

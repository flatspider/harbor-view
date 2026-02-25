# HAR-42: Delete generated polygons and validate NJ coastline + candidate compatibility

1. Remove generated polygon outputs (`nyc-harbor-land.geojson`, `nj-land-polygons.geojson`) per request.
2. Inspect `Coastline_of_New_Jersey.geojson` and `nyc-harbor-land.candidate.geojson` geometry/content.
3. Run merge script using these files to verify compatibility and report concrete pass/fail details.

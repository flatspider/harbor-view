# HAR-43: Build harbor land polygons from NJ + evening NYC shoreline

1. Inspect both shoreline GeoJSON files for geometry types/counts.
2. Create a bounded combined shoreline FeatureCollection from NJ + evening NYC lines.
3. Run `data:build-harbor-land` against combined lines and write candidate polygon output.
4. Report whether polygon creation succeeded and what output file to use.

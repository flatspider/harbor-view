# HAR-37: Use NOAA shapefile as harbor shoreline source

## Goal
Replace current mixed/manual harbor polygons with NOAA shoreline shapefile-derived geometry so runtime rendering comes from NOAA data only.

## Plan
1. Inspect existing shoreline scripts and add a dedicated import script that:
   - converts a `.shp` (or `.zip`) shoreline dataset to GeoJSON line features,
   - writes to `public/assets/data/noaa-shoreline.geojson` by default.
2. Regenerate harbor land polygons from imported shoreline lines using the existing build script and overwrite `public/assets/data/nyc-harbor-land.geojson`.
3. Update docs with a single, concrete command sequence for NOAA shapefile -> harbor render data.
4. Verify scripts compile/run and that output files are produced at expected paths.

Place harbor polygon data in this folder as:

- `nyc-harbor-land.geojson`

The app will load it automatically at runtime from:

- `/assets/data/nyc-harbor-land.geojson`

Expected geometry:

- `FeatureCollection`
- `Polygon` and/or `MultiPolygon` features
- Coordinates in `[longitude, latitude]` (WGS84 / EPSG:4326)

When this file is missing, Harbor Watch uses fallback placeholder land masses.

## NOAA Shapefile -> Harbor Render (recommended)

If you downloaded shoreline tile files like `N40W075.shp/.dbf/.shx/.prj`, you can rebuild harbor land
directly from shoreline lines and overwrite existing polygons.

```bash
bun run data:import-noaa-shoreline -- \
  --input /absolute/path/to/N40W075.shp

bun run data:build-harbor-land
```

What this does:

- Writes shoreline lines to `public/assets/data/noaa-shoreline.geojson`
- Updates coastline overlay at `public/assets/data/harbor-coastline-lines.geojson`
- Rebuilds `public/assets/data/nyc-harbor-land.geojson` from NOAA shoreline geometry

Default harbor bounds used in import/build:

- `-74.26,40.48,-73.90,40.78`

To disable bbox clipping during import:

```bash
bun run data:import-noaa-shoreline -- \
  --input /absolute/path/to/N40W075.shp \
  --bbox none
```

## GSHHG Input Notes (important)

This codebase does **not** read GSHHG native binary `.b` files directly (for example:
`gshhs_f.b`, `gshhs_h.b`, `wdb_rivers_f.b`).

Use one of these options first:

- Download the GSHHG **shapefile** archive (not native binary), then convert to GeoJSON.
- Or export GeoJSON from QGIS by loading the GSHHG shapefile layer and using `Export -> Save Features As -> GeoJSON`.

For Harbor Watch, convert shoreline shapefile data to `noaa-shoreline.geojson` and then run:

```bash
bun run data:build-harbor-land
```

## Merge + Clip New Jersey Coastline

If you downloaded New Jersey files, place them in this folder as:

- `nj-land-polygons.geojson` (preferred for filled land)
- `nj-coastline.geojson` (linework/boundaries)
- `harbor-water-polygons.geojson` (optional but recommended; used to carve waterways out of land polygons)

Then run:

```bash
bun run data:merge-harbor-land
```

If you only have `nj-coastline.geojson` (lines) and need a polygon land file first:

```bash
bun run data:build-nj-land
```

This writes:

- `public/assets/data/nj-land-polygons.geojson`

Or pass explicit paths:

```bash
bun run data:merge-harbor-land -- \
  --nj-land /absolute/path/to/nj-land-polygons.geojson \
  --nj-coast /absolute/path/to/nj-coastline.geojson
```

Optional arguments:

- `--nyc` path to existing NYC land file (default: `public/assets/data/nyc-harbor-land.geojson`)
- `--out` output path (default: `public/assets/data/nyc-harbor-land.geojson`)
- `--out-lines` output path for clipped coastline lines (default: `public/assets/data/harbor-coastline-lines.geojson`)
- `--nj-land` input path for NJ polygon land file
- `--nj-coast` input path for NJ coastline line file
- `--nj` legacy single-input path (can contain polygons, lines, or both)
- `--water-mask` polygon water mask path (subtracts water from land before merge)
- `--bbox west,south,east,north`
  - default: `-74.26,40.48,-73.90,40.78` (NY Harbor bounds)

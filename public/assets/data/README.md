Place harbor polygon data in this folder as:

- `nyc-harbor-land.geojson`

The app will load it automatically at runtime from:

- `/assets/data/nyc-harbor-land.geojson`

Expected geometry:

- `FeatureCollection`
- `Polygon` and/or `MultiPolygon` features
- Coordinates in `[longitude, latitude]` (WGS84 / EPSG:4326)

When this file is missing, Harbor Watch uses fallback placeholder land masses.

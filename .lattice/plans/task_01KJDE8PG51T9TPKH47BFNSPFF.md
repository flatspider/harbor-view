# HAR-78: Clean land polygon geometries — fix invalids, simplify, clip, reproject

## Approach
Single script `scripts/clean-land-polygons.ts` that post-processes existing GeoJSON through a cleaning pipeline:

1. Fix invalid geometries (dedupe coords, close rings, remove degenerates, fix winding, unkink self-intersections)
2. Remove slivers below area threshold
3. Simplify with Douglas-Peucker
4. Clip to NY Harbor bounding box
5. Print stats on what was fixed

## Key files
- `scripts/clean-land-polygons.ts` (new)
- `public/assets/data/nyc-harbor-land.geojson` (processed in-place)
- `public/assets/data/nj-land-polygons.geojson` (processed in-place)

## Acceptance criteria
- Both GeoJSON files processed successfully
- Invalid geometries fixed or removed with stats
- npm script `data:clean-land` added

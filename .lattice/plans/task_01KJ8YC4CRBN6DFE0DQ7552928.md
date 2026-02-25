# HAR-40: Implement NOAA cleanup + polygonize pass for working land polygons

1. Diagnose clipped/simplified NOAA lines to identify degenerate segments that break polygonization.
2. Update `build-harbor-land-from-coastline.ts` to sanitize/explode linework, optionally add a bounding frame ring, and perform polygonization on clean `LineString` features.
3. Keep seed-based land selection and add fallback simplification behavior to avoid stack overflow / invalid ring crashes.
4. Run script against current NOAA file and verify it writes non-empty land polygons.

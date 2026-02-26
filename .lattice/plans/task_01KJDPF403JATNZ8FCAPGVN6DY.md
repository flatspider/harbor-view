# HAR-82: Expand east harbor bounds to include Long Beach and Island Channel

1. Confirm current clipping source by comparing runtime harbor bounds and GeoJSON extents.
2. Widen shared harbor east bound (client + server) so world projection and AIS subscription no longer hard-cut at -73.9.
3. Update data-script default bbox values to the same east bound so future rebuilds do not reintroduce the trim.
4. Rebuild `public/assets/data/nyc-harbor-land.geojson` with the wider bbox and verify resulting extents exceed -73.9.
5. Run lint/build checks and summarize root cause + exact fix.

# HAR-47: Trim NJ coastline to harbor bbox and generate coarse NJ fill polygon

1. Add script to trim line GeoJSON to NY Harbor bbox.
2. Add script to build coarse NJ land polygons from trimmed coastline using rasterized flood-fill enclosure.
3. Run both scripts on `Coastline_of_New_Jersey.geojson`.
4. Provide resulting trimmed shoreline + NJ fill polygon files for merge/display.

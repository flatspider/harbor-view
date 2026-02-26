# HAR-73: Fill ocean in NW/SE corners and keep coastline mask alignment

1. Size the water surface to full world bounds to remove uncovered NW/SE corner gaps.
2. Keep coastline alignment by retaining the land mask and applying it immediately when water tiles are created.
3. Verify with lint/build.

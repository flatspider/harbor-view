# HAR-75: Unclip North Hudson vessel stream and disable land-mask suppression for ship targets

1. Expand `NY_HARBOR_BOUNDS` northward in both server and client shared types so AIS subscription + world mapping include North Hudson.
2. Remove ship-position suppression tied to `isPointOnLand` during marker updates, so coarse land polygons do not freeze real AIS targets.
3. Validate with lint/build and document observed clipping sources.

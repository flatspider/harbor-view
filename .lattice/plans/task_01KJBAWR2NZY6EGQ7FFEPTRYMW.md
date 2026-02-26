# Plan: HAR-58 — Wire smooth ship interpolation

## Problem
Ships currently use frame-rate-dependent `position.lerp(target, 0.16)` — moves faster at higher FPS.
ShipData has `prevLat`/`prevLon`/`lastPositionUpdate` but they're not used for animation.

## Approach
1. In `animateShips`, compute time-based interpolation between previous and current positions
2. Add dead reckoning for moving ships: project forward based on SOG/COG when update is stale
3. Use `latLonToWorld` to convert interpolated positions to world coordinates

## Key files
- MODIFY: `src/scene/ships.ts` (animateShips function)
- MODIFY: `src/scene/constants.ts` (add ShipMarkerData.lastPositionUpdate)

## Acceptance criteria
- Ships move smoothly between AIS position updates
- Movement speed independent of frame rate
- Moving ships project forward via dead reckoning when AIS update is stale

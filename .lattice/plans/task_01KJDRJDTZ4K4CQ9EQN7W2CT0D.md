# HAR-83: Add real-time airplane layer using adsb.lol data

## Architecture

Pipeline mirrors ship data:
```
adsb.lol API → server.ts polling (10s) → /api/aircraft → useAircraftData() → airplanes.ts → HarborScene
```

## Backend (server.ts)
- Add `aircraft` Map<string, AircraftData> alongside existing `ships` Map
- Add `pollAircraftData()` on 10s interval using existing adsb.lol endpoint
- Parse individual aircraft from `ac` array (currently discarded — only count is stored)
- Add `/api/aircraft` endpoint returning airborne aircraft within bounds
- Filter out ground aircraft (alt_baro === "ground") and aircraft outside scene bounds

## New Files
1. `src/types/aircraft.ts` — AircraftData interface, category helpers
2. `src/hooks/useAircraftData.ts` — Poll /api/aircraft every 5s (same pattern as useShipData)
3. `src/scene/airplanes.ts` — Procedural Ghibli-style airplane geometry, reconcileAircraft(), animateAircraft()

## Modified Files
4. `server.ts` — Aircraft polling, data store, /api/aircraft endpoint
5. `src/components/HarborScene.tsx` — Wire in aircraft markers ref, reconciliation useEffect, animation call
6. `src/App.tsx` — Add useAircraftData hook, pass aircraft to HarborScene
7. `src/components/StatusBar.tsx` — Show aircraft count

## Key Design Decisions
- Procedural geometry (MeshToonMaterial + toonGradient), no GLB model for v1
- Logarithmic altitude compression (1000ft→~25y, 5000ft→~45y, 35000ft→~120y)
- Dead-reckoning interpolation between polls using track + ground speed
- Server-side filtering: only airborne, within bounds

## Acceptance Criteria
- /api/aircraft returns aircraft with position, altitude, speed, track, identification
- Aircraft render as Ghibli-style meshes in Three.js scene
- Altitude reflected in Y position with logarithmic compression
- Smooth interpolation between poll updates
- Stale aircraft removed from scene
- Ground aircraft filtered out
- No breakage to existing ship rendering or performance
- Aircraft count shown in StatusBar

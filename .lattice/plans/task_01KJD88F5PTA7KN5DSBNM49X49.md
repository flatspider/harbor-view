# HAR-71: Fix ship zoom scaling — correct size/hitbox/wake proportions across zoom levels

## Problem Analysis

Ships are nearly invisible at most zoom levels. The root cause is a combination of undersized base geometry and insufficient zoom compensation.

### Current numbers (200m cargo ship — the largest common vessel)

| Metric | Value | Problem |
|--------|-------|---------|
| `computeShipSizeScale` output | 0.324 | Cap at 1.1 is irrelevant — nothing reaches it |
| Ship geometry length (world units) | 7.1 | Tiny in a 1200-unit-wide world |
| Pixels at max zoom-out (2220 distance) | ~9 px | Nearly invisible |
| Pixels at default camera start (~788 distance) | ~17 px | Barely visible |
| Pixels at max zoom-in (80 distance) | ~99 px | Reasonable |
| Hit sphere radius (world units) | 6 (floor) | Formula yields 2.52, clamped up to 6 |
| Hit area diameter at max zoom-out | ~15 px | Barely clickable |

For a 50m vessel (`sizeScale` = 0.22, the floor), these numbers are roughly halved.

### Why the numbers are so small

`WORLD_UNITS_PER_METER = 0.036`. A 200m ship is only 7.2 world units. The `computeShipSizeScale` formula divides by reference values (22 for length, 8 for beam) that further compress the scale, then caps at 1.1. The geometry shapes use coordinates like `10 * scale` and `12 * scale`, so a 200m ship's hull is ~7 units long. In a world that is 1200 units wide viewed from 788+ units away, that is a speck.

### Lerp lag

`animateShips` line 388: `THREE.MathUtils.lerp(marker.scale.x, zoomScale, 0.18)` blends at 18% per frame toward the target. At 60 fps, after a quick scroll that changes `shipZoomScale` from 1.5 to 2.3:
- Frame 1: 1.5 → 1.64
- Frame 5: ~1.92
- Frame 10: ~2.14
- Frame 15: ~2.23

That is roughly 250ms to get within 95% of target. On a fast scroll-zoom this creates a visible "ships haven't caught up" effect.

### Wake proportionality

The wake is a child of the ship mesh, so `marker.scale.setScalar(blendedVisualScale)` cascades to the wake. The wake's own local scale factors in `sizeScale` and speed. Relative to the ship hull, the wake proportions are mostly stable — but because the wake uses `max(sizeScale, 0.28)` while the hull geometry uses the raw `sizeScale`, for very small ships (sizeScale < 0.28), the wake is disproportionately wide compared to the hull. This should be fixed.

### Hit area scaling

The hit sphere is also a child of the ship mesh, so it inherits the parent zoom scale. The problem is the base radius formula: `max(6, min(24, lengthM * 0.036 * 0.35))`. For a 200m ship, `200 * 0.036 * 0.35 = 2.52`, which clamps to the floor of 6. The formula effectively never leaves the floor (ships need to be ~476m to exceed 6). If we increase the base ship geometry, we should also ensure the hit area scales proportionally.

---

## Implementation Plan

### 1. Increase base ship geometry scale (`computeShipSizeScale` in `src/scene/ships.ts:117-126`)

**Current:**
```ts
const fromLength = targetLengthUnits / 22;
const fromBeam = targetBeamUnits / 8;
const blended = fromLength * 0.75 + fromBeam * 0.25;
return Math.min(Math.max(blended * style.scale, 0.22), 1.1);
```

**Change:** Multiply `blended` by a world-scale boost factor. The shapes use coordinates around ±10 units, so at sizeScale 1.0 a ship is ~22 units long. We want a 200m cargo ship to be roughly 18-22 units (visible without zoom help). This means targeting a sizeScale around 0.8-1.0 for large ships.

**New values:**
- Multiply the blended result by **3.0** (a single boost multiplier) before applying `style.scale`
- Raise the cap from **1.1** to **2.2** (so tankers at scale 1.2 can be up to 2.2)
- Keep the floor at **0.22** (absolute minimum)

This gives:
- 200m cargo: `0.281 * 3.0 * 1.15 = 0.97` → geometry length ~21 units
- 50m other: `0.073 * 3.0 * 0.9 = 0.197` → clamped to 0.22, geometry length ~4.8 units
- 300m tanker: `0.40 * 3.0 * 1.2 = 1.44` → geometry length ~32 units

These are proportionally more visible without being cartoonishly large.

### 2. Widen the zoom scale range (`HarborScene.tsx:418`)

**Current:**
```ts
const shipZoomScale = THREE.MathUtils.lerp(0.9, 2.3, Math.pow(zoomProgress, 0.72));
```

With larger base ship sizes, the zoom scale range should be adjusted so ships don't become overwhelming when zoomed in. Reduce the zoomed-in scale and keep a moderate zoom-out boost:

**New values:**
```ts
const shipZoomScale = THREE.MathUtils.lerp(0.6, 2.8, Math.pow(zoomProgress, 0.65));
```

- **Zoomed in (0.6):** Ships are 60% of their new (larger) base size when camera is close — makes them feel more "real scale" relative to the now-visible harbor details.
- **Zoomed out (2.8):** Ships are 2.8x their base size at maximum zoom-out. Combined with the 3x base boost, a 200m cargo ship at max zoom out is `21 * 2.8 = 58.8` world units → roughly **33 pixels** on screen. That is comfortably visible and clickable.
- **Exponent 0.65** (from 0.72): Slightly more aggressive scaling toward larger sizes as you zoom out, so ships become visible sooner in the zoom range.

### 3. Increase lerp smoothing speed (`src/scene/ships.ts:388`)

**Current:**
```ts
const blendedVisualScale = THREE.MathUtils.lerp(marker.scale.x || 1, zoomScale, 0.18);
```

**New value:** Change `0.18` to `0.35`. This means ~95% convergence in about 8 frames (~133ms at 60fps) instead of 15 frames (~250ms). The scaling will feel more responsive to scroll zoom without being jarring.

```ts
const blendedVisualScale = THREE.MathUtils.lerp(marker.scale.x || 1, zoomScale, 0.35);
```

### 4. Scale the hit sphere radius formula (`src/scene/ships.ts:249-253, 300-305`)

The hit area geometry is created in two places in `reconcileShips`:
- Lines 249-253 (existing ship, geometry refresh)
- Lines 300-305 (new ship creation)

**Current formula:**
```ts
Math.max(6, Math.min(24, ship.lengthM > 0 ? ship.lengthM * WORLD_UNITS_PER_METER * 0.35 : 9))
```

Since the base geometry is now ~3x larger, the hit sphere should match. Multiply the length-based factor by 3 and raise the max accordingly:

**New formula:**
```ts
Math.max(8, Math.min(40, ship.lengthM > 0 ? ship.lengthM * WORLD_UNITS_PER_METER * 1.05 : 14))
```

- 200m ship: `200 * 0.036 * 1.05 = 7.56` → clamped to 8 (floor)
- 300m ship: `300 * 0.036 * 1.05 = 11.34` → 11.3
- Default (no length): 14 → generous fallback
- Floor raised to 8, cap to 40 to accommodate future very large vessels

### 5. Align wake base scale floor with ship floor (`src/scene/ships.ts:438`)

**Current:**
```ts
const wakeScaleBase = Math.max(markerData.sizeScale, 0.28);
```

The 0.28 floor was above the ship sizeScale floor of 0.22, causing wakes to be proportionally wider than hulls on tiny ships. Now that sizeScale values will be higher (most ships 0.5+), this floor is less impactful. But for consistency, use the same sizeScale directly:

**New:**
```ts
const wakeScaleBase = markerData.sizeScale;
```

No floor needed — the sizeScale itself has a 0.22 floor, and at that size the wake geometry (13 units wide × wakeWidth × 0.22 × speed factor) will still be appropriately small.

### 6. Update `createShipDetailMesh` — no changes needed

The detail mesh (superstructure, containers, etc.) already uses the same `sizeScale` parameter as the hull geometry. Since we're changing the output of `computeShipSizeScale`, both hull and detail will scale together. No separate changes needed.

---

## Files to Modify

| File | Lines | Change |
|------|-------|--------|
| `src/scene/ships.ts` | 117-126 | Boost `computeShipSizeScale` multiplier, raise cap |
| `src/scene/ships.ts` | 388 | Increase lerp factor from 0.18 to 0.35 |
| `src/scene/ships.ts` | 438 | Remove wake base scale floor |
| `src/scene/ships.ts` | 249-253, 300-305 | Update hit sphere radius formula (both locations) |
| `src/components/HarborScene.tsx` | 418 | Adjust zoom scale range and exponent |

---

## Acceptance Criteria

1. **Visibility at max zoom-out:** A 200m cargo ship should occupy at least 25-35 pixels on a 1920x1080 viewport at maximum zoom distance. It should be clearly identifiable as a ship shape, not a dot.

2. **Proportionality at max zoom-in:** Ships at closest zoom (distance 80) should feel large and detailed but not clip through each other or overwhelm the viewport. A 200m cargo ship should occupy roughly 30-50% of the viewport height.

3. **Zoom responsiveness:** When rapidly scrolling the mouse wheel, ship sizes should visually converge to their target within ~150ms (no more than 8-10 frames at 60fps). No visible "ships are the wrong size" moment.

4. **Click targets work at all zoom levels:** Ships should be hoverable and clickable at both max zoom-out and max zoom-in. The hit area should be at least 12px diameter at max zoom-out.

5. **Wake proportionality:** Wakes should be visually proportional to their ship hull at all zoom levels. No cases where the wake is wider than the ship or absurdly thin.

6. **No visual regressions:** Ship detail meshes, bobbing animation, heading rotation, and color/hover effects should all continue working correctly at the new scales.

7. **Performance:** No measurable frame rate drop from the scaling changes (these are simple uniform scale operations, not geometry changes per frame).

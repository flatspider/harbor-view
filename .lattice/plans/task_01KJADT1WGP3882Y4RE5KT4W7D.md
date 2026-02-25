# HAR-50: Reboot vessel visuals and collision-safe placement

## Scope
- Fix wake layering/parallax so wake trails visually stay on water behind each ship hull.
- Strengthen ship category visuals with clear per-category shape/color/signature details.
- Prevent new ship targets from landing on land polygons and reduce overlaps between nearby ships.

## Approach
1. Add deterministic target-resolution utilities in `HarborScene.tsx`:
- Build a local occupancy index from existing marker targets and accepted targets in this update cycle.
- For each ship target, run iterative radial search offsets until candidate point is water and not within a configurable clearance radius of other vessels.
- Reuse this for both new markers and marker updates.

2. Improve wake attachment and depth behavior:
- Convert wake to a flatter, longer trailing geometry anchored behind hull stern.
- Keep wake slightly above water plane but below hull deck, set render/depth ordering to avoid under-boat parallax artifacts.

3. Upgrade category differentiation:
- Extend category style metadata (hull tint, emissive hint, wake scale bias, detail mesh) by category.
- Add a small superstructure/deck detail mesh per category profile so cargo/passenger/tanker/special are distinct beyond color alone.

4. Validate:
- Run lint/typecheck available in package scripts.
- Review interaction behavior (hover/click) still functional since marker hierarchy changes.

## Acceptance Criteria
- Wake no longer appears detached beneath vessel in camera motion.
- At least 4 categories are visibly distinct at normal zoom.
- Ships that would land on land polygons are shifted to nearby water where possible.
- Nearby ship overlaps are reduced through automatic offsetting.

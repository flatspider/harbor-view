# HAR-80: Performance stabilization: reduce scene stutter and load jank

## Scope
Stabilize frame pacing and first-load behavior in the Harbor Watch frontend by removing avoidable hot-path work and reducing expensive reconciliations that run too often.

## Plan
1. `src/scene/ships.ts`
- Remove forced heavy model rendering across all ship categories.
- Throttle expensive land/boundary validation inside per-frame ship animation to run on a timed cadence instead of every frame.
- Keep placement and visibility behavior intact while reducing repeated point-in-polygon checks.

2. `src/components/HarborScene.tsx`
- Rework startup loading flow to avoid waterfall loading that delays visible scene setup.
- Throttle pointer move raycasting to once per animation frame.
- Avoid per-frame ferry route style writes when day/night state has not changed.

3. `src/hooks/useShipData.ts`
- Add payload diffing to avoid state updates when data is unchanged.
- Prevent overlapping polling fetches to reduce work spikes under slower network responses.

4. Validation
- Run `bun run build` to ensure typecheck/build stability.
- Review diff for regressions in interaction behavior and scene visibility.

## Acceptance Criteria
- No build/type errors.
- Ship/data polling no longer triggers full React/scene reconciliation when payload is unchanged.
- Per-frame ship animation no longer performs boundary/land checks for every ship on every frame.
- Pointer hover interactions remain functional while reducing raycast frequency.
- Scene remains visually consistent while reducing startup and runtime jank.

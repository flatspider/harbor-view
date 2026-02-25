# HAR-60: Improve ocean current modeling and constrained water rendering

1. Add an ocean flow field model in `src/scene/ocean.ts` that generates localized current vectors from environmental current direction/speed plus spatial variation, and animate a sparse arrow glyph layer that points along the modeled flow.
2. Constrain water rendering by masking out land using the loaded land polygon rings from `src/scene/land.ts`, by sampling each water vertex in world-space and suppressing wave displacement/visibility where the sample lands on a land polygon.
3. Raise baseline ocean surface elevation slightly and update related constants so water sits above the prior plane but below ship hull visuals.
4. Wire new ocean helper lifecycle calls into `src/components/HarborScene.tsx` (init/animate/dispose), keep behavior resilient when land polygons are not loaded yet, and verify with typecheck.

Acceptance criteria:
- Ocean surface no longer appears over land polygons after land data loads.
- Ocean is raised slightly compared to current baseline.
- Current arrows are visible over water and align with simulated current direction.
- Build/typecheck passes.

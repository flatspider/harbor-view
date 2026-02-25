# Plan: HAR-56 — Ghibli-style painted harbor background

## Approach
Since we can't generate art assets programmatically, create a procedural Ghibli-style sky/horizon background using Three.js gradient techniques that:
1. Replaces the flat color background with a warm painted sky gradient
2. Adds a horizon haze layer for depth
3. Changes dynamically with time of day and weather mood
4. Creates the "painted" feeling through soft color bands

## Implementation
1. Add `src/scene/sky.ts` — procedural sky gradient using a large backplane or vertex-colored geometry
2. Update `atmosphere.ts` to pass sky colors to the sky layer per-frame
3. Color palette: warm Ghibli tones (golden hour golds, soft lavenders, deep indigos at night)

## Key files
- NEW: `src/scene/sky.ts`
- MODIFY: `src/scene/atmosphere.ts` (add sky animation)
- MODIFY: `src/components/HarborScene.tsx` (add sky setup)

## Acceptance criteria
- Sky background has visible gradient (not flat color)
- Changes with day/night and weather mood
- Build passes
- Visual improvement verified via Playwright screenshot

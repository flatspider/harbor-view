# HAR-62: Make ocean motion visibly current-driven

1. Replace whole-water-mesh translation drift with shader-driven advection by updating normal texture UV offset from the modeled current vector each frame.
2. Add directional modulation tied to current heading/speed (along-flow chop + cross-flow attenuation) so water appearance reads as flow-aligned instead of generic isotropic motion.
3. Keep land mask behavior and arrow field intact, then validate with typecheck/lint.

Acceptance criteria:
- Water no longer appears as a giant plane sliding across the map.
- Surface motion visibly tracks current direction/speed in a believable way.
- Existing arrows and land constraints still work.

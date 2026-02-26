# HAR-69: Implement Three.js sky shader controls

## Scope
Replace the current sky animation plumbing with the official Three.js `webgl_shaders_sky` parameter model and expose live UI controls so users can tune sky color/scattering in-app.

## Approach
1. Refactor `src/scene/sky.ts` to use only real `Sky` uniforms (`turbidity`, `rayleigh`, `mieCoefficient`, `mieDirectionalG`, `sunPosition`) plus `elevation`/`azimuth` mapping from the Three.js example.
2. Add a small control state model in `HarborScene` with defaults aligned to the example and weather/night-derived auto values.
3. Render a compact overlay panel with sliders/toggles for enabling auto mode and dialing each sky feature up/down.
4. Keep renderer exposure synced to sky controls so results mirror Three.js example behavior.

## Acceptance Criteria
- Sky uniforms are actively updated each frame and no longer rely on non-existent cloud uniforms.
- User can adjust turbidity, rayleigh, mie coefficient, mie directional g, elevation, azimuth, and exposure at runtime.
- Controls can be toggled between auto-derived values and manual tuning without breaking existing scene behavior.
- TypeScript build/lint passes for touched files.

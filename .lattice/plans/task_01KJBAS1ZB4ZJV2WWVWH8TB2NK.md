# Plan: HAR-57 — Ocean displacement shader

## Approach
Replace the simple PlaneGeometry vertex animation with a custom ShaderMaterial on the water tiles that creates a more organic, living ocean look with:
1. Multi-layered noise for wave displacement (not just sin/cos)
2. Specular highlights that shimmer with camera angle
3. Depth-based color variation (deeper = darker)
4. Subtle foam/white-cap effect near land edges

## Implementation
- Modify `src/scene/ocean.ts` to use `THREE.ShaderMaterial` with custom vertex + fragment shaders
- Vertex shader: multi-octave simplex noise displacement
- Fragment shader: water color with depth, specular, and foam
- Keep the same tile grid structure for compatibility
- Pass time, wave height, swell direction, tide level as uniforms

## Key files
- MODIFY: `src/scene/ocean.ts`

## Acceptance criteria
- Water has visible organic wave motion (not mechanical sin/cos)
- Specular highlights visible on water surface
- Build passes
- No performance regression (still 60fps with 100+ vessels)

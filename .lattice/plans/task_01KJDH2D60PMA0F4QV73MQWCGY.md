# HAR-79: Add Ghibli Cel-Shading Post-Processing Pipeline

## Scope

Add a Ghibli-style cel-shading look through three coordinated changes:
1. Swap `MeshStandardMaterial` to `MeshToonMaterial` on solid geometry (land, ships, skyline)
2. Add post-processing pipeline via `EffectComposer` with ink outlines, color quantization, warm grading, subtle bloom
3. Tune palette: rich teal water, warm golden light, dark warm brown ink outlines

## Key Constraints

- Water uses shader-based `Water` object — tuned via uniforms, not material swap
- Edge detection via custom Sobel ShaderPass (not OutlinePass)
- MeshToonMaterial needs gradientMap DataTexture with NearestFilter
- EffectComposer replaces direct renderer.render() — OutputPass handles tone mapping
- ShipMesh type alias in constants.ts must be updated

## Implementation Steps

### Step 1: toonGradient.ts (new)
4x1 pixel DataTexture, NearestFilter, for cel-shading bands.

### Step 2: land.ts — material swap
MeshStandardMaterial → MeshToonMaterial for landMaterial and cliffMaterial.

### Step 3: ships.ts + constants.ts — material swap
Hull and detail meshes → MeshToonMaterial. Update ShipMesh type. Update instanceof checks.

### Step 4: skyline.ts — material swap
Building material → MeshToonMaterial.

### Step 5: ghibliEdgeShader.ts (new)
Sobel on luminance, dark warm brown (#2a1f1a) edges, tunable threshold/strength.

### Step 6: ghibliColorShader.ts (new)
Color quantization (8 bands), saturation boost (1.15x), warm grading.

### Step 7: HarborScene.tsx — EffectComposer
RenderPass → Edge → Color → Bloom → OutputPass. Resize handler. Cleanup.

### Step 8: ocean.ts — palette tuning
Richer teal, higher saturation.

### Step 9: atmosphere.ts — warm tuning
Warmer sun, stronger directional light.

## Acceptance Criteria

1. Flat-color bands on land, ships, buildings
2. Dark ink-line outlines on geometry edges
3. Water retains animation with richer teal
4. Warm golden lighting with visible toon bands
5. No regressions (hover/click, controls, night mode)
6. Build succeeds

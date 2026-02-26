import * as THREE from "three";

/**
 * Sobel-based edge detection post-processing shader.
 * Detects luminance edges and composites dark ink-colored outlines —
 * the bold lines that give Ghibli/cel-shaded art its look.
 */
export const GhibliEdgeShader = {
  name: "GhibliEdgeShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2() },
    edgeColor: { value: new THREE.Color("#2a1f1a") },
    edgeStrength: { value: 1.2 },
    edgeThreshold: { value: 0.08 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform vec3 edgeColor;
    uniform float edgeStrength;
    uniform float edgeThreshold;

    varying vec2 vUv;

    float edgeLuma(vec3 c) {
      return dot(c, vec3(0.299, 0.587, 0.114));
    }

    void main() {
      vec2 texel = 1.0 / resolution;

      // Sample 3x3 neighborhood luminance
      float tl = edgeLuma(texture2D(tDiffuse, vUv + vec2(-texel.x,  texel.y)).rgb);
      float tc = edgeLuma(texture2D(tDiffuse, vUv + vec2( 0.0,      texel.y)).rgb);
      float tr = edgeLuma(texture2D(tDiffuse, vUv + vec2( texel.x,  texel.y)).rgb);
      float ml = edgeLuma(texture2D(tDiffuse, vUv + vec2(-texel.x,  0.0)).rgb);
      float mr = edgeLuma(texture2D(tDiffuse, vUv + vec2( texel.x,  0.0)).rgb);
      float bl = edgeLuma(texture2D(tDiffuse, vUv + vec2(-texel.x, -texel.y)).rgb);
      float bc = edgeLuma(texture2D(tDiffuse, vUv + vec2( 0.0,     -texel.y)).rgb);
      float br = edgeLuma(texture2D(tDiffuse, vUv + vec2( texel.x, -texel.y)).rgb);

      // Sobel operator
      float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
      float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
      float edge = sqrt(gx * gx + gy * gy);

      // Suppress tiny local luminance noise (water shimmer, grain).
      float localMin = min(min(min(tl, tc), min(tr, ml)), min(min(mr, bl), min(bc, br)));
      float localMax = max(max(max(tl, tc), max(tr, ml)), max(max(mr, bl), max(bc, br)));
      float localContrast = localMax - localMin;
      float contrastMask = smoothstep(0.06, 0.22, localContrast);

      // Smooth threshold to avoid harsh cut.
      float edgeMask = smoothstep(edgeThreshold, edgeThreshold + 0.06, edge) * edgeStrength * contrastMask;

      vec4 original = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(mix(original.rgb, edgeColor, edgeMask), original.a);
    }
  `,
};

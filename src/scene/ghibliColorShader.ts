/**
 * Warm color grading post-processing shader.
 * Boosts saturation and applies warm Ghibli-style color grading
 * (highlights shift golden, shadows shift cooler).
 * No color quantization — the MeshToonMaterial gradient map
 * already handles the flat cel-shading bands.
 */
export const GhibliColorShader = {
  name: "GhibliColorShader",
  uniforms: {
    tDiffuse: { value: null as unknown },
    saturationBoost: { value: 1.35 },
    warmthShift: { value: 0.035 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturationBoost;
    uniform float warmthShift;

    varying vec2 vUv;

    vec3 rgb2hsl(vec3 c) {
      float maxC = max(max(c.r, c.g), c.b);
      float minC = min(min(c.r, c.g), c.b);
      float l = (maxC + minC) * 0.5;

      if (maxC == minC) return vec3(0.0, 0.0, l);

      float d = maxC - minC;
      float s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);

      float h;
      if (maxC == c.r) h = mod((c.g - c.b) / d + 6.0, 6.0);
      else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
      else h = (c.r - c.g) / d + 4.0;
      h /= 6.0;

      return vec3(h, s, l);
    }

    float hue2rgb(float p, float q, float t) {
      if (t < 0.0) t += 1.0;
      if (t > 1.0) t -= 1.0;
      if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
      if (t < 1.0 / 2.0) return q;
      if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
      return p;
    }

    vec3 hsl2rgb(vec3 c) {
      if (c.y == 0.0) return vec3(c.z);
      float q = c.z < 0.5 ? c.z * (1.0 + c.y) : c.z + c.y - c.z * c.y;
      float p = 2.0 * c.z - q;
      return vec3(
        hue2rgb(p, q, c.x + 1.0 / 3.0),
        hue2rgb(p, q, c.x),
        hue2rgb(p, q, c.x - 1.0 / 3.0)
      );
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Convert to HSL for saturation/warmth adjustments
      vec3 hsl = rgb2hsl(color.rgb);

      // Only boost colors that already have saturation —
      // leave neutral greys (fog, sky) untouched to prevent
      // pink/magenta artifacts on near-grey pixels.
      float chromaMask = smoothstep(0.04, 0.18, hsl.y);

      // Boost saturation for vivid Ghibli palette (masked)
      hsl.y = mix(hsl.y, min(hsl.y * saturationBoost, 1.0), chromaMask);

      // Warm shift: highlights shift golden, shadows shift cooler (masked)
      hsl.x += warmthShift * (hsl.z - 0.5) * chromaMask;

      vec3 result = hsl2rgb(hsl);
      gl_FragColor = vec4(result, color.a);
    }
  `,
};

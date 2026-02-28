import * as THREE from "three";

const BASE_TOON_LOOK_CAPTURED_KEY = "__baseToonLookCaptured";
const BASE_TOON_HSL_KEY = "__baseToonHsl";
const BASE_TOON_COLOR_HEX_KEY = "__baseToonColorHex";
const BASE_TOON_EMISSIVE_HEX_KEY = "__baseToonEmissiveHex";
const BASE_TOON_EMISSIVE_INTENSITY_KEY = "__baseToonEmissiveIntensity";

const NIGHT_LIGHTNESS_LIFT = 0.1;
const NIGHT_MIN_LIGHTNESS = 0.4;
const NIGHT_SATURATION_SCALE = 1.08;
const NIGHT_EMISSIVE_INTENSITY_BOOST = 0.14;

interface StoredHsl {
  h: number;
  s: number;
  l: number;
}

interface ToonLookUserData extends Record<string, unknown> {
  __baseToonLookCaptured?: boolean;
  __baseToonHsl?: StoredHsl;
  __baseToonColorHex?: number;
  __baseToonEmissiveHex?: number;
  __baseToonEmissiveIntensity?: number;
}

const _hsl: StoredHsl = { h: 0, s: 0, l: 0 };

export function captureBaseToonLook(material: THREE.MeshToonMaterial): void {
  const userData = material.userData as ToonLookUserData;
  if (userData[BASE_TOON_LOOK_CAPTURED_KEY]) return;

  material.color.getHSL(_hsl);
  userData[BASE_TOON_HSL_KEY] = { ..._hsl };
  userData[BASE_TOON_COLOR_HEX_KEY] = material.color.getHex();
  userData[BASE_TOON_EMISSIVE_HEX_KEY] = material.emissive.getHex();
  userData[BASE_TOON_EMISSIVE_INTENSITY_KEY] = material.emissiveIntensity;
  userData[BASE_TOON_LOOK_CAPTURED_KEY] = true;
}

export function applyNightToonLook(
  material: THREE.MeshToonMaterial,
  enabled: boolean,
): void {
  captureBaseToonLook(material);
  const userData = material.userData as ToonLookUserData;

  const baseHsl = userData[BASE_TOON_HSL_KEY];
  const baseColorHex = userData[BASE_TOON_COLOR_HEX_KEY];
  const baseEmissiveHex = userData[BASE_TOON_EMISSIVE_HEX_KEY];
  const baseEmissiveIntensity = userData[BASE_TOON_EMISSIVE_INTENSITY_KEY];
  if (
    !baseHsl ||
    typeof baseColorHex !== "number" ||
    typeof baseEmissiveHex !== "number" ||
    typeof baseEmissiveIntensity !== "number"
  ) {
    return;
  }

  if (!enabled) {
    material.color.setHex(baseColorHex);
    material.emissive.setHex(baseEmissiveHex);
    material.emissiveIntensity = baseEmissiveIntensity;
    material.needsUpdate = true;
    return;
  }

  material.color.setHSL(
    baseHsl.h,
    THREE.MathUtils.clamp(baseHsl.s * NIGHT_SATURATION_SCALE, 0, 1),
    THREE.MathUtils.clamp(
      Math.max(baseHsl.l + NIGHT_LIGHTNESS_LIFT, NIGHT_MIN_LIGHTNESS),
      0,
      1,
    ),
  );
  material.emissive.copy(material.color);
  material.emissiveIntensity = baseEmissiveIntensity + NIGHT_EMISSIVE_INTENSITY_BOOST;
  material.needsUpdate = true;
}


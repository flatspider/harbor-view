import * as THREE from "three";
import { latLonToWorld } from "./constants";

export interface HarborLabel {
  id: string;
  text: string;
  lat: number;
  lon: number;
  kind: "water" | "landmark";
  priority: number;
  offsetX?: number;
  offsetY?: number;
  style?: "emoji" | "emoji-xl";
}

export const HARBOR_LABELS: HarborLabel[] = [
  { id: "upper-bay", text: "Upper Bay", lat: 40.671, lon: -74.035, kind: "water", priority: 10, offsetY: -12 },
  { id: "east-river", text: "East River", lat: 40.725, lon: -73.982, kind: "water", priority: 9, offsetX: 148, offsetY: -10 },
  { id: "hudson", text: "Hudson", lat: 40.742, lon: -74.028, kind: "water", priority: 8, offsetX: 18 },
  { id: "narrows", text: "The Narrows", lat: 40.61, lon: -74.04, kind: "water", priority: 10, offsetY: -8 },
  { id: "liberty", text: "\u{1F5FD}", lat: 40.6892, lon: -74.0445, kind: "landmark", priority: 12, offsetY: -18, style: "emoji-xl" },
  { id: "gov-island", text: "Governors Island", lat: 40.6897, lon: -74.0168, kind: "landmark", priority: 11, offsetY: -10 },
  { id: "verrazzano", text: "Verrazzano Bridge", lat: 40.6066, lon: -74.0447, kind: "landmark", priority: 11, offsetY: -10 },
  { id: "ambrose", text: "Ambrose Channel", lat: 40.53, lon: -73.98, kind: "landmark", priority: 7, offsetY: -8 },
];

/** Project labels to screen space with overlap avoidance. */
export function projectLabels(
  camera: THREE.PerspectiveCamera,
  container: HTMLDivElement,
  labelElements: Map<string, HTMLDivElement>,
  labelSizes: Map<string, { width: number; height: number }>,
  occlusionTargets?: THREE.Mesh[],
): void {
  const OCCLUDED_OPACITY = 0.2;
  const raycaster = new THREE.Raycaster();
  raycaster.camera = camera;
  const placedRects: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  const overlapPadding = 10;
  const isOverlapping = (
    a: { left: number; right: number; top: number; bottom: number },
    b: { left: number; right: number; top: number; bottom: number },
  ) =>
    a.left - overlapPadding < b.right &&
    a.right + overlapPadding > b.left &&
    a.top - overlapPadding < b.bottom &&
    a.bottom + overlapPadding > b.top;

  const projectedLabels = HARBOR_LABELS.map((label) => {
    const el = labelElements.get(label.id);
    if (!el) return null;
    const world = latLonToWorld(label.lat, label.lon);
    world.y = 8;
    const projected = world.project(camera);
    const inFrustum = projected.z < 1 && projected.z > -1;
    if (!inFrustum) return { label, el, state: "hidden" as const, x: 0, y: 0 };

    const x = ((projected.x + 1) * 0.5) * container.clientWidth + (label.offsetX ?? 0);
    const y = ((-projected.y + 1) * 0.5) * container.clientHeight + (label.offsetY ?? 0);
    let occluded = false;
    const ignoreOcclusion = label.id === "liberty";
    if (!ignoreOcclusion && occlusionTargets && occlusionTargets.length > 0) {
      const toLabel = world.clone().sub(camera.position);
      const labelDistance = toLabel.length();
      if (labelDistance > 0.001) {
        raycaster.set(camera.position, toLabel.multiplyScalar(1 / labelDistance));
        raycaster.far = Math.max(0, labelDistance - 0.5);
        const hits = raycaster.intersectObjects(occlusionTargets, false);
        if (hits.length > 0) occluded = true;
      }
    }
    return { label, el, state: occluded ? ("occluded" as const) : ("visible" as const), x, y };
  })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null)
    .sort((a, b) => b.label.priority - a.label.priority);

  for (const entry of projectedLabels) {
    const { label, el, x, y, state } = entry;
    if (state === "hidden") {
      el.style.opacity = "0";
      continue;
    }
    const cachedSize = labelSizes.get(label.id);
    const width = cachedSize?.width ?? (el.offsetWidth || 100);
    const height = cachedSize?.height ?? (el.offsetHeight || 20);
    labelSizes.set(label.id, { width, height });
    const rect = {
      left: x - width * 0.5,
      right: x + width * 0.5,
      top: y - height * 0.5,
      bottom: y + height * 0.5,
    };
    if (placedRects.some((placed) => isOverlapping(rect, placed))) {
      el.style.opacity = "0";
      continue;
    }
    placedRects.push(rect);
    el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
    el.style.opacity = state === "occluded" ? String(OCCLUDED_OPACITY) : "1";
  }
}

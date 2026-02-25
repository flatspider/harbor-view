import * as THREE from "three";
import { latLonToWorld } from "./constants";

interface FerryRouteData {
  routes: {
    routeId: string;
    routeName: string;
    routeColor: string;
    shapes: { lat: number; lon: number }[][];
  }[];
}

const ferryObjects: THREE.Object3D[] = [];
let ferryRouteDayOpacity = 0.45;

export async function loadFerryRoutes(scene: THREE.Scene, signal: AbortSignal): Promise<void> {
  try {
    const response = await fetch("/data/ferry-routes.json", { signal });
    if (!response.ok) return;
    const data = (await response.json()) as FerryRouteData;

    for (const route of data.routes) {
      const color = new THREE.Color(route.routeColor);

      for (const shape of route.shapes) {
        if (shape.length < 2) continue;

        const points: THREE.Vector3[] = [];
        for (const pt of shape) {
          const world = latLonToWorld(pt.lat, pt.lon);
          points.push(new THREE.Vector3(world.x, 1.5, world.z));
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineDashedMaterial({
          color,
          opacity: ferryRouteDayOpacity,
          transparent: true,
          dashSize: 12,
          gapSize: 8,
          depthWrite: false,
        });

        const line = new THREE.Line(geometry, material);
        line.computeLineDistances();
        line.renderOrder = 2;
        scene.add(line);
        ferryObjects.push(line);
      }
    }
  } catch {
    // Graceful fallback: no ferry routes rendered
  }
}

export function setFerryRouteNight(night: boolean): void {
  const opacity = night ? 0.2 : 0.45;
  ferryRouteDayOpacity = opacity;
  for (const obj of ferryObjects) {
    if (obj instanceof THREE.Line) {
      const mat = obj.material as THREE.LineDashedMaterial;
      mat.opacity = opacity;
    }
  }
}

export function disposeFerryRoutes(scene: THREE.Scene): void {
  for (const obj of ferryObjects) {
    scene.remove(obj);
    if (obj instanceof THREE.Line) {
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
  }
  ferryObjects.length = 0;
}

import * as THREE from "three";
import { latLonToWorld } from "./constants";
import { isPointOnLand } from "./land";

interface FerryRouteData {
  routes: {
    routeId: string;
    routeName: string;
    routeColor: string;
    shapes: { lat: number; lon: number }[][];
  }[];
}

interface FerryRoutePoint {
  lat: number;
  lon: number;
}

export interface FerryRouteInfo {
  routeId: string;
  routeName: string;
  routeColor: string;
  origin: string;
  destination: string;
  nextDeparture: string;
}

interface FerryRouteLineData {
  isFerryRouteLine: true;
  info: FerryRouteInfo;
  baseColor: THREE.Color;
  hoverColor: THREE.Color;
}

const ferryObjects: THREE.Line[] = [];
const FERRY_ROUTE_SURFACE_Y = 2.1;
const FERRY_ROUTE_DAY_OPACITY = 0.78;
const FERRY_ROUTE_NIGHT_OPACITY = 0.35;
const FERRY_ROUTE_SAMPLE_STEP_DEG = 0.00035;
const FERRY_ROUTE_MAX_SUBDIVISIONS = 18;
let ferryRouteDayOpacity = FERRY_ROUTE_DAY_OPACITY;

const FERRY_ROUTE_TERMINALS: Record<string, { origin: string; destination: string }> = {
  ER: { origin: "Wall St / Pier 11", destination: "East 90 St" },
  RS: { origin: "Rockaway", destination: "Soundview" },
  AS: { origin: "Wall St / Pier 11", destination: "Astoria" },
  SB: { origin: "Corlears Hook", destination: "Bay Ridge" },
  RES: { origin: "Wall St / Pier 11", destination: "Rockaway" },
  RWS: { origin: "Wall St / Pier 11", destination: "Rockaway" },
  SG: { origin: "Midtown West", destination: "St. George" },
};

function inferRouteTerminals(routeId: string, routeName: string): { origin: string; destination: string } {
  const known = FERRY_ROUTE_TERMINALS[routeId];
  if (known) return known;

  const split = routeName
    .split(/-|\/| to /i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (split.length >= 2) {
    return {
      origin: split[0],
      destination: split[split.length - 1],
    };
  }
  return { origin: "Terminal details unavailable", destination: "Terminal details unavailable" };
}

function estimateSubdivisions(start: FerryRoutePoint, end: FerryRoutePoint): number {
  const maxDelta = Math.max(Math.abs(start.lat - end.lat), Math.abs(start.lon - end.lon));
  return THREE.MathUtils.clamp(Math.ceil(maxDelta / FERRY_ROUTE_SAMPLE_STEP_DEG), 1, FERRY_ROUTE_MAX_SUBDIVISIONS);
}

function splitShapeIntoWaterSegments(shape: FerryRoutePoint[]): FerryRoutePoint[][] {
  if (shape.length < 2) return [];

  const segments: FerryRoutePoint[][] = [];
  let active: FerryRoutePoint[] = [];

  const flushSegment = () => {
    if (active.length >= 2) segments.push(active);
    active = [];
  };

  for (let i = 0; i < shape.length - 1; i += 1) {
    const start = shape[i];
    const end = shape[i + 1];
    const subdivisions = estimateSubdivisions(start, end);

    for (let s = 0; s <= subdivisions; s += 1) {
      if (i > 0 && s === 0) continue;

      const t = s / subdivisions;
      const point: FerryRoutePoint = {
        lat: start.lat + (end.lat - start.lat) * t,
        lon: start.lon + (end.lon - start.lon) * t,
      };
      const onLand = isPointOnLand(point.lon, point.lat);

      if (onLand) {
        flushSegment();
        continue;
      }

      const last = active[active.length - 1];
      if (!last || last.lat !== point.lat || last.lon !== point.lon) {
        active.push(point);
      }
    }
  }

  flushSegment();
  return segments;
}

export async function loadFerryRoutes(scene: THREE.Scene, signal: AbortSignal): Promise<void> {
  try {
    const response = await fetch("/data/ferry-routes.json", { signal });
    if (!response.ok) return;
    const data = (await response.json()) as FerryRouteData;

    for (const route of data.routes) {
      const terminals = inferRouteTerminals(route.routeId, route.routeName);
      const info: FerryRouteInfo = {
        routeId: route.routeId,
        routeName: route.routeName,
        routeColor: route.routeColor,
        origin: terminals.origin,
        destination: terminals.destination,
        nextDeparture: "Departure schedule unavailable in current data feed",
      };
      const color = new THREE.Color(route.routeColor).lerp(new THREE.Color("#ffffff"), 0.16);

      for (const shape of route.shapes) {
        if (shape.length < 2) continue;
        const waterSegments = splitShapeIntoWaterSegments(shape);

        for (const segment of waterSegments) {
          if (segment.length < 2) continue;

          const points: THREE.Vector3[] = [];
          for (const pt of segment) {
            const world = latLonToWorld(pt.lat, pt.lon);
            points.push(new THREE.Vector3(world.x, FERRY_ROUTE_SURFACE_Y, world.z));
          }

          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          const material = new THREE.LineDashedMaterial({
            color,
            opacity: ferryRouteDayOpacity,
            transparent: true,
            dashSize: 18,
            gapSize: 12,
            depthTest: true,
            depthWrite: false,
            toneMapped: false,
          });

          const line = new THREE.Line(geometry, material);
          const routeData: FerryRouteLineData = {
            isFerryRouteLine: true,
            info,
            baseColor: color.clone(),
            hoverColor: color.clone().lerp(new THREE.Color("#ffffff"), 0.35),
          };
          line.userData = routeData;
          line.computeLineDistances();
          line.renderOrder = 2;
          scene.add(line);
          ferryObjects.push(line);
        }
      }
    }
  } catch {
    // Graceful fallback: no ferry routes rendered
  }
}

export function getFerryRouteTargets(): THREE.Line[] {
  return ferryObjects;
}

export function getFerryRouteFromObject(object: THREE.Object3D | null): THREE.Line | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const data = current.userData as Partial<FerryRouteLineData>;
    if (data.isFerryRouteLine === true && current instanceof THREE.Line) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

export function getFerryRouteData(routeLine: THREE.Object3D): FerryRouteLineData {
  return routeLine.userData as FerryRouteLineData;
}

export function setFerryRouteNight(night: boolean): void {
  const opacity = night ? FERRY_ROUTE_NIGHT_OPACITY : FERRY_ROUTE_DAY_OPACITY;
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

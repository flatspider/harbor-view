import { NY_HARBOR_BOUNDS } from "../types/ais";

/**
 * Convert latitude/longitude to pixel coordinates on the canvas.
 * Uses simple linear interpolation within the bounding box.
 * Good enough for the small area of NY Harbor — Mercator distortion
 * is negligible at this scale.
 */
export function latLonToPixel(
  lat: number,
  lon: number,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  const { south, north, west, east } = NY_HARBOR_BOUNDS;

  // Normalize to 0-1 range within bounding box
  const xNorm = (lon - west) / (east - west);
  const yNorm = 1 - (lat - south) / (north - south); // flip Y: lat increases up, pixels increase down

  return {
    x: xNorm * canvasWidth,
    y: yNorm * canvasHeight,
  };
}

/**
 * Linear interpolation between two values.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(Math.max(t, 0), 1);
}

/**
 * Get interpolated position for a ship based on time elapsed since last update.
 * Uses previous and current positions to smoothly animate between updates.
 */
export function getInterpolatedPosition(
  prevLat: number,
  prevLon: number,
  lat: number,
  lon: number,
  lastUpdateTime: number,
  now: number,
  updateIntervalMs: number = 5000
): { lat: number; lon: number } {
  const elapsed = now - lastUpdateTime;
  const t = Math.min(elapsed / updateIntervalMs, 1);

  return {
    lat: lerp(prevLat, lat, t),
    lon: lerp(prevLon, lon, t),
  };
}

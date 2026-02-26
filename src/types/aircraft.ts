/** Aircraft data from /api/aircraft (adsb.lol passthrough) */
export interface AircraftData {
  hex: string;       // ICAO hex identifier
  flight: string;    // Callsign / flight number (trimmed)
  lat: number;
  lon: number;
  alt_baro: number;  // Barometric altitude in feet
  alt_geom: number;  // Geometric altitude in feet
  gs: number;        // Ground speed in knots
  track: number;     // Track angle in degrees (0 = north, clockwise)
  category: string;  // Emitter category (e.g., "A1"=light, "A3"=large)
  squawk: string;
  lastSeen: number;  // Timestamp ms
}

/** Size class derived from ADS-B emitter category */
export type AircraftSizeClass = "light" | "medium" | "heavy";

export function getAircraftSizeClass(category: string): AircraftSizeClass {
  // adsb.lol category field: A1=light, A2=small, A3=large, A4=high-vortex-large, A5=heavy
  // B-categories are rotorcraft, C=glider, etc.
  switch (category) {
    case "A5":
    case "A4":
      return "heavy";
    case "A3":
      return "medium";
    default:
      return "light";
  }
}

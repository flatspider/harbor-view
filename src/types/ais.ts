// AIS message types from aisstream.io WebSocket API

export interface AISPositionReport {
  Cog: number; // Course over ground (degrees)
  Latitude: number;
  Longitude: number;
  MessageID: number;
  NavigationalStatus: number;
  RateOfTurn: number;
  Sog: number; // Speed over ground (knots)
  Timestamp: number;
  TrueHeading: number; // 0-359, 511 = unavailable
  UserID: number; // MMSI
  Valid: boolean;
}

export interface AISStaticData {
  CallSign: string;
  Destination: string;
  Dimension: {
    A: number; // meters from GPS to bow
    B: number; // meters from GPS to stern
    C: number; // meters from GPS to port
    D: number; // meters from GPS to starboard
  };
  Eta: {
    Day: number;
    Hour: number;
    Minute: number;
    Month: number;
  };
  ImoNumber: number;
  MaximumStaticDraught: number;
  Name: string;
  Type: number; // Ship type code
  UserID: number; // MMSI
  Valid: boolean;
}

export interface AISMetaData {
  MMSI?: number;
  MMSI_String?: string;
  ShipName?: string;
  latitude?: number;
  longitude?: number;
  Latitude?: number;
  Longitude?: number;
  time_utc?: string;
}

export interface AISMessage {
  MessageType: "PositionReport" | "ShipStaticData";
  Message: {
    PositionReport?: AISPositionReport;
    ShipStaticData?: AISStaticData;
  };
  MetaData?: AISMetaData;
  Metadata?: AISMetaData;
}

// Our unified ship data model (merges position + static data)
export interface ShipData {
  mmsi: number;
  name: string;
  lat: number;
  lon: number;
  prevLat: number;
  prevLon: number;
  cog: number; // course over ground
  sog: number; // speed over ground (knots)
  heading: number; // true heading
  navStatus: number;
  shipType: number;
  destination: string;
  callSign: string;
  lengthM: number;
  beamM: number;
  lastUpdate: number; // timestamp ms
  lastPositionUpdate: number; // timestamp ms for interpolation
}

// Ship type categories (first digit of type code)
export type ShipCategory =
  | "special" // 3x: tug, pilot, military, SAR
  | "passenger" // 6x: ferry, cruise
  | "cargo" // 7x: bulk, container
  | "tanker" // 8x: oil, gas, chemical
  | "other"; // everything else

export function getShipCategory(typeCode: number): ShipCategory {
  const firstDigit = Math.floor(typeCode / 10);
  switch (firstDigit) {
    case 3:
      return "special";
    case 6:
      return "passenger";
    case 7:
      return "cargo";
    case 8:
      return "tanker";
    default:
      return "other";
  }
}

// Navigational status descriptions
export const NAV_STATUS: Record<number, string> = {
  0: "Under way using engine",
  1: "At anchor",
  2: "Not under command",
  3: "Restricted maneuverability",
  4: "Constrained by draught",
  5: "Moored",
  6: "Aground",
  7: "Engaged in fishing",
  8: "Under way sailing",
  14: "AIS-SART (active)",
  15: "Not defined",
};

// NY Harbor bounding box
export const NY_HARBOR_BOUNDS = {
  south: 40.48,
  north: 40.92,
  west: -74.26,
  east: -73.9,
} as const;

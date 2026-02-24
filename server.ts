import express from "express";
import http from "node:http";
import ViteExpress from "vite-express";
import { WebSocket } from "ws";
import type { AISMessage, ShipData } from "./src/types/ais";

const PORT = Number(process.env.PORT ?? 5173);
const AIS_STREAM_URL = "wss://stream.aisstream.io/v0/stream";
const AIS_API_KEY =
  process.env.AISSTREAM_API_KEY ?? process.env.VITE_AISSTREAM_API_KEY ?? "";

const NY_HARBOR_BOUNDS = {
  south: 40.48,
  north: 40.78,
  west: -74.26,
  east: -73.9,
} as const;

type RelayStatus = "connecting" | "connected" | "disconnected" | "error";

const app = express();
const httpServer = http.createServer(app);

const ships = new Map<number, ShipData>();
let upstream: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
let upstreamStatus: RelayStatus = "disconnected";
let upstreamStatusMessage: string | undefined;

function setStatus(state: RelayStatus, message?: string) {
  upstreamStatus = state;
  upstreamStatusMessage = message;
}

function clearReconnect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = undefined;
  }
}

function scheduleReconnect() {
  clearReconnect();
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = undefined;
    connectUpstream();
  }, 3000);
}

function isAisMessage(value: unknown): value is AISMessage {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Partial<AISMessage>;
  return typeof maybe.MessageType === "string" && maybe.Message !== undefined;
}

function ingestAisMessage(data: AISMessage) {
  const now = Date.now();
  const metaData = data.MetaData ?? data.Metadata;
  const mmsi =
    metaData?.MMSI ??
    data.Message.PositionReport?.UserID ??
    data.Message.ShipStaticData?.UserID;

  if (!mmsi) return;

  const existing = ships.get(mmsi);

  if (data.MessageType === "PositionReport" && data.Message.PositionReport) {
    const pos = data.Message.PositionReport;

    ships.set(mmsi, {
      mmsi,
      name: existing?.name || metaData?.ShipName || `MMSI ${mmsi}`,
      prevLat: existing?.lat ?? pos.Latitude,
      prevLon: existing?.lon ?? pos.Longitude,
      lat: pos.Latitude,
      lon: pos.Longitude,
      cog: pos.Cog,
      sog: pos.Sog,
      heading: pos.TrueHeading === 511 ? pos.Cog : pos.TrueHeading,
      navStatus: pos.NavigationalStatus,
      shipType: existing?.shipType ?? 0,
      destination: existing?.destination ?? "",
      callSign: existing?.callSign ?? "",
      lastUpdate: now,
      lastPositionUpdate: now,
    });
    return;
  }

  if (data.MessageType === "ShipStaticData" && data.Message.ShipStaticData) {
    const staticData = data.Message.ShipStaticData;

    ships.set(mmsi, {
      mmsi,
      name: staticData.Name || existing?.name || `MMSI ${mmsi}`,
      prevLat: existing?.prevLat ?? 0,
      prevLon: existing?.prevLon ?? 0,
      lat: existing?.lat ?? metaData?.latitude ?? metaData?.Latitude ?? 0,
      lon: existing?.lon ?? metaData?.longitude ?? metaData?.Longitude ?? 0,
      cog: existing?.cog ?? 0,
      sog: existing?.sog ?? 0,
      heading: existing?.heading ?? 0,
      navStatus: existing?.navStatus ?? 0,
      shipType: staticData.Type,
      destination: staticData.Destination,
      callSign: staticData.CallSign,
      lastUpdate: now,
      lastPositionUpdate: existing?.lastPositionUpdate ?? now,
    });
  }
}

function connectUpstream() {
  if (!AIS_API_KEY) {
    setStatus("error", "Missing AISSTREAM_API_KEY in server environment");
    return;
  }

  if (
    upstream &&
    (upstream.readyState === WebSocket.OPEN ||
      upstream.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  clearReconnect();
  setStatus("connecting");

  const ws = new WebSocket(AIS_STREAM_URL);
  upstream = ws;

  ws.on("open", () => {
    if (upstream !== ws) return;

    const subscription = {
      APIKey: AIS_API_KEY,
      BoundingBoxes: [
        [
          [NY_HARBOR_BOUNDS.south, NY_HARBOR_BOUNDS.west],
          [NY_HARBOR_BOUNDS.north, NY_HARBOR_BOUNDS.east],
        ],
      ],
      FilterMessageTypes: ["PositionReport", "ShipStaticData"],
    };

    ws.send(JSON.stringify(subscription));
    setStatus("connected");
  });

  ws.on("message", (raw) => {
    if (upstream !== ws) return;

    try {
      const parsed = JSON.parse(raw.toString()) as unknown;
      if (!isAisMessage(parsed)) return;
      ingestAisMessage(parsed);
    } catch {
      // Ignore malformed/non-json payloads.
    }
  });

  ws.on("error", (error) => {
    if (upstream !== ws) return;
    setStatus("error", error.message);
  });

  ws.on("close", (code, reason) => {
    if (upstream !== ws) return;

    upstream = null;
    const reasonText = reason.toString();
    const details = reasonText
      ? `AIS stream closed (${code}: ${reasonText})`
      : `AIS stream closed (${code})`;

    setStatus("disconnected", details);
    scheduleReconnect();
  });
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    upstreamStatus,
    upstreamStatusMessage,
    shipCount: ships.size,
  });
});

app.get("/api/ships", (_req, res) => {
  res.json({
    status: upstreamStatus,
    message: upstreamStatusMessage,
    ships: Array.from(ships.values()),
  });
});

setInterval(() => {
  const now = Date.now();
  const staleThreshold = 5 * 60 * 1000;

  for (const [mmsi, ship] of ships) {
    if (now - ship.lastUpdate > staleThreshold) {
      ships.delete(mmsi);
    }
  }
}, 30000);

httpServer.listen(PORT, () => {
  console.log(`Harbor Watch server listening on http://localhost:${PORT}`);
});

ViteExpress.bind(app, httpServer, () => {
  connectUpstream();
})
  .catch((error: unknown) => {
    console.error("Failed to bind ViteExpress", error);
    process.exit(1);
  });

import express from "express";
import http from "node:http";
import ViteExpress from "vite-express";
import { WebSocket } from "ws";
import postgres from "postgres";
import type { AISMessage, ShipData } from "./src/types/ais";
import { computeMoonPhase } from "./src/utils/moon";

const PORT = Number(process.env.PORT ?? 5173);
const AIS_STREAM_URL = "wss://stream.aisstream.io/v0/stream";
const AIS_API_KEY =
  process.env.AISSTREAM_API_KEY ?? process.env.VITE_AISSTREAM_API_KEY ?? "";

const NY_HARBOR_BOUNDS = {
  south: 40.48,
  north: 40.92,
  west: -74.26,
  east: -73.9,
} as const;

const NY_HARBOR_POINT = {
  lat: 40.7003,
  lon: -74.0128,
} as const;

const NOAA_STATION_ID = process.env.NOAA_COOPS_STATION_ID ?? "8518750";
const NOAA_CURRENTS_STATION_ID = process.env.NOAA_CURRENTS_STATION_ID ?? "n03020";
const ADSB_RADIUS_NM = Number(process.env.ADSB_RADIUS_NM ?? 25);
const STORMGLASS_API_KEY = process.env.STORMGLASS_API_KEY ?? "";
const PORTWATCH_API_URL =
  process.env.PORTWATCH_API_URL ??
  "https://portwatch.imf.org/api/v1/throughput?frequency=daily";

const DATA_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const DATA_TTL_MS = 2 * 60 * 1000;
const POSITION_FLUSH_INTERVAL_MS = 5000;

/* ── Postgres ────────────────────────────────────────────────────────── */

const DATABASE_URL = process.env.DATABASE_URL ?? "";

const sql = DATABASE_URL
  ? postgres(DATABASE_URL, {
      max: 5,
      idle_timeout: 30,
      connect_timeout: 10,
      ssl: "require",
    })
  : null;

let dbConnected = false;

interface PositionRow {
  mmsi: number;
  lat: number;
  lon: number;
  cog: number;
  sog: number;
  heading: number;
  nav_status: number;
  received_at: Date;
}

const positionBuffer: PositionRow[] = [];

async function flushPositionBuffer() {
  if (!sql || positionBuffer.length === 0) return;

  const batch = positionBuffer.splice(0, positionBuffer.length);

  try {
    await sql`
      INSERT INTO vessel_positions ${sql(batch, "mmsi", "lat", "lon", "cog", "sog", "heading", "nav_status", "received_at")}
    `;
  } catch (error) {
    console.error("Failed to flush position buffer:", error);
    // Put rows back for next attempt (at the front)
    positionBuffer.unshift(...batch);
  }
}

async function checkDbConnection() {
  if (!sql) {
    dbConnected = false;
    return;
  }
  try {
    await sql`SELECT 1`;
    dbConnected = true;
  } catch {
    dbConnected = false;
  }
}

// Periodically flush the position buffer
const positionFlushInterval = sql
  ? setInterval(() => void flushPositionBuffer(), POSITION_FLUSH_INTERVAL_MS)
  : null;

// Check DB connection on startup
void checkDbConnection();

type RelayStatus = "connecting" | "connected" | "disconnected" | "error";
type IntegrationStatus = "ok" | "degraded" | "error" | "skipped";

interface IntegrationSnapshot {
  id: string;
  name: string;
  status: IntegrationStatus;
  updatedAt: string;
  message?: string;
  data: Record<string, string | number | boolean | null>;
}

const app = express();
const httpServer = http.createServer(app);

const ships = new Map<number, ShipData>();
let upstream: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
let upstreamStatus: RelayStatus = "disconnected";
let upstreamStatusMessage: string | undefined;

let integrationSnapshots: IntegrationSnapshot[] = [];
let integrationsLastFetched = 0;
let integrationsInFlight: Promise<void> | null = null;

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

function ensureRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function makeSnapshot(
  id: string,
  name: string,
  status: IntegrationStatus,
  data: Record<string, string | number | boolean | null>,
  message?: string,
): IntegrationSnapshot {
  return {
    id,
    name,
    status,
    data,
    message,
    updatedAt: new Date().toISOString(),
  };
}

async function fetchJson(
  url: string,
  init?: RequestInit,
  timeoutMs = 7000,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        "User-Agent": "harbor-watch/1.0",
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(
  url: string,
  init?: RequestInit,
  timeoutMs = 7000,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        "User-Agent": "harbor-watch/1.0",
        Accept: "text/plain,text/csv,text/html,*/*",
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
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

    const heading = pos.TrueHeading === 511 ? pos.Cog : pos.TrueHeading;

    ships.set(mmsi, {
      mmsi,
      name: existing?.name || metaData?.ShipName || `MMSI ${mmsi}`,
      prevLat: existing?.lat ?? pos.Latitude,
      prevLon: existing?.lon ?? pos.Longitude,
      lat: pos.Latitude,
      lon: pos.Longitude,
      cog: pos.Cog,
      sog: pos.Sog,
      heading,
      navStatus: pos.NavigationalStatus,
      shipType: existing?.shipType ?? 0,
      destination: existing?.destination ?? "",
      callSign: existing?.callSign ?? "",
      lengthM: existing?.lengthM ?? 0,
      beamM: existing?.beamM ?? 0,
      lastUpdate: now,
      lastPositionUpdate: now,
    });

    // Buffer position for DB persistence
    if (sql) {
      positionBuffer.push({
        mmsi,
        lat: pos.Latitude,
        lon: pos.Longitude,
        cog: pos.Cog,
        sog: pos.Sog,
        heading,
        nav_status: pos.NavigationalStatus,
        received_at: new Date(now),
      });
    }
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
      lengthM: staticData.Dimension.A + staticData.Dimension.B,
      beamM: staticData.Dimension.C + staticData.Dimension.D,
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

async function getNoaaPortsSnapshot(): Promise<IntegrationSnapshot> {
  try {
    const baseUrl = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest&station=${NOAA_STATION_ID}&time_zone=gmt&units=metric&format=json`;
    const [airTempRaw, waterTempRaw, pressureRaw, windRaw] = await Promise.all([
      fetchJson(`${baseUrl}&product=air_temperature`),
      fetchJson(`${baseUrl}&product=water_temperature`),
      fetchJson(`${baseUrl}&product=air_pressure`),
      fetchJson(`${baseUrl}&product=wind`),
    ]);

    const airTempData = asArray(ensureRecord(airTempRaw)?.data);
    const waterTempData = asArray(ensureRecord(waterTempRaw)?.data);
    const pressureData = asArray(ensureRecord(pressureRaw)?.data);
    const windData = asArray(ensureRecord(windRaw)?.data);

    const latestAirTemp = ensureRecord(airTempData[airTempData.length - 1]);
    const latestWaterTemp = ensureRecord(waterTempData[waterTempData.length - 1]);
    const latestPressure = ensureRecord(pressureData[pressureData.length - 1]);
    const latestWind = ensureRecord(windData[windData.length - 1]);

    return makeSnapshot("noaa-ports", "NOAA PORTS", "ok", {
      stationId: NOAA_STATION_ID,
      airTempC: asNumber(latestAirTemp?.v),
      waterTempC: asNumber(latestWaterTemp?.v),
      pressureHpa: asNumber(latestPressure?.v),
      windSpeedMs: asNumber(latestWind?.s),
      windDirectionDeg: asNumber(latestWind?.d),
      windGustMs: asNumber(latestWind?.g),
    });
  } catch (error) {
    return makeSnapshot(
      "noaa-ports",
      "NOAA PORTS",
      "error",
      { stationId: NOAA_STATION_ID },
      error instanceof Error ? error.message : "Unable to fetch NOAA PORTS",
    );
  }
}

async function getNoaaCoopsSnapshot(): Promise<IntegrationSnapshot> {
  try {
    const [waterLevelRaw, predictionsRaw] = await Promise.all([
      fetchJson(
        `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest&station=${NOAA_STATION_ID}&product=water_level&datum=MLLW&time_zone=gmt&units=metric&format=json`,
      ),
      fetchJson(
        `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest&station=${NOAA_STATION_ID}&product=predictions&datum=MLLW&time_zone=gmt&units=metric&interval=hilo&format=json`,
      ),
    ]);

    const waterRecord = ensureRecord(waterLevelRaw);
    const waterData = asArray(waterRecord?.data);
    const latestWater = ensureRecord(waterData[waterData.length - 1]);

    const predictionRecord = ensureRecord(predictionsRaw);
    const predictions = asArray(predictionRecord?.predictions);
    const nextTide = ensureRecord(predictions[0]);

    const waterLevelMeters = asNumber(latestWater?.v);
    const trend = asString(latestWater?.f);

    return makeSnapshot("noaa-coops", "NOAA CO-OPS", "ok", {
      stationId: NOAA_STATION_ID,
      waterLevelM: waterLevelMeters,
      trend,
      nextTideHeightM: asNumber(nextTide?.v),
      nextTideAt: asString(nextTide?.t),
    });
  } catch (error) {
    return makeSnapshot(
      "noaa-coops",
      "NOAA CO-OPS",
      "error",
      {
        stationId: NOAA_STATION_ID,
      },
      error instanceof Error ? error.message : "Unable to fetch NOAA CO-OPS",
    );
  }
}

async function getNoaaCurrentsSnapshot(): Promise<IntegrationSnapshot> {
  try {
    const raw = await fetchJson(
      `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest&station=${NOAA_CURRENTS_STATION_ID}&product=currents&time_zone=gmt&units=english&format=json`,
    );

    const record = ensureRecord(raw);
    const data = asArray(record?.data);
    const latest = ensureRecord(data[data.length - 1]);

    return makeSnapshot("noaa-currents", "NOAA Currents", "ok", {
      stationId: NOAA_CURRENTS_STATION_ID,
      speedKnots: asNumber(latest?.s),
      directionDeg: asNumber(latest?.d),
      bin: asString(latest?.b),
      time: asString(latest?.t),
    });
  } catch (error) {
    return makeSnapshot(
      "noaa-currents",
      "NOAA Currents",
      "error",
      {
        stationId: NOAA_CURRENTS_STATION_ID,
      },
      error instanceof Error ? error.message : "Unable to fetch NOAA Currents",
    );
  }
}

async function getOpenMeteoSnapshot(): Promise<IntegrationSnapshot> {
  try {
    const url =
      "https://marine-api.open-meteo.com/v1/marine" +
      `?latitude=${NY_HARBOR_POINT.lat}&longitude=${NY_HARBOR_POINT.lon}` +
      "&current=wave_height,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature";

    const raw = await fetchJson(url);
    const record = ensureRecord(raw);
    const current = ensureRecord(record?.current);

    return makeSnapshot("open-meteo-marine", "Open-Meteo Marine", "ok", {
      waveHeightM: asNumber(current?.wave_height),
      swellHeightM: asNumber(current?.swell_wave_height),
      swellPeriodS: asNumber(current?.swell_wave_period),
      swellDirectionDeg: asNumber(current?.swell_wave_direction),
      seaSurfaceTempC: asNumber(current?.sea_surface_temperature),
      currentTime: asString(current?.time),
    });
  } catch (error) {
    return makeSnapshot(
      "open-meteo-marine",
      "Open-Meteo Marine",
      "error",
      {},
      error instanceof Error
        ? error.message
        : "Unable to fetch Open-Meteo Marine",
    );
  }
}

async function getNwsSnapshot(): Promise<IntegrationSnapshot> {
  try {
    const pointUrl = `https://api.weather.gov/points/${NY_HARBOR_POINT.lat},${NY_HARBOR_POINT.lon}`;
    const pointRaw = await fetchJson(pointUrl);
    const point = ensureRecord(pointRaw);
    const pointProperties = ensureRecord(point?.properties);

    const forecastUrl = asString(pointProperties?.forecast);
    if (!forecastUrl) {
      throw new Error("Missing forecast URL from api.weather.gov/points response");
    }

    const [forecastRaw, alertsRaw] = await Promise.all([
      fetchJson(forecastUrl),
      fetchJson(
        `https://api.weather.gov/alerts/active?point=${NY_HARBOR_POINT.lat},${NY_HARBOR_POINT.lon}`,
      ),
    ]);

    const forecast = ensureRecord(forecastRaw);
    const forecastProperties = ensureRecord(forecast?.properties);
    const forecastPeriods = asArray(forecastProperties?.periods);
    const firstPeriod = ensureRecord(forecastPeriods[0]);

    const alerts = ensureRecord(alertsRaw);
    const alertFeatures = asArray(alerts?.features);

    return makeSnapshot("nws", "NWS", "ok", {
      forecastPeriod: asString(firstPeriod?.name),
      forecastTempF: asNumber(firstPeriod?.temperature),
      forecastWind: asString(firstPeriod?.windSpeed),
      forecastSummary: asString(firstPeriod?.shortForecast),
      activeAlerts: alertFeatures.length,
    });
  } catch (error) {
    return makeSnapshot(
      "nws",
      "NWS",
      "error",
      {},
      error instanceof Error ? error.message : "Unable to fetch NWS data",
    );
  }
}

async function getAdsbSnapshot(): Promise<IntegrationSnapshot> {
  try {
    const raw = await fetchJson(
      `https://api.adsb.lol/v2/lat/${NY_HARBOR_POINT.lat}/lon/${NY_HARBOR_POINT.lon}/dist/${ADSB_RADIUS_NM}`,
    );
    const record = ensureRecord(raw);

    const ac = asArray(record?.ac);
    const messages = asNumber(record?.msg);

    return makeSnapshot("adsb", "adsb.lol", "ok", {
      radiusNm: ADSB_RADIUS_NM,
      aircraftCount: ac.length,
      messages,
      now: asNumber(record?.now),
    });
  } catch (error) {
    return makeSnapshot(
      "adsb",
      "adsb.lol",
      "error",
      {
        radiusNm: ADSB_RADIUS_NM,
      },
      error instanceof Error ? error.message : "Unable to fetch adsb.lol",
    );
  }
}

async function getAccessAisSnapshot(): Promise<IntegrationSnapshot> {
  try {
    const html = await fetchText("https://marinecadastre.gov/accessais/");
    const matches = html.match(/\.zip/gi);

    return makeSnapshot("accessais", "NOAA AccessAIS", "ok", {
      sourceUrl: "https://marinecadastre.gov/accessais/",
      zipLinksDetected: matches?.length ?? 0,
      hasArchiveLinks: (matches?.length ?? 0) > 0,
    });
  } catch (error) {
    return makeSnapshot(
      "accessais",
      "NOAA AccessAIS",
      "error",
      {
        sourceUrl: "https://marinecadastre.gov/accessais/",
      },
      error instanceof Error ? error.message : "Unable to fetch AccessAIS",
    );
  }
}

async function getPortWatchSnapshot(): Promise<IntegrationSnapshot> {
  try {
    const raw = await fetchJson(PORTWATCH_API_URL);
    const record = ensureRecord(raw);

    const dataArray = asArray(record?.data);
    const featuresArray = asArray(record?.features);

    if (dataArray.length === 0 && featuresArray.length === 0) {
      return makeSnapshot(
        "portwatch",
        "IMF PortWatch",
        "degraded",
        {
          endpoint: PORTWATCH_API_URL,
          records: 0,
        },
        "Endpoint reachable but returned no data array",
      );
    }

    const total = dataArray.length > 0 ? dataArray.length : featuresArray.length;

    return makeSnapshot("portwatch", "IMF PortWatch", "ok", {
      endpoint: PORTWATCH_API_URL,
      records: total,
    });
  } catch (error) {
    return makeSnapshot(
      "portwatch",
      "IMF PortWatch",
      "error",
      {
        endpoint: PORTWATCH_API_URL,
      },
      error instanceof Error
        ? error.message
        : "Unable to fetch IMF PortWatch",
    );
  }
}

async function getStormglassSnapshot(): Promise<IntegrationSnapshot> {
  if (!STORMGLASS_API_KEY) {
    return makeSnapshot(
      "stormglass",
      "Stormglass",
      "skipped",
      {
        configured: false,
      },
      "Set STORMGLASS_API_KEY to enable this source",
    );
  }

  try {
    const raw = await fetchJson(
      "https://api.stormglass.io/v2/weather/point" +
        `?lat=${NY_HARBOR_POINT.lat}&lng=${NY_HARBOR_POINT.lon}` +
        "&params=waveHeight,swellHeight,waterTemperature&source=noaa",
      {
        headers: {
          Authorization: STORMGLASS_API_KEY,
        },
      },
    );

    const record = ensureRecord(raw);
    const hours = asArray(record?.hours);
    const firstHour = ensureRecord(hours[0]);

    const waveHeight = ensureRecord(firstHour?.waveHeight);
    const swellHeight = ensureRecord(firstHour?.swellHeight);
    const waterTemperature = ensureRecord(firstHour?.waterTemperature);

    return makeSnapshot("stormglass", "Stormglass", "ok", {
      waveHeightM: asNumber(waveHeight?.noaa),
      swellHeightM: asNumber(swellHeight?.noaa),
      waterTemperatureC: asNumber(waterTemperature?.noaa),
      hourTime: asString(firstHour?.time),
      configured: true,
    });
  } catch (error) {
    return makeSnapshot(
      "stormglass",
      "Stormglass",
      "error",
      {
        configured: true,
      },
      error instanceof Error ? error.message : "Unable to fetch Stormglass",
    );
  }
}

async function getOfacSnapshot(): Promise<IntegrationSnapshot> {
  try {
    const csv = await fetchText("https://www.treasury.gov/ofac/downloads/sdn.csv");
    const lines = csv.split("\n").filter((line) => line.trim().length > 0);

    return makeSnapshot("ofac-sdn", "OFAC SDN List", "ok", {
      sourceUrl: "https://www.treasury.gov/ofac/downloads/sdn.csv",
      entries: Math.max(lines.length - 1, 0),
      updatedFromDownload: true,
    });
  } catch (error) {
    return makeSnapshot(
      "ofac-sdn",
      "OFAC SDN List",
      "error",
      {
        sourceUrl: "https://www.treasury.gov/ofac/downloads/sdn.csv",
      },
      error instanceof Error ? error.message : "Unable to fetch OFAC SDN",
    );
  }
}

function getMoonPhaseSnapshot(): IntegrationSnapshot {
  const { phase, illumination, phaseName, isSpringTide } = computeMoonPhase(new Date());
  return makeSnapshot("moon-phase", "Moon Phase", "ok", {
    phase,
    illumination,
    phaseName,
    isSpringTide,
  });
}

async function refreshIntegrationSnapshots() {
  const now = Date.now();
  if (now - integrationsLastFetched < DATA_TTL_MS && integrationSnapshots.length > 0) {
    return;
  }

  if (integrationsInFlight) {
    await integrationsInFlight;
    return;
  }

  integrationsInFlight = (async () => {
    const next = await Promise.all([
      getNoaaPortsSnapshot(),
      getNoaaCoopsSnapshot(),
      getNoaaCurrentsSnapshot(),
      getOpenMeteoSnapshot(),
      getNwsSnapshot(),
      getAdsbSnapshot(),
      getAccessAisSnapshot(),
      getPortWatchSnapshot(),
      getStormglassSnapshot(),
      getOfacSnapshot(),
      Promise.resolve(getMoonPhaseSnapshot()),
    ]);

    integrationSnapshots = next;
    integrationsLastFetched = Date.now();
  })();

  try {
    await integrationsInFlight;
  } finally {
    integrationsInFlight = null;
  }
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    upstreamStatus,
    upstreamStatusMessage,
    shipCount: ships.size,
    database: sql ? (dbConnected ? "connected" : "disconnected") : "not_configured",
    positionBufferSize: positionBuffer.length,
    integrationsCount: integrationSnapshots.length,
    integrationsLastFetched:
      integrationsLastFetched > 0
        ? new Date(integrationsLastFetched).toISOString()
        : null,
  });
});

app.get("/api/ships", (_req, res) => {
  res.json({
    status: upstreamStatus,
    message: upstreamStatusMessage,
    ships: Array.from(ships.values()),
  });
});

app.get("/api/data-sources", async (_req, res) => {
  await refreshIntegrationSnapshots();

  res.json({
    status: "ok",
    updatedAt:
      integrationsLastFetched > 0
        ? new Date(integrationsLastFetched).toISOString()
        : null,
    sources: integrationSnapshots,
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

setInterval(() => {
  void refreshIntegrationSnapshots();
}, DATA_REFRESH_INTERVAL_MS);

// Periodic DB health check (every 30s)
if (sql) {
  setInterval(() => void checkDbConnection(), 30000);
}

httpServer.listen(PORT, () => {
  console.log(`Harbor Watch server listening on http://localhost:${PORT}`);
});

ViteExpress.bind(app, httpServer, () => {
  connectUpstream();
  void refreshIntegrationSnapshots();
})
  .catch((error: unknown) => {
    console.error("Failed to bind ViteExpress", error);
    process.exit(1);
  });

/* ── Graceful shutdown ───────────────────────────────────────────────── */

async function shutdown() {
  console.log("Shutting down…");

  if (positionFlushInterval) clearInterval(positionFlushInterval);

  // Flush any remaining buffered positions
  await flushPositionBuffer();

  if (sql) {
    await sql.end({ timeout: 5 });
  }

  if (upstream) {
    upstream.close();
    upstream = null;
  }

  httpServer.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

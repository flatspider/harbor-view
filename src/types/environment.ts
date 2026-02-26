import type { IntegrationSnapshot } from "./integrations";

export interface HarborEnvironment {
  tideLevelM: number;
  tideTrend: string;
  waveHeightM: number;
  swellDirectionDeg: number;
  seaSurfaceTempC: number;
  currentSpeedKnots: number;
  currentDirectionDeg: number;
  windSpeedMph: number;
  windDirectionDeg: number;
  windDirectionCardinal: string;
  forecastSummary: string;
  forecastTempF: number;
  activeAlerts: number;
  airTempC: number;
  pressureHpa: number;
  moonPhase: number;
  moonIllumination: number;
  moonPhaseName: string;
  isSpringTide: boolean;
}

const CARDINAL_TO_DEG: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
};

const CARDINALS_16 = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

function degreesToCardinal(deg: number): string {
  const index = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return CARDINALS_16[index];
}

function sourceById(sources: IntegrationSnapshot[], id: string): IntegrationSnapshot | null {
  return sources.find((source) => source.id === id) ?? null;
}

function numberValue(value: string | number | boolean | null | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function stringValue(value: string | number | boolean | null | undefined, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function parseWind(wind: string): { mph: number; directionCardinal: string; directionDeg: number } {
  const dirMatch = wind.match(/\b([NESW]{1,3})\b/i);
  const speedMatch = wind.match(/(\d+)(?:\s*to\s*(\d+))?\s*mph/i);

  const directionCardinal = dirMatch?.[1]?.toUpperCase() ?? "N";
  const directionDeg = CARDINAL_TO_DEG[directionCardinal] ?? 0;
  const speedMin = speedMatch?.[1] ? Number(speedMatch[1]) : 0;
  const speedMax = speedMatch?.[2] ? Number(speedMatch[2]) : speedMin;
  const mph = speedMax > 0 ? (speedMin + speedMax) * 0.5 : speedMin;

  return { mph, directionCardinal, directionDeg };
}

function booleanValue(value: string | number | boolean | null | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

export function toHarborEnvironment(sources: IntegrationSnapshot[]): HarborEnvironment {
  const noaa = sourceById(sources, "noaa-coops");
  const noaaCurrents = sourceById(sources, "noaa-currents");
  const noaaPorts = sourceById(sources, "noaa-ports");
  const openMeteo = sourceById(sources, "open-meteo-marine");
  const nws = sourceById(sources, "nws");
  const moon = sourceById(sources, "moon-phase");

  const nwsWind = parseWind(stringValue(nws?.data.forecastWind, ""));

  // Prefer NOAA PORTS sensor wind over NWS forecast text
  const portsWindSpeedMs = noaaPorts?.status === "ok" ? numberValue(noaaPorts.data.windSpeedMs, NaN) : NaN;
  const portsWindDirDeg = noaaPorts?.status === "ok" ? numberValue(noaaPorts.data.windDirectionDeg, NaN) : NaN;
  const usePortsWind = Number.isFinite(portsWindSpeedMs) && Number.isFinite(portsWindDirDeg);

  const windSpeedMph = usePortsWind ? portsWindSpeedMs * 2.237 : nwsWind.mph;
  const windDirectionDeg = usePortsWind ? portsWindDirDeg : nwsWind.directionDeg;
  const windDirectionCardinal = usePortsWind
    ? degreesToCardinal(portsWindDirDeg)
    : nwsWind.directionCardinal;

  // Prefer NOAA PORTS water temp > Open-Meteo > fallback 10
  const portsWaterTempC = noaaPorts?.status === "ok" ? numberValue(noaaPorts.data.waterTempC, NaN) : NaN;
  const seaSurfaceTempC = Number.isFinite(portsWaterTempC)
    ? portsWaterTempC
    : numberValue(openMeteo?.data.seaSurfaceTempC, 10);

  return {
    tideLevelM: numberValue(noaa?.data.waterLevelM, 0),
    tideTrend: stringValue(noaa?.data.trend, ""),
    waveHeightM: numberValue(openMeteo?.data.waveHeightM, 0.35),
    swellDirectionDeg: numberValue(openMeteo?.data.swellDirectionDeg, 90),
    seaSurfaceTempC,
    currentSpeedKnots: numberValue(noaaCurrents?.data.speedKnots, 0),
    currentDirectionDeg: numberValue(noaaCurrents?.data.directionDeg, 0),
    windSpeedMph,
    windDirectionDeg,
    windDirectionCardinal,
    forecastSummary: stringValue(nws?.data.forecastSummary, "Unknown"),
    forecastTempF: numberValue(nws?.data.forecastTempF, 50),
    activeAlerts: numberValue(nws?.data.activeAlerts, 0),
    airTempC: numberValue(noaaPorts?.data.airTempC, 15),
    pressureHpa: numberValue(noaaPorts?.data.pressureHpa, 1013),
    moonPhase: numberValue(moon?.data.phase, 0.5),
    moonIllumination: numberValue(moon?.data.illumination, 0.5),
    moonPhaseName: stringValue(moon?.data.phaseName, "Unknown"),
    isSpringTide: booleanValue(moon?.data.isSpringTide, false),
  };
}

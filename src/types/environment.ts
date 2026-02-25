import type { IntegrationSnapshot } from "./integrations";

export interface HarborEnvironment {
  tideLevelM: number;
  tideTrend: string;
  waveHeightM: number;
  swellDirectionDeg: number;
  seaSurfaceTempC: number;
  windSpeedMph: number;
  windDirectionDeg: number;
  windDirectionCardinal: string;
  forecastSummary: string;
  forecastTempF: number;
  activeAlerts: number;
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

export function toHarborEnvironment(sources: IntegrationSnapshot[]): HarborEnvironment {
  const noaa = sourceById(sources, "noaa-coops");
  const openMeteo = sourceById(sources, "open-meteo-marine");
  const nws = sourceById(sources, "nws");

  const wind = parseWind(stringValue(nws?.data.forecastWind, ""));

  return {
    tideLevelM: numberValue(noaa?.data.waterLevelM, 0),
    tideTrend: stringValue(noaa?.data.trend, ""),
    waveHeightM: numberValue(openMeteo?.data.waveHeightM, 0.35),
    swellDirectionDeg: numberValue(openMeteo?.data.swellDirectionDeg, 90),
    seaSurfaceTempC: numberValue(openMeteo?.data.seaSurfaceTempC, 10),
    windSpeedMph: wind.mph,
    windDirectionDeg: wind.directionDeg,
    windDirectionCardinal: wind.directionCardinal,
    forecastSummary: stringValue(nws?.data.forecastSummary, "Unknown"),
    forecastTempF: numberValue(nws?.data.forecastTempF, 50),
    activeAlerts: numberValue(nws?.data.activeAlerts, 0),
  };
}

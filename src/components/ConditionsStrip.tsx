import type { HarborEnvironment } from "../types/environment";

interface ConditionsStripProps {
  environment: HarborEnvironment;
}

function formatMeters(value: number): string {
  return `${value.toFixed(2)} m`;
}

const CARDINALS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

function degreesToCardinal(deg: number): string {
  const index = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return CARDINALS[index];
}

const MOON_EMOJIS = ["\u{1F311}", "\u{1F312}", "\u{1F313}", "\u{1F314}", "\u{1F315}", "\u{1F316}", "\u{1F317}", "\u{1F318}"] as const;

function moonEmoji(phase: number): string {
  const octant = Math.floor(phase * 8) % 8;
  return MOON_EMOJIS[octant];
}

export function ConditionsStrip({ environment }: ConditionsStripProps) {
  return (
    <section className="conditions-strip" aria-label="Harbor conditions">
      <div className="condition-pill">
        <span>Tide</span>
        <strong>{formatMeters(environment.tideLevelM)}</strong>
      </div>
      <div className="condition-pill">
        <span>Wave</span>
        <strong>{formatMeters(environment.waveHeightM)}</strong>
      </div>
      <div className="condition-pill">
        <span>Wind</span>
        <strong>
          {Math.round(environment.windSpeedMph)} mph {environment.windDirectionCardinal}
        </strong>
      </div>
      <div className="condition-pill">
        <span>Sea Temp</span>
        <strong>{environment.seaSurfaceTempC.toFixed(1)} C</strong>
      </div>
      <div className="condition-pill">
        <span>Air Temp</span>
        <strong>
          {environment.airTempC.toFixed(1)}&deg;C / {(environment.airTempC * 9 / 5 + 32).toFixed(0)}&deg;F
        </strong>
      </div>
      <div className="condition-pill">
        <span>Pressure</span>
        <strong>{environment.pressureHpa.toFixed(0)} hPa</strong>
      </div>
      <div className="condition-pill">
        <span>Current</span>
        <strong>
          {environment.currentSpeedKnots.toFixed(1)} kt {degreesToCardinal(environment.currentDirectionDeg)}
        </strong>
      </div>
      <div className="condition-pill">
        <span>Moon</span>
        <strong>
          {moonEmoji(environment.moonPhase)} {Math.round(environment.moonIllumination * 100)}%
        </strong>
      </div>
      <div className="condition-pill">
        <span>Forecast</span>
        <strong>{environment.forecastSummary}</strong>
      </div>
      {environment.activeAlerts > 0 ? (
        <div className="condition-pill alert">
          <span>Alerts</span>
          <strong>{environment.activeAlerts}</strong>
        </div>
      ) : null}
    </section>
  );
}

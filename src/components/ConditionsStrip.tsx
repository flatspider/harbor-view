import type { HarborEnvironment } from "../types/environment";

interface ConditionsStripProps {
  environment: HarborEnvironment;
}

function formatMeters(value: number): string {
  return `${value.toFixed(2)} m`;
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

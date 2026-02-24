import type { IntegrationSnapshot } from "../types/integrations";

interface IntegrationsPanelProps {
  sources: IntegrationSnapshot[];
  updatedAt: string | null;
  isLoading: boolean;
}

const STATUS_META: Record<
  IntegrationSnapshot["status"],
  { label: string; className: string }
> = {
  ok: { label: "OK", className: "ok" },
  degraded: { label: "Degraded", className: "degraded" },
  error: { label: "Error", className: "error" },
  skipped: { label: "Skipped", className: "skipped" },
};

function formatMetricValue(value: string | number | boolean | null): string {
  if (value === null) return "n/a";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function topMetrics(source: IntegrationSnapshot): [string, string | number | boolean | null][] {
  return Object.entries(source.data).slice(0, 3);
}

export function IntegrationsPanel({
  sources,
  updatedAt,
  isLoading,
}: IntegrationsPanelProps) {
  return (
    <section className="integrations-panel">
      <header className="integrations-header">
        <h2>External Data Sources</h2>
        <span>
          {isLoading
            ? "Loading..."
            : updatedAt
              ? `Updated ${new Date(updatedAt).toLocaleTimeString()}`
              : "No data"}
        </span>
      </header>

      <div className="integrations-grid">
        {sources.map((source) => {
          const status = STATUS_META[source.status];

          return (
            <article key={source.id} className="integration-card">
              <div className="integration-card-top">
                <h3>{source.name}</h3>
                <span className={`integration-status ${status.className}`}>
                  {status.label}
                </span>
              </div>

              <dl>
                {topMetrics(source).map(([label, value]) => (
                  <div key={label} className="integration-metric">
                    <dt>{label}</dt>
                    <dd>{formatMetricValue(value)}</dd>
                  </div>
                ))}
              </dl>

              {source.message ? <p className="integration-message">{source.message}</p> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

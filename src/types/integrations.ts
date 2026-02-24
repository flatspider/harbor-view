export type IntegrationStatus = "ok" | "degraded" | "error" | "skipped";

export interface IntegrationSnapshot {
  id: string;
  name: string;
  status: IntegrationStatus;
  updatedAt: string;
  message?: string;
  data: Record<string, string | number | boolean | null>;
}

export interface IntegrationsApiResponse {
  status?: string;
  updatedAt?: string | null;
  sources?: IntegrationSnapshot[];
}

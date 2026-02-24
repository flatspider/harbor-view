import { useCallback, useEffect, useRef, useState } from "react";
import type {
  IntegrationSnapshot,
  IntegrationsApiResponse,
} from "../types/integrations";

export function useIntegrations() {
  const [sources, setSources] = useState<IntegrationSnapshot[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const fetchSources = useCallback(async () => {
    try {
      const response = await fetch("/api/data-sources", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Unexpected status ${response.status}`);
      }

      const payload = (await response.json()) as IntegrationsApiResponse;
      setSources(payload.sources ?? []);
      setUpdatedAt(payload.updatedAt ?? null);
    } catch {
      setSources([]);
      setUpdatedAt(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSources();

    pollRef.current = setInterval(() => {
      void fetchSources();
    }, 60000);

    return () => {
      clearInterval(pollRef.current);
    };
  }, [fetchSources]);

  return { sources, updatedAt, isLoading };
}

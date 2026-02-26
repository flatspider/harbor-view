import { useCallback, useEffect, useRef, useState } from "react";
import type { AircraftData } from "../types/aircraft";

interface UseAircraftDataOptions {
  enabled?: boolean;
}

interface AircraftApiResponse {
  aircraft?: AircraftData[];
}

function hasAircraftChanged(prev: AircraftData, next: AircraftData): boolean {
  return (
    prev.hex !== next.hex ||
    prev.flight !== next.flight ||
    prev.lat !== next.lat ||
    prev.lon !== next.lon ||
    prev.alt_baro !== next.alt_baro ||
    prev.alt_geom !== next.alt_geom ||
    prev.gs !== next.gs ||
    prev.track !== next.track ||
    prev.category !== next.category ||
    prev.lastSeen !== next.lastSeen
  );
}

export function useAircraftData({ enabled = true }: UseAircraftDataOptions = {}) {
  const [aircraft, setAircraft] = useState<Map<string, AircraftData>>(new Map());
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );
  const fetchInFlightRef = useRef(false);

  const fetchAircraft = useCallback(async () => {
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
    try {
      const response = await fetch("/api/aircraft", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Unexpected status ${response.status}`);
      }

      const payload = (await response.json()) as AircraftApiResponse;
      const nextAircraft = payload.aircraft ?? [];

      setAircraft((prev) => {
        if (prev.size === nextAircraft.length) {
          let changed = false;
          for (const ac of nextAircraft) {
            const previousAc = prev.get(ac.hex);
            if (!previousAc || hasAircraftChanged(previousAc, ac)) {
              changed = true;
              break;
            }
          }
          if (!changed) return prev;
        }
        return new Map(nextAircraft.map((ac) => [ac.hex, ac]));
      });
    } catch {
      // Silently degrade — aircraft layer is non-critical
    } finally {
      fetchInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setAircraft(new Map());
      return;
    }

    void fetchAircraft();

    pollIntervalRef.current = setInterval(() => {
      void fetchAircraft();
    }, 5000);

    return () => {
      clearInterval(pollIntervalRef.current);
      fetchInFlightRef.current = false;
    };
  }, [enabled, fetchAircraft]);

  return { aircraft, aircraftCount: aircraft.size };
}

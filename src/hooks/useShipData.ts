import { useCallback, useEffect, useRef, useState } from "react";
import type { ShipData } from "../types/ais";

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

interface UseShipDataOptions {
  enabled?: boolean;
}

interface ShipsApiResponse {
  status?: ConnectionStatus;
  ships?: ShipData[];
}

export function useShipData({ enabled = true }: UseShipDataOptions = {}) {
  const [ships, setShips] = useState<Map<number, ShipData>>(new Map());
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );

  const fetchShips = useCallback(async () => {
    try {
      const response = await fetch("/api/ships", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Unexpected status ${response.status}`);
      }

      const payload = (await response.json()) as ShipsApiResponse;
      const nextStatus = payload.status ?? "error";
      const nextShips = payload.ships ?? [];

      setConnectionStatus(nextStatus);
      setShips(new Map(nextShips.map((ship) => [ship.mmsi, ship])));
    } catch {
      setConnectionStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setConnectionStatus("disconnected");
      setShips(new Map());
      return;
    }

    setConnectionStatus("connecting");
    void fetchShips();

    pollIntervalRef.current = setInterval(() => {
      void fetchShips();
    }, 1000);

    return () => {
      clearInterval(pollIntervalRef.current);
    };
  }, [enabled, fetchShips]);

  return { ships, connectionStatus, shipCount: ships.size };
}

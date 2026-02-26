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

function hasShipDataChanged(prev: ShipData, next: ShipData): boolean {
  return (
    prev.mmsi !== next.mmsi ||
    prev.name !== next.name ||
    prev.lat !== next.lat ||
    prev.lon !== next.lon ||
    prev.prevLat !== next.prevLat ||
    prev.prevLon !== next.prevLon ||
    prev.cog !== next.cog ||
    prev.sog !== next.sog ||
    prev.heading !== next.heading ||
    prev.navStatus !== next.navStatus ||
    prev.shipType !== next.shipType ||
    prev.destination !== next.destination ||
    prev.callSign !== next.callSign ||
    prev.lengthM !== next.lengthM ||
    prev.beamM !== next.beamM ||
    prev.lastUpdate !== next.lastUpdate ||
    prev.lastPositionUpdate !== next.lastPositionUpdate
  );
}

export function useShipData({ enabled = true }: UseShipDataOptions = {}) {
  const [ships, setShips] = useState<Map<number, ShipData>>(new Map());
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );
  const fetchInFlightRef = useRef(false);

  const fetchShips = useCallback(async () => {
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
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

      setConnectionStatus((prev) => (prev === nextStatus ? prev : nextStatus));
      setShips((prev) => {
        if (prev.size === nextShips.length) {
          let changed = false;
          for (const ship of nextShips) {
            const previousShip = prev.get(ship.mmsi);
            if (!previousShip || hasShipDataChanged(previousShip, ship)) {
              changed = true;
              break;
            }
          }
          if (!changed) return prev;
        }
        return new Map(nextShips.map((ship) => [ship.mmsi, ship]));
      });
    } catch {
      setConnectionStatus((prev) => (prev === "error" ? prev : "error"));
    } finally {
      fetchInFlightRef.current = false;
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
      fetchInFlightRef.current = false;
    };
  }, [enabled, fetchShips]);

  return { ships, connectionStatus, shipCount: ships.size };
}

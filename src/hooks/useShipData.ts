import { useEffect, useRef, useCallback, useState } from "react";
import type { AISMessage, ShipData } from "../types/ais";
import { NY_HARBOR_BOUNDS } from "../types/ais";

const WS_URL = "wss://stream.aisstream.io/v0/stream";

interface UseShipDataOptions {
  apiKey: string;
  enabled?: boolean;
}

export function useShipData({ apiKey, enabled = true }: UseShipDataOptions) {
  const [ships, setShips] = useState<Map<number, ShipData>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("disconnected");

  const wsRef = useRef<WebSocket | null>(null);
  const shipsRef = useRef<Map<number, ShipData>>(new Map());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Flush ship state to React on an interval (avoids re-render on every AIS message)
  const flushIntervalRef = useRef<ReturnType<typeof setInterval>>();

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data: AISMessage = JSON.parse(event.data);
      const mmsi = data.MetaData.MMSI;
      const now = Date.now();

      const existing = shipsRef.current.get(mmsi);

      if (data.MessageType === "PositionReport" && data.Message.PositionReport) {
        const pos = data.Message.PositionReport;

        shipsRef.current.set(mmsi, {
          mmsi,
          name: existing?.name || data.MetaData.ShipName || `MMSI ${mmsi}`,
          prevLat: existing?.lat ?? pos.Latitude,
          prevLon: existing?.lon ?? pos.Longitude,
          lat: pos.Latitude,
          lon: pos.Longitude,
          cog: pos.Cog,
          sog: pos.Sog,
          heading: pos.TrueHeading === 511 ? pos.Cog : pos.TrueHeading,
          navStatus: pos.NavigationalStatus,
          shipType: existing?.shipType ?? 0,
          destination: existing?.destination ?? "",
          callSign: existing?.callSign ?? "",
          lastUpdate: now,
          lastPositionUpdate: now,
        });
      } else if (data.MessageType === "ShipStaticData" && data.Message.ShipStaticData) {
        const staticData = data.Message.ShipStaticData;

        shipsRef.current.set(mmsi, {
          mmsi,
          name: staticData.Name || existing?.name || `MMSI ${mmsi}`,
          prevLat: existing?.prevLat ?? 0,
          prevLon: existing?.prevLon ?? 0,
          lat: existing?.lat ?? data.MetaData.latitude,
          lon: existing?.lon ?? data.MetaData.longitude,
          cog: existing?.cog ?? 0,
          sog: existing?.sog ?? 0,
          heading: existing?.heading ?? 0,
          navStatus: existing?.navStatus ?? 0,
          shipType: staticData.Type,
          destination: staticData.Destination,
          callSign: staticData.CallSign,
          lastUpdate: now,
          lastPositionUpdate: existing?.lastPositionUpdate ?? now,
        });
      }
    } catch {
      // Skip malformed messages
    }
  }, []);

  const connect = useCallback(() => {
    if (!apiKey || !enabled) return;

    setConnectionStatus("connecting");

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      // Must send subscription within 3 seconds or connection drops
      const subscription = {
        APIKey: apiKey,
        BoundingBoxes: [
          [
            [NY_HARBOR_BOUNDS.south, NY_HARBOR_BOUNDS.west],
            [NY_HARBOR_BOUNDS.north, NY_HARBOR_BOUNDS.east],
          ],
        ],
        FilterMessageTypes: ["PositionReport", "ShipStaticData"],
      };

      ws.send(JSON.stringify(subscription));
      setConnectionStatus("connected");
    };

    ws.onmessage = handleMessage;

    ws.onerror = () => {
      setConnectionStatus("error");
    };

    ws.onclose = () => {
      setConnectionStatus("disconnected");
      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };
  }, [apiKey, enabled, handleMessage]);

  useEffect(() => {
    connect();

    // Flush ship data to React state every 1 second
    flushIntervalRef.current = setInterval(() => {
      setShips(new Map(shipsRef.current));
    }, 1000);

    return () => {
      wsRef.current?.close();
      clearTimeout(reconnectTimeoutRef.current);
      clearInterval(flushIntervalRef.current);
    };
  }, [connect]);

  // Prune stale ships (no update in 5 minutes)
  useEffect(() => {
    const pruneInterval = setInterval(() => {
      const now = Date.now();
      const staleThreshold = 5 * 60 * 1000;

      for (const [mmsi, ship] of shipsRef.current) {
        if (now - ship.lastUpdate > staleThreshold) {
          shipsRef.current.delete(mmsi);
        }
      }
    }, 30000);

    return () => clearInterval(pruneInterval);
  }, []);

  return { ships, connectionStatus, shipCount: ships.size };
}

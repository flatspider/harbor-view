# HAR-17: Integrate marine, weather, flight, trade, and compliance data sources

Scope: Implement server-side connectors and frontend visibility for NOAA CO-OPS, Open-Meteo Marine, NWS, adsb.lol, NOAA AccessAIS, IMF PortWatch, Stormglass, and OFAC SDN while preserving existing AISStream flow.

Approach:
1. Add typed data-source snapshot model and fetch utilities in `server.ts` with request timeout, normalization, and per-source error isolation.
2. Expose a unified endpoint (`/api/data-sources`) that returns source status, sample metrics, and last-updated timestamps.
3. Add a frontend hook and status panel to show data-source health and key metrics.
4. Document required/optional env vars and endpoint behavior in `README.md`.

Acceptance criteria:
- Existing `/api/ships` behavior unchanged.
- `/api/data-sources` returns all target integrations with success/error status.
- Frontend displays integration status and key values without breaking map rendering.
- Build succeeds via `bun run build`.

# Harbor Watch

Real-time New York Harbor vessel visualization built with React + Vite + Three.js, backed by an Express relay that consumes AISStream over WebSocket.

## Why a backend relay

AISStream authentication should run on the server, not in browser code. The frontend now connects to a local relay (`/api/ships`) and never sends the AIS API key.

## Setup

1. Create `.env` in the project root:

```env
AISSTREAM_API_KEY=your_aisstream_key
NOAA_COOPS_STATION_ID=8518750
ADSB_RADIUS_NM=25
# Optional:
# STORMGLASS_API_KEY=your_stormglass_key
# PORTWATCH_API_URL=https://portwatch.imf.org/api/v1/throughput?frequency=daily
```

2. Install dependencies:

```bash
bun install
```

3. Start development server (Express + Vite):

```bash
bun run dev
```

4. Open [http://localhost:5173](http://localhost:5173)

## Scripts

- `bun run dev` - runs Express + Vite (`server.ts`)
- `bun run dev:client` - runs Vite only (no AIS relay)
- `bun run build` - typecheck + build frontend
- `bun run preview` - production-mode Express server
- `bun run data:import-noaa-shoreline -- --input /abs/path/N40W075.shp` - convert NOAA shapefile to source GeoJSON under `data/sources/`
- `bun run data:build-harbor-land` - rebuild `public/assets/data/nyc-harbor-land.geojson` from shoreline lines

## Architecture

- Frontend: React UI + harbor rendering
- Backend (`server.ts`):
  - Connects to `wss://stream.aisstream.io/v0/stream`
  - Sends AIS subscription (NY Harbor bounding box)
  - Caches/merges AIS messages and serves snapshots at `GET /api/ships`
  - Aggregates external integrations and serves status/metrics at `GET /api/data-sources`

## Data Sources

### Currently Integrated
- AISStream.io (live ship positions via WebSocket)
- NOAA CO-OPS (tides/water level snapshots)
- Open-Meteo Marine (wave/swell/sea temperature)
- NWS (`api.weather.gov` forecast + active alerts)
- adsb.lol (nearby flight position summary)
- NOAA AccessAIS (historical AIS source availability checks)
- IMF PortWatch (trade disruption endpoint polling)
- OFAC SDN list (download/count refresh)

### Optional Integration
- Stormglass (enabled when `STORMGLASS_API_KEY` is configured)

## Harbor Land Geometry (Optional)

For coastline and land-mass rendering in the Three.js harbor scene, add:

- `public/assets/data/nyc-harbor-land.geojson`

Script/source geodata should live outside the runtime asset tree in:

- `data/sources/`

Format details are in [`public/assets/data/README.md`](./public/assets/data/README.md), with a starter template in:

- `public/assets/data/nyc-harbor-land.example.geojson`

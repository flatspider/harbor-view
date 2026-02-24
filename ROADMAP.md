# Harbor Watch — 12-Month Roadmap

## Vision

Harbor Watch is a **production-grade Harbor Digital Twin** — the deepest, richest intelligence product for a single harbor, starting with New York. Not trying to be MarineTraffic (global, enterprise). Instead: **unmatched depth for one harbor**, with consumer-grade UX that makes enterprise platforms look like spreadsheets.

The market gap: enterprise platforms (Kpler, Windward) cost $10K+/year and are ugly. Free tiers (MarineTraffic, VesselFinder) are shallow. Nobody is doing deep single-harbor intelligence with beautiful UX at a prosumer price point ($20-50/month).

## Current State

Working Express backend (`server.ts`) relaying AISStream.io WebSocket data. React + TypeScript frontend with SVG ship markers, wave overlays, ship info cards with GSAP animation, and a nautical color palette. Ships appear, move, and are clickable.

## Tech Stack

- **Runtime:** Bun
- **Build:** Vite
- **Framework:** React + TypeScript
- **Animation:** CSS + GSAP (→ PixiJS displacement → particle systems → 3D shaders)
- **Backend:** Express (→ + SQLite → PostgreSQL + TimescaleDB → + Redis)
- **Ship Data:** AISStream.io (WebSocket, real-time AIS)
- **Hosting:** Local (→ Vercel + Railway → + managed Postgres → + CDN + edge)

---

## Architecture Target

```
┌─────────────────────────────────────────────────────────────┐
│                      Harbor Watch Platform                    │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │  Public Map  │  │  Dashboard   │  │  API (REST/GraphQL) │ │
│  │  (React/     │  │  (Analytics, │  │  (Developer access, │ │
│  │   PixiJS)    │  │   Replay,    │  │   webhooks, alerts) │ │
│  │              │  │   Alerts)    │  │                     │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬──────────┘ │
│         │                 │                      │            │
│  ┌──────┴─────────────────┴──────────────────────┴──────────┐ │
│  │                   Application Server                      │ │
│  │  Express + tRPC/REST                                      │ │
│  │  - AIS ingestion (WebSocket relay) ✅ exists              │ │
│  │  - Data enrichment (weather, tides, vessel details)       │ │
│  │  - Alert engine (geofence, speed, watchlist)              │ │
│  │  - ETA prediction (ML/heuristic)                          │ │
│  │  - Auth + rate limiting                                   │ │
│  └──────┬────────────────────────────────────────────────────┘ │
│         │                                                      │
│  ┌──────┴────────────────────────────────────────────────────┐ │
│  │                   Data Layer                               │ │
│  │  PostgreSQL (or SQLite → Postgres migration)               │ │
│  │  - Ship positions (time-series, partitioned by day)        │ │
│  │  - Ship static data (vessel registry)                      │ │
│  │  - Weather/tide snapshots                                  │ │
│  │  - Alert rules + event log                                 │ │
│  │  - User accounts + subscriptions                           │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Q1: The Foundation (Months 1-3)
*"Secure the beachhead."*

### Month 1 — The Beautiful Map

**Goal:** The most visually stunning harbor visualization on the internet. People screenshot it and share it.

**Week 1 (done/in-progress):**
- [x] Express backend with AIS WebSocket relay
- [x] React frontend with SVG ship markers
- [x] Ship info cards with GSAP animation
- [x] Nautical color palette and wave overlays
- [ ] Ghibli-style painted background image
- [ ] PixiJS displacement filter for living ocean water
- [ ] Smooth ship position interpolation (lerp utilities exist, wire them up)
- [ ] Flight data layer (adsb.lol REST polling) — stretch

**Weeks 2-4:**
- Painted background with masked ocean displacement animation
- Ship type sprites (cargo, tanker, passenger, tug — distinct silhouettes)
- Wake trails behind moving ships (particle system or SVG trail)
- Moored ship gentle bobbing animation
- Day/night cycle based on actual time (warm golden hour, cool blue night)
- Atmospheric effects (clouds drifting, fog, light shimmer on water)
- Sound design: ocean ambiance, seagulls, subtle fog horn
- Mobile-responsive layout
- Deploy to Vercel (or Railway for the Express backend)

**Deliverable:** A deployed public URL that makes people say "holy shit." The top of the funnel — the thing people share.

### Month 2 — Data Depth

**Goal:** Go from "pretty map" to "useful tool." Add the data layers that make maritime professionals lean forward.

- **Persistence layer**: SQLite (via better-sqlite3 or Drizzle ORM) to store every AIS position. Unlocks replay and analytics.
- **NOAA tides integration**: Real-time tide levels + 48-hour predictions from CO-OPS API for NY Harbor stations (The Battery, Sandy Hook, Bergen Point). Display as overlay or sidebar widget.
- **Marine weather integration**: Open-Meteo Marine API for wave height, swell direction, sea surface temperature. Wind barbs on the map.
- **NWS weather alerts**: Fetch active marine weather warnings for the NY Harbor zone. Display as banner/overlay when active.
- **Vessel detail pages**: Click a ship → full page with voyage history (from stored data), vessel specs, recent port calls.
- **Search**: Search for a vessel by name, MMSI, or call sign. Jump to it on the map.

**Deliverable:** A harbor visualization with real environmental context. Weather, tides, and clickable ship stories.

### Month 3 — Replay + Analytics

**Goal:** Time travel. Show what happened yesterday, last week, last month.

- **Replay system**: Timeline scrubber UI. Query stored positions by time range. Playback at 1x, 4x, 16x, 64x speed. Trail visualization showing vessel paths.
- **Port activity dashboard**: Daily vessel count by type, average anchorage duration, busiest hours, vessel arrivals/departures as time-series charts.
- **Heatmap overlay**: Aggregate stored positions into grid cells. Toggle a traffic density heatmap.
- **Basic API**: `GET /api/v1/vessels`, `GET /api/v1/vessels/:mmsi`, `GET /api/v1/vessels/:mmsi/track?start=&end=`. JSON responses. Public read-only, no auth yet.

**Deliverable:** The first version a harbor master, marine journalist, or shipping enthusiast would bookmark and check daily.

---

## Q2: Intelligence (Months 4-6)
*"From visualization to insight."*

### Month 4 — Alerts + Geofencing

- **Geofence engine**: Draw polygons on the map. Alert when a vessel enters/exits.
- **Speed zone alerts**: Define zones with speed limits (e.g., NOAA right whale seasonal management areas — 10 knots). Alert on violations.
- **Anchor drag detection**: Monitor position drift when navStatus = "at anchor." Alert if drift exceeds threshold.
- **Vessel watchlist**: Track specific MMSIs. Notified when they enter the harbor, depart, or change status.
- **Notification delivery**: In-app first. Email via Resend or SendGrid. Webhook support for developers.
- **User accounts**: Auth via Clerk or Auth.js. Free tier + Pro tier concept.

**Deliverable:** A tool that actively tells you what's happening, not just passively shows it.

### Month 5 — ETA Prediction + Anomaly Detection

- **ETA prediction (heuristic)**: For inbound vessels, estimate arrival using current speed + distance to harbor entrance. Compare against reported ETA.
- **ETA prediction (ML)**: Train a model on stored historical data. Features: vessel type, speed, distance, time of day, day of week, weather. Even linear regression beats most AIS-reported ETAs.
- **Anomaly detection**: Flag unusual behavior — unexpected stops, dramatic speed changes, course deviations. K-means clustering on behavioral features.
- **AIS gap detection**: Track when vessels go silent. Flag gaps > 15 minutes for previously active vessels.
- **Risk scoring**: Composite score per vessel based on speed compliance, AIS reliability, behavioral patterns.

**Deliverable:** Harbor Watch tells you what's about to happen and what's weird.

### Month 6 — Flight Layer + Multi-Source Fusion

- **Flight data integration**: adsb.lol REST polling for aircraft over the harbor. Altitude-based sizing, smooth interpolation, aircraft type icons.
- **Helicopter traffic**: Separate visual treatment for helicopters (NYPD, Coast Guard, tourist flights).
- **Weather radar overlay**: NWS radar imagery composited over the map during storms.
- **Current/tide flow visualization**: Animated arrows or streamlines showing water current direction and strength from NOAA data.
- **Data fusion dashboard**: Single view combining vessel count, weather, tides, active alerts, and predictions.

**Deliverable:** The most comprehensive real-time view of NY Harbor outside the Coast Guard's own systems.

---

## Q3: Product (Months 7-9)
*"From project to product."*

### Month 7 — Public API + Developer Experience

- **RESTful API v1**: Full vessel data, historical tracks, port statistics, weather overlays. OpenAPI/Swagger docs.
- **API key management**: Self-service key generation, usage dashboard, rate limiting (100 req/day free, 10K req/day pro).
- **Webhook system**: Subscribe to events (vessel arrival, alert triggered, weather warning). Reliable delivery with retries.
- **Embeddable widget**: `<iframe>` or JS snippet for embedding a live harbor map on any website.

**Deliverable:** Other developers can build on Harbor Watch data. The platform play.

### Month 8 — Multi-Harbor Expansion

- **Parameterized harbor support**: Abstract the NY Harbor bounding box into a configurable harbor definition (name, bounds, NOAA stations, landmarks).
- **Add 2-3 harbors**: LA/Long Beach (busiest US port), Miami (cruise capital), San Francisco (iconic).
- **Harbor comparison dashboard**: Side-by-side activity metrics across harbors.
- **Harbor-specific landing pages**: SEO-optimized with live vessel counts, current conditions, recent activity.

**Deliverable:** Harbor Watch is "the harbor intelligence platform," not just NY.

### Month 9 — Monetization + Polish

- **Stripe integration**: Subscription billing for Pro tier ($20-30/month).
- **Pro features gated**: Historical replay beyond 24h, custom alerts, API access, vessel watchlists, CSV export.
- **Landing page**: Marketing site with demo video, feature comparison, pricing table.
- **Onboarding flow**: Guided tour for new users. Tooltip walkthrough.
- **Performance optimization**: Code splitting, lazy loading, service worker, aggressive caching.
- **SEO + social sharing**: Open Graph tags, Twitter cards with live harbor screenshots.

**Deliverable:** A real SaaS product with paying customers.

---

## Q4: Scale + Intelligence (Months 10-12)
*"The moat deepens."*

### Month 10 — Advanced Analytics + Reports

- **Automated harbor reports**: Weekly PDF/email summarizing traffic, notable events, weather impact, trends. B2B angle ($50-100/month).
- **Sanctions screening**: Cross-reference MMSIs against OFAC SDN list. Flag vessels with sanctions risk.
- **Ship-to-ship transfer detection**: Identify vessels that rendezvoused at sea (proximity + stopped). High-value intelligence feature.
- **Carbon emission estimation**: Estimate CO2 per vessel based on type, speed, engine power models. Sustainability reporting angle.

### Month 11 — Community + Content

- **Harbor Watch blog/feed**: Automated notable event posts. Content marketing engine.
- **Community features**: Users annotate vessels, share findings, create public watchlists.
- **Integration marketplace**: Slack bot, Discord bot, Telegram alerts.
- **Historical data API**: Sell access to stored AIS archive. Researchers, journalists, hedge funds.

### Month 12 — The Digital Twin

- **3D harbor visualization**: Three.js/React Three Fiber with terrain, buildings, and vessels in 3D.
- **Simulation mode**: "What if" scenarios — what if a cargo ship blocks Ambrose Channel?
- **Port efficiency metrics**: Berth utilization, turnaround time, congestion index.
- **Predictive traffic modeling**: Given inbound vessels + weather + tides, predict congestion 6-24 hours out.
- **Partnership conversations**: NY/NJ Port Authority, maritime insurance, shipping agents.

**Month 12 Deliverable:** A production platform with paying users, multiple harbors, API, alerts, replay, predictions, and the most beautiful maritime visualization on the internet.

---

## Data Sources

### Currently Integrated
| Source | Type | API | Status |
|--------|------|-----|--------|
| AISStream.io | Ship positions (WebSocket) | `stream.aisstream.io` | ✅ Live |
| NOAA CO-OPS | Tides, currents, water levels | `api.tidesandcurrents.noaa.gov` | ✅ Wired (backend + UI status) |
| Open-Meteo Marine | Wave height, swell, sea temp | `open-meteo.com/en/docs/marine-weather-api` | ✅ Wired (backend + UI status) |
| NWS | Weather forecasts, marine warnings | `api.weather.gov` | ✅ Wired (backend + UI status) |
| adsb.lol | Flight positions (REST) | `api.adsb.lol/v2/lat/lon/dist` | ✅ Wired (data source; flight visuals pending) |
| NOAA AccessAIS | Historical AIS (bulk) | `marinecadastre.gov/accessais` | ✅ Wired (source availability checks) |
| IMF PortWatch | Trade disruption alerts | `portwatch.imf.org` | ✅ Wired (endpoint/status checks) |
| Stormglass.io | Enhanced marine weather | `stormglass.io` | ✅ Wired (key-gated; active when configured) |
| OFAC SDN List | Sanctions screening | `ofac.treasury.gov` | ✅ Wired (download + refresh checks) |

---

## Tech Stack Evolution

| Layer | Now | Month 3 | Month 6 | Month 12 |
|-------|-----|---------|---------|----------|
| **Frontend** | React + SVG | React + PixiJS + SVG | + D3 charts | + Three.js 3D view |
| **Animation** | CSS + GSAP | + PixiJS displacement | + particle systems | + 3D shaders |
| **Backend** | Express | + SQLite + cron jobs | + job queue (BullMQ) | + microservices |
| **Database** | In-memory Map | SQLite (better-sqlite3) | PostgreSQL + TimescaleDB | + Redis cache |
| **Auth** | None | None | Clerk or Auth.js | + API key management |
| **Payments** | None | None | None | Stripe |
| **Hosting** | Local | Vercel + Railway | + managed Postgres | + CDN + edge workers |
| **ML** | None | None | scikit-learn/ONNX | + custom models |

---

## Ship Type Codes

| First Digit | Category | Visual Treatment |
|-------------|----------|-----------------|
| 3 | Special (tug, pilot, military) | Small, yellow |
| 6 | Passenger (ferries, cruise) | Medium, white |
| 7 | Cargo | Large, dark blue |
| 8 | Tanker | Large, dark red |
| 9 | Other | Medium, gray |

## Navigational Status

| Code | Meaning | Animation |
|------|---------|-----------|
| 0 | Under way (engine) | Moving, wake trail |
| 1 | At anchor | Stationary, gentle bob |
| 5 | Moored | Stationary, docked |
| 8 | Under way (sailing) | Moving, sail icon |

---

## AIS Data Notes

- **Protocol:** WebSocket (`wss://stream.aisstream.io/v0/stream`)
- **NY Harbor bounding box:** `[[40.48, -74.26], [40.78, -73.90]]`
- **Key gotcha:** Static data (ship name, type) arrives on a DIFFERENT message type and LESS frequently than position data. Must build a lookup table keyed by MMSI and merge both.
- **Second gotcha:** Must send the subscription message within 3 seconds of connecting or the connection drops.

## File Structure

```
harbor-watch/
├── public/
│   └── assets/
│       ├── harbor-bg.png          # Ghibli-style painted background
│       ├── displacement-map.png   # Grayscale water displacement texture
│       └── ships/                 # Ship type sprites/icons
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── types/
│   │   └── ais.ts                 # AIS message type interfaces
│   ├── hooks/
│   │   ├── useShipData.ts         # WebSocket connection + ship cache
│   │   └── useFlightData.ts       # REST polling (stretch)
│   ├── components/
│   │   ├── HarborScene.tsx        # Main scene + visual layers
│   │   ├── ShipInfoCard.tsx       # Click-to-reveal info card
│   │   ├── StatusBar.tsx          # Header with ship count, time
│   │   ├── OceanLayer.tsx         # Displacement filter + wave overlays
│   │   ├── ShipLayer.tsx          # Ship sprites (extract from HarborScene)
│   │   ├── FlightLayer.tsx        # Flight paths (stretch)
│   │   └── AtmosphericOverlay.tsx # Light/gradient effects
│   ├── utils/
│   │   ├── coordinates.ts         # Lat/lon to pixel mapping + interpolation
│   │   └── interpolation.ts       # Smooth position lerping
│   └── styles/
│       └── index.css
├── server.ts                      # Express backend, AIS WebSocket relay
├── index.html
├── tsconfig.json
├── vite.config.ts
├── package.json
└── ROADMAP.md                     # This file
```

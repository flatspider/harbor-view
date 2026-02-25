# Harbor Watch — Product Requirements Document

## Overview

Harbor Watch is a real-time digital twin of New York Harbor. It ingests live vessel tracking data, marine weather, tides, flight traffic, and trade intelligence — then renders them into a single, visually rich, interactive display that updates continuously.

The product sits between two failing extremes in maritime technology. Enterprise platforms like Kpler and Windward cost $10K+/year and look like they were designed in 2008. Free tools like MarineTraffic and VesselFinder show dots on a map with no environmental context, no intelligence, and no craft. Harbor Watch is the third option: **unmatched depth for a single harbor, with consumer-grade design quality, at a prosumer price point ($20-50/month).**

The initial target is New York Harbor — one of the busiest and most photographed ports in the world. The architecture is designed to expand to additional harbors over time.

---

## Real-Time Architecture

Harbor Watch is a **live system**. Every layer of the product reflects what is happening right now.

### Data Flow

```
External Sources (WebSocket + REST polling)
        │
        ▼
  Express Backend (server.ts)
    - AIS WebSocket relay (continuous stream)
    - REST polling for weather, tides, flights (interval-based)
    - In-memory ship cache (keyed by MMSI)
    - Integration snapshot cache (TTL-based refresh)
        │
        ▼
  REST API (/api/ships, /api/data-sources)
        │
        ▼
  React Frontend (polling at 1s for ships, 60s for integrations)
    - Ship positions update every second
    - Environmental data refreshes every minute
    - Visual scene reacts to live data in real time
```

### Update Cadences

| Data Type | Source | Update Frequency | Latency Target |
|-----------|--------|-----------------|----------------|
| Ship positions | AISStream WebSocket | Continuous (every few seconds per vessel) | < 2s from AIS transmission |
| Ship static data | AISStream WebSocket | Every few minutes per vessel | < 5s from receipt |
| Weather forecast | NWS API | Every 10 minutes | < 30s |
| Marine conditions | Open-Meteo / Stormglass | Every 10 minutes | < 30s |
| Tide levels | NOAA CO-OPS | Every 10 minutes | < 30s |
| Flight positions | adsb.lol REST | Every 10-15 seconds (planned) | < 5s |
| Trade intelligence | IMF PortWatch | Every 10 minutes | < 60s |
| Sanctions list | OFAC SDN | Daily refresh | N/A (batch) |

### Ship Data Model

Every vessel in the harbor is tracked as a unified record merging two AIS message types:

**From Position Reports (frequent):**
- Latitude, longitude
- Course over ground (COG)
- Speed over ground (SOG, in knots)
- True heading (0-359 degrees)
- Navigational status (underway, anchored, moored, etc.)
- Rate of turn

**From Static Data Reports (less frequent):**
- Ship name
- MMSI (Maritime Mobile Service Identity — unique 9-digit ID)
- Call sign
- Ship type code (cargo, tanker, passenger, tug, etc.)
- Destination
- Physical dimensions (bow, stern, port, starboard offsets from GPS)
- IMO number
- Maximum draught
- ETA (day, hour, minute, month)

**Derived / computed:**
- Ship category (special, passenger, cargo, tanker, other — from type code first digit)
- Previous position (for interpolation between updates)
- Time since last update (for staleness detection)

### Bounding Box

New York Harbor coverage area:
- **South:** 40.48N (south of Sandy Hook)
- **North:** 40.78N (north of George Washington Bridge)
- **West:** 74.26W (Newark Bay)
- **East:** 73.90W (East River / Brooklyn)

This captures the Narrows, Upper and Lower Bay, Kill Van Kull, Arthur Kill, Hudson River mouth, East River entrance, and all major anchorages.

---

## Data Sources

### 1. AISStream.io — Vessel Tracking

**What it is:** Real-time Automatic Identification System data via WebSocket. AIS is the maritime equivalent of ADS-B for aircraft — every commercial vessel over 300 gross tons is required to broadcast its position, identity, and voyage information.

**Protocol:** WebSocket (`wss://stream.aisstream.io/v0/stream`)

**What we receive:**
- `PositionReport` messages: lat/lon, COG, SOG, heading, nav status, rate of turn
- `ShipStaticData` messages: name, type, dimensions, destination, call sign, IMO, ETA, draught

**Key behaviors:**
- Subscription must be sent within 3 seconds of connection or the socket drops
- Static data arrives on a different message type and less frequently than position data — the backend maintains a lookup table keyed by MMSI and merges both
- Ships that haven't reported in 5 minutes are pruned from the cache

**Coverage:** All AIS-equipped vessels within the NY Harbor bounding box. Typically 40-120 vessels at any given time, including container ships, tankers, ferries, tugs, pilot boats, Coast Guard vessels, and recreational craft with AIS transponders.

**Authentication:** API key required (server-side only).

### 2. NOAA CO-OPS — Tides and Water Levels

**What it is:** The National Oceanic and Atmospheric Administration's Center for Operational Oceanographic Products and Services. Provides real-time and predicted water level data from physical tide gauge stations.

**Endpoint:** `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`

**What we receive:**
- Current water level (meters above MLLW datum)
- Water level trend
- Next predicted high/low tide time and height

**Station:** The Battery, Manhattan (Station 8518750) — the primary reference station for NY Harbor. Additional stations available: Sandy Hook (8531680), Bergen Point (8519483).

**Authentication:** None (public API).

### 3. Open-Meteo Marine — Wave and Sea Conditions

**What it is:** Open-source marine weather API providing wave, swell, and sea surface data derived from NOAA GFS Wave model.

**Endpoint:** `https://marine-api.open-meteo.com/v1/marine`

**What we receive:**
- Wave height (meters)
- Swell wave height (meters)
- Swell wave period (seconds)
- Sea surface temperature (Celsius)

**Authentication:** None (free, no key required).

### 4. National Weather Service (NWS) — Forecasts and Alerts

**What it is:** Official US government weather forecasts and active weather alerts for the NY Harbor area.

**Endpoints:**
- `https://api.weather.gov/points/{lat},{lon}` → forecast URL lookup
- Forecast endpoint (dynamic) → period-by-period forecast
- `https://api.weather.gov/alerts/active?point={lat},{lon}` → active alerts

**What we receive:**
- Current forecast period name, temperature, wind speed, short summary
- Count of active weather alerts (marine warnings, storm advisories, etc.)

**Authentication:** None (public API, User-Agent header recommended).

### 5. adsb.lol — Flight Tracking

**What it is:** Community-sourced ADS-B aircraft tracking data. Provides real-time positions of aircraft broadcasting ADS-B signals within a radius of a given point.

**Endpoint:** `https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{radius_nm}`

**What we receive:**
- Aircraft count within radius
- Per-aircraft: position, altitude, speed, heading, aircraft type, registration, callsign
- Message count (data freshness indicator)

**Coverage radius:** 25 nautical miles from NY Harbor center point. Captures all commercial, general aviation, and helicopter traffic over the harbor and surrounding airspace.

**Authentication:** None (public API).

### 6. NOAA AccessAIS — Historical AIS Archive

**What it is:** Bulk historical AIS data maintained by the Bureau of Ocean Energy Management (BOEM) via the Marine Cadastre. Provides downloadable archives of all AIS transmissions in US waters.

**Endpoint:** `https://marinecadastre.gov/accessais/`

**What we receive:** Availability of ZIP archive downloads containing historical AIS records. Used for replay features and historical analysis.

**Authentication:** None (public download).

### 7. IMF PortWatch — Trade Disruption Intelligence

**What it is:** The International Monetary Fund's port activity and trade disruption monitoring platform. Tracks global port throughput and flags disruptions.

**Endpoint:** `https://portwatch.imf.org/api/v1/throughput`

**What we receive:**
- Port throughput records (daily frequency)
- Disruption alerts affecting global trade routes

**Authentication:** None (public API).

### 8. Stormglass.io — Enhanced Marine Weather

**What it is:** Premium marine weather API aggregating data from multiple meteorological sources (NOAA, ECMWF, etc.) into a unified format.

**Endpoint:** `https://api.stormglass.io/v2/weather/point`

**What we receive:**
- Wave height (meters)
- Swell height (meters)
- Water temperature (Celsius)

**Authentication:** API key required (optional integration — system operates without it using Open-Meteo as primary marine weather source).

### 9. OFAC SDN List — Sanctions Screening

**What it is:** The US Treasury's Office of Foreign Assets Control Specially Designated Nationals list. Contains entities and individuals subject to US economic sanctions.

**Endpoint:** `https://www.treasury.gov/ofac/downloads/sdn.csv`

**What we receive:** Full SDN list as CSV. Cross-referenced against vessel MMSIs and names for sanctions risk flagging.

**Authentication:** None (public download).

---

## Product Scope — 12-Month Implementation Plan

### Month 1: The Beautiful Map

**Goal:** The most visually striking harbor visualization on the internet. The thing people screenshot and share.

**Ship visualization overhaul:**
- Replace circle markers with distinct SVG silhouettes per ship type (cargo, tanker, passenger, tug, other)
- Size ships proportionally using actual dimensions from AIS static data
- Rotate sprites to match true heading
- Wake trails behind moving ships (V-shaped particle trail, intensity proportional to speed)
- Gentle bobbing animation for anchored vessels
- Smooth position interpolation between AIS updates (lerp utilities exist, need wiring)

**Water and environment:**
- Painted Ghibli-style background image with NY Harbor geography (coastline, land masses, landmarks)
- PixiJS displacement filter on the water surface for living, breathing ocean
- Wave animation intensity driven by real Open-Meteo wave height data
- Wind particle system — tiny white specks drifting across the water surface in actual NWS wind direction
- Day/night cycle based on actual time (golden hour warmth, cool blue nights, light reflections)

**Geography layer:**
- Simplified coastline overlay (Manhattan, Brooklyn, Staten Island, NJ)
- Key landmark labels: Statue of Liberty, Governors Island, Verrazano Bridge, Ambrose Channel

**Data-driven atmosphere:**
- Overall scene mood responds to NWS forecast (clear = warm and bright, overcast = muted, rain = dark with rain particles, fog = blurred distance)
- Marine weather alert banner when NWS active alerts > 0
- Sea surface temperature subtly tints water color (warmer = teal hints, cooler = deep ink blue)

**Information display:**
- Slim conditions bar replacing the current integration card grid: tide level, wave height, wind, temperature as compact gauges
- Ship info card on click (already built, refine design)
- Ship count by type

**Infrastructure:**
- Mobile-responsive layout
- Deploy to Vercel (frontend) + Railway (Express backend)

**Deliverable:** A deployed public URL that makes people say "wow." The top of the funnel.

### Month 2: Data Depth

**Goal:** Go from "pretty visualization" to "useful tool." Add data layers that make maritime professionals lean forward.

**Persistence layer:**
- SQLite database (via better-sqlite3 or Drizzle ORM)
- Store every AIS position report with timestamp
- Store ship static data updates
- Store weather/tide snapshots at regular intervals

**Enhanced tide visualization:**
- Real-time tide gauge widget with current level + 48-hour prediction curve
- Water level in the scene shifts visually with tide data
- Multiple station support (The Battery, Sandy Hook, Bergen Point)

**Marine weather integration (visual):**
- Wind barbs on the map showing wind direction and speed
- Wave height indicator integrated into the water surface
- Sea surface temperature as a toggleable color overlay

**NWS weather alerts:**
- Fetch active marine weather warnings for the NY Harbor zone
- Display as banner overlay when active (gale warnings, storm advisories, fog advisories)
- Scene atmosphere responds to active warnings

**Vessel detail pages:**
- Click a ship → full detail view with voyage history (from stored position data)
- Vessel specs, dimensions, type classification
- Recent port calls and anchorage durations (derived from stored data)

**Search:**
- Search for a vessel by name, MMSI, or call sign
- Jump to vessel on the map and highlight it

**Deliverable:** A harbor visualization with real environmental context. Weather, tides, and clickable ship stories.

### Month 3: Replay and Analytics

**Goal:** Time travel. Show what happened yesterday, last week, last month.

**Replay system:**
- Timeline scrubber UI
- Query stored positions by time range
- Playback at 1x, 4x, 16x, 64x speed
- Trail visualization showing vessel paths during playback

**Port activity dashboard:**
- Daily vessel count by type (bar chart)
- Average anchorage duration
- Busiest hours heatmap
- Vessel arrivals/departures as time-series chart

**Traffic heatmap overlay:**
- Aggregate stored positions into grid cells
- Toggle a traffic density heatmap showing most-traveled routes

**Public API (v1):**
- `GET /api/v1/vessels` — list current vessels
- `GET /api/v1/vessels/:mmsi` — single vessel detail
- `GET /api/v1/vessels/:mmsi/track?start=&end=` — historical track
- JSON responses, public read-only, no auth

**Deliverable:** Something a harbor master, marine journalist, or shipping enthusiast would bookmark and check daily.

### Month 4: Alerts and Geofencing

**Goal:** Harbor Watch actively tells you what's happening, not just passively shows it.

**Geofence engine:**
- Draw polygons on the map to define zones
- Alert when a vessel enters or exits a geofenced area

**Speed zone alerts:**
- Define zones with speed limits (e.g., NOAA right whale seasonal management areas — 10 knots)
- Alert on violations

**Anchor drag detection:**
- Monitor position drift when nav status = "at anchor"
- Alert if drift exceeds configurable threshold

**Vessel watchlist:**
- Track specific MMSIs
- Notifications when watched vessels enter the harbor, depart, or change status

**Notification delivery:**
- In-app notification center
- Email notifications (via Resend or SendGrid)
- Webhook support for developers

**User accounts:**
- Authentication via Clerk or Auth.js
- Free tier + Pro tier concept

**Deliverable:** A tool that proactively surfaces important events.

### Month 5: Prediction and Anomaly Detection

**Goal:** Harbor Watch tells you what's about to happen and what's unusual.

**ETA prediction (heuristic):**
- For inbound vessels, estimate arrival using current speed + distance to harbor entrance
- Compare predicted ETA against AIS-reported ETA

**ETA prediction (ML):**
- Train a model on stored historical data
- Features: vessel type, speed, distance, time of day, day of week, weather conditions
- Even linear regression outperforms most AIS-reported ETAs

**Anomaly detection:**
- Flag unusual behavior: unexpected stops, dramatic speed changes, course deviations from normal traffic lanes
- Clustering on behavioral features (K-means or similar)

**AIS gap detection:**
- Track when vessels go silent (no position update)
- Flag gaps > 15 minutes for previously active vessels

**Risk scoring:**
- Composite score per vessel: speed compliance, AIS reliability, behavioral patterns
- Visual indicator on ship markers

**Deliverable:** Predictive and anomaly intelligence layered onto the real-time view.

### Month 6: Flight Layer and Multi-Source Fusion

**Goal:** The most comprehensive real-time view of NY Harbor outside the Coast Guard.

**Flight data visualization:**
- Aircraft silhouettes rendered above the harbor scene
- Altitude-based sizing (higher = smaller)
- Smooth position interpolation between polling intervals
- Aircraft type icons (fixed-wing vs. helicopter)
- Flight trails as fading lines

**Helicopter traffic:**
- Separate visual treatment for helicopters (NYPD, Coast Guard, tourist flights)
- Altitude and pattern-based classification

**Weather radar overlay:**
- NWS radar imagery composited over the map during active precipitation

**Current and tide flow visualization:**
- Animated arrows or streamlines showing water current direction and strength (from NOAA data)

**Data fusion dashboard:**
- Single unified view: vessel count, weather conditions, tide state, active alerts, predictions, flight activity

**Deliverable:** Complete situational awareness — vessels, aircraft, weather, tides, currents in one view.

### Month 7: Public API and Developer Experience

**Goal:** Other developers can build on Harbor Watch data.

**RESTful API v1 (full):**
- Vessel data, historical tracks, port statistics, weather overlays
- OpenAPI/Swagger documentation

**API key management:**
- Self-service key generation
- Usage dashboard and rate limiting (100 req/day free, 10K req/day pro)

**Webhook system:**
- Subscribe to events (vessel arrival, alert triggered, weather warning)
- Reliable delivery with retries

**Embeddable widget:**
- `<iframe>` or JS snippet for embedding a live harbor map on any website

### Month 8: Multi-Harbor Expansion

**Goal:** Harbor Watch becomes "the harbor intelligence platform," not just NY.

**Parameterized harbor support:**
- Abstract the NY Harbor bounding box, NOAA stations, and landmarks into configurable harbor definitions
- Harbor config schema: name, bounds, stations, landmark coordinates

**Additional harbors:**
- LA/Long Beach (busiest US port)
- Miami (cruise capital)
- San Francisco (iconic)

**Harbor comparison dashboard:**
- Side-by-side activity metrics across harbors

**Harbor-specific landing pages:**
- SEO-optimized with live vessel counts, current conditions, recent activity

### Month 9: Monetization and Polish

**Goal:** A real SaaS product with paying customers.

**Stripe integration:**
- Subscription billing for Pro tier ($20-30/month)

**Pro features gated:**
- Historical replay beyond 24h
- Custom geofence alerts
- API access
- Vessel watchlists
- CSV data export

**Landing page:**
- Marketing site with demo video, feature comparison, pricing table

**Onboarding flow:**
- Guided tour for new users with tooltip walkthrough

**Performance optimization:**
- Code splitting, lazy loading, service worker, aggressive caching

**SEO and social sharing:**
- Open Graph tags, Twitter cards with live harbor screenshots

### Month 10: Advanced Analytics and Reports

**Goal:** B2B intelligence product.

**Automated harbor reports:**
- Weekly PDF/email summarizing traffic, notable events, weather impact, trends
- B2B pricing tier ($50-100/month)

**Sanctions screening (visual):**
- Cross-reference vessel MMSIs against OFAC SDN list in real time
- Red warning indicator on flagged vessels
- Sanctions alert in notification system

**Ship-to-ship transfer detection:**
- Identify vessels that rendezvoused at sea (proximity + both stopped)
- High-value intelligence for compliance and maritime security

**Carbon emission estimation:**
- Estimate CO2 per vessel based on type, speed, engine power models
- Sustainability reporting angle

### Month 11: Community and Content

**Goal:** Network effects and content marketing.

**Harbor Watch blog/feed:**
- Automated notable event posts (largest vessel of the week, unusual arrivals, weather events)

**Community features:**
- Users annotate vessels, share findings, create public watchlists

**Integration marketplace:**
- Slack bot, Discord bot, Telegram alerts

**Historical data API:**
- Sell access to stored AIS archive (researchers, journalists, hedge funds)

### Month 12: The Digital Twin

**Goal:** The definitive harbor intelligence platform.

**3D harbor visualization:**
- Three.js / React Three Fiber with terrain, buildings, and vessels in 3D

**Simulation mode:**
- "What if" scenarios — what if a cargo ship blocks Ambrose Channel?

**Port efficiency metrics:**
- Berth utilization, turnaround time, congestion index

**Predictive traffic modeling:**
- Given inbound vessels + weather + tides, predict congestion 6-24 hours out

**Deliverable:** A production platform with paying users, multiple harbors, API, alerts, replay, predictions, and the most visually compelling maritime visualization on the internet.

---

## Technical Architecture

### Current Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Build | Vite |
| Frontend | React + TypeScript |
| Animation | CSS keyframes + GSAP |
| Ship rendering | SVG (circles + heading lines) |
| Backend | Express (Node/Bun) |
| Data transport | REST polling (frontend ← backend), WebSocket (backend ← AISStream) |
| State | In-memory Map (ships), in-memory array (integration snapshots) |

### Planned Stack Evolution

| Layer | Month 1 | Month 3 | Month 6 | Month 12 |
|-------|---------|---------|---------|----------|
| Frontend | React + PixiJS + SVG | + D3 charts | + radar overlays | + Three.js 3D view |
| Animation | + PixiJS displacement | + particle systems | + weather particles | + 3D shaders |
| Backend | Express | + SQLite + cron jobs | + job queue (BullMQ) | + microservices |
| Database | In-memory Map | SQLite (better-sqlite3) | PostgreSQL + TimescaleDB | + Redis cache |
| Auth | None | None | Clerk or Auth.js | + API key management |
| Payments | None | None | None | Stripe |
| Hosting | Local dev | Vercel + Railway | + managed Postgres | + CDN + edge workers |
| ML | None | None | scikit-learn / ONNX | + custom models |

---

## Ship Type Classification

AIS ship type codes use a two-digit system. The first digit determines the visual category:

| First Digit | Category | Visual Treatment | Marker Color |
|-------------|----------|-----------------|-------------|
| 3 | Special (tug, pilot, military, SAR) | Small silhouette | Gold (#e6a817) |
| 6 | Passenger (ferry, cruise) | Medium silhouette | White (#ffffff) |
| 7 | Cargo (bulk, container, general) | Large silhouette | Blue (#4a8cbf) |
| 8 | Tanker (oil, gas, chemical) | Large silhouette | Red (#c44d4d) |
| Other | Other / unknown | Medium generic | Gray (#8b9daa) |

## Navigational Status Codes

| Code | Meaning | Visual Behavior |
|------|---------|----------------|
| 0 | Under way using engine | Moving, wake trail |
| 1 | At anchor | Stationary, gentle bob animation |
| 2 | Not under command | Stationary, warning indicator |
| 3 | Restricted maneuverability | Moving slowly, caution indicator |
| 4 | Constrained by draught | Moving, deep-draft indicator |
| 5 | Moored | Stationary, docked position |
| 6 | Aground | Stationary, alert indicator |
| 7 | Engaged in fishing | Moving slowly, fishing indicator |
| 8 | Under way sailing | Moving, sail icon variant |
| 14 | AIS-SART (active) | Emergency beacon, high-visibility pulse |

---

## Market Position

**Enterprise platforms** (Kpler, Windward, MarineTraffic Pro): $10K-50K/year. Comprehensive data but designed for analysts sitting at desks. Ugly. No delight.

**Free tools** (MarineTraffic free, VesselFinder): Dots on a map. No environmental context. No intelligence. No personality.

**Harbor Watch:** Deep single-harbor intelligence. Beautiful, real-time, data-rich. Environmental context (weather, tides, waves) fused with vessel tracking. Pro tier at $20-50/month. The product maritime professionals want to look at, not just have to look at.

**Target users:**
- Harbor masters and port operations staff
- Marine journalists and bloggers
- Shipping enthusiasts and maritime hobbyists
- Maritime security and compliance teams
- Logistics companies tracking specific vessels
- Researchers studying port activity and trade patterns
- Developers building maritime applications (API consumers)

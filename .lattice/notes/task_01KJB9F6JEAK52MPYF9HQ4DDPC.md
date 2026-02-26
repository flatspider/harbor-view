# Gap Report: Harbor Watch Codebase vs. Roadmap

**Generated:** 2026-02-25
**Task:** HAR-53
**Auditor:** agent:claude-opus-4-impl

---

## Summary Statistics

| Category | Count | % |
|----------|-------|---|
| Done | 14 | 18% |
| Done (diverged) | 3 | 4% |
| Partial | 6 | 8% |
| Missing | 54 | 70% |
| **Total** | **77** | |

### Completion by Quarter
- **Q1 Month 1:** 9/21 done or partial (43%)
- **Q1 Month 2:** 4/6 done (67%)
- **Q1 Month 3:** 1/7 partial (14%)
- **Q2:** 1/16 partial (6%)
- **Q3:** 0/14 (0%)
- **Q4:** 2/13 done or partial (15%)

---

## Full Gap Table

### Item 1: Audit current codebase against roadmap items
| Field | Value |
|-------|-------|
| **Status** | in_progress (this task) |
| **Evidence** | This document |

### Item 2: Stabilize AIS ingestion
| Field | Value |
|-------|-------|
| **Status** | done |
| **Evidence** | `server.ts:117-135` (subscription within 3s on open), `server.ts:222-234` (reconnect with 3s delay), `server.ts:140-220` (static-vs-dynamic merge by MMSI) |
| **Notes** | Subscription sent in `ws.on("open")` handler. Reconnect on close/error. Position and static data merged into unified ShipData keyed by MMSI. |

### Item 3: Refactor scene layers into modular components
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | `src/components/HarborScene.tsx` is 1239 lines, monolithic |
| **Notes** | StatusBar and ConditionsStrip are separate. But OceanLayer, ShipLayer, AtmosphericOverlay do not exist as separate files. |

### Item 4: Add Ghibli-style painted harbor background
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | No `harbor-bg.png` in `public/assets/`; no background image loading in source |

### Item 5: Implement PixiJS ocean displacement filter
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | `package.json` has `pixi.js` and `@pixi/react` dependencies but zero imports in `src/` |
| **Notes** | Three.js vertex wave animation exists as alternative (`HarborScene.tsx:643`). PixiJS displacement is a different visual approach. |

### Item 6: Wire smooth ship interpolation/lerp
| Field | Value |
|-------|-------|
| **Status** | partial |
| **Evidence** | `src/utils/coordinates.ts:38-54` has `getInterpolatedPosition()` with `prevLat`/`prevLon` fields on `ShipData` type |
| **Notes** | Function exists but is NOT called in the render loop. `HarborScene.tsx:870` uses a basic `lerp` to smooth toward target position, but this is not time-based AIS interpolation. |

### Item 7: Add ship-type sprite system with heading rotation
| Field | Value |
|-------|-------|
| **Status** | partial |
| **Evidence** | `HarborScene.tsx:228-267` distinct 3D geometry per category, `HarborScene.tsx:371-403` superstructure meshes |
| **Notes** | Has different 3D shapes and colors per vessel type (cargo/tanker/passenger/special/other) but NOT sprite images/silhouettes. Heading rotation exists. |

### Item 8: Mode-system foundation (Real Harbor vs Ghibli toggle)
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | No mode toggle, no ghibli references in src/ |

### Item 9: Build sunrise-ripple transformation animation
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | No sunrise/ripple code in src/ |

### Item 10: Map vessel class to Ghibli equivalents
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | No cartoon sprite mapping in src/ |

### Item 11: Add wake trail rendering for moving vessels
| Field | Value |
|-------|-------|
| **Status** | done |
| **Evidence** | `HarborScene.tsx:269-279` (wake shape geometry), `HarborScene.tsx:873-878` (speed-scaled opacity), `HarborScene.tsx:1107-1122` (wake cleanup) |

### Item 12: Add gentle bobbing animation for anchored/moored vessels
| Field | Value |
|-------|-------|
| **Status** | partial |
| **Evidence** | `HarborScene.tsx:869-871` — `bob = isAnchored ? Math.sin(t * 2 + (markerData.mmsi % 11)) * 0.8 : 0` |
| **Notes** | Triggers on `navStatus === 1` (anchored) but NOT `navStatus === 5` (moored). Should include both. |

### Item 13: Implement true day/night cycle driven by local harbor time
| Field | Value |
|-------|-------|
| **Status** | done |
| **Evidence** | `HarborScene.tsx:215-218` (hour check), `HarborScene.tsx:807-811` (directional light color by hour), `HarborScene.tsx:858-862` (ambient light intensity by hour) |

### Item 14: Add atmospheric effects (clouds, fog, water shimmer)
| Field | Value |
|-------|-------|
| **Status** | partial |
| **Evidence** | `HarborScene.tsx:570` (fog), `HarborScene.tsx:847-857` (mood-based fog distance), `HarborScene.tsx:617-636,881-895` (wind particles) |
| **Notes** | Fog varies by weather mood. Wind particles exist. No cloud meshes, no water shimmer effect. |

### Item 15: Build radar loading experience with staged hydration
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | No radar/sonar/loading screen code in src/ |

### Item 16: Add ambient soundscape controls
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | No audio references in src/ |

### Item 17: Make map/UI fully mobile responsive
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | No `@media` queries in `src/styles/index.css` |

### Item 18: Deploy public frontend/backend with production telemetry
| Field | Value |
|-------|-------|
| **Status** | done (diverged) |
| **Evidence** | `.github/workflows/deploy.yml`, `Dockerfile`, `server.ts:735` (health endpoint) |
| **Notes** | Deployed to EC2 via Docker/ECR (not Vercel+Railway as roadmap specified). Health endpoint exists. No structured logging/telemetry framework. |

### Item 19: Add SQLite persistence for AIS position messages
| Field | Value |
|-------|-------|
| **Status** | done (diverged) |
| **Evidence** | `server.ts:36-99` PostgreSQL with buffered inserts |
| **Notes** | Uses PostgreSQL instead of SQLite. `vessel_positions` table with mmsi, lat, lon, cog, sog, heading, nav_status, received_at. |

### Item 20: Build ingestion-to-storage pipeline with indexes
| Field | Value |
|-------|-------|
| **Status** | partial |
| **Evidence** | `server.ts:62-78` (table creation), `server.ts:286-298` (buffered insert every 5s) |
| **Notes** | Buffer flush works but no indexes beyond primary key. No replay or vessel lookup indexes. |

### Item 21: Integrate NOAA tides (current + 48h forecast)
| Field | Value |
|-------|-------|
| **Status** | done |
| **Evidence** | `server.ts:396-436` (backend fetch for water levels + predictions), `src/components/ConditionsStrip.tsx:16-17` (UI display) |

### Item 22: Integrate marine weather data into backend and map overlays
| Field | Value |
|-------|-------|
| **Status** | done |
| **Evidence** | `server.ts:438-468` (Open-Meteo marine fetch), `src/components/ConditionsStrip.tsx:18-21` (UI display) |
| **Notes** | Backend fetches wave height, swell direction, sea surface temp. No map overlay arrows/barbs. |

### Item 23: Integrate active NWS marine alerts with warning banners
| Field | Value |
|-------|-------|
| **Status** | done |
| **Evidence** | `server.ts:470-513` (NWS fetch), `src/components/ConditionsStrip.tsx:22-39` (alert display), `HarborScene.tsx` (alert glow overlay) |

### Item 24: Build vessel detail page with voyage history
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | `ShipInfoCard.tsx` is a popup card only; no routing, no voyage history page |

### Item 25: Implement vessel search by name/MMSI/call sign
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | No search UI or `/api/search` endpoint |

### Item 26: Build replay engine with timeline scrubber
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | No replay code in src/ |

### Item 27: Add replay path trails and time-range querying
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | No replay code; no time-range query endpoint |

### Item 28: Add optional cinematic sunrise-ripple before replay
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | No Ghibli mode exists |

### Item 29: Implement Radar Room full-screen mode
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | No radar room code |

### Item 30: Route heavy replay seeks through radar loading
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | No radar loading code |

### Item 31: Build port activity dashboard
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | No dashboard/analytics views |

### Item 32: Implement traffic density heatmap overlay
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | No heatmap code |

### Item 33: Publish API v1 read-only endpoints
| Field | Value |
|-------|-------|
| **Status** | partial |
| **Evidence** | `server.ts:735-741` has `GET /api/ships` and `GET /api/health` and `GET /api/data-sources` |
| **Notes** | Returns all ships but not versioned `/api/v1/`, no per-vessel endpoint, no track query |

### Item 34: Add geofence drawing, persistence, and alert engine
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 35: Add speed-zone definitions and violation alerts
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 36: Add anchor-drag detection and alerting
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 37: Add vessel watchlists with notifications
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 38: Implement notification delivery channels
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 39: Add user auth and account model
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 40: Implement heuristic ETA prediction
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 41: Add ML ETA model training/inference
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 42: Implement anomaly detection
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 43: Implement AIS silence-gap detection
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 44: Add composite vessel risk scoring
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 45: Integrate flight layer with interpolation and iconography
| Field | Value |
|-------|-------|
| **Status** | partial |
| **Evidence** | `server.ts:515-542` backend fetches adsb.lol |
| **Notes** | Backend integration exists. No frontend aircraft rendering, no altitude scaling, no aircraft icons. |

### Item 46: Add distinct helicopter visual treatment
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 47: Add NWS radar imagery overlay
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 48: Add NOAA current/tide flow vector visualization
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 49: Build fused operations dashboard
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 50: Expand API to full REST v1 with OpenAPI docs
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 51: Add API key management, quotas, rate limiting
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 52: Implement resilient webhook subscription
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 53: Ship embeddable harbor widget
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 54: Generalize harbor configuration model
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | NY Harbor bounds hardcoded in `server.ts:111-116` |

### Item 55: Launch additional harbors
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 56: Build harbor comparison analytics dashboard
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 57: Build harbor-specific SEO landing pages
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 58: Integrate Stripe subscriptions
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 59: Gate Pro features
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 60: Ship marketing site and onboarding
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 61: Execute frontend performance optimization
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Evidence** | Basic Vite config only. No code splitting, lazy loading, service worker. |

### Item 62: Implement SEO/social graph metadata
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 63: Add automated weekly harbor reports
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 64: Integrate OFAC SDN screening and sanctions risk flags
| Field | Value |
|-------|-------|
| **Status** | partial |
| **Evidence** | `server.ts:662-683` downloads SDN CSV and counts entries |
| **Notes** | Downloads list but does NOT cross-reference against vessel MMSIs. No risk flags in UI. |

### Item 65: Implement ship-to-ship transfer detection
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 66: Add vessel carbon-emission estimation
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 67: Launch automated Harbor Watch blog/feed
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 68: Implement community annotations and public watchlists
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 69: Ship integration marketplace entries
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 70: Productize historical AIS archive API access
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 71: Build 3D harbor visualization
| Field | Value |
|-------|-------|
| **Status** | done (ahead of schedule) |
| **Evidence** | `src/components/HarborScene.tsx` — full Three.js 3D scene |
| **Notes** | Roadmap placed this at Month 12 but it's already the primary rendering engine. |

### Item 72: Add simulation mode for what-if scenarios
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 73: Implement port efficiency metrics
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 74: Add predictive congestion modeling
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 75: Prepare partnership-ready outputs
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Notes** | Non-code item; requires reports, API samples, demo environment |

### Item 76: Run final production hardening
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 77: Execute end-to-end QA pass
| Field | Value |
|-------|-------|
| **Status** | missing |

### Item 78: Produce final roadmap completion report
| Field | Value |
|-------|-------|
| **Status** | missing |
| **Notes** | This is the capstone deliverable |

---

## Priority Next Actions (Q1 Focus)

These are the highest-impact items to tackle next, in recommended order:

1. **Item 2: Stabilize AIS ingestion** — Already done, verify with manual checks
2. **Item 3: Refactor scene layers** — HarborScene.tsx at 1239 lines is a maintenance risk
3. **Item 6: Wire smooth ship interpolation** — `getInterpolatedPosition()` exists but is unused
4. **Item 12: Fix bobbing to include moored ships** — Quick fix (add navStatus === 5)
5. **Item 4: Ghibli-style background** — Requires art asset + rendering pipeline
6. **Item 5: PixiJS ocean displacement** — Decision needed: PixiJS vs Three.js water shader
7. **Item 7: Ship-type sprites** — Replace procedural geometry with visual silhouettes
8. **Item 8: Mode system foundation** — Architecture for Real/Ghibli toggle
9. **Item 14: Atmospheric effects** — Add clouds and shimmer to existing fog
10. **Item 17: Mobile responsive** — Zero responsive CSS currently

---

## Bonus: Items Implemented Ahead of Roadmap

| Feature | Evidence | Roadmap Position |
|---------|----------|-----------------|
| 3D harbor visualization (Three.js) | `HarborScene.tsx` | Month 12 |
| Ship collision avoidance placement | `HarborScene.tsx:329-369` | Not in roadmap |
| Wind particle system | `HarborScene.tsx:617-636` | Not in roadmap |
| Weather-driven mood system | `HarborScene.tsx:220-226` | Not in roadmap |
| Harbor landmark labels | `HarborScene.tsx:160-169` | Not in roadmap |
| 9 external data integrations | `server.ts:396-683` | Months 2-6 |
| CI/CD pipeline to EC2 | `.github/workflows/deploy.yml` | Not specified |
| PostgreSQL persistence | `server.ts:36-99` | Month 2 (as SQLite) |

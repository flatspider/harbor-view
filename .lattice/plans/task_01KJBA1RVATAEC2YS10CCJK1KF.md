# Plan: HAR-54 — Stabilize AIS ingestion

## Assessment
All three requirements are already implemented. This is a verification task, not an implementation task.

## Verification checklist
1. **Subscription within 3s**: `server.ts:347-363` — subscription sent immediately in `ws.on("open")` handler. No delay.
2. **Reconnect logic**: `server.ts:138-144` — `scheduleReconnect()` fires 3s after close. Called from `ws.on("close")` at line 392.
3. **Static-vs-dynamic merge by MMSI**: `server.ts:249-324` — `ingestAisMessage()` merges PositionReport and ShipStaticData into unified ShipData keyed by MMSI.

## Evidence
- Health endpoint confirms: `upstreamStatus: "connected"`, ships accumulating
- Live Playwright screenshot shows vessels appearing after server start

## Acceptance criteria
- All three behaviors verified via code review
- Live AIS data flowing (confirmed via /api/health)

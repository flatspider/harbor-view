# Harbor Watch

Real-time New York Harbor vessel visualization built with React + Vite, backed by an Express relay that consumes AISStream over WebSocket.

## Why a backend relay

AISStream authentication should run on the server, not in browser code. The frontend now connects to a local relay (`/api/ships`) and never sends the AIS API key.

## Setup

1. Create `.env` in the project root:

```env
AISSTREAM_API_KEY=your_aisstream_key
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

## Architecture

- Frontend: React UI + harbor rendering
- Backend (`server.ts`):
  - Connects to `wss://stream.aisstream.io/v0/stream`
  - Sends AIS subscription (NY Harbor bounding box)
  - Caches/merges AIS messages and serves snapshots at `GET /api/ships`

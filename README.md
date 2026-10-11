# 🔴 Red Attack

A browser-based multiplayer FPV drone defense game. Players defend an outpost from waves of enemies by launching and piloting kamikaze drones in first-person view.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Rendering | Three.js (WebGL) |
| Networking | Colyseus 0.18 (WebSocket) |
| Language | TypeScript |
| Build | Vite (client), tsx (server) |
| Monorepo | npm workspaces |

## Project Structure

```
red-attack/
├── packages/
│   ├── client/          # Vite + Three.js frontend
│   │   └── src/
│   │       ├── input/       # InputManager (keyboard + mouse)
│   │       ├── network/     # Colyseus client wrapper
│   │       ├── scene/       # Three.js scene, drone, enemies, terrain
│   │       ├── ui/          # HUD overlay
│   │       └── main.ts      # Game loop
│   ├── server/          # Colyseus game server
│   │   └── src/
│   │       ├── rooms/       # GameRoom (state, physics, waves)
│   │       └── index.ts     # HTTP + WebSocket entry
│   └── shared/          # Shared types & game constants
│       └── src/
│           ├── types.ts
│           └── constants.ts
├── docs/                # Design documents
└── package.json         # Workspace root
```

## Quick Start

```bash
# Install dependencies
npm install

# Run dev (server + client concurrently)
npm run dev
```

Or run separately:

```bash
# Terminal 1 — Server (port 2567)
cd packages/server && npx tsx src/index.ts

# Terminal 2 — Client (port 5173)
cd packages/client && npx vite
```

Open **http://localhost:5173** in your browser.

## Controls (FPV Drone)

| Key | Action |
|-----|--------|
| **W / S** | Forward / backward thrust (in drone's facing direction) |
| **A / D** | Yaw rotation (rotate drone left / right) |
| **Mouse X** | Yaw rotation (additive with A/D) |
| **Mouse Y** | Pitch (tilt nose up / down) |
| **Space** | Ascend (throttle up) / Launch drone when waiting |
| **Shift** | Descend (throttle down) |
| **LMB** | Boost (2× speed) |
| **R** | Self-destruct drone |

### How to Fly

1. **Launch** — Press `Space` while waiting at the outpost.
2. **Turn** — Use `A`/`D` or move the mouse left/right to yaw the drone.
3. **Altitude** — `Space` to ascend, `Shift` to descend.
4. **Thrust** — `W` pushes forward in whatever direction the drone faces.
5. **Strike** — Fly into enemies to detonate. Use boost (`LMB`) for speed.
6. **Self-destruct** — Press `R` to detonate early (e.g., out of bounds).

## Multiplayer

- **Create Game** — generates a 4-character room code.
- **Join Game** — enter the room code to join a friend's session.
- Up to **4 players** per room.
- Each player pilots their own drone independently.
- Shared outpost HP and wave state.

## Game Mechanics

| Parameter | Value |
|-----------|-------|
| Drone speed | 15 m/s (30 m/s boosted) |
| Max flight time | 20 s |
| Max distance | 150 m from outpost |
| Kill radius | 3 m |
| Reload time | 5 s |
| Total waves | 12 |
| Max players | 4 |

### Enemy Types

| Enemy | Speed | HP | Score |
|-------|-------|----|-------|
| Cheburashka | 2.5 m/s | 1 | 10 |
| Soldier | 1.8 m/s | 3 | 20 |
| Bear | 1.0 m/s | 5 | 30 |

## Build for Production

```bash
npm run build
```

Output: `packages/client/dist/` (static files) + compiled server.

## License

Private — all rights reserved.

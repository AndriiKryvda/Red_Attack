# 🔴 Red Attack

A browser-based multiplayer FPV drone defense game. Players defend an outpost from an endless horde of enemies by launching and piloting kamikaze drones in first-person view.

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
│   │       ├── rooms/       # GameRoom (state, physics, horde)
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
| **↑ / ↓** or **Q / E** | Pitch (tilt nose up / down) — keyboard equivalent of mouse Y |
| **Space** | Ascend (throttle up) / Launch drone when waiting |
| **Shift** | Descend (throttle down) |
| **LMB** | Boost (2× speed) |
| **R** | Self-destruct drone |
| **H** | Show / hide the on-screen key guide (remembered between sessions) |
| **Click** | Recapture the mouse after alt-tabbing away or pressing `Esc` |

### How to Fly

1. **Launch** — Press `Space` while waiting at the outpost.
2. **Turn** — Use `A`/`D` or move the mouse left/right to yaw the drone.
3. **Altitude** — `Space` to ascend, `Shift` to descend.
4. **Tilt** — hold `↑`/`↓` (or `Q`/`E`) to point the nose up or down without moving the mouse.
5. **Thrust** — `W` pushes forward in whatever direction the drone faces, so tilt down + `W` = a dive.
6. **Strike** — Fly into enemies to detonate. Use boost (`LMB`) for speed.
7. **Self-destruct** — Press `R` to detonate early (e.g., out of bounds).
8. **Alt-tab** — Leaving the window releases the mouse capture (that is how
   browsers work). Coming back, the game re-grabs the mouse automatically; if
   you pressed `Esc` instead, click once to resume mouse look. Keys held when
   you left are released so the drone does not fly off on its own.

## Multiplayer

- **Create Game** — generates a 4-character room code.
- **Join Game** — enter the room code to join a friend's session.
- Up to **4 players** per room.
- Each player pilots their own drone independently.
- Shared outpost HP and horde state.
- Every pilot sees the other pilots' drones in the air (colour-coded per player, with a callsign tag and a smoke trail).

## Game Mechanics

| Parameter | Value |
|-----------|-------|
| Drone speed | 15 m/s (30 m/s boosted) |
| Max flight time | 20 s |
| Max distance | 150 m from outpost |
| Kill radius | 3 m |
| Reload time | 5 s |
| Horde spawn rate | 0.35 → 1.6 enemies/s (ramps over 9 min, ×players) |
| Threat level | +1 every 45 s |
| Spawn directions | full 360° ring, 105–140 m from the fort |
| Max players | 4 |

### Endless Horde

There are no discrete waves. Enemies stream toward the fort continuously from a
random bearing on a 105–140 m ring, and the spawn rate climbs the longer the
fort holds out: Cheburashka only at the start, soldiers from 15 s and bears from
40 s, with heavier units becoming more common as the threat level rises. A run
ends when the outpost falls (set `HORDE_VICTORY_TIME` in `packages/shared` to
make it a timed-survival win instead).

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

# 🔴 Red Attack

A browser-based multiplayer FPV drone defense game. Players defend an outpost from an endless horde of enemies by launching and piloting kamikaze drones in first-person view. The horde advances out of a Russian-held village on the north and east edges of the map, so the houses, barns, flats and parked cars that fly the tricolor are both the cover the enemies pour out of and targets in their own right.

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
│   │       │                #   Outpost.ts / VillageModels.ts — the fort and the
│   │       │                #   destructible village (models, flags, ruins)
│   │       │                #   Structures.ts — client side of the village state
│   │       │                #   VehicleModels.ts — horde vehicles
│   │       ├── ui/          # HUD overlay
│   │       └── main.ts      # Game loop
│   ├── server/          # Colyseus game server
│   │   └── src/
│   │       ├── rooms/       # GameRoom (state, physics, horde, village)
│   │       └── index.ts     # HTTP + WebSocket entry
│   └── shared/          # Shared types & game constants
│       └── src/
│           ├── types.ts
│           ├── constants.ts
│           └── structures.ts  # STRUCTURE_SPECS, village layout, spawn edges
├── docs/                # Design documents
└── package.json         # Workspace root
```

## Quick Start

Requires **Node 18+ / npm 9+** (npm 7+ is needed for the `workspaces` field; the
root scripts use `npm run -w <package>`). On an older npm the `-w` flag is
ignored and `npm run build` recurses forever, so `.npmrc` sets
`engine-strict=true` and such a toolchain fails at `npm install` with a clear
message instead. Run `nvm use` to pick up the version in `.nvmrc`.

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
| Max distance | 175 m from outpost |
| Kill radius | 3 m |
| Reload time | 5 s |
| Horde spawn rate | 0.35 → 1.6 enemies/s (ramps over 9 min, ×players) |
| Threat level | +1 every 45 s |
| Spawn directions | weighted to the village: 40% north, 40% east, 10% west, 10% south (out on the map border, 142–149 m from the fort) |
| Door spawns | 75% of the spawns on a built-up side step out of a building doorway |
| Village | 14 buildings + 12 parked cars, on the north and east edges 126 m out |
| Wreckage burn | open flame ~14 s, smoke until 55 s, up to 12 piles at once |
| Max players | 4 |

### Endless Horde

There are no discrete waves. Enemies stream toward the fort continuously out on
the map border (142–149 m out, so every enemy has to cross nearly the whole
field), and the spawn rate climbs the longer the fort holds out. The bearing is
not uniform: four in ten come out of the east and four in ten out of the north —
the two built-up sides — and most of those step out of a village doorway instead
of off the open field (see [The Village](#the-village)).

The three foot types — Cheburashka, soldier, bear — can show up in the very first
seconds of a run; the vehicles join in only once the pilots have racked up enough
kills (see the table below), and the HUD shouts `⚠ NEW ENEMY INCOMING` the moment
one unlocks. A run ends when the outpost falls (set `HORDE_VICTORY_TIME` in
`packages/shared` to make it a timed-survival win instead).

### Enemy Types

| Enemy | Speed | HP | Drones per kill | Score | Unlocks at |
|-------|-------|----|-----------------|-------|-----------|
| Cheburashka | 2.5 m/s | 1 | 1 | 10 | from the start |
| Soldier | 1.8 m/s | 3 | 1 | 20 | from the start |
| Bear | 1.0 m/s | 5 | 1 | 30 | from the start |
| Golf Cart · 2 soldiers | 5.5 m/s | 4 | 1 | 40 | 10 kills |
| Motorcyclist | 7.5 m/s | 2 | 1 | 35 | 20 kills |
| Tank | 1.5 m/s | 2 | **2** | 120 | 30 kills |

One detonation takes off as much HP as the target's armour, so everything except
the tank dies to a single drone. The tank is armoured: the first hit sets it on
fire, pays the pilot a quarter of its score, and it keeps driving at the fort
while it burns — a second drone is needed to finish it.

Cheburashka and the bear both walk on two legs — the bear additionally marches a
red banner on a pole — while the soldier marches in carrying a white ceramic
water closet in both hands. These props are cosmetic and carry no mechanics.

The vehicles are the horde's reinforcements. The golf cart is a green roofed
car with a driver and a rifleman seated under the roof and a cargo bed at the
tail; the motorcyclist is a single soldier on a spoked motorcycle, the fastest
thing on the field; the tank rolls on tracked runs with a rotating turret and is
the only unit that survives a hit. All three are built from primitives with
rolling wheels, track links and decals so they stay readable during a 30 m/s
pass.

### The Village

The fort stands in an open field, but the north and east sides of the map are
lined with a strip of village: a row of buildings 126 m out
(`VILLAGE_EDGE_OFFSET`) with cars parked on the road in front of them. It is enemy
territory and it says so — every roof, gable and cab flies the Russian tricolor,
while the fort flies the Ukrainian blue-and-yellow. That is a gameplay feature as
much as set dressing: on a 30 m/s pass the tricolor is what tells a pilot which
side of the line a shape belongs to.

| Structure | Size W×D×H (m) | Hits | Score |
|-----------|----------------|------|-------|
| Sedan · Pickup · Van | 4.4–5.6 long | 1 | 15 · 18 · 20 |
| Bus | 8.5 × 2.6 × 3.2 | 2 | 30 |
| House | 8 × 7 × 6 | 2 | 40 |
| Barn | 11 × 8 × 7 | 2 | 50 |
| Water tower | 6 × 6 × 15 | 2 | 60 |
| Apartment block | 14 × 9 × 12 | 3 | 90 |

Each built-up side gets the same mix — 7 buildings and 6 parked cars — spaced
along the strip with a little jitter, so no two runs look identical and a pilot who
learned one layout still has to look.

- **Cover for the horde.** Three quarters of the enemies that spawn on a built-up
  side step out of a doorway (`HORDE_BUILDING_SPAWN_CHANCE`), scattered ±3.5 m
  along the facade; the rest still walk in from the border.
- **Solid.** A drone detonates against the same box the model fills, so a building
  stops a strike that was aimed past it. Flagpoles, chimneys and roof vents are
  decorative and reach above that box.
- **They burn.** The first hit sets the whole structure alight and pays a quarter
  of its worth; the last one drops it to a low, smoking ruin that stays for the rest
  of the run, its flagpole bent into the rubble under a burnt flag. The apartment
  block soaks three hits, so leveling it is a real commitment of drones.
- **They reset** when a new game starts — rubble and all.

All of it is client-side detail on top of three numbers. The server keeps only
`hp` / `burning` / `destroyed` per structure; each client turns that into the model,
the flame, the charred walls and the cloth. Cloth swings are driven per frame with a
per-structure phase, so the village flutters out of step instead of snapping in
unison, and a burning building chars its own flag rather than every flag on the map.

### Burning Wreckage

Every vehicle leaves something behind. When a golf cart, motorcyclist or tank is
destroyed, its body rolls flat onto its side and stays there for 30 s
(`ENEMY_DEATH_LINGER_TIME`), and a scatter of charred debris — tyres, panels,
the tank's turret and road wheels — lands nearby on top of a scorch mark. The
pile burns with open flame for the first ~14 s, then smokes, cools and fades out
over the last 4 s and is cleaned up at 55 s. At most 12 wrecks are kept on the
field; a new kill retires the oldest pile. This is purely a client-side visual —
it costs no bandwidth and no server state.

## Build for Production

```bash
npm run build
```

Output: `packages/client/dist/` (static files) + compiled server.

## Hosting on a Home Server (Router Port Forwarding)

The game needs **two TCP ports and no UDP**. Both processes already bind to
`0.0.0.0`, so nothing has to change in the code — only on the router.

| Router (external) | Forward to (LAN) | Protocol | What it carries |
|-------------------|------------------|----------|-----------------|
| **2567** | `<server LAN IP>:2567` | TCP | Colyseus game server: the gameplay WebSocket **and** the room-code HTTP lookups (`/join/:code`, `/room/:code`, `/health`) |
| **5173** | `<server LAN IP>:5173` | TCP | The web client itself — the page and the JS bundle (Vite dev server) |

Players then visit `http://<your-public-ip-or-domain>:5173`, create or join a room
code, and the browser opens its own WebSocket straight back to port 2567.

### Why port 2567 must stay 2567

`packages/client/src/network/Client.ts` builds the game-server URL from the host
the page was served from, with the port hardcoded:

```ts
this.client = new Client(`${protocol}//${window.location.hostname}:2567`);
```

So the browser always dials **port 2567 on whatever hostname the page came from**.
Publish it on the router as `2567 → 2567`; a remapped external port (e.g.
`8443 → 2567`) fails silently with a connection error in the browser console.

### Keep it on plain HTTP, not HTTPS

The game server has no TLS, and the client only picks `wss:` when the page itself
is `https:`. An HTTPS page would try `wss://host:2567` against a plain WebSocket
endpoint and be blocked by the browser as mixed content. Serve the client over
HTTP until TLS is added to the WebSocket transport.

### Recommended: build instead of exposing the dev server

The Vite dev server is fine for a handful of friends, but for anything more public,
build the static bundle and serve it from nginx/Caddy on port 80:

```bash
npm run build
# serve packages/client/dist/ from nginx on port 80
```

In that case forward **80** and **2567** — the client still dials `:2567`, so that
mapping is unchanged.

### Firewall on the Linux box

```bash
sudo ufw allow 5173/tcp   # or 80/tcp when serving the built client
sudo ufw allow 2567/tcp
```

### Pre-flight checklist

- Reserve a **static LAN IP** for the box (DHCP reservation) so the forward keeps pointing at it.
- You need a **public WAN IP** on the router. Many ISPs use CGNAT, where router
  port forwarding does nothing — use a Cloudflare Tunnel or Tailscale Funnel instead.
- Use **DDNS** if your public IP is not static, so the room code link survives a reconnect.
- Verify from outside your own LAN (not from a device on the same network):
  ```bash
  curl http://<public-ip>:2567/health   # → {"status":"ok","game":"Red Attack"}
  curl -I http://<public-ip>:5173
  ```
- Do not open SSH (22) as part of this. Keep it LAN-only or key-gated.

### Want to publish a single port?

`packages/client/vite.config.ts` contains a `'/ws'` proxy to `ws://localhost:2567`,
but nothing uses it — the client dials port 2567 directly. Collapsing to one port
requires changing `NetworkClient` to a same-origin endpoint (`/ws`) and proxying
both HTTP and WebSocket through one front door (nginx/Caddy). That is also the
right time to add TLS.

## License

Private — all rights reserved.

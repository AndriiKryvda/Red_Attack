# 🔴 Red Attack

A browser-based multiplayer fort defense game. A handful of pilots man the weapon stations of an open fortified position and hold it against an endless horde. Two weapons are on the table: fly a kamikaze drone in first-person view for precision work, or stand at the tube mortar and put shells across the middle of the field. The horde advances out of a Russian-held village on the north and east edges of the map, so the houses, barns, flats and parked cars that fly the tricolor are both the cover the enemies pour out of and targets in their own right.

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
│   │       │                #   Mortar.ts / MortarFx.ts — the tube, its aim
│   │       │                #   rings and the shell / shell-camera layer
│   │       │                #   Structures.ts — client side of the village state
│   │       │                #   VehicleModels.ts — horde vehicles
│   │       ├── ui/          # HUD overlay
│   │       └── main.ts      # Game loop
│   ├── server/          # Colyseus game server
│   │   └── src/
│   │       ├── rooms/       # GameRoom (state, physics, horde, village, shells)
│   │       └── index.ts     # HTTP + WebSocket entry
│   └── shared/          # Shared types & game constants
│       └── src/
│           ├── types.ts
│           ├── constants.ts
│           ├── mortar.ts      # weapon types, range clamp, shared ballistics
│           └── structures.ts  # STRUCTURE_SPECS, village layout, spawn edges
├── docs/                # Design documents
└── package.json         # Workspace root
```

## Quick Start

Requires **Node 22+ / npm 9+**: `@colyseus/core` needs Node 22, and npm 7+ is needed
to link the workspace packages into `node_modules`. `scripts/check-engines.js` runs
on `preinstall` and refuses an older toolchain with an explanation (override with
`SKIP_ENGINES_CHECK=1`). Use `nvm use` to pick up the version in `.nvmrc`, or see
[Installing Node 22 on the Linux server](#installing-node-22-on-the-linux-server).

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

## Controls

Two stations, one key each: `1` mans the FPV drone pad, `2` mans the tube mortar and
`Tab` swaps between them. `Space` then does whatever the manned station does — launch
the quad, or send a shell at wherever the fort view is pointing. With the tube manned,
the left mouse button is a second trigger for the same shell.

### Keys

| Key | Action |
|-----|--------|
| **1 / 2** | Man the FPV drone pad / man the tube mortar |
| **Tab** | Swap between the two weapons |
| **W / S** | Forward / backward thrust (in drone's facing direction) |
| **A / D** | Yaw rotation (rotate drone left / right) |
| **Mouse X** | Yaw rotation (additive with A/D) |
| **Mouse Y** | Pitch (tilt nose up / down) |
| **↑ / ↓** or **Q / E** | Pitch (tilt nose up / down) — keyboard equivalent of mouse Y |
| **Space** | Ascend (throttle up); when waiting at the fort: launch the drone or fire the mortar |
| **Shift** | Descend (throttle down) |
| **LMB** | Boost (2× speed); with the tube manned, fires the mortar |
| **R** | Self-destruct drone |
| **H** | Show / hide the on-screen key guide (remembered between sessions) |
| **Click** | Recapture the mouse after alt-tabbing away or pressing `Esc` |

### How to Fly

1. **Launch** — With the drone manned (`1`), press `Space` to send the quad off the pad.
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

### The Mortar

The tube on the courtyard slab is the fort's area weapon. It cannot be aimed as
precisely as a quad, but one shell clears a whole crowd at once and it reaches ground
a 30 m/s pass would have flown past.

1. **Man it** — press `2` (or `Tab`). The fort view gains two painted range rings and
   a dashed arc that swings with the mouse.
2. **Aim** — the tube is laid at a fixed 60° elevation, so the only thing a pilot sets
   is *distance*: swinging the view slides the impact marker between the near and the
   far ring. An amber marker means the spot you wanted sits outside the ring of fire
   and the shot will be pulled back onto the limit — the fort and its own wire always
   fall short of the minimum range, so nothing lands inside the perimeter.
3. **Fire** — `Space` or the left mouse button. The camera leaves the fort, tracks the
   shell from the side for the whole flight and holds a second on the crater before the
   view goes back.
4. **Reload** — 8 s, on each pilot's own clock.

Flight time tells you the range: about 1.9 s at the near limit, 3.8 s at the far one,
and the horde keeps walking all the while, so a shell is aimed where the column is
going rather than where it is. Server and client solve the same closed-form ballistics
(`packages/shared/src/mortar.ts`), so the dashed arc you aimed along is exactly the
path the server detonates the shell on — and nothing about a shell's flight has to be
sent per frame.

## Multiplayer

- **Create Game** — generates a 4-character room code.
- **Join Game** — enter the room code to join a friend's session.
- Up to **4 players** per room.
- Each player pilots their own drone independently.
- Shared outpost HP and horde state.
- Every pilot sees the other pilots' drones in the air (colour-coded per player, with a callsign tag and a smoke trail).
- Weapons are per pilot: switching between the quad and the mortar, and each mortar reload, is private to that pilot, while every shell, crater and kill is shared. Only the shooter's own camera leaves the fort to watch a shell land.

## Game Mechanics

| Parameter | Value |
|-----------|-------|
| Drone speed | 15 m/s (30 m/s boosted) |
| Max flight time | 20 s |
| Max distance | 175 m from outpost |
| Drone kill radius | 3 m |
| Drone reload | 5 s |
| Mortar ring of fire | 30–120 m from the fort, laid at a fixed 60° elevation |
| Mortar shell | 9 m blast — kills everything it catches, tank included, and lands one heavy hit on any building inside it |
| Mortar reload | 8 s per pilot |
| Mortar flight | 1.9 s at 30 m → 3.8 s at 120 m, apex 15–54 m |
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

### The Fort

The fort is an open fortified position standing in the middle of a field, not a
building: the fight happens in the courtyard behind the wire, and the sky above it is
clear, so a quad always has a way out.

| Piece | What it is |
|-------|-----------|
| Berm and wire | Sandbags on all four sides — three bags thick, six courses high — with a fence on top. Reaching this line is what counts as a breach (`FORT_PERIMETER`, 12.5 m from the centre) |
| Firing platforms | Sandbagged decks on posts at all four corners — the lookouts of the position |
| Command bunker | North-west: a roofless bunker of sandbag walls on a poured floor, a revetted pit to shelter in rather than a roof a drone can fly into |
| Drone pad | South-west: the FPV quad on a marked concrete slab with its guidance mast |
| Mortar pad | South-east: the tube on a poured slab, firing clear over the berm |
| Gate | South face: the vehicle gap in the berm, sandbagged at the flanks |
| Flag | An 11 m pole on a sandbag plinth in the middle of the courtyard, flying the Ukrainian blue-and-yellow |

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

Output: `packages/client/dist/` (static files) + compiled server in
`packages/server/dist/`. Needs the Node 22 toolchain described below.

Run the built game on the box:

```bash
npm run start            # one process: game server + built client on 0.0.0.0:2567
npm run start:all        # the same, plus a separate Vite preview on 0.0.0.0:5173
npm run preview:client   # only the client, on 0.0.0.0:5173
```

`npm run start` also mounts `packages/client/dist` on the game-server port, so
`http://<host>:2567/` is all you need - the client dials `:2567` anyway, and nothing
listens on 5173 unless you run one of the client commands above. When the dist folder
is missing the server still starts and logs a hint instead.

Every workspace script is a plain `cd packages/<name> && npm run <script>`, so it
behaves the same on any npm from 7 up (npm 6 silently mangles `npm run -w`, which
is what made the old build recurse into itself forever). npm 7+ is still required,
because only it links the `@red-attack/*` workspace packages into `node_modules`.

### Installing Node 22 on the Linux server

Ubuntu's own `nodejs` apt package is far too old (20.04 ships Node 10 / npm 6),
and `@colyseus/core` 0.18 needs Node 22 to even start. `scripts/check-engines.js`
runs on `preinstall` and stops an old toolchain with an explanation instead of a
cryptic crash; `SKIP_ENGINES_CHECK=1 npm install` overrides it if you insist.

Install Node 22 system-wide from NodeSource (needs sudo, glibc >= 2.28, and amd64
or arm64 - it works on a Banana Pi M5):

```bash
node -v && npm -v                       # note what you have now
sudo apt-get remove -y nodejs npm       # drop the distro package first
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs          # ships Node 22 + npm 10
hash -r                                 # clear bash's cached /usr/bin/node
node -v && npm -v                       # must be v22.x / 10.x
```

The `| sudo -E bash -` pipe is not optional: running the bare `curl` URL only
prints the script and installs nothing.

No sudo, or NodeSource unreachable? Unpack the official tarball instead - use
`linux-arm64` on a 64-bit ARM board, `linux-x64` on a PC:

```bash
cd /tmp
curl -fLO https://nodejs.org/dist/v22.23.1/node-v22.23.1-linux-arm64.tar.xz
mkdir -p ~/.local && tar -xJf node-v22.23.1-linux-arm64.tar.xz -C ~/.local
echo 'export PATH="$HOME/.local/node-v22.23.1-linux-arm64/bin:$PATH"' >> ~/.bashrc
exec bash && node -v && npm -v
```

Then rebuild from a clean tree:

```bash
cd ~/Red_Attack && git pull
rm -rf node_modules && npm install && npm run build
ls -l node_modules/@red-attack          # symlinks into ../../packages/*
ls packages/client/dist                 # index.html + assets/
```

If a systemd unit runs the game server, point `ExecStart=` at the new binary
(`/usr/bin/node` after a NodeSource install, or `~/.local/node-*/bin/node` for the
tarball) and reload with
`sudo systemctl daemon-reload && sudo systemctl restart red-attack`.

## Hosting on a Home Server (Router Port Forwarding)

The game needs **two TCP ports and no UDP**. Both processes already bind to
`0.0.0.0`, so nothing has to change in the code — only on the router.

| Router (external) | Forward to (LAN) | Protocol | What it carries |
|-------------------|------------------|----------|-----------------|
| **2567** | `<server LAN IP>:2567` | TCP | Everything `npm run start` serves: the built client at `/`, the gameplay WebSocket and the room-code lookups (`/join/:code`, `/room/:code`, `/health`) |
| **5173** | `<server LAN IP>:5173` | TCP | Only when the client is served separately (`npm run dev:client` / `npm run preview:client`) |

Players then visit `http://<your-public-ip-or-domain>:2567` (or `:5173` when the
client is served separately), create or join a room
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
sudo ufw allow 2567/tcp   # game server + built client (single port)
sudo ufw allow 5173/tcp   # only if the client is served separately
```

### Pre-flight checklist

- Reserve a **static LAN IP** for the box (DHCP reservation) so the forward keeps pointing at it.
- You need a **public WAN IP** on the router. Many ISPs use CGNAT, where router
  port forwarding does nothing — use a Cloudflare Tunnel or Tailscale Funnel instead.
- Use **DDNS** if your public IP is not static, so the room code link survives a reconnect.
- Verify from outside your own LAN (not from a device on the same network):
  ```bash
  curl http://<public-ip>:2567/health   # → {"status":"ok","game":"Red Attack"}
  curl -I http://<public-ip>:2567/      # → 200, the built client
  ```
- Do not open SSH (22) as part of this. Keep it LAN-only or key-gated.

### Serving the client and the game from one port

`npm run start` already does this: the built client, the gameplay WebSocket and the
room-code endpoints all answer on `2567`, so a single port forward is enough. The
remaining step for a true same-origin setup (one HTTPS front door, no `:2567` in the
URL) is to switch `NetworkClient` in `packages/client/src/network/Client.ts` to a
relative `/ws` endpoint and proxy HTTP + WebSocket through nginx/Caddy with TLS.
The `'/ws'` proxy in `packages/client/vite.config.ts` only applies to the Vite dev
server today.

## License

Private — all rights reserved.

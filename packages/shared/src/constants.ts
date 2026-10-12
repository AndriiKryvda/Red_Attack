import { EnemyType } from './types.js';

// ─── Drone ─────────────────────────────────────────────────
export const DRONE_SPEED = 15;           // m/s
export const DRONE_BOOST_MULTIPLIER = 2;
export const DRONE_BOOST_COOLDOWN = 3;   // seconds
export const DRONE_MAX_FLIGHT_TIME = 20; // seconds
export const DRONE_MAX_DISTANCE = 150;   // meters from outpost
export const DRONE_RELOAD_TIME = 5;      // seconds
export const DRONE_KILL_RADIUS = 3;      // meters
export const DRONE_SLOW_RADIUS = 6;      // meters
export const DRONE_SLOW_DURATION = 4;    // seconds
export const DRONE_FREEZE_DURATION = 2;  // seconds

// ─── Enemies ───────────────────────────────────────────────
export const ENEMY_STATS: Record<EnemyType, { speed: number; hp: number; size: number; score: number }> = {
  [EnemyType.CHEBURASHKA]: { speed: 2.5, hp: 1, size: 0.8, score: 10 },
  [EnemyType.BEAR]: { speed: 1.0, hp: 5, size: 2.0, score: 30 },
  [EnemyType.SOLDIER]: { speed: 1.8, hp: 3, size: 1.2, score: 20 },
};

export const ENEMY_DEATH_LINGER_TIME = 30; // seconds before dead enemies disappear

// ─── Outpost ───────────────────────────────────────────────
// The fort has no hit points: every enemy that reaches it is simply counted as a
// breach (see GameRoom.leaks) and the horde keeps coming.

// ─── Horde (endless escalating assault) ──────────────────
// There are no discrete waves: enemies stream toward the fort continuously and
// the spawn cadence tightens the longer the fort survives.
export const MAX_ACTIVE_ENEMIES = 80;        // hard cap of live enemies

export const HORDE_START_RATE = 0.35;        // enemies per second at t = 0 (~1 every 3 s)
export const HORDE_MAX_RATE = 1.6;           // enemies per second at full escalation
export const HORDE_RAMP_TIME = 540;          // seconds to reach HORDE_MAX_RATE
export const HORDE_SPAWN_BURST_MAX = 3;      // enemies per spawn tick at max escalation
export const HORDE_PLAYER_PRESSURE = 0.4;    // extra spawn rate per extra player
export const HORDE_THREAT_INTERVAL = 45;     // seconds per displayed threat level
export const HORDE_VICTORY_TIME = 0;         // 0 = endless survival, >0 = survive N s to win

// Enemy mix unlocks over time so the first minute stays Cheburashka-heavy.
export const HORDE_SOLDIER_DELAY = 15;       // soldiers join the horde after 15 s
export const HORDE_BEAR_DELAY = 40;          // bears join the horde after 40 s

// ─── Map ───────────────────────────────────────────────────
export const MAP_SIZE = 300;             // meters (square)
// The map is completely flat: there is no hill anywhere on the field.
export const OUTPOST_RADIUS = 15;        // meters (outpost footprint)
export const HORDE_SPAWN_RING_MIN = 105;   // meters from center (nearest spawn arc)
export const HORDE_SPAWN_RING_MAX = 140;   // meters from center (farthest spawn arc)

// ─── Server ────────────────────────────────────────────────
export const TICK_RATE = 50;             // ms per tick (20 TPS)
export const MAX_PLAYERS = 4;
export const SERVER_PORT = 2567;

// ─── Scoring ───────────────────────────────────────────────
export const MULTI_KILL_BONUS = 50;
export const MULTI_KILL_THRESHOLD = 3;

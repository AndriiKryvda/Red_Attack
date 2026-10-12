import { EnemyType } from './types.js';

// ─── Drone ─────────────────────────────────────────────────
export const DRONE_SPEED = 15;           // m/s
export const DRONE_BOOST_MULTIPLIER = 2;
export const DRONE_BOOST_COOLDOWN = 3;   // seconds
export const DRONE_MAX_FLIGHT_TIME = 20; // seconds
// A quad gives up and RTBs past this. It has to stay above the horde spawn ring
// further down with room to spare, or an enemy spawned out on the map border
// would be untouchable for a kamikaze run that has to steer around anything.
export const DRONE_MAX_DISTANCE = 175;   // meters from outpost
export const DRONE_RELOAD_TIME = 5;      // seconds
export const DRONE_KILL_RADIUS = 3;      // meters
export const DRONE_SLOW_RADIUS = 6;      // meters
export const DRONE_SLOW_DURATION = 4;    // seconds
export const DRONE_FREEZE_DURATION = 2;  // seconds

// ─── Enemies ───────────────────────────────────────────────
export interface EnemyStat {
  /** Marching speed toward the fort, m/s. */
  speed: number;
  /** Total hit points. One drone deals `armour` of them. */
  hp: number;
  /** Damage one drone detonation deals. Below `hp` means the enemy survives. */
  armour: number;
  /** Model scale: the mesh is built around a box of this many meters. */
  size: number;
  score: number;
}

// The tank is the only armoured unit: 2 hp with 1 damage per hit means it takes
// two drones. After the first hit it keeps driving, on fire.
export const ENEMY_STATS: Record<EnemyType, EnemyStat> = {
  [EnemyType.CHEBURASHKA]:  { speed: 2.5, hp: 1, armour: 1, size: 0.8, score: 10 },
  [EnemyType.BEAR]:         { speed: 1.0, hp: 5, armour: 5, size: 2.0, score: 30 },
  [EnemyType.SOLDIER]:      { speed: 1.8, hp: 3, armour: 3, size: 1.2, score: 20 },
  [EnemyType.GOLF_CART]:    { speed: 5.5, hp: 4, armour: 4, size: 1.6, score: 40 },
  [EnemyType.MOTORCYCLIST]: { speed: 7.5, hp: 2, armour: 2, size: 1.6, score: 35 },
  [EnemyType.TANK]:         { speed: 1.5, hp: 2, armour: 1, size: 3.4, score: 120 },
};

/** Every enemy type the spawner knows about, in unlock order. */
export const ALL_ENEMY_TYPES: EnemyType[] = [
  EnemyType.CHEBURASHKA, EnemyType.SOLDIER, EnemyType.BEAR,
  EnemyType.GOLF_CART, EnemyType.MOTORCYCLIST, EnemyType.TANK,
];

/** Total kills the fort needs before a type starts spawning at all. */
export const ENEMY_UNLOCK_KILLS: Record<EnemyType, number> = {
  [EnemyType.CHEBURASHKA]: 0,
  [EnemyType.SOLDIER]: 0,
  [EnemyType.BEAR]: 0,
  [EnemyType.GOLF_CART]: 10,      // green golf car with two soldiers
  [EnemyType.MOTORCYCLIST]: 20,   // soldier on a motorcycle
  [EnemyType.TANK]: 30,           // armoured, two drones per kill
};

/**
 * Relative spawn chance inside the unlocked pool. Foot units stay the bulk of
 * the horde; vehicles are reinforcements, and the tank is the rarest of them.
 */
export const ENEMY_SPAWN_WEIGHTS: Record<EnemyType, number> = {
  [EnemyType.CHEBURASHKA]: 30,
  [EnemyType.SOLDIER]: 26,
  [EnemyType.BEAR]: 16,
  [EnemyType.GOLF_CART]: 14,
  [EnemyType.MOTORCYCLIST]: 12,
  [EnemyType.TANK]: 6,
};

/** Announcer labels, shared by the HUD and the "new enemy" banner. */
export const ENEMY_DISPLAY_NAMES: Record<EnemyType, string> = {
  [EnemyType.CHEBURASHKA]: 'CHEBURASHKA',
  [EnemyType.BEAR]: 'BEAR',
  [EnemyType.SOLDIER]: 'SOLDIER',
  [EnemyType.GOLF_CART]: 'GOLF CART · 2 SOLDIERS',
  [EnemyType.MOTORCYCLIST]: 'MOTORCYCLIST',
  [EnemyType.TANK]: 'TANK · 2 DRONES NEEDED',
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

// ─── Map ───────────────────────────────────────────────────
export const MAP_SIZE = 300;             // meters (square)
// The map is completely flat: there is no hill anywhere on the field.
export const OUTPOST_RADIUS = 15;        // meters (outpost footprint)
// The horde spawns out on the map border rather than mid-field, so every enemy
// has to cross nearly the whole field before it reaches the fort. The square
// edge is sampled at HORDE_SPAWN_BORDER and rounded off at RING_MAX (a far corner
// is 209 m out, well past a drone's reach); RING_MIN is how far the back of a
// spawn pack trails in from the edge.
export const HORDE_SPAWN_BORDER = MAP_SIZE / 2 - 2;  // meters from center (the edge itself)
export const HORDE_SPAWN_RING_MIN = 142;   // meters from center (nearest spawn arc)
export const HORDE_SPAWN_RING_MAX = 149;   // meters from center (farthest spawn arc)

// ─── Server ────────────────────────────────────────────────
export const TICK_RATE = 50;             // ms per tick (20 TPS)
export const MAX_PLAYERS = 4;
export const SERVER_PORT = 2567;

// ─── Scoring ───────────────────────────────────────────────
export const MULTI_KILL_BONUS = 50;
export const MULTI_KILL_THRESHOLD = 3;
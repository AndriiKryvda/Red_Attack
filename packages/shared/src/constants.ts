import { EnemyType, Difficulty } from './types.js';

// ─── Drone ─────────────────────────────────────────────────
export const DRONE_SPEED = 15;           // m/s
export const DRONE_BOOST_MULTIPLIER = 2;
export const DRONE_BOOST_COOLDOWN = 3;   // seconds
/** Altitude at or below which a quad crashes into the ground and detonates. */
export const DRONE_GROUND_HEIGHT = 0.5;  // meters
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
// The courtyard is fenced in: an enemy that walks up to the wire has broken
// through, it does not get to stroll across the parade ground.
export const FORT_PERIMETER = 12.5;        // meters from center (the fence line)

// ─── Horde (escalating assault — survive 20 min to win) ─────
// There are no discrete waves: enemies stream toward the fort continuously and
// the spawn cadence tightens the longer the fort survives.
export const MAX_ACTIVE_ENEMIES = 100;       // hard cap of live enemies

export const HORDE_START_RATE = 0.35;        // enemies per second at t = 0 (~1 every 3 s)
export const HORDE_MAX_RATE = 2.0;           // enemies per second at full escalation
export const HORDE_RAMP_TIME = 900;          // seconds to reach HORDE_MAX_RATE (15 min)
export const HORDE_SPAWN_BURST_MAX = 3;      // enemies per spawn tick at max escalation
export const HORDE_PLAYER_PRESSURE = 0.4;    // extra spawn rate per extra player
export const HORDE_THREAT_INTERVAL = 60;     // seconds per displayed threat level
export const HORDE_VICTORY_TIME = 1200;      // survive 20 minutes to win

// ─── Difficulty ────────────────────────────────────────────
/**
 * Share of the hard-mode horde each level fields. The multiplier scales the
 * spawn rate (and the live enemy cap) off the hard baseline, which is the
 * current, unchanged game: medium is half as thick, easy a quarter.
 */
export const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = {
  [Difficulty.EASY]: 0.25,
  [Difficulty.MEDIUM]: 0.5,
  [Difficulty.HARD]: 1.0,
};

/** Human labels for the menu and the HUD. */
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  [Difficulty.EASY]: 'EASY',
  [Difficulty.MEDIUM]: 'MEDIUM',
  [Difficulty.HARD]: 'HARD',
};

/** A room with no difficulty chosen defaults to the easy horde. */
export const DEFAULT_DIFFICULTY = Difficulty.EASY;

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

// ─── Mortar ────────────────────────────────────────────────
// The tube mortar on the courtyard pad owns the middle of the field. Both limits
// are a share of the half-map: at 20% a shell cannot land on our own fence, and
// at 80% the border the horde walks in from stays the drone's job.
export const MORTAR_RANGE_MIN_PCT = 0.20;
export const MORTAR_RANGE_MAX_PCT = 0.80;
export const MORTAR_MIN_RANGE = (MAP_SIZE / 2) * MORTAR_RANGE_MIN_PCT; // 30 m
export const MORTAR_MAX_RANGE = (MAP_SIZE / 2) * MORTAR_RANGE_MAX_PCT; // 120 m
/** Standing lay: the barrel is never raised below this, so every shot is a lob. */
export const MORTAR_ELEVATION = (60 * Math.PI) / 180;
/** Heavier than real gravity on purpose: keeps the arc short enough to read. */
export const MORTAR_GRAVITY = 30;
/** Where the fort's mortar stands, and how high its muzzle sits. */
export const MORTAR_POSITION = { x: 7, z: 5 };
export const MORTAR_MUZZLE_HEIGHT = 1.9;
/** Seconds the crew needs to lay the tube again between two shots. */
export const MORTAR_RELOAD_TIME = 2;
/** Blast radius: everything inside it is gone, buildings take one hit each. */
export const MORTAR_KILL_RADIUS = 9;
/** Damage one shell deals (a bear has 5 hp, a tank 2), so one shell clears all. */
export const MORTAR_DAMAGE = 6;
/** Visual size of the blast relative to a drone detonation. */
export const MORTAR_BLAST_SCALE = 1.9;
/** Seconds the impact camera lingers on the crater after the shell lands. */
export const MORTAR_CAM_HOLD = 1;

// ─── Server ────────────────────────────────────────────────
export const TICK_RATE = 50;             // ms per tick (20 TPS)
/**
 * A room holds a full ten-man crew: enough pilots to keep every weapon station
 * manned at once (the quad, the tube and the four machine guns) with pilots left
 * over to fly a second and third wave of quads. Colours, the state broadcast and
 * the horde scaling all stay in step with this number — see OWNER_PALETTE in
 * packages/client/src/scene/Drone.ts.
 */
export const MAX_PLAYERS = 10;
export const SERVER_PORT = 2567;

// ─── Scoring ───────────────────────────────────────────────
export const MULTI_KILL_BONUS = 50;
export const MULTI_KILL_THRESHOLD = 3;
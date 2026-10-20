/**
 * ─── State wire format ────────────────────────────────────────────────────────
 *
 * The server used to `broadcast()` a complete `GameState` — every enemy, every
 * structure, every field — twenty times a second. With a saturated horde that is
 * ~28 KB per frame per client, most of it bytes that did not change: wrecks that
 * sit still for 30 s, buildings that never move, `maxHp` that never moves.
 *
 * What goes over the wire now is a per-client **delta**: for each collection the
 * client is told which entities appeared, which moved, which changed state, and
 * which are gone. Positions and angles are quantized to fixed point, timestamps
 * are relative milliseconds instead of absolute epoch, and entities are keyed by
 * the integer half of their id instead of the whole string.
 *
 * Records are positional arrays rather than objects so the key strings are paid
 * once in this file's documentation instead of once per entity per frame.
 *
 * A frame is only ever sent in full to a client that has just joined (or has
 * asked to resync); everyone else only ever receives what moved since the frame
 * they were last sent.
 */

/** Bump when a tuple layout below changes, so a stale client resyncs instead of misreading. */
export const NET_VERSION = 2;

/** Metres per quantized position unit — 1 cm, and ±150 m fits comfortably in an int16. */
export const POS_STEP = 0.01;
/** Radians per quantized angle unit. */
export const ANGLE_STEP = 0.001;
/** Metres per quantized speed unit. */
export const SPEED_STEP = 0.01;

export function qPos(metres: number): number { return Math.round(metres / POS_STEP); }
export function qAngle(radians: number): number { return Math.round(radians / ANGLE_STEP); }
export function qSpeed(mps: number): number { return Math.round(mps / SPEED_STEP); }

export function dequantPos(q: number): number { return q * POS_STEP; }
export function dequantAngle(q: number): number { return q * ANGLE_STEP; }
export function dequantSpeed(q: number): number { return q * SPEED_STEP; }

/** Milliseconds from `now` until `abs`, clamped at zero so it stays a small int. */
export function relTime(abs: number, now: number): number {
  return abs > now ? Math.round(abs - now) : 0;
}

/** The inverse: an absolute timestamp from a relative one, for the client. */
export function absTime(rel: number, now: number): number {
  return rel > 0 ? now + rel : 0;
}

/**
 * The same, rounded to a whole second. A countdown that ticks in milliseconds
 * changes on every single frame and so forces a fresh patch every frame; rounded
 * to seconds it changes once a second, which is exactly the precision the HUD
 * counts off.
 */
export function relTimeSec(abs: number, now: number): number {
  return abs > now ? Math.ceil((abs - now) / 1000) : 0;
}

export function absTimeSec(rel: number, now: number): number {
  return rel > 0 ? now + rel * 1000 : 0;
}

/** Rounded to a tenth of a second: fine for a status tint, cheap on the wire. */
export function relTimeDs(abs: number, now: number): number {
  return abs > now ? Math.ceil((abs - now) / 100) : 0;
}

export function absTimeDs(rel: number, now: number): number {
  return rel > 0 ? now + rel * 100 : 0;
}

// ─── Enum ↔ wire index tables ─────────────────────────────────────────────────
// String enums cost a dictionary entry per entity per frame; an index costs one
// small int. Order is the protocol — append only, never reorder.
export const ENEMY_TYPE_WIRE = [
  'cheburashka', 'bear', 'soldier', 'golf_cart', 'motorcyclist', 'tank',
] as const;
export const GAME_PHASE_WIRE = ['lobby', 'playing', 'victory', 'defeat'] as const;
export const PLAYER_STATE_WIRE = ['waiting', 'piloting', 'cooldown'] as const;
export const WEAPON_WIRE = ['fpv', 'vampire', 'mortar', 'hmg1', 'hmg2', 'hmg3', 'hmg4'] as const;
export const STRUCTURE_KIND_WIRE = ['building', 'car'] as const;
export const STRUCTURE_VARIANT_WIRE = [
  'house', 'block', 'barn', 'tower', 'sedan', 'pickup', 'van', 'bus',
] as const;
export const DIFFICULTY_WIRE = ['easy', 'medium', 'hard'] as const;
/** Drone kind on the wire: 0 = fpv, 1 = vampire. */
export const DRONE_KIND_WIRE = ['fpv', 'vampire'] as const;

/** Index of `value` in a wire table, or 0 when unrecognised so the frame stays well-formed. */
export function wireIndex(table: readonly string[], value: string | undefined): number {
  const i = value === undefined ? -1 : table.indexOf(value);
  return i < 0 ? 0 : i;
}

/** The inverse, with the same fallback. */
export function wireValue(table: readonly string[], index: number): string {
  return table[index] ?? table[0];
}

/** Enemy state bits, packed into one int instead of four booleans. */
export const EF_DEAD = 1;
export const EF_BURNING = 2;

/** Structure state bits, packed into one int instead of two booleans. */
export const SF_BURNING = 1;
export const SF_DESTROYED = 2;

// ─── Tuples ───────────────────────────────────────────────────────────────────
// Each collection splits its record three ways:
//   static — never changes after the entity spawns; only ever travels in `a`
//   state  — changes occasionally; travels in `a` and `p`
//   pos    — changes most ticks; travels in `a` and `m`
// `a` is always [id, ...static, ...state, ...pos].

/** `a` = [id, type, maxHp, speedQ | hp, flags, slowMs, frozenMs | x, z] */
export type EnemyAdd = [number, number, number, number, number, number, number, number, number, number];
/** `m` = [id, x, z] */
export type EnemyMove = [number, number, number];
/** `p` = [id, hp, flags, slowMs, frozenMs] */
export type EnemyPatch = [number, number, number, number, number];

/** `a` = [id, kind, variant, x, z, yawQ, maxHp | hp, flags] */
export type StructureAdd = [number, number, number, number, number, number, number, number, number];
/** `p` = [id, hp, flags] */
export type StructurePatch = [number, number, number];

/** `a` = [id, ownerId, kind, ageDs | alive, bombs, returning | x, y, z, yawQ, pitchQ, vx, vy, vz] */
export type DroneAdd = [number, string, number, number, number, number, number, number, number, number, number, number, number, number, number];
/** `m` = [id, x, y, z, yawQ, pitchQ, vx, vy, vz] */
export type DroneMove = [number, number, number, number, number, number, number, number, number];
/** `p` = [id, alive, bombs, returning, ageDs] */
export type DronePatch = [number, number, number, number, number];

/** `a` = [id, ownerId | x, y, z] */
export type BombAdd = [number, string, number, number, number];
/** `m` = [id, x, y, z] */
export type BombMove = [number, number, number, number];

/** Mines never move and never change: they arrive once and leave when they detonate. */
/** `a` = [id, ownerId, x, z] */
export type MineAdd = [number, string, number, number];



/**
 * The player record is long and mixed, so it travels as a flat array rather than
 * a tuple; per-gun arrays are comma-joined into single cells on the way out.
 *
 * `a` = [id, name | state, score, ready, droneId, cooldownMs, weapon, mortarMs,
 *        hmgAmmo, hmgReloadMs, manningGun, hmgYawQ, hmgPitchQ,
 *        vBombs, vReturning, vReloadMs, credits, unlocked]
 */
export type PlayerAdd = (string | number)[];
/** `p` = the same minus the leading id. */
export type PlayerPatch = (string | number)[];

/** [phase, threat, elapsed, alive, kills, leaks, playerCount] */
export type NetHeader = [number, number, number, number, number, number, number];
/** [roomCode, difficulty] — travels on full frames only. */
export type NetMeta = [string, number];

/**
 * One collection's worth of change. Every field is optional and simply absent
 * when nothing happened, which is the whole point: a quiet tick is a handful of
 * bytes rather than a rebuilt world.
 */
export interface NetCollection<A = unknown[], M = unknown[], P = unknown[]> {
  /** Entities the client has not seen yet, as full records. */
  a?: A[];
  /** Entities whose position changed, as [id, ...pos]. */
  m?: M[];
  /** Entities whose state changed, as [id, ...state]. */
  p?: P[];
  /** Ids the client should drop. */
  r?: number[];
}

/** The `state` message the server sends each tick. */
export interface NetFrame {
  v: number;
  /** Monotonic frame counter, for the debug overlay. */
  t: number;
  /** The server's epoch clock in ms; the client's interpolation and countdown clock. */
  st: number;
  /** Present and 1 when this frame is a complete snapshot the client must reset onto. */
  f?: 1;
  h?: NetHeader;
  meta?: NetMeta;
  e?: NetCollection<EnemyAdd, EnemyMove, EnemyPatch>;
  s?: NetCollection<StructureAdd, never, StructurePatch>;
  d?: NetCollection<DroneAdd, DroneMove, DronePatch>;
  b?: NetCollection<BombAdd, BombMove, never>;
  n?: NetCollection<MineAdd>;
  y?: NetCollection<PlayerAdd, never, PlayerPatch>;
}

/** Ask the server for a fresh full frame; sent when the client cannot apply a delta. */
export const RESYNC_MSG = 'resync';

/**
 * The numeric half of an entity id — `e_41` becomes `41`. Each collection has its
 * own counter, so the number is unique within the collection it came from.
 */
export function wireId(id: string): number {
  const underscore = id.indexOf('_');
  return underscore < 0 ? NaN : Number(id.slice(underscore + 1));
}

/** The client's inverse: rebuild the string id the rest of the codebase expects. */
export function fullId(prefix: string, num: number): string { return `${prefix}_${num}`; }

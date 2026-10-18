import { StructureKind, StructureVariant } from './structures.js';
import { WeaponType } from './mortar.js';


// ─── Enemy Types ───────────────────────────────────────────
export enum EnemyType {
  CHEBURASHKA = 'cheburashka',
  BEAR = 'bear',
  SOLDIER = 'soldier',
  /** Green golf car carrying two soldiers — joins the horde after 10 kills. */
  GOLF_CART = 'golf_cart',
  /** Soldier on a motorcycle — joins the horde after 20 kills. */
  MOTORCYCLIST = 'motorcyclist',
  /** Armoured tank: takes two drone hits, igniting after the first one. */
  TANK = 'tank',
}

// ─── Game Phases ───────────────────────────────────────────
export enum GamePhase {
  LOBBY = 'lobby',
  PLAYING = 'playing',
  VICTORY = 'victory',
  DEFEAT = 'defeat',
}

// ─── Player State ──────────────────────────────────────────
export enum PlayerState {
  WAITING = 'waiting',       // At base, can launch drone
  PILOTING = 'piloting',     // Controlling a drone
  COOLDOWN = 'cooldown',     // Drone destroyed, waiting
}

// ─── Difficulty ────────────────────────────────────────────
/**
 * How thick the horde is. Hard is the current, unchanged game; the others field
 * a smaller share of it (see DIFFICULTY_MULTIPLIER in constants.ts).
 */
export enum Difficulty {
  EASY = 'easy',
  MEDIUM = 'medium',
  HARD = 'hard',
}

// ─── Vector3 ───────────────────────────────────────────────
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
// ─── Structure (village buildings and parked cars) ─────────
/**
 * A destructible prop on the edge of the map. Structures never move, so the whole
 * record is static apart from `hp` / `burning` / `destroyed`: a drone hit sets it
 * on fire, and its last hp turns it into rubble.
 */
export interface StructureData {
  id: string;
  kind: StructureKind;
  /** Key into STRUCTURE_SPECS — the model on the client, the box on the server. */
  variant: StructureVariant;
  x: number;
  z: number;
  /** Yaw in radians; the facade (local +Z) faces the fort. */
  yaw: number;
  hp: number;
  maxHp: number;
  burning: boolean;
  destroyed: boolean;
}



// ─── Enemy ─────────────────────────────────────────────────
export interface EnemyData {
  id: string;
  type: EnemyType;
  position: Vec3;
  hp: number;
  maxHp: number;
  speed: number;
  slowedUntil: number;   // timestamp
  frozenUntil: number;   // timestamp
  dead: boolean;
  deathTime: number;     // timestamp when killed
  /** Set once an armoured enemy survives a hit: it burns but keeps moving. */
  burning: boolean;
}

// ─── Drone ─────────────────────────────────────────────────
export interface DroneData {
  id: string;
  ownerId: string;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  launchedAt: number;    // timestamp
  alive: boolean;
  /** Which bomber this quad is: a one-hit FPV or a bomb-carrying Vampire. */
  kind?: 'fpv' | 'vampire';
  /** Mini-bombs left in a Vampire's stack (only set when `kind` is 'vampire'). */
  vampireBombs?: number;
  /** True while an empty Vampire is flying itself home to re-arm (input ignored). */
  returning?: boolean;
}

// ─── Vampire mini-bomb ─────────────────────────────────────
/** One mini-bomb in the air under a Vampire, resolved in closed form on the tick. */
export interface BombData {
  id: string;
  ownerId: string;
  position: Vec3;
}

// ─── Player ────────────────────────────────────────────────
export interface PlayerData {
  id: string;
  name: string;
  state: PlayerState;
  score: number;
  ready: boolean;
  droneId: string | null;
  cooldownUntil: number; // timestamp
  /** Which of the fort's weapons this pilot is currently manning. */
  weapon: WeaponType;
  /** Timestamp the mortar crew needs before it can fire again. */
  mortarReadyAt: number;
  /** Rounds left in each of the four machine guns, index for index with HMG_NESTS. */
  hmgAmmo: number[];
  /**
   * Timestamp each gun's belt is back to full, or 0 when it is already full. The
   * crew reloads a gun by not firing it for HMG_RELOAD_TIME seconds, so this is
   * simply the last shot plus that long, and the HUD counts the rest off it.
   */
  hmgReloadAt: number[];
  /** Nest this pilot is manning right now, or -1 when they are on another weapon. */
  manningGun: number;
  /** Lay of the gun the pilot is manning: world yaw, and elevation inside its limits. */
  hmgYaw: number;
  hmgPitch: number;
  /**
   * Vampire bomber state. `vampireBombs` is the stack the pilot in the cockpit is
   * carrying (mirrored from the drone so the HUD can read it off the player),
   * `vampireReturning` says the empty bomber is on autopilot home, and
   * `vampireReloadAt` is the timestamp the crew finishes re-arming.
   */
  vampireBombs: number;
  vampireReturning: boolean;
  vampireReloadAt: number;
}

// ─── Horde ───────────────────────────────────────────
// (removed) the game is one continuous horde — there is no per-wave config table.

// ─── Game State (server → client) ─────────────────────────
export interface GameState {
  phase: GamePhase;
  threatLevel: number;     // escalating difficulty tier (1, 2, 3, ...)
  elapsed: number;         // seconds the horde has been pressing the fort
  enemiesAlive: number;    // live enemies currently on the field
  kills: number;           // total enemies destroyed by all pilots
  leaks: number;           // enemies that made it through to the fort (never ends the game)
  playerCount: number;
  roomCode: string;
  /** The difficulty the host created the room with. */
  difficulty: Difficulty;
  enemies: EnemyData[];
  structures: StructureData[];   // village buildings and parked cars (static)

  drones: DroneData[];
  /** Mini-bombs currently falling from the Vampire bombers (state-driven render). */
  bombs: BombData[];
  players: PlayerData[];
  serverTime: number;
}

// ─── Client → Server Messages ─────────────────────────────
export interface LaunchDroneMsg {
  type: 'launch_drone';
}

export interface DroneInputMsg {
  type: 'drone_input';
  forward: number;   // -1 to 1
  yawDelta: number;  // incremental yaw (mouse + A/D keys)
  pitch: number;     // absolute pitch (radians)
  up: number;        // -1 to 1
  boost: boolean;
}

export interface SelfDestructMsg {
  type: 'self_destruct';
}

export interface PlayerReadyMsg {
  type: 'player_ready';
  ready: boolean;
}

export interface PlayerNameMsg {
  type: 'player_name';
  name: string;
}

/** Swap the pilot over to the other weapon of the fort. */
export interface SelectWeaponMsg {
  type: 'select_weapon';
  weapon: WeaponType;
}

/** Drop a shell on a spot of the field; the server clamps it into range. */
export interface MortarFireMsg {
  type: 'mortar_fire';
  x: number;
  z: number;
}

/**
 * Release one mini-bomb from the Vampire the pilot is flying. There is no aim
 * payload: the bomb simply lets go of the aircraft where it flies, and the server
 * decides whether the drop is legal (enough altitude, a bomb left, the interval
 * elapsed) so a spamming client cannot empty the stack in one frame.
 */
export interface VampireDropMsg {
  type: 'vampire_drop';
}

/**
 * The lay of a manned machine gun and whether the trigger is under. The client
 * streams this the way it streams drone input and the server decides when a round
 * actually leaves the barrel, so the belt, the cyclic rate and the hits stay
 * authoritative no matter how fast a browser sends frames.
 */
export interface HmgInputMsg {
  type: 'hmg_input';
  /** Nest index, index for index with HMG_NESTS. */
  gun: number;
  /** World yaw of the lay, radians. */
  yaw: number;
  /** Elevation in radians; the server clamps it to what the pintle allows. */
  pitch: number;
  firing: boolean;
}

export type ClientMessage =
  | LaunchDroneMsg
  | DroneInputMsg
  | SelfDestructMsg
  | PlayerReadyMsg
  | PlayerNameMsg
  | SelectWeaponMsg
  | MortarFireMsg
  | VampireDropMsg
  | HmgInputMsg;

// ─── Server → Client Events ───────────────────────────────
export interface ExplosionEvent {
  type: 'explosion';
  position: Vec3;
  radius: number;
  /** Visual size multiplier: a mortar shell is a bigger affair than a quad. */
  scale?: number;
}

/**
 * A shell left the fort's mortar. The launch vector and flight time are sent
 * instead of live positions: the arc is closed-form, so every client redraws the
 * exact parabola the server resolves the hit on without any further traffic.
 */
export interface MortarFireEvent {
  type: 'mortar_fire';
  shellId: string;
  ownerId: string;
  /** Muzzle the shell left, in world space. */
  origin: Vec3;
  /** Launch velocity (m/s). */
  velocity: Vec3;
  /** Seconds from the muzzle down to `impact`. */
  flight: number;
  impact: Vec3;
}

/**
 * One round left a machine gun. The server has already decided whether it hit, so
 * the event carries the ray the round flew down and how far it was worth: clients
 * draw a tracer to that distance, with a strike on the ground or on the enemy that
 * took it.
 */
export interface HmgShotEvent {
  type: 'hmg_shot';
  /** Nest index the round came out of, index for index with HMG_NESTS. */
  gun: number;
  ownerId: string;
  /** Muzzle in world space, laid the way the gun was laid. */
  origin: Vec3;
  /** Unit direction the round flew, spread already in it. */
  dir: Vec3;
  /** Metres the tracer runs: to the target, or out to the gun's effective range. */
  range: number;
  /** True when a living thing took the round (never a tank, never a building). */
  hit: boolean;
}

export interface EnemyKilledEvent {
  type: 'enemy_killed';
  enemyId: string;
  enemyType: EnemyType;
  killerId: string;
  position: Vec3;
}

/** An armoured enemy soaked up a hit without dying (the tank after 1 drone). */
export interface EnemyHitEvent {
  type: 'enemy_hit';
  enemyId: string;
  enemyType: EnemyType;
  killerId: string;
  position: Vec3;
  hp: number;
  maxHp: number;
  burning: boolean;
}
/** A drone hit a building or a car without levelling it — it is burning now. */
export interface StructureHitEvent {
  type: 'structure_hit';
  structureId: string;
  kind: StructureKind;
  variant: StructureVariant;
  position: Vec3;
  hp: number;
  maxHp: number;
}

/** A structure was levelled: the client swaps the model for a burning ruin. */
export interface StructureDestroyedEvent {
  type: 'structure_destroyed';
  structureId: string;
  kind: StructureKind;
  variant: StructureVariant;
  killerId: string;
  position: Vec3;
  score: number;
}


/** A new enemy type just crossed its kill threshold and started spawning. */
export interface NewEnemyEvent {
  type: 'new_enemy';
  enemyType: EnemyType;
  kills: number;
}

export interface HordeStartEvent {
  type: 'horde_start';
}

export interface ThreatLevelEvent {
  type: 'threat_level';
  level: number;
  enemiesAlive: number;
}

export interface EnemyBreachEvent {
  type: 'enemy_breach';
  enemyId: string;
  enemyType: EnemyType;
  position: Vec3;
  leaks: number;           // running total of enemies that reached the fort
}

export interface GameOverEvent {
  type: 'game_over';
  victory: boolean;
  scores: Record<string, number>;
}

export type ServerEvent =
  | ExplosionEvent
  | MortarFireEvent
  | HmgShotEvent
  | EnemyKilledEvent
  | EnemyHitEvent
  | StructureHitEvent
  | StructureDestroyedEvent

  | NewEnemyEvent
  | HordeStartEvent
  | ThreatLevelEvent
  | EnemyBreachEvent
  | GameOverEvent;
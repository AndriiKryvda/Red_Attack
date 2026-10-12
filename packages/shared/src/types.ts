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

// ─── Vector3 ───────────────────────────────────────────────
export interface Vec3 {
  x: number;
  y: number;
  z: number;
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
  enemies: EnemyData[];
  drones: DroneData[];
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

export type ClientMessage =
  | LaunchDroneMsg
  | DroneInputMsg
  | SelfDestructMsg
  | PlayerReadyMsg
  | PlayerNameMsg;

// ─── Server → Client Events ───────────────────────────────
export interface ExplosionEvent {
  type: 'explosion';
  position: Vec3;
  radius: number;
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
  | EnemyKilledEvent
  | EnemyHitEvent
  | NewEnemyEvent
  | HordeStartEvent
  | ThreatLevelEvent
  | EnemyBreachEvent
  | GameOverEvent;
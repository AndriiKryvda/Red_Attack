// ─── Enemy Types ───────────────────────────────────────────
export enum EnemyType {
  CHEBURASHKA = 'cheburashka',
  BEAR = 'bear',
  SOLDIER = 'soldier',
}

// ─── Game Phases ───────────────────────────────────────────
export enum GamePhase {
  LOBBY = 'lobby',
  PLAYING = 'playing',
  WAVE_INTERMISSION = 'wave_intermission',
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

// ─── Wave Config ───────────────────────────────────────────
export interface WaveConfig {
  wave: number;
  cheburashka: number;
  bear: number;
  soldier: number;
  spawnInterval: number; // seconds
}

// ─── Game State (server → client) ─────────────────────────
export interface GameState {
  phase: GamePhase;
  wave: number;
  totalWaves: number;
  waveCountdown: number;   // seconds until next wave
  outpostHp: number;
  outpostMaxHp: number;
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

export interface WaveStartEvent {
  type: 'wave_start';
  wave: number;
  totalEnemies: number;
}

export interface WaveCompleteEvent {
  type: 'wave_complete';
  wave: number;
}

export interface GameOverEvent {
  type: 'game_over';
  victory: boolean;
  scores: Record<string, number>;
}

export type ServerEvent =
  | ExplosionEvent
  | EnemyKilledEvent
  | WaveStartEvent
  | WaveCompleteEvent
  | GameOverEvent;

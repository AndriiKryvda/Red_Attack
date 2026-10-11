import { EnemyType, WaveConfig } from './types';

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
export const OUTPOST_HP_PER_PLAYER = 100;
export const OUTPOST_WALL_HP_PER_PLAYER = 25;
export const OUTPOST_WALLS = 4;
export const ENEMY_TARRAM_DMG = 10;

// ─── Waves ─────────────────────────────────────────────────
export const TOTAL_WAVES = 12;
export const WAVE_INTERVAL = 30; // seconds between waves
export const MAX_ACTIVE_ENEMIES = 80;

export const WAVE_TABLE: WaveConfig[] = [
  { wave: 1, cheburashka: 1, bear: 1, soldier: 1, spawnInterval: 3.0 },
  { wave: 2, cheburashka: 2, bear: 1, soldier: 1, spawnInterval: 2.5 },
  { wave: 3, cheburashka: 2, bear: 1, soldier: 2, spawnInterval: 2.2 },
  { wave: 4, cheburashka: 3, bear: 2, soldier: 2, spawnInterval: 2.0 },
  { wave: 5, cheburashka: 3, bear: 2, soldier: 3, spawnInterval: 1.8 },
  { wave: 6, cheburashka: 4, bear: 3, soldier: 3, spawnInterval: 1.6 },
  { wave: 7, cheburashka: 5, bear: 3, soldier: 4, spawnInterval: 1.4 },
  { wave: 8, cheburashka: 5, bear: 4, soldier: 5, spawnInterval: 1.2 },
  { wave: 9, cheburashka: 6, bear: 5, soldier: 5, spawnInterval: 1.0 },
  { wave: 10, cheburashka: 7, bear: 5, soldier: 6, spawnInterval: 0.9 },
  { wave: 11, cheburashka: 8, bear: 6, soldier: 7, spawnInterval: 0.8 },
  { wave: 12, cheburashka: 10, bear: 8, soldier: 8, spawnInterval: 0.6 },
];

// ─── Map ───────────────────────────────────────────────────
export const MAP_SIZE = 300;             // meters (square)
export const HILL_RADIUS = 40;           // meters
export const HILL_HEIGHT = 15;           // meters
export const OUTPOST_RADIUS = 15;        // meters (outpost footprint)
export const SPAWN_DISTANCE = 120;       // meters from center
export const SPAWN_ANGLES = [0, Math.PI / 2, Math.PI, Math.PI * 1.5]; // 4 directions

// ─── Server ────────────────────────────────────────────────
export const TICK_RATE = 50;             // ms per tick (20 TPS)
export const MAX_PLAYERS = 4;
export const SERVER_PORT = 2567;

// ─── Scoring ───────────────────────────────────────────────
export const MULTI_KILL_BONUS = 50;
export const MULTI_KILL_THRESHOLD = 3;
export const WAVE_NO_LEAK_BONUS = 100;

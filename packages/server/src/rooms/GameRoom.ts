import { Room, Client } from '@colyseus/core';
import {
  GamePhase, PlayerState, EnemyType,
  EnemyData, DroneData, PlayerData, Vec3, ClientMessage,
  DRONE_SPEED, DRONE_BOOST_MULTIPLIER, DRONE_BOOST_COOLDOWN,
  DRONE_MAX_FLIGHT_TIME, DRONE_MAX_DISTANCE, DRONE_RELOAD_TIME,
  DRONE_KILL_RADIUS, DRONE_SLOW_RADIUS, DRONE_SLOW_DURATION, DRONE_FREEZE_DURATION,
  ENEMY_STATS, ENEMY_DEATH_LINGER_TIME,
  ALL_ENEMY_TYPES, ENEMY_UNLOCK_KILLS, ENEMY_SPAWN_WEIGHTS,
  MAX_ACTIVE_ENEMIES, TICK_RATE, MAX_PLAYERS,
  MULTI_KILL_BONUS, MULTI_KILL_THRESHOLD,
  HORDE_START_RATE, HORDE_MAX_RATE, HORDE_RAMP_TIME,
  HORDE_SPAWN_BURST_MAX, HORDE_PLAYER_PRESSURE, HORDE_THREAT_INTERVAL,
  HORDE_VICTORY_TIME,
  HORDE_SPAWN_BORDER, HORDE_SPAWN_RING_MIN, HORDE_SPAWN_RING_MAX,
} from '@red-attack/shared';
import { roomCodeRegistry } from '../index.js';

interface InternalEnemy extends EnemyData {
  targetPos: Vec3;
}

interface InternalDrone extends DroneData {
  boostCooldownUntil: number;
  input: { forward: number; up: number; boost: boolean };
}

interface InternalPlayer extends PlayerData {
  lastInput: number;
}

/**
 * Share of the kill score paid to a pilot whose drone damaged an armoured target
 * without destroying it (the tank after the first hit).
 */
const ARMOUR_HIT_SCORE_SHARE = 0.25;

export class GameRoom extends Room {
  phase: GamePhase = GamePhase.LOBBY;
  threatLevel: number = 1;
  elapsed: number = 0;        // seconds the horde has been pressing the fort
  kills: number = 0;
  leaks: number = 0;       // enemies that reached the fort — counted, never fatal
  serverTime: number = 0;
  roomCode: string = '';

  enemies: Map<string, InternalEnemy> = new Map();
  drones: Map<string, InternalDrone> = new Map();
  players: Map<string, InternalPlayer> = new Map();

  private spawnAccumulator: number = 0;
  private idCounter: number = 0;
  /** Enemy types whose kill threshold has been reached (and announced). */
  private unlockedEnemies: Set<EnemyType> = new Set();

  // ─── Lifecycle ───────────────────────────────────────────
  onCreate(_options: any) {
    this.autoDispose = true;
    this.maxClients = MAX_PLAYERS;
    this.setPatchRate(TICK_RATE);
    this.setSimulationInterval(() => this.tick(), TICK_RATE);

    // Generate a 4-char room code for sharing
    this.roomCode = this.generateRoomCode();
    this.setMetadata({ code: this.roomCode });
    roomCodeRegistry.set(this.roomCode, this.roomId);
    console.log(`[Room] Created with code: ${this.roomCode} (roomId: ${this.roomId})`);

    this.onMessage('*', (_client, type: string, message: any) => {
      this.handleMessage(_client, message as ClientMessage);
    });
  }

  onJoin(client: Client, options?: { name?: string }) {
    const id = client.sessionId;
    const player: InternalPlayer = {
      id,
      name: options?.name || `Player ${this.players.size + 1}`,
      state: PlayerState.WAITING,
      score: 0,
      ready: false,
      droneId: null,
      cooldownUntil: 0,
      lastInput: Date.now(),
    };
    this.players.set(id, player);
    console.log(`[Room] Player joined: ${player.name} (${id}). Total: ${this.players.size}`);

    if (this.phase === GamePhase.LOBBY && this.players.size >= 1) {
      this.startGame();
    }
  }

  onLeave(client: Client) {
    const id = client.sessionId;
    const player = this.players.get(id);
    if (player?.droneId) {
      this.drones.delete(player.droneId);
    }
    this.players.delete(id);
  }

  onDispose() {
    roomCodeRegistry.delete(this.roomCode);
    console.log('[Room] Disposed');
  }

  // ─── Game Flow ───────────────────────────────────────────
  private startGame() {
    this.phase = GamePhase.PLAYING;
    this.threatLevel = 1;
    this.elapsed = 0;
    this.spawnAccumulator = 0;
    this.leaks = 0;
    this.kills = 0;
    this.unlockedEnemies.clear();
    this.broadcastEvent({ type: 'horde_start' });
    console.log(`[Horde] Room ${this.roomCode}: endless horde engaged`);
  }

  // ─── Horde escalation ────────────────────────────────────
  /** 0 → 1 escalation progress driven by how long the fort keeps holding. */
  private escalation(): number {
    return Math.min(1, this.elapsed / HORDE_RAMP_TIME);
  }

  /** Enemies per second — ramps with time and scales with the crew size. */
  private spawnRate(): number {
    const pressure = 1 + HORDE_PLAYER_PRESSURE * Math.max(0, this.players.size - 1);
    return (HORDE_START_RATE + (HORDE_MAX_RATE - HORDE_START_RATE) * this.escalation()) * pressure;
  }

  /**
   * Weighted pick over the types the pilots have unlocked so far. The fort has to
   * claim 10 kills before the golf car shows up, 20 for the motorcyclist and 30
   * for the tank (see ENEMY_UNLOCK_KILLS / ENEMY_SPAWN_WEIGHTS).
   */
  private pickEnemyType(): EnemyType {
    const pool: EnemyType[] = [];
    let total = 0;
    for (const type of ALL_ENEMY_TYPES) {
      if (this.kills < ENEMY_UNLOCK_KILLS[type]) continue;
      pool.push(type);
      total += ENEMY_SPAWN_WEIGHTS[type];
    }
    let roll = Math.random() * total;
    for (const type of pool) {
      roll -= ENEMY_SPAWN_WEIGHTS[type];
      if (roll <= 0) return type;
    }
    return pool[pool.length - 1];
  }

  /** Announces each reinforcement the first time its kill threshold is passed. */
  private checkUnlocks() {
    for (const type of ALL_ENEMY_TYPES) {
      const needed = ENEMY_UNLOCK_KILLS[type];
      if (needed === 0 || this.kills < needed) continue;
      if (this.unlockedEnemies.has(type)) continue;
      this.unlockedEnemies.add(type);
      this.broadcastEvent({ type: 'new_enemy', enemyType: type, kills: this.kills });
      console.log(`[Horde] ${type} unlocked at ${this.kills} kills`);
    }
  }

  private updateThreatLevel() {
    const level = 1 + Math.floor(this.elapsed / HORDE_THREAT_INTERVAL);
    if (level !== this.threatLevel) {
      this.threatLevel = level;
      this.broadcastEvent({ type: 'threat_level', level, enemiesAlive: this.getActiveEnemyCount() });
      console.log(`[Horde] Threat level ${level} — ${this.spawnRate().toFixed(2)} enemies/s`);
    }
    if (HORDE_VICTORY_TIME > 0 && this.elapsed >= HORDE_VICTORY_TIME) this.endGame(true);
  }

  /** Only reachable through HORDE_VICTORY_TIME — leaks never end the run. */
  private endGame(victory: boolean) {
    this.phase = victory ? GamePhase.VICTORY : GamePhase.DEFEAT;
    const scores: Record<string, number> = {};
    for (const p of this.players.values()) scores[p.id] = p.score;
    this.broadcastEvent({ type: 'game_over', victory, scores });
  }

  // ─── Tick ────────────────────────────────────────────────
  private tick() {
    this.serverTime = Date.now();
    if (this.phase === GamePhase.PLAYING) {
      this.elapsed += TICK_RATE / 1000;
      this.updateThreatLevel();
      this.tickSpawner();
      this.tickEnemies();
      this.tickDrones();
      this.tickCooldowns();
    }
    this.broadcastState();
  }

  private tickSpawner() {
    const dt = TICK_RATE / 1000;
    this.spawnAccumulator += this.spawnRate() * dt;

    let spawned = 0;
    while (this.spawnAccumulator >= 1 && spawned < HORDE_SPAWN_BURST_MAX) {
      if (this.getActiveEnemyCount() >= MAX_ACTIVE_ENEMIES) {
        // Field is saturated — don't bank up spawns for later.
        this.spawnAccumulator = 0;
        return;
      }
      this.spawnAccumulator -= 1;
      spawned++;
      this.spawnEnemy(this.pickEnemyType());
    }
    if (this.spawnAccumulator > HORDE_SPAWN_BURST_MAX) this.spawnAccumulator = HORDE_SPAWN_BURST_MAX;
  }

  private spawnEnemy(type: EnemyType) {
    const stats = ENEMY_STATS[type];
    // Border spawn: pick a bearing, walk it out to the edge of the map and drop
    // the enemy there, so the horde has to cross the whole field instead of
    // appearing halfway to the wall. The square edge is rounded off at
    // HORDE_SPAWN_RING_MAX so nobody spawns in a far corner out of drone reach,
    // and the ring minimum gives the back of a spawn pack some spread.
    const angle = Math.random() * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const edge = HORDE_SPAWN_BORDER / Math.max(Math.abs(cos), Math.abs(sin));
    const dist = Math.min(edge, HORDE_SPAWN_RING_MAX)
      - Math.random() * (HORDE_SPAWN_RING_MAX - HORDE_SPAWN_RING_MIN);
    const pos: Vec3 = {
      x: cos * dist,
      y: 0,
      z: sin * dist,
    };
    const enemy: InternalEnemy = {
      id: `e_${this.idCounter++}`, type, position: pos,
      hp: stats.hp, maxHp: stats.hp, speed: stats.speed,
      slowedUntil: 0, frozenUntil: 0, dead: false, deathTime: 0, burning: false,
      targetPos: { x: 0, y: 0, z: 0 },
    };
    this.enemies.set(enemy.id, enemy);
  }

  private tickEnemies() {
    const dt = TICK_RATE / 1000;
    for (const [id, enemy] of this.enemies) {
      if (enemy.dead) {
        if (this.serverTime - enemy.deathTime > ENEMY_DEATH_LINGER_TIME * 1000) {
          this.enemies.delete(id);
        }
        continue;
      }
      if (this.serverTime < enemy.frozenUntil) continue;

      let speed = enemy.speed;
      if (this.serverTime < enemy.slowedUntil) speed *= 0.5;

      const dx = enemy.targetPos.x - enemy.position.x;
      const dz = enemy.targetPos.z - enemy.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 5) {
        // Reached the fort: it counts as a breach and is consumed at the wall.
        // There is no defeat condition — the horde presses on forever.
        this.leaks++;
        this.broadcastEvent({
          type: 'enemy_breach', enemyId: enemy.id, enemyType: enemy.type,
          position: { ...enemy.position }, leaks: this.leaks,
        });
        this.enemies.delete(id);
        continue;
      }

      enemy.position.x += (dx / dist) * speed * dt;
      enemy.position.z += (dz / dist) * speed * dt;
      // The map is completely flat: enemies stay glued to the ground. The old
      // hardcoded hill lifted them up to 15 m inside 40 m of the fort, which read
      // as an invisible slope right in front of the walls.
      enemy.position.y = 0;
    }
  }

  // ─── Drone Physics ───────────────────────────────────────
  private tickDrones() {
    const dt = TICK_RATE / 1000;
    for (const [id, drone] of this.drones) {
      if (!drone.alive) continue;
      const elapsed = (this.serverTime - drone.launchedAt) / 1000;
      if (elapsed > DRONE_MAX_FLIGHT_TIME) { this.explodeDrone(drone); continue; }

      const distFromCenter = Math.sqrt(drone.position.x ** 2 + drone.position.z ** 2);
      if (distFromCenter > DRONE_MAX_DISTANCE) { this.explodeDrone(drone); continue; }

      const input = drone.input;
      const speed = DRONE_SPEED * (input.boost && this.serverTime > drone.boostCooldownUntil ? DRONE_BOOST_MULTIPLIER : 1);
      const yaw = drone.yaw;
      const pitch = drone.pitch;

      // Forward is in the direction the drone faces (yaw + pitch)
      const forwardX = Math.sin(yaw) * Math.cos(pitch);
      const forwardY = Math.sin(pitch);
      const forwardZ = Math.cos(yaw) * Math.cos(pitch);

      // Velocity: forward thrust + vertical (up/down)
      drone.velocity.x = forwardX * input.forward * speed;
      drone.velocity.y = forwardY * input.forward * speed + input.up * speed;
      drone.velocity.z = forwardZ * input.forward * speed;

      drone.position.x += drone.velocity.x * dt;
      drone.position.y += drone.velocity.y * dt;
      drone.position.z += drone.velocity.z * dt;
      if (drone.position.y < 0.5) drone.position.y = 0.5;
      if (drone.position.y > 50) drone.position.y = 50;

      this.checkDroneCollisions(drone);
    }
  }

  private checkDroneCollisions(drone: InternalDrone) {
    let kills = 0;
    let contacts = 0;
    const killRadiusSq = DRONE_KILL_RADIUS * DRONE_KILL_RADIUS;
    const slowRadiusSq = DRONE_SLOW_RADIUS * DRONE_SLOW_RADIUS;

    for (const [, enemy] of this.enemies) {
      if (enemy.dead) continue;
      const dx = drone.position.x - enemy.position.x;
      const dy = drone.position.y - enemy.position.y;
      const dz = drone.position.z - enemy.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < killRadiusSq) {
        contacts++;
        if (this.damageEnemy(enemy, drone.ownerId)) kills++;
      } else if (distSq < slowRadiusSq) {
        if (distSq < killRadiusSq * 2) {
          enemy.frozenUntil = this.serverTime + DRONE_FREEZE_DURATION * 1000;
        } else {
          enemy.slowedUntil = this.serverTime + DRONE_SLOW_DURATION * 1000;
        }
      }
    }
    if (kills >= MULTI_KILL_THRESHOLD) {
      const player = this.players.get(drone.ownerId);
      if (player) player.score += MULTI_KILL_BONUS;
    }
    // The quad detonates on contact whether or not the target went with it: an
    // armoured kill costs the pilot a drone either way.
    if (contacts > 0) this.explodeDrone(drone);
  }

  /**
   * Applies one drone detonation to an enemy and returns true if it died.
   * Armoured units (the tank) soak a hit, catch fire and keep driving, so they
   * need a second quad to finish them off.
   */
  private damageEnemy(enemy: InternalEnemy, killerId: string): boolean {
    const stats = ENEMY_STATS[enemy.type];
    const player = this.players.get(killerId);
    enemy.hp = Math.max(0, enemy.hp - stats.armour);

    if (enemy.hp > 0) {
      enemy.burning = true;
      if (player) player.score += Math.round(stats.score * ARMOUR_HIT_SCORE_SHARE);
      this.broadcastEvent({
        type: 'enemy_hit', enemyId: enemy.id, enemyType: enemy.type, killerId,
        position: { ...enemy.position }, hp: enemy.hp, maxHp: enemy.maxHp, burning: true,
      });
      return false;
    }

    enemy.dead = true;
    enemy.deathTime = this.serverTime;
    this.kills++;
    if (player) player.score += stats.score;
    this.broadcastEvent({
      type: 'enemy_killed', enemyId: enemy.id, enemyType: enemy.type, killerId,
      position: { ...enemy.position },
    });
    this.checkUnlocks();
    return true;
  }

  private explodeDrone(drone: InternalDrone) {
    drone.alive = false;
    this.drones.delete(drone.id);
    const player = this.players.get(drone.ownerId);
    if (player) {
      player.state = PlayerState.COOLDOWN;
      player.cooldownUntil = this.serverTime + DRONE_RELOAD_TIME * 1000;
      player.droneId = null;
    }
    this.broadcastEvent({ type: 'explosion', position: { ...drone.position }, radius: DRONE_KILL_RADIUS });
  }

  // ─── Wave Complete & Intermission ────────────────────────
  // The horde never "completes": a run only ends when the fort falls (or when
  // the optional HORDE_VICTORY_TIME is reached), so there is no wave state.

  // ─── Message Handling ────────────────────────────────────
  private handleMessage(client: Client, msg: ClientMessage) {
    const player = this.players.get(client.sessionId);
    if (!player) return;
    switch (msg.type) {
      case 'player_ready':
        player.ready = msg.ready;
        if (this.phase === GamePhase.LOBBY) this.startGame();
        break;
      case 'player_name':
        player.name = msg.name;
        break;
      case 'launch_drone':
        if (player.state === PlayerState.WAITING && this.phase === GamePhase.PLAYING) {
          this.launchDrone(player);
        }
        break;
      case 'drone_input':
        if (player.state === PlayerState.PILOTING && player.droneId) {
          const drone = this.drones.get(player.droneId);
          if (drone && drone.alive) {
            // Apply yaw delta (incremental rotation from mouse + A/D)
            drone.yaw += msg.yawDelta;
            // Set pitch directly (absolute from mouse Y)
            drone.pitch = msg.pitch;
            // Store movement input
            drone.input = { forward: msg.forward, up: msg.up, boost: msg.boost };
            if (msg.boost) drone.boostCooldownUntil = this.serverTime + DRONE_BOOST_COOLDOWN * 1000;
          }
        }
        break;
      case 'self_destruct':
        if (player.state === PlayerState.PILOTING && player.droneId) {
          const drone = this.drones.get(player.droneId);
          if (drone) this.explodeDrone(drone);
        }
        break;
    }
  }

  private launchDrone(player: InternalPlayer) {
    const drone: InternalDrone = {
      id: `d_${this.idCounter++}`, ownerId: player.id,
      position: { x: 0, y: 5, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
      yaw: Math.random() * Math.PI * 2, pitch: 0,
      launchedAt: this.serverTime, alive: true,
      boostCooldownUntil: 0,
      input: { forward: 0, up: 0, boost: false },
    };
    this.drones.set(drone.id, drone);
    player.state = PlayerState.PILOTING;
    player.droneId = drone.id;
  }

  // ─── Helpers ─────────────────────────────────────────────
  private tickCooldowns() {
    for (const player of this.players.values()) {
      if (player.state === PlayerState.COOLDOWN && this.serverTime >= player.cooldownUntil) {
        player.state = PlayerState.WAITING;
        player.cooldownUntil = 0;
      }
    }
  }

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
    } while (roomCodeRegistry.has(code));
    return code;
  }

  private getActiveEnemyCount(): number {
    let count = 0;
    for (const e of this.enemies.values()) { if (!e.dead) count++; }
    return count;
  }

  // ─── Broadcasting ────────────────────────────────────────
  private broadcastState() {
    const state = {
      phase: this.phase,
      threatLevel: this.threatLevel,
      elapsed: Math.floor(this.elapsed),
      enemiesAlive: this.getActiveEnemyCount(),
      kills: this.kills,
      leaks: this.leaks,
      playerCount: this.players.size,
      roomCode: this.roomCode,
      enemies: Array.from(this.enemies.values()).map(e => ({
        id: e.id, type: e.type, position: e.position,
        hp: e.hp, maxHp: e.maxHp, speed: e.speed,
        slowedUntil: e.slowedUntil, frozenUntil: e.frozenUntil,
        dead: e.dead, deathTime: e.deathTime, burning: e.burning,
      })),
      drones: Array.from(this.drones.values()).map(d => ({
        id: d.id, ownerId: d.ownerId, position: d.position,
        velocity: d.velocity, yaw: d.yaw, pitch: d.pitch,
        launchedAt: d.launchedAt, alive: d.alive,
      })),
      players: Array.from(this.players.values()).map(p => ({
        id: p.id, name: p.name, state: p.state,
        score: p.score, ready: p.ready,
        droneId: p.droneId, cooldownUntil: p.cooldownUntil,
      })),
      serverTime: this.serverTime,
    };
    this.broadcast('state', state);
  }

  private broadcastEvent(event: any) {
    this.broadcast('event', event);
  }
}

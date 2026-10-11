import { Room, Client } from '@colyseus/core';
import {
  GamePhase, PlayerState, EnemyType,
  EnemyData, DroneData, PlayerData, Vec3, ClientMessage,
  DRONE_SPEED, DRONE_BOOST_MULTIPLIER, DRONE_BOOST_COOLDOWN,
  DRONE_MAX_FLIGHT_TIME, DRONE_MAX_DISTANCE, DRONE_RELOAD_TIME,
  DRONE_KILL_RADIUS, DRONE_SLOW_RADIUS, DRONE_SLOW_DURATION, DRONE_FREEZE_DURATION,
  ENEMY_STATS, ENEMY_DEATH_LINGER_TIME,
  OUTPOST_HP_PER_PLAYER, ENEMY_TARRAM_DMG,
  TOTAL_WAVES, WAVE_INTERVAL, MAX_ACTIVE_ENEMIES, WAVE_TABLE,
  SPAWN_DISTANCE, SPAWN_ANGLES, TICK_RATE, MAX_PLAYERS,
  MULTI_KILL_BONUS, MULTI_KILL_THRESHOLD, WAVE_NO_LEAK_BONUS,
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

export class GameRoom extends Room {
  phase: GamePhase = GamePhase.LOBBY;
  wave: number = 0;
  waveCountdown: number = 0;
  outpostHp: number = 100;
  outpostMaxHp: number = 100;
  serverTime: number = 0;
  roomCode: string = '';

  enemies: Map<string, InternalEnemy> = new Map();
  drones: Map<string, InternalDrone> = new Map();
  players: Map<string, InternalPlayer> = new Map();

  private spawnQueue: EnemyType[] = [];
  private spawnTimer: number = 0;
  private spawnInterval: number = 3.0;
  private waveEnemiesTotal: number = 0;
  private waveEnemiesKilled: number = 0;
  private waveLeaks: number = 0;
  private idCounter: number = 0;

  // ─── Lifecycle ───────────────────────────────────────────
  onCreate(_options: any) {
    this.autoDispose = true;
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
    this.updateOutpostHp();
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
    this.updateOutpostHp();
  }

  onDispose() {
    roomCodeRegistry.delete(this.roomCode);
    console.log('[Room] Disposed');
  }

  // ─── Game Flow ───────────────────────────────────────────
  private startGame() {
    this.phase = GamePhase.PLAYING;
    this.wave = 0;
    this.updateOutpostHp();
    this.outpostHp = this.outpostMaxHp;
    this.startNextWave();
  }

  private startNextWave() {
    this.wave++;
    if (this.wave > TOTAL_WAVES) {
      this.endGame(true);
      return;
    }

    const waveConfig = WAVE_TABLE[this.wave - 1];
    const playerCount = this.players.size;
    this.spawnInterval = waveConfig.spawnInterval;
    this.waveEnemiesKilled = 0;
    this.waveLeaks = 0;

    this.spawnQueue = [];
    for (let i = 0; i < waveConfig.cheburashka * playerCount; i++) {
      this.spawnQueue.push(EnemyType.CHEBURASHKA);
    }
    for (let i = 0; i < waveConfig.bear * playerCount; i++) {
      this.spawnQueue.push(EnemyType.BEAR);
    }
    for (let i = 0; i < waveConfig.soldier * playerCount; i++) {
      this.spawnQueue.push(EnemyType.SOLDIER);
    }
    for (let i = this.spawnQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.spawnQueue[i], this.spawnQueue[j]] = [this.spawnQueue[j], this.spawnQueue[i]];
    }

    this.waveEnemiesTotal = this.spawnQueue.length;
    this.spawnTimer = 0;
    this.phase = GamePhase.PLAYING;

    this.broadcastEvent({ type: 'wave_start', wave: this.wave, totalEnemies: this.waveEnemiesTotal });
    console.log(`[Wave ${this.wave}] Started with ${this.waveEnemiesTotal} enemies`);
  }

  private startIntermission() {
    this.phase = GamePhase.WAVE_INTERMISSION;
    this.waveCountdown = WAVE_INTERVAL;
    if (this.waveLeaks === 0) {
      for (const player of this.players.values()) {
        player.score += WAVE_NO_LEAK_BONUS;
      }
    }
    this.broadcastEvent({ type: 'wave_complete', wave: this.wave });
  }

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
      this.tickSpawner();
      this.tickEnemies();
      this.tickDrones();
      this.tickCooldowns();
      this.checkWaveComplete();
    } else if (this.phase === GamePhase.WAVE_INTERMISSION) {
      this.tickIntermission();
      this.tickEnemies();
      this.tickCooldowns();
    }
    this.broadcastState();
  }

  private tickSpawner() {
    if (this.spawnQueue.length === 0) return;
    this.spawnTimer += TICK_RATE / 1000;
    if (this.spawnTimer >= this.spawnInterval) {
      this.spawnTimer = 0;
      if (this.getActiveEnemyCount() < MAX_ACTIVE_ENEMIES) {
        const type = this.spawnQueue.shift()!;
        this.spawnEnemy(type);
      }
    }
  }

  private spawnEnemy(type: EnemyType) {
    const stats = ENEMY_STATS[type];
    const angle = SPAWN_ANGLES[Math.floor(Math.random() * SPAWN_ANGLES.length)];
    const spread = (Math.random() - 0.5) * 30;
    const spawnAngle = angle + (spread / SPAWN_DISTANCE);
    const pos: Vec3 = {
      x: Math.cos(spawnAngle) * SPAWN_DISTANCE,
      y: 0,
      z: Math.sin(spawnAngle) * SPAWN_DISTANCE,
    };
    const enemy: InternalEnemy = {
      id: `e_${this.idCounter++}`, type, position: pos,
      hp: stats.hp, maxHp: stats.hp, speed: stats.speed,
      slowedUntil: 0, frozenUntil: 0, dead: false, deathTime: 0,
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
        this.outpostHp -= ENEMY_TARRAM_DMG;
        this.waveLeaks++;
        enemy.dead = true;
        enemy.deathTime = this.serverTime;
        if (this.outpostHp <= 0) { this.outpostHp = 0; this.endGame(false); }
        continue;
      }

      enemy.position.x += (dx / dist) * speed * dt;
      enemy.position.z += (dz / dist) * speed * dt;
      enemy.position.y = this.getHillHeight(enemy.position.x, enemy.position.z);
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
    const killRadiusSq = DRONE_KILL_RADIUS * DRONE_KILL_RADIUS;
    const slowRadiusSq = DRONE_SLOW_RADIUS * DRONE_SLOW_RADIUS;

    for (const [, enemy] of this.enemies) {
      if (enemy.dead) continue;
      const dx = drone.position.x - enemy.position.x;
      const dy = drone.position.y - enemy.position.y;
      const dz = drone.position.z - enemy.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < killRadiusSq) {
        enemy.hp = 0; enemy.dead = true; enemy.deathTime = this.serverTime;
        kills++; this.waveEnemiesKilled++;
        const stats = ENEMY_STATS[enemy.type];
        const player = this.players.get(drone.ownerId);
        if (player) player.score += stats.score;
        this.broadcastEvent({ type: 'enemy_killed', enemyId: enemy.id, enemyType: enemy.type, killerId: drone.ownerId, position: { ...enemy.position } });
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
    if (kills > 0) this.explodeDrone(drone);
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
  private checkWaveComplete() {
    if (this.phase !== GamePhase.PLAYING) return;
    if (this.spawnQueue.length > 0) return;
    const activeEnemies = Array.from(this.enemies.values()).filter(e => !e.dead);
    if (activeEnemies.length === 0) {
      if (this.wave >= TOTAL_WAVES) this.endGame(true);
      else this.startIntermission();
    }
  }

  private tickIntermission() {
    this.waveCountdown -= TICK_RATE / 1000;
    if (this.waveCountdown <= 0) this.startNextWave();
  }

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
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  private updateOutpostHp() {
    this.outpostMaxHp = OUTPOST_HP_PER_PLAYER * this.players.size;
    if (this.outpostHp > this.outpostMaxHp) this.outpostHp = this.outpostMaxHp;
  }

  private getActiveEnemyCount(): number {
    let count = 0;
    for (const e of this.enemies.values()) { if (!e.dead) count++; }
    return count;
  }

  private getHillHeight(x: number, z: number): number {
    const dist = Math.sqrt(x * x + z * z);
    if (dist > 40) return 0;
    return Math.max(0, 15 * (1 - dist / 40));
  }

  // ─── Broadcasting ────────────────────────────────────────
  private broadcastState() {
    const state = {
      phase: this.phase, wave: this.wave, totalWaves: TOTAL_WAVES,
      waveCountdown: Math.max(0, Math.ceil(this.waveCountdown)),
      outpostHp: this.outpostHp, outpostMaxHp: this.outpostMaxHp,
      playerCount: this.players.size,
      roomCode: this.roomCode,
      enemies: Array.from(this.enemies.values()).map(e => ({
        id: e.id, type: e.type, position: e.position,
        hp: e.hp, maxHp: e.maxHp, speed: e.speed,
        slowedUntil: e.slowedUntil, frozenUntil: e.frozenUntil,
        dead: e.dead, deathTime: e.deathTime,
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

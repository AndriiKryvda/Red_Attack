import { Room, Client } from '@colyseus/core';
import {
  GamePhase, PlayerState, EnemyType,
  EnemyData, DroneData, PlayerData, Vec3, ClientMessage, MineData,
  StructureData, StructureVariant,
  DRONE_SPEED, DRONE_BOOST_MULTIPLIER, DRONE_BOOST_COOLDOWN,
  DRONE_RELOAD_TIME, DRONE_KILL_RADIUS, DRONE_SLOW_RADIUS,
  DRONE_SLOW_DURATION, DRONE_FREEZE_DURATION, DRONE_GROUND_HEIGHT,
  ENEMY_STATS, ENEMY_DEATH_LINGER_TIME,
  ALL_ENEMY_TYPES, ENEMY_UNLOCK_KILLS, ENEMY_SPAWN_WEIGHTS,
  MAX_ACTIVE_ENEMIES, TICK_RATE, MAX_PLAYERS,
  MULTI_KILL_BONUS, MULTI_KILL_THRESHOLD,
  HORDE_START_RATE, HORDE_MAX_RATE, HORDE_RAMP_TIME,
  HORDE_SPAWN_BURST_MAX, HORDE_PLAYER_PRESSURE, HORDE_THREAT_INTERVAL,
  HORDE_VICTORY_TIME,
  Difficulty, DIFFICULTY_MULTIPLIER, DEFAULT_DIFFICULTY,
  HORDE_SPAWN_BORDER, HORDE_SPAWN_RING_MIN, HORDE_SPAWN_RING_MAX,
  StructureKind, SpawnEdge, STRUCTURE_SPECS, BUILDING_VARIANTS, CAR_VARIANTS,
  VILLAGE_EDGE_OFFSET, VILLAGE_SPREAD, VILLAGE_CAR_DEPTH, HORDE_BUILDING_SPAWN_CHANCE,
  HORDE_DOOR_SPREAD, HORDE_DOOR_GAP, SPAWN_EDGE_ANGLE, SPAWN_EDGE_ARC, pickSpawnEdge,
  FORT_PERIMETER,
  WeaponType, clampMortarTarget, mortarBallistics, mortarShellHeight, MortarShot,
  MORTAR_POSITION, MORTAR_MUZZLE_HEIGHT, MORTAR_RELOAD_TIME, MORTAR_KILL_RADIUS,
  MORTAR_DAMAGE, MORTAR_BLAST_SCALE,
  VAMPIRE_BOMB_CAPACITY, VAMPIRE_MIN_DROP_ALTITUDE, VAMPIRE_DROP_INTERVAL,
  VAMPIRE_RELOAD_TIME, VAMPIRE_SPEED, VAMPIRE_CRUISE_ALTITUDE, VAMPIRE_LAUNCH_ALTITUDE,
  VAMPIRE_MIN_ALTITUDE, VAMPIRE_MAX_ALTITUDE, VAMPIRE_CLIMB_RATE,
  VAMPIRE_BOMB_DAMAGE, VAMPIRE_BOMB_RADIUS, VAMPIRE_BOMB_BLAST_SCALE,
  VAMPIRE_BASE, VAMPIRE_BASE_RADIUS, vampireBombFlight, vampireBombHeight,
  HMG_NESTS, HMG_BELT_SIZE, HMG_RELOAD_TIME, HMG_ROUNDS_PER_SEC, HMG_DAMAGE,
  HMG_MAX_RANGE, HMG_SPREAD, HMG_INPUT_TIMEOUT, hmgGunOf, clampHmgPitch,
  hmgDirection, hmgMuzzle,
  ShopItem, shopItemByKey, shopItemFor, weaponIsUnlocked,
  defaultLoadout, STARTING_CREDITS, CREDIT_PAYOUT,
  mineFieldSpots, MINE_TRIGGER_RADIUS, MINEFIELD_ARM_TIME,
  RESYNC_MSG,
  MINE_DAMAGE, MINE_BLAST_RADIUS, MINE_BLAST_SCALE,
  generateTreeSpots, TREE_COLLISION_RADIUS, TREE_BASE_HEIGHT,
  type TreeSpot,
} from '@red-attack/shared';
import { DeltaStream, type Snapshot } from '../net/DeltaStream.js';
import { roomCodeRegistry } from '../index.js';

interface InternalEnemy extends EnemyData {
  targetPos: Vec3;
}

interface InternalStructure extends StructureData {
  /** Collision half-extents in world space, meters (y is the box centre). */
  hx: number;
  hy: number;
  hz: number;
  cy: number;
  /** Side of the map it stands on; the horde walks out of a building on this edge. */
  edge: SpawnEdge;
  /** Doorway: the point in front of the facade its enemies step out to. */
  doorX: number;
  doorZ: number;
}

interface InternalDrone extends DroneData {
  boostCooldownUntil: number;
  input: { forward: number; up: number; boost: boolean };
  /** 'fpv' is a one-hit kamikaze quad; 'vampire' carries a stack of mini-bombs. */
  kind: 'fpv' | 'vampire';
  /** Mini-bombs left in the stack (Vampire only; 0 for an FPV). */
  vampireBombs: number;
  /** True while an empty Vampire is on autopilot home to re-arm (input ignored). */
  returning: boolean;
  /** Timestamp the last bomb was released, to pace the drop interval. */
  lastDropAt: number;
  /** Timestamp the pad crew finishes re-arming, or 0 when not on the pad. */
  vampireReloadAt: number;
}

interface InternalPlayer extends PlayerData {
  lastInput: number;
  /** Rounds banked since the last one left each barrel, so the cyclic rate is exact. */
  hmgFireAcc: number[];
  /** Timestamp each belt last fired; HMG_RELOAD_TIME of quiet tops it back up. */
  hmgLastShotAt: number[];
  /** Timestamp the last lay arrived, so a trigger left down cannot stick forever. */
  hmgInputAt: number;
  /** Whether the trigger on the gun being manned is currently under. */
  hmgFiring: boolean;
}

/** One mortar shell in the air, resolved in closed form on every tick. */
interface InternalShell {
  id: string;
  ownerId: string;
  /** Muzzle the shell left from, in world space. */
  origin: Vec3;
  /** Launch velocity (m/s): position falls straight out of it. */
  velocity: Vec3;
  /** Timestamp the shell left the muzzle. */
  firedAt: number;
  /** Seconds of flight, from mortarBallistics. */
  flight: number;
  /** Where it is committed to landing. */
  impact: Vec3;
}

/**
 * One mini-bomb in the air under a Vampire. Like a shell it is resolved in closed
 * form on every tick from where it was released, so the server only has to notice
 * the moment it comes back down onto the ground.
 */
interface InternalBomb {
  id: string;
  ownerId: string;
  /** Where it was released, in world space. */
  origin: Vec3;
  /** Live position, recomputed each tick and synced to clients for the render. */
  position: Vec3;
  /** Horizontal drift inherited from the aircraft at release (y stays 0). */
  velocity: Vec3;
  /** Altitude it fell from, for the closed-form height. */
  originY: number;
  firedAt: number;
  /** Seconds from release down to the ground. */
  flight: number;
  /** Where it lands, so the score credit can be handed to the pilot who dropped it. */
  impact: Vec3;
}

/**
 * One anti-personnel mine in the dirt. Nothing moves: the mine waits where it was
 * buried until something walks into it, so the only clock it carries is the seconds
 * the crew needs to put it down and get clear.
 */
interface InternalMine extends MineData {
  /** Timestamp the mine becomes live; before that it is harmless. */
  armedAt: number;
  /**
   * Index of the hole in the belt this mine was buried in, into `mineFieldSpots`. The
   * field is a fixed set of holes, so this is what a refill looks for when it decides
   * which spots are still free. Server-side only — the client never needs it, and
   * `broadcastState` sends mines by id, owner and position alone.
   */
  spot: number;
}

/**
 * Share of the kill score paid to a pilot whose drone damaged an armoured target
 * without destroying it (the tank after the first hit).
 */
const ARMOUR_HIT_SCORE_SHARE = 0.25;

/** One value per machine gun nest, so per-gun player state stays in step. */
function perGun(value: number): number[] {
  return HMG_NESTS.map(() => value);
}

export class GameRoom extends Room {
  phase: GamePhase = GamePhase.LOBBY;
  threatLevel: number = 1;
  elapsed: number = 0;        // seconds the horde has been pressing the fort
  kills: number = 0;
  leaks: number = 0;       // enemies that reached the fort — counted, never fatal
  serverTime: number = 0;
  roomCode: string = '';
  /** How thick the horde is; set by the host when the room is created. */
  difficulty: Difficulty = DEFAULT_DIFFICULTY;

  enemies: Map<string, InternalEnemy> = new Map();
  drones: Map<string, InternalDrone> = new Map();
  players: Map<string, InternalPlayer> = new Map();
  /** The village on the north and east edges, and the doorways the horde uses. */
  structures: Map<string, InternalStructure> = new Map();
  doors: Map<SpawnEdge, InternalStructure[]> = new Map();
  /** Shells currently in the air from the fort's mortar. */
  shells: Map<string, InternalShell> = new Map();
  /** Mini-bombs currently falling from the Vampire bombers. */
  bombs: Map<string, InternalBomb> = new Map();
  /** Anti-personnel mines in the dirt around the fort, laid by an armory purchase. */
  mines: Map<string, InternalMine> = new Map();
  /** Deterministic tree positions for drone collision (same layout as the client). */
  private treeSpots: TreeSpot[] = generateTreeSpots();

  private spawnAccumulator: number = 0;
  private idCounter: number = 0;
  private structureIdCounter: number = 0;
  private shellIdCounter: number = 0;
  private bombIdCounter: number = 0;
  private mineIdCounter: number = 0;
  /**
   * When the room came into being. The wire carries the clock as an offset from
   * this rather than as an epoch timestamp, which keeps it inside two bytes.
   */
  private epochMs: number = Date.now();
  /** Per-client delta encoder; see net/DeltaStream. */
  private net!: DeltaStream;
  /** Enemy types whose kill threshold has been reached (and announced). */
  private unlockedEnemies: Set<EnemyType> = new Set();

  // ─── Lifecycle ───────────────────────────────────────────
  onCreate(_options: any) {
    this.autoDispose = true;
    this.maxClients = MAX_PLAYERS;
    // The host picks a difficulty when creating the room; anything unrecognised
    // falls back to the full-intensity hard horde.
    if ((Object.values(Difficulty) as string[]).includes(_options?.difficulty)) {
      this.difficulty = _options.difficulty as Difficulty;
    }
    // There is no Colyseus Schema behind `this.state`, so `setPatchRate` would only
    // start a timer nobody listens to. The room drives its own 20 Hz frame below and
    // hands every client a hand-built delta through `net` instead.
    this.net = new DeltaStream(this);
    this.setSimulationInterval(() => this.tick(), TICK_RATE);
    // The village is part of the map, so it has to stand there before the first
    // pilot ever launches a drone at it.
    this.buildVillage();

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
    // Start this client's view empty so the next frame rebuilds the world for them
    // and every frame after that only carries what moved.
    this.net.add(client);
    const player: InternalPlayer = {
      id,
      name: options?.name || `Player ${this.players.size + 1}`,
      state: PlayerState.WAITING,
      score: 0,
      ready: false,
      droneId: null,
      cooldownUntil: 0,
      weapon: WeaponType.FPV,
      mortarReadyAt: 0,
      hmgAmmo: perGun(HMG_BELT_SIZE),
      hmgReloadAt: perGun(0),
      manningGun: -1,
      hmgYaw: HMG_NESTS[0].yaw,
      hmgPitch: 0,
      vampireBombs: 0,
      vampireReturning: false,
      vampireReloadAt: 0,
      // The free stations and whatever the difficulty hands out: on hard and medium the
      // purse starts empty, so a bomber is something he earns out of the horde rather
      // than something the fort hands over for nothing. Easy pays ahead of him.
      credits: STARTING_CREDITS[this.difficulty],
      unlocked: defaultLoadout(),
      lastInput: Date.now(),
      hmgFireAcc: perGun(0),
      hmgLastShotAt: perGun(0),
      hmgInputAt: 0,
      hmgFiring: false,
    };
    this.players.set(id, player);
    console.log(`[Room] Player joined: ${player.name} (${id}). Total: ${this.players.size}`);

    if (this.phase === GamePhase.LOBBY && this.players.size >= 1) {
      this.startGame();
    }
  }

  onLeave(client: Client) {
    const id = client.sessionId;
    this.net.remove(client);
    const player = this.players.get(id);
    if (player?.droneId) {
      this.drones.delete(player.droneId);
    }
    // A shell already in the air still lands and still kills; it just stops
    // belonging to anyone, so nobody inherits the score.
    for (const [sid, shell] of this.shells) {
      if (shell.ownerId === id) this.shells.delete(sid);
    }
    // A dropped mini-bomb behaves the same way: it still falls and still detonates.
    for (const [bid, bomb] of this.bombs) {
      if (bomb.ownerId === id) this.bombs.delete(bid);
    }
    // Mines are deliberately left where they are. They are fort defence that somebody
    // paid for, not a pilot's vehicle: a field keeps killing after its buyer disconnects,
    // it simply stops scoring for anyone.
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
    this.shells.clear();
    this.mines.clear();
    this.buildVillage();
    this.broadcastEvent({ type: 'horde_start' });
    console.log(`[Horde] Room ${this.roomCode}: horde engaged — survive ${Math.round(HORDE_VICTORY_TIME / 60)} min to win`);
  }

  // ─── Horde escalation ────────────────────────────────────
  /** 0 → 1 escalation progress driven by how long the fort keeps holding. */
  private escalation(): number {
    return Math.min(1, this.elapsed / HORDE_RAMP_TIME);
  }

  /** Enemies per second — ramps with time and scales with the crew size. */
  private spawnRate(): number {
    const pressure = 1 + HORDE_PLAYER_PRESSURE * Math.max(0, this.players.size - 1);
    const base = HORDE_START_RATE + (HORDE_MAX_RATE - HORDE_START_RATE) * this.escalation();
    return base * pressure * DIFFICULTY_MULTIPLIER[this.difficulty];
  }

  /**
   * The most enemies allowed on the field at once, thinned out by the difficulty
   * so an easy or medium field stays proportionally sparse even late in a run.
   * Always at least one so the horde never fully stalls.
   */
  private activeEnemyCap(): number {
    return Math.max(1, Math.round(MAX_ACTIVE_ENEMIES * DIFFICULTY_MULTIPLIER[this.difficulty]));
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
      this.tickShells();
      this.tickBombs();
      this.tickMines();
      this.tickHmgs();
      this.tickCooldowns();
    }
    this.broadcastState();
  }

  private tickSpawner() {
    const dt = TICK_RATE / 1000;
    this.spawnAccumulator += this.spawnRate() * dt;

    let spawned = 0;
    while (this.spawnAccumulator >= 1 && spawned < HORDE_SPAWN_BURST_MAX) {
      if (this.getActiveEnemyCount() >= this.activeEnemyCap()) {
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
    // Four in ten of the horde comes out of the north, four in ten out of the
    // east, and only a tenth each across the open west and south fields.
    const edge = pickSpawnEdge();
    const pos = this.spawnPointFor(edge);
    const enemy: InternalEnemy = {
      id: `e_${this.idCounter++}`, type, position: pos,
      hp: stats.hp, maxHp: stats.hp, speed: stats.speed,
      slowedUntil: 0, frozenUntil: 0, dead: false, deathTime: 0, burning: false,
      targetPos: { x: 0, y: 0, z: 0 },
    };
    this.enemies.set(enemy.id, enemy);
  }

  // ─── Village: the built-up north and east edges ──────────
  /**
   * Lay out the two strips of village the horde comes out of: a row of buildings
   * on a line VILLAGE_EDGE_OFFSET out from the fort, cars parked on the road in
   * front of them. Both edges get the same mix so a strike from the tower reads the
   * same either way. Rebuilding on every start resets the rubble.
   */
  private buildVillage() {
    this.structures.clear();
    this.doors.clear();
    this.structureIdCounter = 0;
    this.buildEdge(SpawnEdge.NORTH);
    this.buildEdge(SpawnEdge.EAST);
  }

  private buildEdge(edge: SpawnEdge) {
    // Outward normal of the side; the along-axis is that normal turned a quarter
    // turn, so `t` measures along the strip and `out` measures away from the fort
    // (a negative `out` brings a car forward onto the road).
    const outX = edge === SpawnEdge.EAST ? 1 : edge === SpawnEdge.WEST ? -1 : 0;
    const outZ = edge === SpawnEdge.SOUTH ? 1 : edge === SpawnEdge.NORTH ? -1 : 0;
    const alongX = -outZ;
    const alongZ = outX;
    // Turns a model's facade (local +Z) so that it faces the fort.
    const yaw = Math.atan2(-outX, -outZ);
    const spot = (i: number, count: number, out: number) => {
      const step = (VILLAGE_SPREAD * 2) / count;
      const t = -VILLAGE_SPREAD + step * (i + 0.5) + (Math.random() - 0.5) * step * 0.4;
      return {
        x: outX * (VILLAGE_EDGE_OFFSET + out) + alongX * t,
        z: outZ * (VILLAGE_EDGE_OFFSET + out) + alongZ * t,
      };
    };

    BUILDING_VARIANTS.forEach((variant, i) => {
      const p = spot(i, BUILDING_VARIANTS.length, 0);
      this.addStructure(variant, edge, yaw, p.x, p.z);
    });
    CAR_VARIANTS.forEach((variant, i) => {
      // Parked between the fort and the buildings, nose turned a little off square.
      const p = spot(i, CAR_VARIANTS.length, -(7 + Math.random() * (VILLAGE_CAR_DEPTH - 7)));
      this.addStructure(variant, edge, yaw + (Math.random() - 0.5) * 0.6, p.x, p.z);
    });
  }

  private addStructure(
    variant: StructureVariant, edge: SpawnEdge, yaw: number, x: number, z: number,
  ) {
    const spec = STRUCTURE_SPECS[variant];
    // Half-extents of the box the rotated footprint fits inside: the collision test
    // is axis-aligned, so a car parked at an angle gets the slightly wider box.
    const c = Math.abs(Math.cos(yaw));
    const s = Math.abs(Math.sin(yaw));
    const doorGap = spec.depth / 2 + HORDE_DOOR_GAP;
    const structure: InternalStructure = {
      id: `s_${this.structureIdCounter++}`,
      kind: spec.kind, variant, x, z, yaw,
      hp: spec.hp, maxHp: spec.hp, burning: false, destroyed: false,
      hx: (c * spec.width + s * spec.depth) / 2,
      hy: spec.height / 2,
      hz: (s * spec.width + c * spec.depth) / 2,
      cy: spec.height / 2,
      edge,
      doorX: x + Math.sin(yaw) * doorGap,
      doorZ: z + Math.cos(yaw) * doorGap,
    };
    this.structures.set(structure.id, structure);
    if (spec.kind === StructureKind.BUILDING) {
      const list = this.doors.get(edge);
      if (list) list.push(structure);
      else this.doors.set(edge, [structure]);
    }
  }

  /**
   * Where a new enemy appears on a side. Most of the north/east horde walks out of
   * a doorway — the village is their staging ground — and the rest, plus all of the
   * open west and south sides, come in off the map border.
   */
  private spawnPointFor(edge: SpawnEdge): Vec3 {
    const doors = this.doors.get(edge);
    if (doors && doors.length > 0 && Math.random() < HORDE_BUILDING_SPAWN_CHANCE) {
      const door = doors[(Math.random() * doors.length) | 0];
      // Scatter sideways along the facade, which runs at right angles to the way
      // the door faces.
      const side = (Math.random() * 2 - 1) * HORDE_DOOR_SPREAD;
      return {
        x: door.doorX + Math.cos(door.yaw) * side,
        y: 0,
        z: door.doorZ - Math.sin(door.yaw) * side,
      };
    }
    return this.borderPointFor(edge);
  }

  /**
   * Border spawn restricted to one side: pick a bearing near that side's normal and
   * walk it out to the square edge, so the horde still has to cross the whole field
   * instead of appearing halfway to the wall. The edge is rounded off at
   * HORDE_SPAWN_RING_MAX so nobody spawns in a far corner out of drone reach, and
   * the ring minimum gives the back of a spawn pack some spread.
   */
  private borderPointFor(edge: SpawnEdge): Vec3 {
    const angle = SPAWN_EDGE_ANGLE[edge] + (Math.random() * 2 - 1) * SPAWN_EDGE_ARC;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const border = HORDE_SPAWN_BORDER / Math.max(Math.abs(cos), Math.abs(sin));
    const dist = Math.min(border, HORDE_SPAWN_RING_MAX)
      - Math.random() * (HORDE_SPAWN_RING_MAX - HORDE_SPAWN_RING_MIN);
    return { x: cos * dist, y: 0, z: sin * dist };
  }

  /**
   * A quad that flies into a building or a parked car detonates on it. The box is
   * the structure's footprint; rubble keeps a low box, so a ruin still has to be
   * flown over instead of straight through.
   */
  private checkStructureHits(drone: InternalDrone): number {
    const r = DRONE_KILL_RADIUS;
    let contacts = 0;
    for (const st of this.structures.values()) {
      const dx = Math.max(Math.abs(drone.position.x - st.x) - st.hx, 0);
      const dy = Math.max(Math.abs(drone.position.y - st.cy) - st.hy, 0);
      const dz = Math.max(Math.abs(drone.position.z - st.z) - st.hz, 0);
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      this.damageStructure(st, drone.ownerId);
      contacts++;
    }
    return contacts;
  }

  /**
   * One detonation against a structure: the first hit sets the whole thing alight
   * and pays a share of its worth, the last one leaves it as a burning heap.
   */
  private damageStructure(st: InternalStructure, killerId: string) {
    if (st.destroyed) return;
    const spec = STRUCTURE_SPECS[st.variant];
    const player = this.players.get(killerId);
    st.hp = Math.max(0, st.hp - 1);
    st.burning = true;

    if (st.hp > 0) {
      if (player) this.award(player, Math.round(spec.score * ARMOUR_HIT_SCORE_SHARE));
      this.broadcastEvent({
        type: 'structure_hit', structureId: st.id, kind: st.kind, variant: st.variant,
        position: { x: st.x, y: st.cy, z: st.z }, hp: st.hp, maxHp: st.maxHp,
      });
      return;
    }

    st.destroyed = true;
    // What is left of it is a smoking heap a metre or so high now.
    st.hy = Math.min(st.hy, 1.2);
    st.cy = st.hy;
    if (player) this.award(player, spec.score);
    this.broadcastEvent({
      type: 'structure_destroyed', structureId: st.id, kind: st.kind, variant: st.variant,
      killerId, position: { x: st.x, y: 0, z: st.z }, score: spec.score,
    });
  }

  /**
   * Returns true if the drone is inside a tree's collision cylinder. Each tree is
   * modelled as a vertical cylinder centred on its trunk with radius
   * TREE_COLLISION_RADIUS × scale and height TREE_BASE_HEIGHT × scale.
   */
  private checkTreeCollision(drone: InternalDrone): boolean {
    const px = drone.position.x;
    const py = drone.position.y;
    const pz = drone.position.z;
    for (const tree of this.treeSpots) {
      const radius = TREE_COLLISION_RADIUS * tree.scale;
      const height = TREE_BASE_HEIGHT * tree.scale;
      const dx = px - tree.x;
      const dz = pz - tree.z;
      if (dx * dx + dz * dz > radius * radius) continue;
      if (py < height) return true;
    }
    return false;
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

      if (dist < FORT_PERIMETER) {
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

  // ─── Mortar ──────────────────────────────────────────────
  /**
   * Send a shell at a spot of the field. The aim point is clamped into the ring of
   * fire first, so a click out past the border still lands at the limit of the tube
   * instead of nowhere, and nothing ever falls short onto our own fence line.
   */
  private fireMortar(player: InternalPlayer, x: number, z: number) {
    const target = clampMortarTarget(x, z);
    const origin: Vec3 = { x: MORTAR_POSITION.x, y: MORTAR_MUZZLE_HEIGHT, z: MORTAR_POSITION.z };
    const shot: MortarShot = mortarBallistics(origin.x, origin.y, origin.z, target.x, target.z);
    const shell: InternalShell = {
      id: `m_${this.shellIdCounter++}`,
      ownerId: player.id,
      origin,
      velocity: { x: shot.vx, y: shot.vy, z: shot.vz },
      firedAt: this.serverTime,
      flight: shot.flight,
      impact: { x: shot.impactX, y: 0, z: shot.impactZ },
    };
    this.shells.set(shell.id, shell);
    player.mortarReadyAt = this.serverTime + MORTAR_RELOAD_TIME * 1000;
    this.broadcastEvent({
      type: 'mortar_fire', shellId: shell.id, ownerId: player.id,
      origin: { ...origin }, velocity: { ...shell.velocity },
      flight: shell.flight, impact: { ...shell.impact },
    });
  }

  /**
   * Walk every shell along its parabola. Nothing is networked per frame: the
   * position falls straight out of the launch vector, so the server only has to
   * notice the moment a shell comes back down onto the ground.
   */
  private tickShells() {
    for (const shell of this.shells.values()) {
      const t = (this.serverTime - shell.firedAt) / 1000;
      if (t >= shell.flight || mortarShellHeight(shell.origin.y, shell.velocity.y, t) <= 0) {
        this.detonateShell(shell);
      }
    }
  }

  /**
   * A shell lands. Everything inside the blast is finished in one hit — bears and
   * tanks alike, which is what the tube is for — and each building caught by it
   * takes the same single heavy hit a drone would, so a shell onto a roof leaves it
   * burning. The pilot is credited through the usual damage paths.
   */
  private detonateShell(shell: InternalShell) {
    this.shells.delete(shell.id);
    const radiusSq = MORTAR_KILL_RADIUS * MORTAR_KILL_RADIUS;
    let kills = 0;
    for (const enemy of this.enemies.values()) {
      if (enemy.dead) continue;
      const dx = shell.impact.x - enemy.position.x;
      const dz = shell.impact.z - enemy.position.z;
      if (dx * dx + dz * dz > radiusSq) continue;
      if (this.damageEnemy(enemy, shell.ownerId, MORTAR_DAMAGE)) kills++;
    }
    for (const st of this.structures.values()) {
      if (st.destroyed) continue;
      const dx = shell.impact.x - st.x;
      const dz = shell.impact.z - st.z;
      if (dx * dx + dz * dz > radiusSq) continue;
      this.damageStructure(st, shell.ownerId);
    }
    if (kills >= MULTI_KILL_THRESHOLD) {
      const player = this.players.get(shell.ownerId);
      if (player) this.award(player, MULTI_KILL_BONUS);
    }
    this.broadcastEvent({
      type: 'explosion', position: { ...shell.impact },
      radius: MORTAR_KILL_RADIUS, scale: MORTAR_BLAST_SCALE,
    });
  }

  // ─── Vampire bomber ──────────────────────────────────────

  /**
   * Release one mini-bomb from the Vampire. The bomb keeps the aircraft's horizontal
   * velocity but starts with no vertical velocity of its own, so it simply falls from
   * the current altitude; the whole path is closed form (see `vampireBombFlight`), so
   * the server only has to notice the tick it touches down. When the last bomb leaves,
   * the bomber flips to autopilot and flies itself home to re-arm.
   */
  private dropBomb(player: InternalPlayer, drone: InternalDrone) {
    const altitude = drone.position.y;
    drone.vampireBombs -= 1;
    drone.lastDropAt = this.serverTime;
    player.vampireBombs = drone.vampireBombs;

    const flight = vampireBombFlight(altitude);
    const bomb: InternalBomb = {
      id: `b_${this.bombIdCounter++}`,
      ownerId: player.id,
      origin: { ...drone.position },
      position: { ...drone.position },
      velocity: { x: drone.velocity.x, y: 0, z: drone.velocity.z },
      originY: altitude,
      firedAt: this.serverTime,
      flight,
      impact: {
        x: drone.position.x + drone.velocity.x * flight,
        y: 0,
        z: drone.position.z + drone.velocity.z * flight,
      },
    };
    this.bombs.set(bomb.id, bomb);

    // The stack is dry: hand the aircraft to the autopilot for the trip home.
    if (drone.vampireBombs <= 0) {
      drone.returning = true;
      player.vampireReturning = true;
    }
  }

  /**
   * Walk every mini-bomb down its fall. Nothing is networked per frame: the position
   * falls straight out of the release point and inherited drift, so the server only
   * has to notice the moment a bomb comes back down onto the ground.
   */
  private tickBombs() {
    for (const bomb of this.bombs.values()) {
      const t = (this.serverTime - bomb.firedAt) / 1000;
      const height = vampireBombHeight(bomb.originY, t);
      if (t >= bomb.flight || height <= 0) {
        this.detonateBomb(bomb);
      } else {
        // Keep the synced position current so the client draws the falling bomb.
        bomb.position.x = bomb.origin.x + bomb.velocity.x * t;
        bomb.position.y = height;
        bomb.position.z = bomb.origin.z + bomb.velocity.z * t;
      }
    }
  }

  /**
   * A mini-bomb lands and detonates: a footprint between a quad and a shell, so it
   * clears a cluster of infantry or wounds a tank but does not level a building the
   * way a shell does. The pilot who dropped it gets the credit, exactly as for a shell.
   */
  private detonateBomb(bomb: InternalBomb) {
    this.bombs.delete(bomb.id);
    const radiusSq = VAMPIRE_BOMB_RADIUS * VAMPIRE_BOMB_RADIUS;
    let kills = 0;
    for (const enemy of this.enemies.values()) {
      if (enemy.dead) continue;
      const dx = bomb.impact.x - enemy.position.x;
      const dz = bomb.impact.z - enemy.position.z;
      if (dx * dx + dz * dz > radiusSq) continue;
      if (this.damageEnemy(enemy, bomb.ownerId, VAMPIRE_BOMB_DAMAGE)) kills++;
    }
    for (const st of this.structures.values()) {
      if (st.destroyed) continue;
      const dx = bomb.impact.x - st.x;
      const dz = bomb.impact.z - st.z;
      if (dx * dx + dz * dz > radiusSq) continue;
      this.damageStructure(st, bomb.ownerId);
    }
    if (kills >= MULTI_KILL_THRESHOLD) {
      const player = this.players.get(bomb.ownerId);
      if (player) this.award(player, MULTI_KILL_BONUS);
    }
    this.broadcastEvent({
      type: 'explosion', position: { ...bomb.impact },
      radius: VAMPIRE_BOMB_RADIUS, scale: VAMPIRE_BOMB_BLAST_SCALE,
    });
  }

  /**
   * Which holes in the belt around the fort are free, as indices into `mineFieldSpots`.
   * Every mine carries the index of the hole it was buried in, so refilling is a set
   * lookup rather than a distance search — and it stays correct however a hole became
   * empty, whether its mine tripped under the horde or (someday) an enemy cleared it.
   */
  private emptyMineSpots(): number[] {
    const taken = new Set<number>();
    for (const mine of this.mines.values()) taken.add(mine.spot);
    const spots = mineFieldSpots(0, 0);
    const empty: number[] = [];
    for (let i = 0; i < spots.length; i++) {
      if (!taken.has(i)) empty.push(i);
    }
    return empty;
  }

  /**
   * Refill the mine field. The layout is the shared module's business (see
   * `mineFieldSpots`): the fort is ringed by a fixed belt of holes between the fence and
   * the mortar's minimum range, every other ring turned half a step so the horde crosses
   * a mine every couple of metres wherever it walks in from. A purchase fills every hole
   * that is currently empty, which is what puts a thinned belt back up to a full field —
   * it does not bury a second mine on top of one that is still waiting. Mines already in
   * the dirt keep their owner and their arming clock, so a top-up never re-arms a live
   * mine and never moves a kill to a different pilot. Returns how many mines went down;
   * zero means the belt was already full, which the armory refuses rather than selling
   * nothing at full price.
   */
  private layMinefield(player: InternalPlayer): number {
    const spots = mineFieldSpots(0, 0);
    let laid = 0;
    for (const index of this.emptyMineSpots()) {
      const mine: InternalMine = {
        id: `m_${this.mineIdCounter++}`,
        ownerId: player.id,
        position: { ...spots[index] },
        spot: index,
        armedAt: this.serverTime + MINEFIELD_ARM_TIME * 1000,
      };
      this.mines.set(mine.id, mine);
      laid++;
    }
    return laid;
  }

  /**
   * Walk the field: any live enemy that comes within the trigger radius of an armed
   * mine sets it off. A mine is spent whether or not the blast kills anything — it is a
   * buried charge, not a turret — so a field can be walked apart by a thick enough
   * horde, which is what makes buying one a bet on the next few minutes rather than a
   * permanent wall.
   */
  private tickMines() {
    if (this.mines.size === 0) return;
    const triggerSq = MINE_TRIGGER_RADIUS * MINE_TRIGGER_RADIUS;
    for (const mine of this.mines.values()) {
      if (this.serverTime < mine.armedAt) continue;
      for (const enemy of this.enemies.values()) {
        if (enemy.dead) continue;
        const dx = mine.position.x - enemy.position.x;
        const dz = mine.position.z - enemy.position.z;
        if (dx * dx + dz * dz > triggerSq) continue;
        this.detonateMine(mine);
        break;   // this mine is gone; move on to the next one in the field
      }
    }
  }

  /**
   * A mine goes off. The blast is mortar-heavy on purpose — a mine is the one thing in
   * the game that kills a tank outright — and the pilot who paid for the field keeps the
   * credit for everything it takes with it. Mines never touch the village: they are laid
   * around our own fort, and friendly scenery is not a target.
   */
  private detonateMine(mine: InternalMine) {
    this.mines.delete(mine.id);
    const radiusSq = MINE_BLAST_RADIUS * MINE_BLAST_RADIUS;
    let kills = 0;
    for (const enemy of this.enemies.values()) {
      if (enemy.dead) continue;
      const dx = mine.position.x - enemy.position.x;
      const dz = mine.position.z - enemy.position.z;
      if (dx * dx + dz * dz > radiusSq) continue;
      if (this.damageEnemy(enemy, mine.ownerId, MINE_DAMAGE)) kills++;
    }
    if (kills >= MULTI_KILL_THRESHOLD) {
      const player = this.players.get(mine.ownerId);
      if (player) this.award(player, MULTI_KILL_BONUS);
    }
    this.broadcastEvent({
      type: 'explosion', position: { ...mine.position },
      radius: MINE_BLAST_RADIUS, scale: MINE_BLAST_SCALE,
    });
  }

  /**
   * Fly an empty Vampire home on its own. It holds the station altitude, steers
   * level at the pad, hovers there while the crew re-arms it; when the re-arm timer
   * runs out the stack is full again and the pilot gets the controls back. The
   * pilot's input is ignored for the whole trip (see tickDrones).
   */
  private tickVampireReturn(drone: InternalDrone, dt: number) {
    const dx = VAMPIRE_BASE.x - drone.position.x;
    const dz = VAMPIRE_BASE.z - drone.position.z;
    const dist = Math.hypot(dx, dz);
    drone.yaw = Math.atan2(dx, dz);
    drone.pitch = 0;

    if (dist > VAMPIRE_BASE_RADIUS) {
      // Cruise home: close on the pad while easing up to the cruise altitude.
      const ux = dx / dist;
      const uz = dz / dist;
      const vy = Math.max(-VAMPIRE_SPEED, Math.min(VAMPIRE_SPEED, (VAMPIRE_CRUISE_ALTITUDE - drone.position.y) * 2));
      drone.velocity.x = ux * VAMPIRE_SPEED;
      drone.velocity.y = vy;
      drone.velocity.z = uz * VAMPIRE_SPEED;
      drone.position.x += drone.velocity.x * dt;
      drone.position.y += drone.velocity.y * dt;
      drone.position.z += drone.velocity.z * dt;
      return;
    }

    // Over the pad: settle down onto it and start the re-arm once it touches off.
    drone.velocity.x = 0;
    drone.velocity.z = 0;
    drone.velocity.y = -VAMPIRE_SPEED;
    drone.position.y += drone.velocity.y * dt;
    if (drone.position.y <= VAMPIRE_LAUNCH_ALTITUDE) {
      drone.position.y = VAMPIRE_LAUNCH_ALTITUDE;
      drone.velocity = { x: 0, y: 0, z: 0 };
      if (drone.vampireReloadAt === 0) {
        drone.vampireReloadAt = this.serverTime + VAMPIRE_RELOAD_TIME * 1000;
        const player = this.players.get(drone.ownerId);
        if (player) player.vampireReloadAt = drone.vampireReloadAt;
      } else if (this.serverTime >= drone.vampireReloadAt) {
        this.reloadVampire(drone);
      }
    }
  }

  /**
   * A Vampire that has come home and finished re-arming is handed back to its pilot
   * with a full stack of mini-bombs, and the pilot steps out of the cockpit back onto
   * the fort: the airframe is parked (despawned), so the next launch lifts a fresh
   * bomber. Releasing the pilot here is what lets him switch to the FPV, the tube, or
   * a machine gun once his bomber is reloaded on the pad.
   */
  private reloadVampire(drone: InternalDrone) {
    drone.alive = false;
    this.drones.delete(drone.id);
    const player = this.players.get(drone.ownerId);
    if (player) {
      player.state = PlayerState.WAITING;
      player.droneId = null;
      player.vampireBombs = 0;
      player.vampireReturning = false;
      player.vampireReloadAt = 0;
    }
  }

  // ─── Machine guns ────────────────────────────────────────
  /**
   * Fire every gun a pilot is currently holding the trigger on.
   *
   * The cyclic rate lives here and not in a browser: rounds leave a barrel on the
   * server's clock, and the lay they leave it on is the lay the pilot last sent. A
   * pilot whose connection stops talking stops firing after a moment, so a trigger
   * left down on a dead tab cannot empty a belt into the dark.
   */
  private tickHmgs() {
    const dt = TICK_RATE / 1000;
    for (const player of this.players.values()) {
      const gun = hmgGunOf(player.weapon);
      // A pilot who walked off the gun, or who is up flying a quad, is not on it.
      // Whatever the crew was doing with that belt, they have stopped, so the
      // reload timer that runs off "not firing" is already ticking.
      if (gun < 0 || player.state === PlayerState.PILOTING) {
        player.manningGun = -1;
        player.hmgFiring = false;
        continue;
      }
      player.manningGun = gun;

      const stale = this.serverTime - player.hmgInputAt > HMG_INPUT_TIMEOUT * 1000;
      if (!player.hmgFiring || stale || player.hmgAmmo[gun] <= 0) {
        player.hmgFireAcc[gun] = 0;
        continue;
      }
      player.hmgFireAcc[gun] += HMG_ROUNDS_PER_SEC * dt;
      while (player.hmgFireAcc[gun] >= 1 && player.hmgAmmo[gun] > 0) {
        player.hmgFireAcc[gun] -= 1;
        this.fireHmgRound(player, gun);
      }
      // A tick that banked less than a whole round keeps the fraction; a burst of
      // rounds beyond one per tick would only mean the server stalled, so drop it.
      if (player.hmgFireAcc[gun] > 1) player.hmgFireAcc[gun] = 0;
    }
  }

  /** One round out of one gun: a belt spent, a ray traced, everybody told. */
  private fireHmgRound(player: InternalPlayer, gun: number) {
    player.hmgAmmo[gun] = Math.max(0, player.hmgAmmo[gun] - 1);
    player.hmgLastShotAt[gun] = this.serverTime;
    player.hmgReloadAt[gun] = this.serverTime + HMG_RELOAD_TIME * 1000;

    const origin = hmgMuzzle(gun, player.hmgYaw, player.hmgPitch);
    const dir = this.hmgSprayedDir(player.hmgYaw, player.hmgPitch);
    const struck = this.hmgTrace(origin, dir, player.id);
    this.broadcastEvent({
      type: 'hmg_shot', gun, ownerId: player.id,
      origin, dir,
      range: struck ? struck.t : this.hmgRoundStop(origin, dir),
      hit: struck !== null,
    });
  }

  /**
   * The lay the pilot asked for, sprayed by a fraction of a degree. A burst is not
   * a laser, and the cone is what makes walking a gun onto a running soldier take a
   * couple of extra rounds instead of being a hitscan aimbot.
   */
  private hmgSprayedDir(yaw: number, pitch: number): Vec3 {
    const a = Math.random() * Math.PI * 2;
    const r = HMG_SPREAD * Math.sqrt(Math.random());
    return hmgDirection(yaw + Math.cos(a) * r, pitch + Math.sin(a) * r);
  }

  /**
   * How far a round is worth flying: out to the gun's effective range, or down to
   * the dirt if it was laid low enough to find it first. Tracers stop here too, so
   * a burst aimed at the sky does not paint a line across half the map.
   */
  private hmgRoundStop(origin: Vec3, dir: Vec3): number {
    if (dir.y < -0.0001) return Math.min(HMG_MAX_RANGE, origin.y / -dir.y);
    return HMG_MAX_RANGE;
  }

  /**
   * One round down the range, and the damage it does.
   *
   * Two things this deliberately never touches: the tank, which shrugs small arms
   * off entirely and stays the quad's problem, and the village out on the far edge,
   * which is both past the gun's reach and simply not in the list of things a round
   * is checked against. What is left is the horde in front of the wall.
   */
  private hmgTrace(
    origin: Vec3, dir: Vec3, shooterId: string,
  ): { enemy: InternalEnemy; t: number } | null {
    const stop = this.hmgRoundStop(origin, dir);
    let best: InternalEnemy | null = null;
    let bestT = stop;
    for (const enemy of this.enemies.values()) {
      if (enemy.dead || enemy.type === EnemyType.TANK) continue;
      const stats = ENEMY_STATS[enemy.type];
      const radius = Math.max(0.55, stats.size * 0.45);
      const ox = enemy.position.x - origin.x;
      const oy = stats.size * 0.5 - origin.y;
      const oz = enemy.position.z - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t <= 0 || t > bestT) continue;
      const px = ox - dir.x * t;
      const py = oy - dir.y * t;
      const pz = oz - dir.z * t;
      if (px * px + py * py + pz * pz > radius * radius) continue;
      best = enemy;
      bestT = t;
    }
    if (!best) return null;
    this.damageEnemy(best, shooterId, HMG_DAMAGE, false);
    return { enemy: best, t: bestT };
  }

  // ─── Drone Physics ───────────────────────────────────────
  private tickDrones() {
    const dt = TICK_RATE / 1000;
    for (const [id, drone] of this.drones) {
      if (!drone.alive) continue;

      // An empty Vampire is on autopilot home to re-arm; the pilot's stick is ignored.
      if (drone.kind === 'vampire' && drone.returning) {
        this.tickVampireReturn(drone, dt);
        continue;
      }

      // A Vampire is flown like the FPV — it turns (yaw), moves forward/back, and
      // climbs or descends on the same keys (Space up, Shift down) — but it works a
      // band of altitudes rather than the whole sky: the server clamps it between the
      // floor (above every rooftop) and the ceiling so it stays in play and on camera.
      if (drone.kind === 'vampire') {
        const input = drone.input;
        const speed = VAMPIRE_SPEED * (input.boost && this.serverTime > drone.boostCooldownUntil ? DRONE_BOOST_MULTIPLIER : 1);
        const yaw = drone.yaw;
        drone.pitch = 0;
        drone.velocity.x = Math.sin(yaw) * input.forward * speed;
        drone.velocity.y = input.up * VAMPIRE_CLIMB_RATE;
        drone.velocity.z = Math.cos(yaw) * input.forward * speed;
        drone.position.x += drone.velocity.x * dt;
        drone.position.y += drone.velocity.y * dt;
        drone.position.z += drone.velocity.z * dt;
        if (drone.position.y < VAMPIRE_MIN_ALTITUDE) drone.position.y = VAMPIRE_MIN_ALTITUDE;
        else if (drone.position.y > VAMPIRE_MAX_ALTITUDE) drone.position.y = VAMPIRE_MAX_ALTITUDE;
        this.checkDroneCollisions(drone);
        continue;
      }

      const input = drone.input;
      // Only the FPV kamikaze quad reaches here; Vampires were handled above.
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

      // Ground contact: drone crashes and detonates
      if (drone.position.y <= DRONE_GROUND_HEIGHT) { this.explodeDrone(drone); continue; }
      if (drone.position.y > 50) drone.position.y = 50;

      this.checkDroneCollisions(drone);
    }
  }

  private checkDroneCollisions(drone: InternalDrone) {
    let kills = 0;
    let contacts = 0;
    const killRadiusSq = DRONE_KILL_RADIUS * DRONE_KILL_RADIUS;
    const slowRadiusSq = DRONE_SLOW_RADIUS * DRONE_SLOW_RADIUS;

    // The village is solid: a quad that flies into a wall detonates there instead
    // of passing straight through to the enemy standing behind it.
    contacts += this.checkStructureHits(drone);

    // Trees are solid: a quad that clips a trunk or foliage detonates.
    if (this.checkTreeCollision(drone)) { this.explodeDrone(drone); return; }

    // A Vampire is a bomber, not a kamikaze: it neither detonates on nor damages an
    // enemy it brushes past — its weapon is the bombs it drops. It still crashes into
    // solid walls and trees (handled above), so fly it clear of the village.
    if (drone.kind === 'vampire') {
      if (contacts > 0) this.explodeDrone(drone);
      return;
    }

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
      if (player) this.award(player, MULTI_KILL_BONUS);
    }
    // The quad detonates on contact whether or not the target went with it: an
    // armoured kill costs the pilot a drone either way.
    if (contacts > 0) this.explodeDrone(drone);
  }

  /**
   * Applies one hit to an enemy and returns true if it died. One unit of damage is a
   * quad's payload; the mortar arrives with a heavier one and clears the whole
   * armour table in a single shell, while a machine gun round is a fraction of one.
   * Armoured units (the tank) soak a hit, catch fire and keep driving, so they need
   * a second quad to finish them.
   *
   * `heavy` says whether this was a strike worth announcing: a quad or a shell
   * ignites the target, pays a share of its worth for the hit and tells every client
   * about it. A machine gun round is neither: it just chips the armour, and a burst
   * of ten of them is not about to send ten `enemy_hit` events down the wire.
   */
  private damageEnemy(enemy: InternalEnemy, killerId: string, damage = 1, heavy = true): boolean {
    const stats = ENEMY_STATS[enemy.type];
    const player = this.players.get(killerId);
    enemy.hp = Math.max(0, enemy.hp - damage * stats.armour);

    if (enemy.hp > 0) {
      if (!heavy) return false;
      enemy.burning = true;
      if (player) this.award(player, Math.round(stats.score * ARMOUR_HIT_SCORE_SHARE));
      this.broadcastEvent({
        type: 'enemy_hit', enemyId: enemy.id, enemyType: enemy.type, killerId,
        position: { ...enemy.position }, hp: enemy.hp, maxHp: enemy.maxHp, burning: true,
      });
      return false;
    }

    enemy.dead = true;
    enemy.deathTime = this.serverTime;
    this.kills++;
    if (player) this.award(player, stats.score);
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
    // A client that cannot apply a delta asks for the world again. Handled ahead of
    // the player lookup because it is about the socket, not about the pilot.
    if ((msg as { type?: string })?.type === RESYNC_MSG) { this.net.resync(client); return; }
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
      case 'select_weapon': {
        // Swapping stations is free and always allowed. A pilot mid-flight keeps
        // flying the quad they already have; the choice only gates what the next
        // launch does. Free to swap, but not free to borrow: a station the armory
        // sells stays dead until its price has been paid, and since the launch and
        // the bomb drop both read player.weapon, gating the choice gates the
        // aircraft with it.
        const gun = hmgGunOf(msg.weapon);
        if (msg.weapon === WeaponType.FPV || msg.weapon === WeaponType.VAMPIRE || msg.weapon === WeaponType.MORTAR || gun >= 0) {
          if (!weaponIsUnlocked(msg.weapon, player.unlocked)) {
            // Sent down the same 'event' channel the room broadcasts use, but to him
            // alone: his HUD flashes the price, nobody else's screen reacts.
            this.send(client, 'event', {
              type: 'purchase_denied',
              item: shopItemFor(msg.weapon)?.item ?? ShopItem.VAMPIRE,
              reason: 'locked',
              credits: player.credits,
            });
            break;
          }
          player.weapon = msg.weapon;
          if (gun >= 0) {
            // Taking over a crew starts from the lay that crew was holding, and
            // from a trigger nobody has his hand on.
            player.hmgYaw = HMG_NESTS[gun].yaw;
            player.hmgPitch = 0;
            player.hmgFireAcc[gun] = 0;
            player.hmgFiring = false;
            player.hmgInputAt = this.serverTime;
          }
        }
        break;
      }
      case 'hmg_input': {
        // Only the gun the pilot is standing at, and only while he is not up in a
        // quad. The lay is his, the elevation is clamped to the pintle, and whether
        // a round actually leaves the barrel is decided on the tick.
        const gun = hmgGunOf(player.weapon);
        if (gun < 0 || msg.gun !== gun || player.state === PlayerState.PILOTING) break;
        if (typeof msg.yaw === 'number' && msg.yaw === msg.yaw) player.hmgYaw = msg.yaw;
        player.hmgPitch = clampHmgPitch(msg.pitch);
        player.hmgFiring = msg.firing === true;
        player.hmgInputAt = this.serverTime;
        break;
      }
      case 'mortar_fire':
        if (
          player.weapon === WeaponType.MORTAR
          && this.phase === GamePhase.PLAYING
          && this.serverTime >= player.mortarReadyAt
        ) {
          this.fireMortar(player, msg.x, msg.z);
        }
        break;
      case 'launch_drone':
        // Only the drone stations launch: with the tube manned, SPACE is a shell.
        // The FPV and the Vampire are both flown quads, so both lift off on SPACE.
        if (
          (player.weapon === WeaponType.FPV || player.weapon === WeaponType.VAMPIRE)
          && player.state === PlayerState.WAITING
          && this.phase === GamePhase.PLAYING
        ) {
          if (player.weapon === WeaponType.VAMPIRE) this.launchVampire(player);
          else this.launchDrone(player);
        }
        break;
      case 'vampire_drop': {
        // Release one mini-bomb from the Vampire in the air. Every gate is checked
        // server-side so a spamming client cannot empty the stack in one frame or
        // drop below the safe altitude: a bomb left, not on autopilot home, enough
        // altitude, and the release interval elapsed since the last one.
        if (
          player.weapon === WeaponType.VAMPIRE
          && player.state === PlayerState.PILOTING
          && this.phase === GamePhase.PLAYING
          && player.droneId
        ) {
          const drone = this.drones.get(player.droneId);
          if (
            drone && drone.alive && drone.kind === 'vampire'
            && !drone.returning
            && drone.vampireBombs > 0
            && drone.position.y >= VAMPIRE_MIN_DROP_ALTITUDE
            && this.serverTime - drone.lastDropAt >= VAMPIRE_DROP_INTERVAL * 1000
          ) {
            this.dropBomb(player, drone);
          }
        }
        break;
      }
      case 'purchase': {
        // The armory. The client names a catalogue row and nothing else — the price
        // comes from the server's own copy of the catalogue, so a tampered browser
        // cannot ask for a bomber at a tenth of what it costs, and cannot ask for a
        // row that does not exist at all.
        const spec = shopItemByKey(msg.item);
        if (!spec) break;
        // Nothing changes hands while the fort is still being drawn up or after it
        // has fallen: a purchase is a decision made under the horde, not in the lobby.
        if (this.phase !== GamePhase.PLAYING) {
          this.send(client, 'event', { type: 'purchase_denied', item: spec.item, reason: 'closed', credits: player.credits });
          break;
        }
        if (spec.weapon && player.unlocked.includes(spec.weapon)) {
          this.send(client, 'event', { type: 'purchase_denied', item: spec.item, reason: 'owned', credits: player.credits });
          break;
        }
        // A mine field is a refill of the belt, not a stack of belts. When every hole is
        // already occupied there is nothing this purchase could bury, so the armory says
        // so instead of taking the credits for a field that would not change by one mine.
        if (spec.item === ShopItem.MINEFIELD && this.emptyMineSpots().length === 0) {
          this.send(client, 'event', { type: 'purchase_denied', item: spec.item, reason: 'full', credits: player.credits });
          break;
        }
        if (player.credits < spec.cost) {
          this.send(client, 'event', { type: 'purchase_denied', item: spec.item, reason: 'credits', credits: player.credits });
          break;
        }
        player.credits -= spec.cost;
        if (spec.weapon) player.unlocked.push(spec.weapon);
        // A row that sells no station is a consumable: it does its work the moment it is
        // paid for instead of handing over something to man. The mine field goes into the
        // dirt here, on the far side of the wire, and waits.
        if (spec.item === ShopItem.MINEFIELD) this.layMinefield(player);
        // Everyone hears about it: the row goes to OWNED on every screen, and the
        // room knows who just walked out with a bomber.
        this.broadcastEvent({
          type: 'purchase', buyerId: player.id, item: spec.item,
          cost: spec.cost, credits: player.credits,
        });
        break;
      }
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
      kind: 'fpv', vampireBombs: 0, returning: false, lastDropAt: 0, vampireReloadAt: 0,
    };
    this.drones.set(drone.id, drone);
    player.state = PlayerState.PILOTING;
    player.droneId = drone.id;
  }

  /**
   * Send a Vampire bomber up off the pad with a full stack of mini-bombs. It lifts to
   * the floor of its altitude band, which is already above the drop floor, so the first
   * bomb is legal the instant the pilot is airborne; from there the pilot climbs or
   * descends within the band. The bomb state is mirrored onto the player so the HUD can
   * read the stack without reaching through the drone.
   */
  private launchVampire(player: InternalPlayer) {
    const drone: InternalDrone = {
      id: `d_${this.idCounter++}`, ownerId: player.id,
      position: { x: VAMPIRE_BASE.x, y: VAMPIRE_LAUNCH_ALTITUDE, z: VAMPIRE_BASE.z },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: Math.random() * Math.PI * 2, pitch: 0,
      launchedAt: this.serverTime, alive: true,
      boostCooldownUntil: 0,
      input: { forward: 0, up: 0, boost: false },
      kind: 'vampire',
      vampireBombs: VAMPIRE_BOMB_CAPACITY,
      returning: false,
      lastDropAt: 0,
      vampireReloadAt: 0,
    };
    this.drones.set(drone.id, drone);
    player.state = PlayerState.PILOTING;
    player.droneId = drone.id;
    player.vampireBombs = VAMPIRE_BOMB_CAPACITY;
    player.vampireReturning = false;
    player.vampireReloadAt = 0;
  }

  // ─── Helpers ─────────────────────────────────────────────
  private tickCooldowns() {
    for (const player of this.players.values()) {
      if (player.state === PlayerState.COOLDOWN && this.serverTime >= player.cooldownUntil) {
        player.state = PlayerState.WAITING;
        player.cooldownUntil = 0;
      }
      this.reloadHmgs(player);
    }
  }

  /**
   * Pay a pilot for some damage: the score keeps the record of what he achieved,
   * and the credits are the part of it he can spend at the armory. Every payout in
   * the room goes through here so the two ledgers can never drift apart, and a
   * future change to what kills are worth in credits is one line.
   */
  private award(player: InternalPlayer, points: number) {
    player.score += points;
    player.credits += Math.round(points * CREDIT_PAYOUT);
  }

  /**
   * A gun that has not been fired for HMG_RELOAD_TIME seconds has a full belt in it
   * again: the crew that was not shooting spent that time hooking a fresh can up to
   * the feed tray. One rule covers both cases that matter — a belt run empty, and a
   * gun its pilot simply walked away from — so changing stations never needs a
   * reload of its own.
   */
  private reloadHmgs(player: InternalPlayer) {
    for (let gun = 0; gun < player.hmgAmmo.length; gun++) {
      if (player.hmgAmmo[gun] >= HMG_BELT_SIZE) {
        player.hmgReloadAt[gun] = 0;
        continue;
      }
      if (this.serverTime - player.hmgLastShotAt[gun] >= HMG_RELOAD_TIME * 1000) {
        player.hmgAmmo[gun] = HMG_BELT_SIZE;
        player.hmgReloadAt[gun] = 0;
      }
    }
  }

  private generateRoomCode(): string {
    const chars = '0123456789';
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
  /**
   * Hand the tick's live maps to the delta stream. Nothing is copied or rebuilt
   * here: the stream reads the room's own maps, encodes each entity once, and
   * sends every client only what differs from what that client was last told.
   */
  private broadcastState() {
    const snap: Snapshot = {
      phase: this.phase,
      threatLevel: this.threatLevel,
      elapsed: Math.floor(this.elapsed),
      enemiesAlive: this.getActiveEnemyCount(),
      kills: this.kills,
      leaks: this.leaks,
      playerCount: this.players.size,
      roomCode: this.roomCode,
      difficulty: this.difficulty,
      serverTime: this.serverTime - this.epochMs,
      enemies: this.enemies,
      structures: this.structures,
      drones: this.drones,
      bombs: this.bombs,
      mines: this.mines,
      players: this.players,
    };
    this.net.broadcast(snap);
  }

  private broadcastEvent(event: any) {
    this.broadcast('event', event);
  }
}

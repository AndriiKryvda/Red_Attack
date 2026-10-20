/**
 * ─── Client-side delta applier ────────────────────────────────────────────────
 *
 * Rebuilds a plain `GameState` out of the compact per-client delta frames the
 * server sends (see shared/netcode for the wire layout). The rest of the client
 * keeps reading `state.enemies[i].position.x` exactly as it always has; only the
 * bytes on the wire changed.
 *
 * Two things matter for performance here:
 *   - entity objects are created once and mutated in place, so a busy tick
 *     allocates nothing beyond the few arrays msgpackr hands back;
 *   - the arrays the renderers iterate are only rebuilt when membership changes,
 *     never just because something moved.
 *
 * Timestamps arrive as relative milliseconds and are turned back into
 * `Date.now()`-based absolutes on the way in, which is what `Enemy.ts` and the
 * HUD already compare against — and it drops the old dependence on the server's
 * wall clock matching the browser's.
 */
import {
  NET_VERSION, absTimeDs, absTimeSec, dequantPos, dequantAngle, dequantSpeed, fullId, wireValue,
  ENEMY_TYPE_WIRE, GAME_PHASE_WIRE, PLAYER_STATE_WIRE, WEAPON_WIRE,
  STRUCTURE_KIND_WIRE, STRUCTURE_VARIANT_WIRE, DIFFICULTY_WIRE, DRONE_KIND_WIRE,
  EF_DEAD, EF_BURNING, SF_BURNING, SF_DESTROYED,
  GamePhase, PlayerState, Difficulty, WeaponType, EnemyType, StructureKind,
  type NetFrame, type NetCollection,
  type GameState, type EnemyData, type StructureData, type DroneData,
  type BombData, type MineData, type PlayerData,
  type StructureVariant,
} from '@red-attack/shared';
import { Interpolator } from './Interpolator.js';

/** Thrown when a delta names an entity we have never seen: the only fix is a fresh snapshot. */
export class DesyncError extends Error {}

function flagBits(v: number, bit: number): boolean { return (v & bit) !== 0; }
function splitNums(csv: string): number[] {
  if (!csv) return [];
  return csv.split(',').map(Number);
}

export class StateApplier {
  readonly state: GameState = {
    phase: GamePhase.LOBBY, threatLevel: 1, elapsed: 0, enemiesAlive: 0,
    kills: 0, leaks: 0, playerCount: 0, roomCode: '', difficulty: Difficulty.HARD,
    enemies: [], structures: [], drones: [], bombs: [], mines: [], players: [],
    serverTime: 0,
  };
  readonly interpolator = new Interpolator();
  /** Frames applied, for the debug overlay. */
  frames = 0;
  /** Wire version of the snapshot we last reset onto. */
  private enemies_ = new Map<string, EnemyData>();
  private structures_ = new Map<string, StructureData>();
  private drones_ = new Map<string, DroneData>();
  private bombs_ = new Map<string, BombData>();
  private mines_ = new Map<string, MineData>();
  private players_ = new Map<string, PlayerData>();
  private dirtyArrays = true;
  /** The wire numbers players travel under, both ways round. */
  private playerIds = new Map<number, string>();
  private playersByNum = new Map<number, PlayerData>();

  /** The pilot's own session id, so their aircraft can be smoothed more tightly. */
  ownSessionId: string = '';

  /**
   * Fold one frame into the live state. Throws `DesyncError` if the frame refers
   * to an entity that was never sent, which the caller answers by asking for a
   * whole snapshot.
   */
  apply(frame: NetFrame): void {
    if (frame.v !== NET_VERSION) throw new DesyncError(`wire version ${frame.v} != ${NET_VERSION}`);
    if (frame.f === 1) this.reset();
    this.frames++;

    // One clock on the client: the server's. Relative offsets are rebased onto the
    // stamp of the frame that carried them, so every timestamp the client holds —
    // cooldowns, slow/freeze expiry, wreck age — is comparable against
    // `state.serverTime`, exactly as the pre-delta protocol's absolute ones were.
    const now = frame.st;
    this.state.serverTime = frame.st;
    this.interpolator.note(frame.st);

    if (frame.meta) {
      this.state.roomCode = frame.meta[0];
      this.state.difficulty = wireValue(DIFFICULTY_WIRE, frame.meta[1]) as Difficulty;
    }
    const h = frame.h;
    if (h) {
      this.state.phase = wireValue(GAME_PHASE_WIRE, h[0]) as GamePhase;
      this.state.threatLevel = h[1];
      this.state.elapsed = h[2];
      this.state.enemiesAlive = h[3];
      this.state.kills = h[4];
      this.state.leaks = h[5];
      this.state.playerCount = h[6];
    }

    if (frame.e) this.applyEnemies(frame.e, now);
    if (frame.s) this.applyStructures(frame.s);
    if (frame.d) this.applyDrones(frame.d);
    if (frame.b) this.applyBombs(frame.b);
    if (frame.n) this.applyMines(frame.n);
    if (frame.y) this.applyPlayers(frame.y, now);
  }

  /** The merged state with arrays up to date, positions exactly as the server sent them. */
  flush(): GameState {
    if (this.dirtyArrays) this.rebuildArrays();
    return this.state;
  }

  /** The state with positions smoothed to the render clock. Read this once per frame. */
  read(): GameState {
    const s = this.state;
    if (this.dirtyArrays) this.rebuildArrays();
    const ownDroneId = this.ownDroneId();
    this.interpolator.smooth(this.enemies_, s.serverTime);
    this.interpolator.smooth(this.drones_, s.serverTime, ownDroneId);
    this.interpolator.smooth(this.bombs_, s.serverTime);
    return s;
  }

  private ownDroneId(): string | null {
    const me = this.players_.get(this.ownSessionId);
    return me?.droneId ?? null;
  }

  private reset(): void {
    this.enemies_.clear(); this.structures_.clear(); this.drones_.clear();
    this.bombs_.clear(); this.mines_.clear(); this.players_.clear();
    this.playerIds.clear(); this.playersByNum.clear();
    this.interpolator.clear();
    this.dirtyArrays = true;
  }

  private rebuildArrays(): void {
    this.state.enemies = Array.from(this.enemies_.values());
    this.state.structures = Array.from(this.structures_.values());
    this.state.drones = Array.from(this.drones_.values());
    this.state.bombs = Array.from(this.bombs_.values());
    this.state.mines = Array.from(this.mines_.values());
    this.state.players = Array.from(this.players_.values());
    this.dirtyArrays = false;
  }


  // ─── Enemies ────────────────────────────────────────────────────────────────
  private applyEnemies(col: NetCollection<any, any, any>, now: number): void {
    if (col.a) for (const r of col.a) {
      const id = fullId('e', r[0]);
      let e = this.enemies_.get(id);
      if (e === undefined) {
        e = { id, type: EnemyType.CHEBURASHKA, position: { x: 0, y: 0, z: 0 }, hp: 0, maxHp: 1,
          speed: 0, slowedUntil: 0, frozenUntil: 0, dead: false, deathTime: 0, burning: false };
        this.enemies_.set(id, e);
        this.dirtyArrays = true;
      }
      e.type = wireValue(ENEMY_TYPE_WIRE, r[1]) as EnemyType;
      e.maxHp = r[2];
      e.speed = dequantSpeed(r[3]);
      e.hp = r[4];
      e.dead = flagBits(r[5], EF_DEAD);
      e.burning = flagBits(r[5], EF_BURNING);
      e.slowedUntil = absTimeDs(r[6], now);
      e.frozenUntil = absTimeDs(r[7], now);
      e.position.x = dequantPos(r[8]);
      e.position.z = dequantPos(r[9]);
      this.interpolator.record(id, e.position.x, e.position.y, e.position.z);
    }
    if (col.m) for (const r of col.m) {
      const e = this.require(this.enemies_, 'enemy', r[0], 'e');
      e.position.x = dequantPos(r[1]);
      e.position.z = dequantPos(r[2]);
      this.interpolator.record(e.id, e.position.x, e.position.y, e.position.z);
    }
    if (col.p) for (const r of col.p) {
      const e = this.require(this.enemies_, 'enemy', r[0], 'e');
      e.hp = r[1];
      const wasDead = e.dead;
      e.dead = flagBits(r[2], EF_DEAD);
      e.burning = flagBits(r[2], EF_BURNING);
      // The wire does not carry a wreck's age, so stamp the moment we first hear
      // about it; nothing on the client reads it beyond that.
      if (e.dead && !wasDead) e.deathTime = now;
      e.slowedUntil = absTimeDs(r[3], now);
      e.frozenUntil = absTimeDs(r[4], now);
    }
    if (col.r) for (const n of col.r) this.drop(this.enemies_, fullId('e', n));
  }

  // ─── Structures ─────────────────────────────────────────────────────────────
  private applyStructures(col: NetCollection<any, any, any>): void {
    if (col.a) for (const r of col.a) {
      const id = fullId('s', r[0]);
      let s = this.structures_.get(id);
      if (s === undefined) {
        s = { id, kind: StructureKind.BUILDING, variant: 'house' as StructureVariant,
          x: 0, z: 0, yaw: 0, hp: 1, maxHp: 1, burning: false, destroyed: false };
        this.structures_.set(id, s);
        this.dirtyArrays = true;
      }
      s.kind = wireValue(STRUCTURE_KIND_WIRE, r[1]) as StructureKind;
      s.variant = wireValue(STRUCTURE_VARIANT_WIRE, r[2]) as StructureVariant;
      s.x = dequantPos(r[3]);
      s.z = dequantPos(r[4]);
      s.yaw = dequantAngle(r[5]);
      s.maxHp = r[6];
      s.hp = r[7];
      s.burning = flagBits(r[8], SF_BURNING);
      s.destroyed = flagBits(r[8], SF_DESTROYED);
    }
    if (col.p) for (const r of col.p) {
      const s = this.require(this.structures_, 'structure', r[0], 's');
      s.hp = r[1];
      s.burning = flagBits(r[2], SF_BURNING);
      s.destroyed = flagBits(r[2], SF_DESTROYED);
    }
    if (col.r) for (const n of col.r) this.drop(this.structures_, fullId('s', n));
  }

  // ─── Drones ─────────────────────────────────────────────────────────────────
  private applyDrones(col: NetCollection<any, any, any>): void {
    const launched = (ageDs: number) => this.state.serverTime - ageDs * 100;
    if (col.a) for (const r of col.a) {
      const id = fullId('d', r[0]);
      let d = this.drones_.get(id);
      if (d === undefined) {
        d = { id, ownerId: r[1], position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 },
          yaw: 0, pitch: 0, launchedAt: 0, alive: true };
        this.drones_.set(id, d);
        this.dirtyArrays = true;
      }
      d.ownerId = r[1];
      d.kind = wireValue(DRONE_KIND_WIRE, r[2]) as 'fpv' | 'vampire';
      d.alive = r[3] !== 0;
      d.vampireBombs = r[4];
      d.returning = r[5] !== 0;
      d.launchedAt = launched(r[6]);
      readDronePos(d, r, 7);
      this.interpolator.record(id, d.position.x, d.position.y, d.position.z);
    }
    if (col.m) for (const r of col.m) {
      const d = this.require(this.drones_, 'drone', r[0], 'd');
      readDronePos(d, r, 1);
      this.interpolator.record(d.id, d.position.x, d.position.y, d.position.z);
    }
    if (col.p) for (const r of col.p) {
      const d = this.require(this.drones_, 'drone', r[0], 'd');
      d.alive = r[1] !== 0;
      d.vampireBombs = r[2];
      d.returning = r[3] !== 0;
      d.launchedAt = launched(r[4]);
    }
    if (col.r) for (const n of col.r) this.drop(this.drones_, fullId('d', n));
  }

  // ─── Mini-bombs ─────────────────────────────────────────────────────────────
  private applyBombs(col: NetCollection<any, any, any>): void {
    if (col.a) for (const r of col.a) {
      const id = fullId('b', r[0]);
      let b = this.bombs_.get(id);
      if (b === undefined) {
        b = { id, ownerId: r[1], position: { x: 0, y: 0, z: 0 } };
        this.bombs_.set(id, b);
        this.dirtyArrays = true;
      }
      b.ownerId = r[1];
      b.position.x = dequantPos(r[2]);
      b.position.y = dequantPos(r[3]);
      b.position.z = dequantPos(r[4]);
      this.interpolator.record(id, b.position.x, b.position.y, b.position.z);
    }
    if (col.m) for (const r of col.m) {
      const b = this.require(this.bombs_, 'bomb', r[0], 'b');
      b.position.x = dequantPos(r[1]);
      b.position.y = dequantPos(r[2]);
      b.position.z = dequantPos(r[3]);
      this.interpolator.record(b.id, b.position.x, b.position.y, b.position.z);
    }
    if (col.r) for (const n of col.r) this.drop(this.bombs_, fullId('b', n));
  }

  // ─── Mines ──────────────────────────────────────────────────────────────────
  private applyMines(col: NetCollection<any, any, any>): void {
    if (col.a) for (const r of col.a) {
      const id = fullId('m', r[0]);
      if (this.mines_.has(id)) continue;
      this.mines_.set(id, { id, ownerId: r[1],
        position: { x: dequantPos(r[2]), y: 0, z: dequantPos(r[3]) } });
      this.dirtyArrays = true;
    }
    if (col.r) for (const n of col.r) this.drop(this.mines_, fullId('m', n));
  }

  // ─── Players ────────────────────────────────────────────────────────────────
  private applyPlayers(col: NetCollection<any, any, any>, now: number): void {
    if (col.a) for (const r of col.a) {
      const num = r[0] as number;
      const id = r[1] as string;
      let p = this.players_.get(id);
      if (p === undefined) {
        p = { id, name: '', state: PlayerState.WAITING, score: 0, ready: false, droneId: null,
          cooldownUntil: 0, weapon: WeaponType.FPV, mortarReadyAt: 0, hmgAmmo: [],
          hmgReloadAt: [], manningGun: -1, hmgYaw: 0, hmgPitch: 0, vampireBombs: 0,
          vampireReturning: false, vampireReloadAt: 0, credits: 0, unlocked: [] };
        this.players_.set(id, p);
        this.dirtyArrays = true;
      }
      this.playerIds.set(num, id);
      this.playersByNum.set(num, p);
      p.name = r[2] as string;
      readPlayerState(p, r, 3, now);
    }
    if (col.p) for (const r of col.p) {
      const p = this.playersByNum.get(r[0] as number);
      if (p === undefined) throw new DesyncError(`unknown player ${r[0]}`);
      readPlayerState(p, r, 1, now);
    }
    if (col.r) for (const n of col.r) {
      const id = this.playerIds.get(n);
      this.playerIds.delete(n);
      this.playersByNum.delete(n);
      if (id !== undefined) this.drop(this.players_, id);
    }
  }

  /** Look up a delta's target, or admit we have fallen out of step. */
  private require<T extends { id: string }>(
    view: Map<string, T>, what: string, num: number, prefix: string,
  ): T {
    const found = view.get(fullId(prefix, num));
    if (found === undefined) throw new DesyncError(`unknown ${what} ${num}`);
    return found;
  }

  private drop<T>(view: Map<string, T>, id: string): void {
    if (view.delete(id)) { this.dirtyArrays = true; this.interpolator.forget(id); }
  }
}

function readDronePos(d: DroneData, r: any[], i: number): void {
  d.position.x = dequantPos(r[i]);
  d.position.y = dequantPos(r[i + 1]);
  d.position.z = dequantPos(r[i + 2]);
  d.yaw = dequantAngle(r[i + 3]);
  d.pitch = dequantAngle(r[i + 4]);
  d.velocity.x = dequantSpeed(r[i + 5]);
  d.velocity.y = dequantSpeed(r[i + 6]);
  d.velocity.z = dequantSpeed(r[i + 7]);
}

/** The player state block, shared by the add and patch rows; `i` is where it starts. */
function readPlayerState(p: PlayerData, r: any[], i: number, now: number): void {
  p.state = wireValue(PLAYER_STATE_WIRE, r[i]) as PlayerState;
  p.score = r[i + 1];
  p.ready = r[i + 2] !== 0;
  p.droneId = (r[i + 3] || null) as string | null;
  p.cooldownUntil = absTimeSec(r[i + 4], now);
  p.weapon = wireValue(WEAPON_WIRE, r[i + 5]) as WeaponType;
  p.mortarReadyAt = absTimeSec(r[i + 6], now);
  p.hmgAmmo = splitNums(r[i + 7] as string);
  p.hmgReloadAt = splitNums(r[i + 8] as string).map((s) => absTimeSec(s, now));
  p.manningGun = r[i + 9];
  p.hmgYaw = dequantAngle(r[i + 10]);
  p.hmgPitch = dequantAngle(r[i + 11]);
  p.vampireBombs = r[i + 12];
  p.vampireReturning = r[i + 13] !== 0;
  p.vampireReloadAt = absTimeSec(r[i + 14], now);
  p.credits = r[i + 15];
  p.unlocked = ((r[i + 16] as string).split(',').filter(Boolean)) as WeaponType[];
}


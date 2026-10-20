/**
 * ─── Per-client delta stream ──────────────────────────────────────────────────
 *
 * `broadcastState` used to rebuild the whole world twenty times a second and hand
 * the same 28 KB blob to every client, whether or not a single byte of it had
 * changed. This turns that inside out: the room hands us its live maps once per
 * tick, we encode each entity once into a quantized record shared by every
 * client, and then each client is sent only what differs from what it was last
 * sent. A marching enemy costs ten bytes; a wreck, a barn and a minefield cost
 * nothing at all until they change.
 *
 * The encoder is deliberately allocation-light on the hot path: records are built
 * once per tick (not once per client per tick) and the per-client pass only
 * compares.
 */
import { Client, Room } from '@colyseus/core';
import {
  NET_VERSION, qPos, qAngle, qSpeed, relTimeDs, relTimeSec, wireId, wireIndex,
  ENEMY_TYPE_WIRE, GAME_PHASE_WIRE, PLAYER_STATE_WIRE, WEAPON_WIRE,
  STRUCTURE_KIND_WIRE, STRUCTURE_VARIANT_WIRE, DIFFICULTY_WIRE, DRONE_KIND_WIRE,
  EF_DEAD, EF_BURNING, SF_BURNING, SF_DESTROYED,
  type NetFrame, type NetCollection, type NetHeader,
  type EnemyAdd, type EnemyMove, type EnemyPatch,
  type StructureAdd, type StructurePatch,
  type DroneAdd, type DroneMove, type DronePatch,
  type BombAdd, type BombMove, type MineAdd, type PlayerAdd, type PlayerPatch,
} from '@red-attack/shared';

type Cell = string | number;

/** An entity encoded three ways; see the tuple documentation in shared/netcode. */
interface Record3 { stat: Cell[]; state: Cell[]; pos: Cell[] }

/** Structural views of the room's internal entities, so this file owns no game logic. */
export interface EnemySrc {
  id: string; type: string; position: { x: number; y: number; z: number };
  hp: number; maxHp: number; speed: number;
  slowedUntil: number; frozenUntil: number; dead: boolean; burning: boolean;
}
export interface StructureSrc {
  id: string; kind: string; variant: string; x: number; z: number; yaw: number;
  hp: number; maxHp: number; burning: boolean; destroyed: boolean;
}
export interface DroneSrc {
  id: string; ownerId: string; kind?: string; launchedAt: number; alive: boolean;
  vampireBombs?: number; returning?: boolean;
  position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number };
  yaw: number; pitch: number;
}
export interface BombSrc { id: string; ownerId: string; position: { x: number; y: number; z: number } }
export interface MineSrc { id: string; ownerId: string; position: { x: number; y: number; z: number } }
export interface PlayerSrc {
  id: string; name: string; state: string; score: number; ready: boolean;
  droneId: string | null; cooldownUntil: number; weapon: string; mortarReadyAt: number;
  hmgAmmo: number[]; hmgReloadAt: number[]; manningGun: number; hmgYaw: number; hmgPitch: number;
  vampireBombs: number; vampireReturning: boolean; vampireReloadAt: number;
  credits: number; unlocked: string[];
}

/** Everything the room knows this tick. */
export interface Snapshot {
  phase: string; threatLevel: number; elapsed: number; enemiesAlive: number;
  kills: number; leaks: number; playerCount: number; roomCode: string;
  difficulty: string;
  /** The server's epoch clock, in ms. Every timestamp on the wire is in this frame. */
  serverTime: number;
  // ReadonlyMap so the room's richer InternalEnemy et al. satisfy these views.
  enemies: ReadonlyMap<string, EnemySrc>;
  structures: ReadonlyMap<string, StructureSrc>;
  drones: ReadonlyMap<string, DroneSrc>;
  bombs: ReadonlyMap<string, BombSrc>;
  mines: ReadonlyMap<string, MineSrc>;
  players: ReadonlyMap<string, PlayerSrc>;
}

/** What one client has been told about so far. */
class ClientView {
  enemies = new Map<number, Record3>();
  structures = new Map<number, Record3>();
  drones = new Map<number, Record3>();
  bombs = new Map<number, Record3>();
  mines = new Map<number, Record3>();
  players = new Map<number, Record3>();
  header: number[] | null = null;
  /** True until the first frame has been delivered, so it is sent whole. */
  fresh = true;
  /** Frame counter at the last send, so a quiet room still beats at a slower rate. */
  lastSentAt = 0;
}

/** A heartbeat keeps the client's clock honest in a room where nothing is moving. */
const HEARTBEAT_MS = 500;

function same(a: Cell[] | null, b: Cell[]): boolean {
  if (a === null || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Diff one collection against what this client already knows. `encoded` is the
 * tick's shared, already-quantized records; nothing here allocates unless there
 * is actually something to report.
 */
function diff<A extends Cell[] = Cell[], M extends Cell[] = Cell[], P extends Cell[] = Cell[]>(
  sent: Map<number, Record3>,
  encoded: Map<number, Record3>,
  hasPos: boolean,
  hasState: boolean,
): NetCollection<A, M, P> | undefined {
  let a: Cell[][] | undefined;
  let m: Cell[][] | undefined;
  let p: Cell[][] | undefined;
  let r: number[] | undefined;

  for (const [num, rec] of encoded) {
    const prev = sent.get(num);
    if (prev === undefined) {
      (a ??= []).push([num, ...rec.stat, ...rec.state, ...rec.pos]);
      sent.set(num, rec);
      continue;
    }
    const moved = hasPos && !same(prev.pos, rec.pos);
    const changed = hasState && !same(prev.state, rec.state);
    if (moved) (m ??= []).push([num, ...rec.pos]);
    if (changed) (p ??= []).push([num, ...rec.state]);
    if (moved || changed) sent.set(num, rec);
  }

  if (sent.size > encoded.size) {
    for (const num of sent.keys()) {
      if (!encoded.has(num)) { (r ??= []).push(num); sent.delete(num); }
    }
  }

  if (a === undefined && m === undefined && p === undefined && r === undefined) return undefined;
  const out: NetCollection<A, M, P> = {};
  // The encoders above are the only producers of these rows, and their shapes are
  // the tuples documented in shared/netcode; the cast just carries that across here.
  if (a) out.a = a as A[];
  if (m) out.m = m as M[];
  if (p) out.p = p as P[];
  if (r) out.r = r;
  return out;
}


// ─── Per-entity encoders ──────────────────────────────────────────────────────

function encodeEnemy(e: EnemySrc, now: number): Record3 {
  let flags = 0;
  if (e.dead) flags |= EF_DEAD;
  if (e.burning) flags |= EF_BURNING;
  return {
    stat: [wireIndex(ENEMY_TYPE_WIRE, e.type), e.maxHp, qSpeed(e.speed)],
    state: [e.hp, flags, relTimeDs(e.slowedUntil, now), relTimeDs(e.frozenUntil, now)],
    pos: [qPos(e.position.x), qPos(e.position.z)],
  };
}

/**
 * A building never moves, so its whole geometry rides in `stat` and leaves the
 * hot path. `maxHp` is fixed once spawned and goes there too: anything left in
 * `state` is re-sent on every hit, and a patch must stay exactly `[id, hp, flags]`
 * for the client to read its state bits from the right cell.
 */
function encodeStructure(s: StructureSrc): Record3 {
  let flags = 0;
  if (s.burning) flags |= SF_BURNING;
  if (s.destroyed) flags |= SF_DESTROYED;
  return {
    stat: [wireIndex(STRUCTURE_KIND_WIRE, s.kind), wireIndex(STRUCTURE_VARIANT_WIRE, s.variant),
      qPos(s.x), qPos(s.z), qAngle(s.yaw), s.maxHp],
    state: [s.hp, flags],
    pos: [],
  };
}

function encodeDrone(d: DroneSrc, now: number): Record3 {
  return {
    stat: [d.ownerId, wireIndex(DRONE_KIND_WIRE, d.kind)],
    state: [d.alive ? 1 : 0, d.vampireBombs ?? 0, d.returning ? 1 : 0, Math.round((now - d.launchedAt) / 100)],
    pos: [qPos(d.position.x), qPos(d.position.y), qPos(d.position.z),
      qAngle(d.yaw), qAngle(d.pitch),
      qSpeed(d.velocity.x), qSpeed(d.velocity.y), qSpeed(d.velocity.z)],
  };
}

function encodeBomb(b: BombSrc): Record3 {
  return { stat: [b.ownerId], state: [], pos: [qPos(b.position.x), qPos(b.position.y), qPos(b.position.z)] };
}

/** A mine is a pin in a map: position and owner, once, and then silence. */
function encodeMine(m: MineSrc): Record3 {
  return { stat: [m.ownerId, qPos(m.position.x), qPos(m.position.z)], state: [], pos: [] };
}

/**
 * Per-gun arrays go over as comma-joined strings: they are four small numbers that
 * change together, and a flat cell compares with `===` instead of element by element.
 */
function encodePlayer(p: PlayerSrc, now: number): Record3 {
  return {
    stat: [p.id, p.name],
    state: [
      wireIndex(PLAYER_STATE_WIRE, p.state), p.score, p.ready ? 1 : 0, p.droneId ?? '',
      relTimeSec(p.cooldownUntil, now), wireIndex(WEAPON_WIRE, p.weapon), relTimeSec(p.mortarReadyAt, now),
      p.hmgAmmo.join(','), p.hmgReloadAt.map((t) => relTimeSec(t, now)).join(','),
      p.manningGun, qAngle(p.hmgYaw), qAngle(p.hmgPitch),
      p.vampireBombs, p.vampireReturning ? 1 : 0, relTimeSec(p.vampireReloadAt, now),
      p.credits, p.unlocked.join(','),
    ],
    pos: [],
  };
}

/** Encode a collection once for the tick; every client then diffs against the same records. */
function encodeAll<T extends { id: string }>(
  items: Iterable<T>, encode: (item: T) => Record3,
): Map<number, Record3> {
  const out = new Map<number, Record3>();
  for (const item of items) out.set(wireId(item.id), encode(item));
  return out;
}

// ─── The stream ───────────────────────────────────────────────────────────────

export class DeltaStream {
  private views = new Map<Client, ClientView>();
  /** Session ids are UUIDs; the wire wants small ints, so hand out stable numbers. */
  private playerNums = new Map<string, number>();
  private nextPlayerNum = 1;
  private tick = 0;
  /** Running totals for the debug overlay and the benchmark. */
  readonly stats = { frames: 0, bytesEstimate: 0, entities: 0 };

  constructor(private room: Room) {}

  /** Called from `onJoin`: the next frame for this client has to be the whole world. */
  add(client: Client): void { this.views.set(client, new ClientView()); }

  remove(client: Client): void { this.views.delete(client); }

  /**
   * Forget everything we told one client. The next frame rebuilds it from
   * nothing; the client asks for this when a delta lands on state it cannot
   * recognise, which should be impossible over a reliable socket but is cheap
   * insurance against a protocol mismatch.
   */
  resync(client: Client): void { this.views.set(client, new ClientView()); }

  private playerNum(id: string): number {
    let n = this.playerNums.get(id);
    if (n === undefined) { n = this.nextPlayerNum++; this.playerNums.set(id, n); }
    return n;
  }

  /** Encode once, then diff per client. */
  broadcast(snap: Snapshot): void {
    const now = snap.serverTime;
    const tick = ++this.tick;
    const encEnemies = encodeAll(snap.enemies.values(), (e) => encodeEnemy(e, now));
    const encStructures = encodeAll(snap.structures.values(), encodeStructure);
    const encDrones = encodeAll(snap.drones.values(), (d) => encodeDrone(d, now));
    const encBombs = encodeAll(snap.bombs.values(), encodeBomb);
    const encMines = encodeAll(snap.mines.values(), encodeMine);
    const encPlayers = new Map<number, Record3>();
    for (const p of snap.players.values()) encPlayers.set(this.playerNum(p.id), encodePlayer(p, now));

    const header: NetHeader = [
      wireIndex(GAME_PHASE_WIRE, snap.phase), snap.threatLevel, snap.elapsed,
      snap.enemiesAlive, snap.kills, snap.leaks, snap.playerCount,
    ];
    this.stats.entities = snap.enemies.size + snap.structures.size + snap.drones.size
      + snap.bombs.size + snap.mines.size + snap.players.size;

    for (const client of this.room.clients) {
      let view = this.views.get(client);
      if (view === undefined) { view = new ClientView(); this.views.set(client, view); }
      const frame = this.build(view, tick, now, header, snap,
        encEnemies, encStructures, encDrones, encBombs, encMines, encPlayers);
      if (frame !== undefined) {
        this.room.send(client, 'state', frame);
        this.stats.frames++;
        view.lastSentAt = now;
      }
    }
  }

  private build(
    view: ClientView, tick: number, now: number, header: NetHeader, snap: Snapshot,
    encEnemies: Map<number, Record3>, encStructures: Map<number, Record3>,
    encDrones: Map<number, Record3>, encBombs: Map<number, Record3>,
    encMines: Map<number, Record3>, encPlayers: Map<number, Record3>,
  ): NetFrame | undefined {
    const full = view.fresh;
    const frame: NetFrame = { v: NET_VERSION, t: tick, st: now };

    if (full) {
      frame.f = 1;
      frame.meta = [snap.roomCode, wireIndex(DIFFICULTY_WIRE, snap.difficulty)];
    }
    if (full || !same(view.header, header)) { frame.h = header; view.header = header; }

    const e = diff<EnemyAdd, EnemyMove, EnemyPatch>(view.enemies, encEnemies, true, true);
    if (e) frame.e = e;
    const s = diff<StructureAdd, never, StructurePatch>(view.structures, encStructures, false, true);
    if (s) frame.s = s;
    const d = diff<DroneAdd, DroneMove, DronePatch>(view.drones, encDrones, true, true);
    if (d) frame.d = d;
    const b = diff<BombAdd, BombMove, never>(view.bombs, encBombs, true, false);
    if (b) frame.b = b;
    const n = diff<MineAdd>(view.mines, encMines, false, false);
    if (n) frame.n = n;
    const y = diff<PlayerAdd, never, PlayerPatch>(view.players, encPlayers, false, true);
    if (y) frame.y = y;

    const quiet = frame.e === undefined && frame.s === undefined && frame.d === undefined
      && frame.b === undefined && frame.n === undefined && frame.y === undefined;
    // A room where nothing moves still has to beat, or the client's clock and
    // interpolation buffer go stale waiting for a frame that never comes.
    if (quiet && !full && !frame.h && now - view.lastSentAt < HEARTBEAT_MS) return undefined;

    view.fresh = false;
    return frame;
  }
}


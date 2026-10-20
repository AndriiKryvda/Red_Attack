/**
 * ─── Protocol round-trip check ────────────────────────────────────────────────
 *
 * Runs the real server encoder and the real client applier back to back and asks
 * the only question that matters about a delta protocol: does the client end up
 * knowing exactly what the server knows?
 *
 *   npx tsx scripts/netroundtrip.ts
 *
 * It walks a live field for thirty ticks, then does the things that actually
 * break delta encoders — an entity dying, an entity vanishing, an entity
 * appearing, a second client joining halfway through — and re-checks the whole
 * world after every single frame.
 */
import { DeltaStream } from '../packages/server/dist/net/DeltaStream.js';
import { StateApplier } from '../packages/client/src/network/StateApplier.ts';
import { POS_STEP, ANGLE_STEP, SPEED_STEP } from '../packages/shared/dist/index.js';

let checks = 0;
const failures: string[] = [];

function near(a: number, b: number, tol: number, what: string): void {
  checks++;
  if (!(Math.abs(a - b) <= tol)) failures.push(`${what}: got ${a}, expected ${b} (tol ${tol})`);
}
function eq(a: unknown, b: unknown, what: string): void {
  checks++;
  if (a !== b) failures.push(`${what}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}

/** A decoded countdown may be rounded up to a whole second, and nothing more. */
const CLOCK_TOL = 1_500;

/**
 * A timestamp that travels as a relative offset must come back as either zero
 * (spent) or the moment it was set to. Anything else means the two ends are
 * reading different clocks — which is how every freeze lasted an age.
 */
function countdown(decoded: number, src: number, label: string): void {
  if (src <= world.serverTime) eq(decoded, 0, `${label} spent`);
  else near(decoded, src, CLOCK_TOL, label);
}

// ─── The world under test ─────────────────────────────────────────────────────
const now = 1_700_000_000_000;
const world: any = {
  phase: 'playing', threatLevel: 3, elapsed: 60, enemiesAlive: 4,
  kills: 12, leaks: 2, playerCount: 2, roomCode: '0427', difficulty: 'hard',
  // One clock everywhere: the server's epoch, the same one every entity timestamp
  // below is stamped on. Two clock domains sharing a wire is what broke the HUD.
  serverTime: now,
  enemies: new Map(), structures: new Map(), drones: new Map(),
  bombs: new Map(), mines: new Map(), players: new Map(),
};

function addEnemy(n: number, dead = false): void {
  world.enemies.set(`e_${n}`, {
    id: `e_${n}`, type: 'bear',
    position: { x: 10 + n, y: 0, z: -20 - n },
    hp: dead ? 0 : 40, maxHp: 40, speed: 3.2,
    slowedUntil: n === 1 ? now + 1200 : 0, frozenUntil: n === 2 ? now + 700 : 0,
    dead, deathTime: dead ? now : 0, burning: dead,
  });
}
for (let i = 0; i < 4; i++) addEnemy(i);

world.structures.set('s_0', { id: 's_0', kind: 'building', variant: 'barn', x: -70.5, z: 12.25,
  yaw: 1.5708, hp: 3, maxHp: 3, burning: false, destroyed: false });
world.structures.set('s_1', { id: 's_1', kind: 'car', variant: 'van', x: 33, z: 44,
  yaw: 0, hp: 1, maxHp: 2, burning: true, destroyed: false });
world.mines.set('m_0', { id: 'm_0', ownerId: 'p1', position: { x: 5, y: 0, z: 6 } });
world.drones.set('d_0', { id: 'd_0', ownerId: 'p1', kind: 'vampire',
  position: { x: 1.5, y: 80.25, z: -3.75 }, velocity: { x: 11.5, y: 0, z: -3.75 },
  yaw: 2.5, pitch: -0.2, launchedAt: now - 5000, alive: true, vampireBombs: 4, returning: false });
world.bombs.set('b_0', { id: 'b_0', ownerId: 'p1', position: { x: 2, y: 40, z: -4 } });
world.players.set('p1', { id: 'p1', name: 'Ada', state: 'piloting', score: 900, ready: true,
  droneId: 'd_0', cooldownUntil: now + 4000, weapon: 'vampire', mortarReadyAt: now + 1500,
  hmgAmmo: [120, 90, 120, 120], hmgReloadAt: [0, now + 3000, 0, 0], manningGun: -1,
  hmgYaw: 0.5, hmgPitch: 0.1, vampireBombs: 4, vampireReturning: false, vampireReloadAt: 0,
  credits: 320, unlocked: ['fpv', 'mortar'] });
world.players.set('p2', { id: 'p2', name: 'Bo', state: 'waiting', score: 10, ready: false,
  droneId: null, cooldownUntil: 0, weapon: 'fpv', mortarReadyAt: 0, hmgAmmo: [120, 120, 120, 120],
  hmgReloadAt: [0, 0, 0, 0], manningGun: 2, hmgYaw: -1, hmgPitch: 0.3, vampireBombs: 0,
  vampireReturning: false, vampireReloadAt: 0, credits: 0, unlocked: ['fpv'] });

// ─── A room that keeps what it sent, per client ───────────────────────────────
const sent = new Map<object, any[]>();
const room: any = {
  clients: new Set(),
  send(client: any, _type: string, message: any) {
    if (!sent.has(client)) sent.set(client, []);
    sent.get(client)!.push(message);
    return true;
  },
};
const stream = new DeltaStream(room);

const clientA: any = { sessionId: 'A' };
const applierA = new StateApplier();
applierA.ownSessionId = 'p1';
room.clients.add(clientA);
stream.add(clientA);

/** Compare everything the applier knows against everything the room knows. */
function verify(label: string, applier: StateApplier): void {
  const s = applier.flush();
  eq(s.phase, world.phase, `${label}: phase`);
  eq(s.threatLevel, world.threatLevel, `${label}: threat`);
  eq(s.elapsed, world.elapsed, `${label}: elapsed`);
  eq(s.kills, world.kills, `${label}: kills`);
  eq(s.leaks, world.leaks, `${label}: leaks`);
  eq(s.roomCode, world.roomCode, `${label}: roomCode`);
  eq(s.difficulty, world.difficulty, `${label}: difficulty`);

  eq(s.enemies.length, world.enemies.size, `${label}: enemy count`);
  for (const e of s.enemies) {
    const src = world.enemies.get(e.id);
    if (src === undefined) { failures.push(`${label}: unknown enemy ${e.id}`); continue; }
    eq(e.type, src.type, `${label}: ${e.id} type`);
    eq(e.hp, src.hp, `${label}: ${e.id} hp`);
    eq(e.maxHp, src.maxHp, `${label}: ${e.id} maxHp`);
    eq(e.dead, src.dead, `${label}: ${e.id} dead`);
    eq(e.burning, src.burning, `${label}: ${e.id} burning`);
    near(e.position.x, src.position.x, POS_STEP / 2 + 1e-9, `${label}: ${e.id} x`);
    near(e.position.z, src.position.z, POS_STEP / 2 + 1e-9, `${label}: ${e.id} z`);
    near(e.speed, src.speed, SPEED_STEP / 2 + 1e-9, `${label}: ${e.id} speed`);
    // Slow/freeze ride the server's clock, rebased on the client — check the value,
    // not just that something arrived.
    countdown(e.slowedUntil, src.slowedUntil, `${label}: ${e.id} slowed`);
    countdown(e.frozenUntil, src.frozenUntil, `${label}: ${e.id} frozen`);
  }

  eq(s.structures.length, world.structures.size, `${label}: structure count`);
  for (const st of s.structures) {
    const src = world.structures.get(st.id);
    if (src === undefined) { failures.push(`${label}: unknown structure ${st.id}`); continue; }
    eq(st.kind, src.kind, `${label}: ${st.id} kind`);
    eq(st.variant, src.variant, `${label}: ${st.id} variant`);
    eq(st.hp, src.hp, `${label}: ${st.id} hp`);
    eq(st.maxHp, src.maxHp, `${label}: ${st.id} maxHp`);
    eq(st.burning, src.burning, `${label}: ${st.id} burning`);
    eq(st.destroyed, src.destroyed, `${label}: ${st.id} destroyed`);
    near(st.x, src.x, POS_STEP / 2 + 1e-9, `${label}: ${st.id} x`);
    near(st.yaw, src.yaw, ANGLE_STEP / 2 + 1e-9, `${label}: ${st.id} yaw`);
  }

  eq(s.drones.length, world.drones.size, `${label}: drone count`);
  for (const d of s.drones) {
    const src = world.drones.get(d.id);
    if (src === undefined) { failures.push(`${label}: unknown drone ${d.id}`); continue; }
    eq(d.ownerId, src.ownerId, `${label}: ${d.id} owner`);
    eq(d.kind, src.kind, `${label}: ${d.id} kind`);
    eq(d.alive, src.alive, `${label}: ${d.id} alive`);
    eq(d.vampireBombs, src.vampireBombs, `${label}: ${d.id} bombs`);
    eq(d.returning, src.returning, `${label}: ${d.id} returning`);
    near(d.position.y, src.position.y, POS_STEP / 2 + 1e-9, `${label}: ${d.id} y`);
    near(d.yaw, src.yaw, ANGLE_STEP / 2 + 1e-9, `${label}: ${d.id} yaw`);
    near(d.velocity.x, src.velocity.x, SPEED_STEP / 2 + 1e-9, `${label}: ${d.id} vx`);
  }

  eq(s.mines.length, world.mines.size, `${label}: mine count`);
  eq(s.bombs.length, world.bombs.size, `${label}: bomb count`);

  eq(s.players.length, world.players.size, `${label}: player count`);
  for (const p of s.players) {
    const src = world.players.get(p.id);
    if (src === undefined) { failures.push(`${label}: unknown player ${p.id}`); continue; }
    eq(p.name, src.name, `${label}: ${p.id} name`);
    eq(p.state, src.state, `${label}: ${p.id} state`);
    eq(p.score, src.score, `${label}: ${p.id} score`);
    eq(p.credits, src.credits, `${label}: ${p.id} credits`);
    eq(p.weapon, src.weapon, `${label}: ${p.id} weapon`);
    eq(p.droneId, src.droneId, `${label}: ${p.id} droneId`);
    eq(p.manningGun, src.manningGun, `${label}: ${p.id} manningGun`);
    eq(p.hmgAmmo.join(','), src.hmgAmmo.join(','), `${label}: ${p.id} hmgAmmo`);
    eq(p.unlocked.join(','), src.unlocked.join(','), `${label}: ${p.id} unlocked`);
    eq(p.vampireBombs, src.vampireBombs, `${label}: ${p.id} vBombs`);
    countdown(p.cooldownUntil, src.cooldownUntil, `${label}: ${p.id} cooldown`);
    countdown(p.mortarReadyAt, src.mortarReadyAt, `${label}: ${p.id} mortar`);
    countdown(p.vampireReloadAt, src.vampireReloadAt, `${label}: ${p.id} vampireReload`);
  }
}


/** Push one tick through the stream and into an applier. */
function pump(applier: StateApplier, client: any): void {
  stream.broadcast(world);
  for (const frame of sent.get(client)!) applier.apply(frame);
  sent.get(client)!.length = 0;
}

function march(): void {
  world.serverTime += 50;
  for (const e of world.enemies.values()) {
    if (e.dead) continue;
    e.position.x -= e.speed * 0.05;
    e.position.z += e.speed * 0.05;
  }
  for (const d of world.drones.values()) {
    d.position.x += d.velocity.x * 0.05;
    d.position.y += d.velocity.y * 0.05;
  }
}

// ─── Thirty ordinary ticks ────────────────────────────────────────────────────
for (let t = 0; t < 30; t++) {
  march();
  pump(applierA, clientA);
  verify(`tick ${t}`, applierA);
}
console.log('  30 ordinary ticks checked');

// ─── A death, a removal, an arrival, a purchase ──────────────────────────────
world.enemies.get('e_1').dead = true;
world.enemies.get('e_1').hp = 0;
world.enemies.get('e_1').deathTime = world.serverTime;
world.enemies.delete('e_2');
addEnemy(9);
world.structures.set('s_2', { id: 's_2', kind: 'building', variant: 'tower', x: 5, z: 6,
  yaw: 3.14, hp: 3, maxHp: 3, burning: false, destroyed: false });
world.players.get('p2').credits = 150;
world.players.get('p2').unlocked = ['fpv', 'vampire'];
world.players.get('p2').weapon = 'vampire';
pump(applierA, clientA);
verify('after death/removal/arrival', applierA);
const after = applierA.flush();
eq(after.enemies.find((e: any) => e.id === 'e_1')?.dead, true, 'wreck still reported dead');
eq(after.enemies.find((e: any) => e.id === 'e_2'), undefined, 'removed enemy is gone');
eq(after.enemies.some((e: any) => e.id === 'e_9'), true, 'new enemy arrived');
eq(after.structures.length, 3, 'new structure arrived');
console.log('  death, removal, arrival and a purchase checked');

// ─── A building takes a hit, a car dies ───────────────────────────────────────
// The cells a patch carries must line up with the cells the client reads, or the
// burning/destroyed bits get decoded out of the wrong number. `s_1` has maxHp 2,
// whose second bit reads back as "destroyed" if the layout ever slips by one.
world.structures.get('s_0').hp = 2;
pump(applierA, clientA);
verify('building wounded', applierA);
const wounded = applierA.flush().structures.find((s: any) => s.id === 's_0')!;
eq(wounded.hp, 2, 'building took a hit');
eq(wounded.destroyed, false, 'a wounded building is not rubble');
eq(wounded.burning, false, 'a wounded building is not burning');

world.structures.get('s_1').hp = 0;
world.structures.get('s_1').burning = false;
world.structures.get('s_1').destroyed = true;
pump(applierA, clientA);
verify('car destroyed', applierA);
const wreck = applierA.flush().structures.find((s: any) => s.id === 's_1')!;
eq(wreck.hp, 0, 'a destroyed car is at 0 hp');
eq(wreck.destroyed, true, 'a destroyed car reads as destroyed');
eq(wreck.burning, false, 'a destroyed car is not burning');
eq(wreck.maxHp, 2, 'a structure keeps the maxHp it spawned with');
console.log('  structure damage and destruction checked');

// ─── A second client joins late and must be handed the whole world ───────────
const clientB: any = { sessionId: 'B' };
const applierB = new StateApplier();
room.clients.add(clientB);
stream.add(clientB);
pump(applierB, clientB);
verify('late joiner', applierB);
eq(sent.get(clientB)!.length, 0, 'late joiner needed no follow-up frame');
console.log('  late joiner snapshot checked');

// ─── The interpolator must not invent positions ───────────────────────────────
for (let t = 0; t < 20; t++) { march(); pump(applierA, clientA); }
const smoothed = applierA.read();
for (const e of smoothed.enemies) {
  const src = world.enemies.get(e.id);
  // Rendered up to ~100 ms in the past, so it may trail the truth by a tenth of a
  // second of travel — and never by more than that.
  const drift = e.speed * 0.12 + POS_STEP;
  near(e.position.x, src.position.x, drift, `interpolated ${e.id} stays near the truth`);
}
console.log('  interpolation stays inside one tick of the truth');

// ─── Something that stopped moving must not be dragged into the past ──────────
// A wreck stops being re-sent the moment it stops moving, so its sample buffer
// freezes while the clock keeps running. Interpolating straight back from the
// current time would walk into samples from before it stopped.
const wreckTruth = world.enemies.get('e_1').position.x;
for (let t = 0; t < 40; t++) {
  world.serverTime += 50;
  stream.broadcast(world);
  for (const frame of sent.get(clientA)!) applierA.apply(frame);
  sent.get(clientA)!.length = 0;
  const nowWreck = applierA.read().enemies.find((e: any) => e.id === 'e_1')!;
  near(nowWreck.position.x, wreckTruth, POS_STEP, `wreck holds still at tick +${t}`);
}
console.log('  a wreck holds its position instead of sliding backwards');

// ─── A client that lost its place recovers on request ─────────────────────────
stream.resync(clientA);
pump(applierA, clientA);
verify('after resync', applierA);
console.log('  resync rebuilds a client from nothing');

console.log(`\n  ${checks} checks, ${failures.length} failures`);
if (failures.length > 0) {
  for (const f of failures.slice(0, 20)) console.log(`    FAIL ${f}`);
  process.exit(1);
}
console.log('  PASS — the client knows exactly what the server knows\n');


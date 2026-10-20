#!/usr/bin/env node
/**
 * ─── Network benchmark ────────────────────────────────────────────────────────
 *
 * Answers one question with numbers: how many bytes does a frame of the late-game
 * horde cost, before and after the delta protocol?
 *
 *   node scripts/netbench.mjs                    # synthetic A/B, no server needed
 *   node scripts/netbench.mjs encode --enemies 150
 *   node scripts/netbench.mjs live --clients 4   # against a server on :2567
 *
 * `encode` builds a representative saturated field — a full live horde plus the
 * wrecks that linger behind it, the village, a minefield, five bombers and five
 * pilots — and runs it through both encoders:
 *
 *   old  the shape `broadcastState` used to send: a complete GameState, every
 *        field of every entity, twenty times a second, to everybody
 *   new  the real `DeltaStream` from the server build, per client
 *
 * Both sides are measured with msgpackr, the codec Colyseus 0.18 puts on the wire,
 * so the byte counts are the ones that would actually have crossed a socket.
 */
import { pack } from 'msgpackr';
import { DeltaStream } from '../packages/server/dist/net/DeltaStream.js';
import { ENEMY_STATS, MAX_ACTIVE_ENEMIES, TICK_RATE } from '../packages/shared/dist/index.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? Number(process.argv[i + 1]) : fallback;
};
const mode = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'encode';

const kbit = (bytesPerSec) => (bytesPerSec * 8 / 1000).toFixed(2).padStart(8);
const kb = (bytes) => (bytes / 1024).toFixed(2).padStart(8);
const pad = (s, n) => String(s).padEnd(n);
/** TICK_RATE is milliseconds per tick, so the frame rate is its reciprocal. */
const TICK_HZ = 1000 / TICK_RATE;

// ─── The scenario ─────────────────────────────────────────────────────────────
// A late-game frame: the horde at its cap, wrecks from the last half-minute of
// kills still on the field, the village half-burned, and a full crew on the fort.
function buildScenario({ enemies, corpses, structures, mines, drones, players }) {
  const types = Object.keys(ENEMY_STATS);
  const now = 1_700_000_000_000;
  const epoch = now - 11 * 60 * 1000;      // the room is eleven minutes old
  const state = {
    phase: 'playing', threatLevel: 7, elapsed: 660, enemiesAlive: enemies,
    rawElapsed: 660,
    kills: 1842, leaks: 96, playerCount: players, roomCode: '4271',
    difficulty: 'hard', serverTime: now - epoch,
    enemies: new Map(), structures: new Map(), drones: new Map(),
    bombs: new Map(), mines: new Map(), players: new Map(),
  };

  for (let i = 0; i < enemies + corpses; i++) {
    const type = types[i % types.length];
    const stats = ENEMY_STATS[type];
    const dead = i >= enemies;
    const angle = (i * 2.399) % (Math.PI * 2);
    const radius = dead ? 18 + (i % 40) : 55 + (i % 60);
    state.enemies.set(`e_${i}`, {
      id: `e_${i}`, type,
      position: { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius },
      hp: dead ? 0 : Math.max(1, Math.round(stats.hp * (0.3 + (i % 7) / 10))),
      maxHp: stats.hp, speed: stats.speed,
      slowedUntil: i % 23 === 0 ? now + 1500 : 0,
      frozenUntil: i % 41 === 0 ? now + 900 : 0,
      dead, deathTime: dead ? now - (i % 30) * 1000 : 0,
      burning: dead && i % 5 === 0,
    });
  }

  const kinds = ['building', 'car'];
  const variants = ['house', 'block', 'barn', 'tower', 'sedan', 'pickup', 'van', 'bus'];
  for (let i = 0; i < structures; i++) {
    state.structures.set(`s_${i}`, {
      id: `s_${i}`, kind: kinds[i % 2], variant: variants[i % variants.length],
      x: -90 + (i % 13) * 15, z: -95 + Math.floor(i / 13) * 40,
      yaw: (i % 4) * Math.PI / 2,
      hp: i % 6 === 0 ? 0 : 3, maxHp: 3,
      burning: i % 6 === 1, destroyed: i % 6 === 0,
    });
  }

  for (let i = 0; i < mines; i++) {
    state.mines.set(`m_${i}`, {
      id: `m_${i}`, ownerId: `pilot_${i % players}`,
      position: { x: -20 + i * 5, y: 0, z: 28 + (i % 3) * 3 },
    });
  }

  for (let i = 0; i < drones; i++) {
    const vampire = i % 2 === 1;
    state.drones.set(`d_${i}`, {
      id: `d_${i}`, ownerId: `pilot_${i % players}`,
      kind: vampire ? 'vampire' : 'fpv',
      position: { x: -40 + i * 20, y: vampire ? 95 : 22, z: -30 + i * 14 },
      velocity: { x: 11.5, y: vampire ? 0.4 : -1.2, z: -3.75 },
      yaw: i * 0.7, pitch: -0.18 + i * 0.05,
      launchedAt: now - (4 + i * 3) * 1000, alive: true,
      vampireBombs: vampire ? 3 + (i % 4) : 0,
      returning: vampire && i % 4 === 3,
    });
  }

  for (let i = 0; i < players; i++) {
    state.players.set(`pilot_${i}`, {
      id: `pilot_${i}`, name: `Pilot ${i + 1}`,
      state: i % 3 === 2 ? 'waiting' : 'piloting',
      score: 400 + i * 137, ready: true, droneId: `d_${i % drones}`,
      cooldownUntil: i === 0 ? now + 3000 : 0,
      weapon: i % 2 ? 'vampire' : 'fpv', mortarReadyAt: now + 1200,
      hmgAmmo: [120, 120, 90, 120], hmgReloadAt: [0, 0, now + 4000, 0],
      manningGun: -1, hmgYaw: 0.4 * i, hmgPitch: 0.12,
      vampireBombs: 5, vampireReturning: false, vampireReloadAt: 0,
      credits: 250 + i * 40, unlocked: ['fpv', 'mortar', 'hmg1'],
    });
  }
  return { state, epoch, now };
}

/** Advance the world one tick the way the room would: the horde marches inward. */
function advance(state, dt) {
  const dtSec = dt / 1000;
  for (const e of state.enemies.values()) {
    if (e.dead) continue;
    const p = e.position;
    const dist = Math.hypot(p.x, p.z) || 1;
    const step = e.speed * dtSec;
    p.x -= (p.x / dist) * step;
    p.z -= (p.z / dist) * step;
  }
  for (const d of state.drones.values()) {
    d.position.x += d.velocity.x * dtSec;
    d.position.y += d.velocity.y * dtSec;
    d.position.z += d.velocity.z * dtSec;
    d.yaw += 0.01;
  }
  state.serverTime += dt;
  // The room sends `Math.floor(elapsed)`, so the bench keeps the fraction off the
  // wire value; an un-floored clock would make the header change every tick.
  state.rawElapsed += dtSec;
  state.elapsed = Math.floor(state.rawElapsed);
  state.enemiesAlive = 0;
  for (const e of state.enemies.values()) if (!e.dead) state.enemiesAlive++;
}

/** The old encoder, reproduced verbatim from the pre-delta `broadcastState`. */
function encodeOld(state) {
  let alive = 0;
  for (const e of state.enemies.values()) if (!e.dead) alive++;
  return {
    phase: state.phase, threatLevel: state.threatLevel, elapsed: Math.floor(state.elapsed),
    enemiesAlive: alive, kills: state.kills, leaks: state.leaks,
    playerCount: state.playerCount, roomCode: state.roomCode, difficulty: state.difficulty,
    enemies: Array.from(state.enemies.values()).map(e => ({
      id: e.id, type: e.type, position: e.position,
      hp: e.hp, maxHp: e.maxHp, speed: e.speed,
      slowedUntil: e.slowedUntil, frozenUntil: e.frozenUntil,
      dead: e.dead, deathTime: e.deathTime, burning: e.burning,
    })),
    structures: Array.from(state.structures.values()).map(s => ({
      id: s.id, kind: s.kind, variant: s.variant, x: s.x, z: s.z, yaw: s.yaw,
      hp: s.hp, maxHp: s.maxHp, burning: s.burning, destroyed: s.destroyed,
    })),
    drones: Array.from(state.drones.values()).map(d => ({
      id: d.id, ownerId: d.ownerId, position: d.position, velocity: d.velocity,
      yaw: d.yaw, pitch: d.pitch, launchedAt: d.launchedAt, alive: d.alive,
      kind: d.kind, vampireBombs: d.vampireBombs, returning: d.returning,
    })),
    bombs: Array.from(state.bombs.values()).map(b => ({
      id: b.id, ownerId: b.ownerId, position: b.position,
    })),
    mines: Array.from(state.mines.values()).map(m => ({
      id: m.id, ownerId: m.ownerId, position: m.position,
    })),
    players: Array.from(state.players.values()).map(p => ({
      id: p.id, name: p.name, state: p.state, score: p.score, ready: p.ready,
      droneId: p.droneId, cooldownUntil: p.cooldownUntil, weapon: p.weapon,
      mortarReadyAt: p.mortarReadyAt, hmgAmmo: p.hmgAmmo, hmgReloadAt: p.hmgReloadAt,
      manningGun: p.manningGun, hmgYaw: p.hmgYaw, hmgPitch: p.hmgPitch,
      vampireBombs: p.vampireBombs, vampireReturning: p.vampireReturning,
      vampireReloadAt: p.vampireReloadAt, credits: p.credits, unlocked: p.unlocked,
    })),
    serverTime: state.serverTime,
  };
}

/** A room stub just real enough for the real DeltaStream to talk through. */
function makeRoom(clientCount) {
  const clients = new Set();
  for (let i = 0; i < clientCount; i++) clients.add({ sessionId: `bench_${i}` });
  return {
    clients,
    bytes: 0,
    frames: 0,
    send(_client, _type, message) { this.bytes += pack(message).length; this.frames++; return true; },
  };
}


function runEncode() {
  const cfg = {
    enemies: arg('enemies', MAX_ACTIVE_ENEMIES),
    corpses: arg('corpses', 60),
    structures: arg('structures', 26),
    mines: arg('mines', 8),
    drones: arg('drones', 5),
    players: arg('players', 5),
  };
  const ticks = arg('ticks', 40);
  const clientCounts = [1, 4, 6, 10];

  const { state } = buildScenario(cfg);

  console.log(`\nRed Attack network benchmark — encode mode`);
  console.log(`  field: ${cfg.enemies} live enemies, ${cfg.corpses} wrecks, `
    + `${cfg.structures} structures, ${cfg.mines} mines, ${cfg.drones} drones, ${cfg.players} pilots`);
  console.log(`  sampling ${ticks} ticks at ${TICK_HZ} Hz\n`);

  // ── old: the same complete snapshot to everyone, every tick
  const oldBytes = pack(encodeOld(state)).length;
  const oldJson = Buffer.byteLength(JSON.stringify(encodeOld(state)));
  console.log('OLD — full GameState broadcast (identical to every client, every tick)');
  console.log(`  msgpack ${kb(oldBytes)} KB/frame    JSON ${kb(oldJson)} KB/frame`);
  for (const n of clientCounts) {
    const perSec = oldBytes * TICK_HZ * n;
    console.log(`    ${pad(`${n} client${n === 1 ? '' : 's'}`, 12)} ${kbit(perSec)} kbit/s   ${kb(perSec)} KB/s`);
  }

  // ── new: the real DeltaStream, diffed per client
  console.log('\nNEW — per-client delta frames (real DeltaStream from the server build)');
  console.log(`    ${pad('clients', 12)}${pad('avg frame', 12)}${pad('kbit/s', 10)}${pad('KB/s', 10)}vs old`);
  let snapshotBytes = 0;
  const oldFor = (n) => oldBytes * TICK_HZ * n;
  for (const n of clientCounts) {
    const room = makeRoom(n);
    const stream = new DeltaStream(room);
    for (const c of room.clients) stream.add(c);

    // Tick 0 is the one snapshot every fresh client is handed.
    stream.broadcast(state);
    if (n === 1) snapshotBytes = room.bytes;

    room.bytes = 0;
    room.frames = 0;
    for (let t = 0; t < ticks; t++) {
      advance(state, TICK_RATE);
      stream.broadcast(state);
    }
    const avgFrame = room.bytes / Math.max(1, room.frames);
    const perSec = room.bytes / (ticks / TICK_HZ);
    console.log(`    ${pad(`${n} client${n === 1 ? '' : 's'}`, 12)} `
      + `${pad(`${avgFrame.toFixed(0)} B`, 12)}${kbit(perSec)}   ${kb(perSec)}   `
      + `${(oldFor(n) / perSec).toFixed(1)}x smaller`);
  }
  console.log(`\n  first frame for a fresh client: ${kb(snapshotBytes)} KB, then never again`);
  console.log('  wrecks cost nothing once their death has been reported\n');
}

// ─── Live mode: real bots against a running server ────────────────────────────
async function runLive() {
  const { Client } = await import('@colyseus/sdk');
  const urlArgs = process.argv.indexOf('--url');
  const url = urlArgs >= 0 ? process.argv[urlArgs + 1] : 'ws://localhost:2567';
  const count = arg('clients', 4);
  const seconds = arg('seconds', 20);

  console.log(`\nLive benchmark: ${count} bots -> ${url}, sampling ${seconds}s\n`);
  const room = new Client(url);
  const bots = [await room.joinOrCreate('game', { name: 'bench', difficulty: 'hard' })];
  for (let i = 1; i < count; i++) bots.push(await room.joinOrCreate('game', { name: `bench${i}` }));

  const stats = bots.map(() => ({ bytes: 0, frames: 0 }));
  bots.forEach((bot, i) => {
    bot.onMessage('state', (frame) => {
      stats[i].bytes += pack(frame).length;
      stats[i].frames += 1;
    });
  });

  const started = Date.now();
  while (Date.now() - started < seconds * 1000) {
    await new Promise((r) => setTimeout(r, 1000));
    const secs = (Date.now() - started) / 1000;
    const total = stats.reduce((a, s) => a + s.bytes, 0);
    const frames = stats.reduce((a, s) => a + s.frames, 0);
    process.stdout.write(`\r  ${secs.toFixed(0)}s  ${(total * 8 / 1000 / secs).toFixed(2)} kbit/s total`
      + `   avg frame ${Math.round(total / Math.max(1, frames))} B   `);
  }
  console.log('\n');
  for (const b of bots) b.leave();
  const total = stats.reduce((a, s) => a + s.bytes, 0);
  const frames = stats.reduce((a, s) => a + s.frames, 0);
  console.log(`  ${count} clients: ${(total * 8 / 1000 / seconds).toFixed(2)} kbit/s combined, `
    + `${Math.round(frames / count / seconds)} frames/s each\n`);
  process.exit(0);
}

if (mode === 'live') runLive().catch((e) => { console.error(e.message); process.exit(1); });
else runEncode();


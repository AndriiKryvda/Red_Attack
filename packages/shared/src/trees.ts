// ─────────────────────────────────────────────────────────────────────────────
// Deterministic tree scatter shared by the client renderer and the server
// collision layer. Both halves call generateTreeSpots() with the same seed and
// get identical positions, so a quad that looks like it hit a trunk on screen
// detonates on the server too.
// ─────────────────────────────────────────────────────────────────────────────

import { MAP_SIZE, OUTPOST_RADIUS } from './constants.js';
import { villageCorridors } from './structures.js';

/** Seed that produces the one canonical forest layout. */
export const TREE_SEED = 0x5eed1234;

export const TREE_COUNT = 170;
export const TREE_MIN_SPACING = 5.5;               // meters between neighbouring trunks
export const TREE_MARGIN = 14;                     // keep trees inside the ground plane
export const CLEARING_RADIUS = OUTPOST_RADIUS + 6; // never block the fort approach

/**
 * Horizontal collision radius multiplier. A tree's collision cylinder has
 * radius = TREE_COLLISION_RADIUS * scale, so a tree at scale 1.0 has a 1.5 m
 * radius — slightly forgiving compared to the 2.0 m foliage cone.
 */
export const TREE_COLLISION_RADIUS = 1.5;

/** Base tree height in meters before per-tree scaling. */
export const TREE_BASE_HEIGHT = 7;

export interface TreeSpot {
  x: number;
  z: number;
  scale: number;
  rot: number;
}

// Deterministic PRNG (mulberry32): the forest is laid out identically on every
// client and on every reload, so the horizon reads as a real wood instead of
// reshuffling between sessions.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VILLAGE_BLOCKS = villageCorridors();

function inVillage(x: number, z: number): boolean {
  for (const c of VILLAGE_BLOCKS) {
    if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) return true;
  }
  return false;
}

/**
 * Rejection-sampled scatter: random positions, but every trunk keeps a minimum
 * distance from its neighbours so the wood reads as trees instead of noise.
 * Returns exactly TREE_COUNT spots (or fewer if the guard runs out).
 */
export function generateTreeSpots(seed: number = TREE_SEED): TreeSpot[] {
  const rand = mulberry32(seed);
  const half = MAP_SIZE / 2 - TREE_MARGIN;
  const spots: TreeSpot[] = [];
  let guard = TREE_COUNT * 80; // hard stop so a tight packing can never hang
  while (spots.length < TREE_COUNT && guard-- > 0) {
    const x = (rand() * 2 - 1) * half;
    const z = (rand() * 2 - 1) * half;
    if (Math.hypot(x, z) < CLEARING_RADIUS) continue;
    if (inVillage(x, z)) continue;
    let ok = true;
    for (const s of spots) {
      const dx = s.x - x;
      const dz = s.z - z;
      if (dx * dx + dz * dz < TREE_MIN_SPACING * TREE_MIN_SPACING) { ok = false; break; }
    }
    if (!ok) continue;
    spots.push({ x, z, scale: 0.6 + rand() * 0.95, rot: rand() * Math.PI * 2 });
  }
  return spots;
}

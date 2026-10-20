import { FORT_PERIMETER } from './constants.js';
import { Vec3 } from './types.js';

// ─── The mine field ────────────────────────────────────────
// The armory's one consumable: pay the fort's sappers and they ring the fort with
// anti-personnel mines. There is no station to man and no key to fire — the mines go
// into the dirt where they were paid for and wait. The horde walks in straight lines
// from the village to the fort, so a ring of mines catches every approach direction,
// and a mine that is walked over is spent: a field thins out over a run and buying
// another ring simply fills the holes back in.
//
// Six rings rather than one, so the field has depth: the horde crosses a mine every
// couple of metres over the last 26 m of its approach, from the stragglers still short
// of the wire to the ones at the fence. Every ring sits inside the mortar's minimum
// range, so the mines never occupy ground a shell is already committed to landing on.

/** Mines one purchase lays around the fort. */
export const MINEFIELD_MINES = 120;
/**
 * Rings the field is spread over between the inner and outer radius. Six rings across a
 * 10 m band puts a mine every 2 m on the way in, which is what makes the field a belt
 * rather than a line.
 */
export const MINEFIELD_RINGS = 6;
/**
 * Mines on one ring. The field divides evenly on purpose: a ragged last ring would
 * leave a gap in the belt the size of whatever was left over.
 */
export const MINEFIELD_PER_RING = MINEFIELD_MINES / MINEFIELD_RINGS;
/**
 * The inner ring, meters from the fort centre. It clears the fence line and the four
 * gun nests on the berm crest, so a mine never sits under a gunner's feet.
 */
export const MINEFIELD_INNER_RING = FORT_PERIMETER + 3.5;
/**
 * The outer ring, meters from the fort centre. It stays inside MORTAR_MIN_RANGE (30 m)
 * so the tube and the mine field never work the same ground.
 */
export const MINEFIELD_OUTER_RING = 26;
/**
 * Half a step along a ring, in radians. Alternate rings are turned by this much, so no
 * mine sits on a due-axis approach and neighbouring rings interlock instead of lining up
 * into lanes the horde could walk between.
 */
export const MINEFIELD_ANGLE_OFFSET = Math.PI / MINEFIELD_PER_RING;
/** A mine goes off when anything comes within this many metres of it. */
export const MINE_TRIGGER_RADIUS = 2.5;
/**
 * Seconds between a mine hitting the dirt and it being live. The crew has to put them
 * down and clear the field, and it stops a field bought with enemies already standing
 * on the spots from setting the whole field off at once.
 */
export const MINEFIELD_ARM_TIME = 1;
/**
 * Damage a mine deals inside its blast, before armour. The same figure a mortar shell
 * carries, so a mine kills anything the horde sends — the tank included — which is the
 * point of a buried charge rather than a gun.
 */
export const MINE_DAMAGE = 6;
/** Blast radius of one mine, meters — a footprint a little under a mini-bomb's. */
export const MINE_BLAST_RADIUS = 6;
/** Visual size of a mine blast relative to a drone detonation. */
export const MINE_BLAST_SCALE = 0.9;

/**
 * The spots one field occupies, ring by ring from the inner radius outward, each ring
 * evenly spaced and every other one turned half a step so the rings interlock. Shared
 * because the server owns the layout: it puts the mines where this says and the client
 * only draws what comes back.
 */
export function mineFieldSpots(cx = 0, cz = 0): Vec3[] {
  const spots: Vec3[] = [];
  const spread = (MINEFIELD_OUTER_RING - MINEFIELD_INNER_RING) / (MINEFIELD_RINGS - 1);
  for (let ring = 0; ring < MINEFIELD_RINGS; ring++) {
    const r = MINEFIELD_INNER_RING + ring * spread;
    const offset = ring % 2 === 0 ? MINEFIELD_ANGLE_OFFSET : 0;
    for (let i = 0; i < MINEFIELD_PER_RING; i++) {
      const a = (i / MINEFIELD_PER_RING) * Math.PI * 2 + offset;
      spots.push({ x: cx + Math.cos(a) * r, y: 0, z: cz + Math.sin(a) * r });
    }
  }
  return spots;
}
import { FORT_PERIMETER } from './constants.js';
import { WeaponType } from './mortar.js';

// ─── Heavy machine guns ────────────────────────────────────
// Four heavy machine guns sit on the crest of the four faces of the berm. They are
// the fort's close defence: a pilot mans one, traverses it along its own wall and
// holds the trigger down while the belt runs out. Where the mortar owns the middle
// of the field and the quad owns the border, an HMG owns the last hundred metres of
// dirt in front of its own face - and it owns nothing else.

/** Rounds in one belt. Firing stops when it runs out and the crew swaps the can. */
export const HMG_BELT_SIZE = 120;
/**
 * Seconds without firing that put a full belt back in the gun.
 *
 * One rule covers both cases the crew cares about: a belt fired empty is being
 * replaced for this long, and a gun you walked away from is full again by the time
 * anybody thinks about using it. Switching weapons needs no special case.
 */
export const HMG_RELOAD_TIME = 10;
/** Cyclic rate: 600 rounds a minute, so a whole belt is twelve seconds of firing. */
export const HMG_ROUNDS_PER_SEC = 10;
/**
 * Damage one round deals, before the target's armour multiplies it the way every
 * other weapon in the game does. A round is much lighter than a drone: a soldier
 * takes two of them, a bear takes ten, which is what makes holding a gun on a
 * charging bear feel like work.
 */
export const HMG_DAMAGE = 0.5;
/**
 * Furthest a round is worth anything, from the muzzle. The village stands 126 m out
 * with the cars parked in front of it, so a gun laid on the horizon cannot be used
 * as artillery against the scenery - it defends the wall and nothing beyond it.
 */
export const HMG_MAX_RANGE = 70;
/** Half-angle of the cone a burst sprays, in radians (~0.7 degrees). */
export const HMG_SPREAD = 0.012;
/**
 * The gun is on a pintle with the berm under it: it can look down at the wire and
 * up over the crest, and that is the whole of its elevation.
 */
export const HMG_PITCH_MIN = (-35 * Math.PI) / 180;
export const HMG_PITCH_MAX = (8 * Math.PI) / 180;
/** Height of the trunnion above the ground: berm crest, deck plate, pedestal. */
export const HMG_MUZZLE_Y = 3.64;
/** How far the muzzle sits in front of the nest centre, along the lay. */
export const HMG_MUZZLE_OUT = 1.6;
/** The gunner stands behind the spade grips, not inside the gun. */
export const HMG_SEAT_BACK = 0.75;
export const HMG_SEAT_Y = 4.1;
/** A gun whose pilot stopped sending aim stops firing after this many seconds. */
export const HMG_INPUT_TIMEOUT = 0.6;

/** Where one gun stands, and the yaw it was built facing. */
export interface HmgNest {
  x: number;
  z: number;
  /** Built-in facing: local +Z of the gun, in the same yaw convention as the aim. */
  yaw: number;
  label: string;
}

/**
 * The four nests, clockwise from the north face, in the order the HUD numbers them
 * 3, 4, 5, 6. The south gun stands west of the gate because the gap a vehicle drives
 * through is in the middle of that face.
 */
export const HMG_NESTS: HmgNest[] = [
  { x: 0, z: -FORT_PERIMETER, yaw: Math.PI + 0.16, label: 'HMG NORTH' },
  { x: FORT_PERIMETER, z: 0, yaw: Math.PI / 2 - 0.1, label: 'HMG EAST' },
  { x: -6.5, z: FORT_PERIMETER, yaw: 0.12, label: 'HMG SOUTH' },
  { x: -FORT_PERIMETER, z: 0, yaw: -Math.PI / 2 + 0.08, label: 'HMG WEST' },
];

/** The weapon each nest is selected with, index for index with HMG_NESTS. */
export const HMG_WEAPONS: WeaponType[] = [
  WeaponType.HMG_1, WeaponType.HMG_2, WeaponType.HMG_3, WeaponType.HMG_4,
];

/** Which nest a weapon mans, or -1 when the weapon is not a machine gun. */
export function hmgGunOf(weapon: WeaponType | undefined): number {
  if (!weapon) return -1;
  return HMG_WEAPONS.indexOf(weapon);
}

/** Keep a requested elevation inside what the pintle allows. */
export function clampHmgPitch(pitch: number): number {
  if (!(pitch === pitch)) return 0;   // NaN guard
  return Math.min(HMG_PITCH_MAX, Math.max(HMG_PITCH_MIN, pitch));
}

/** Unit vector a gun laid at `yaw`/`pitch` points along. */
export function hmgDirection(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const p = clampHmgPitch(pitch);
  const cp = Math.cos(p);
  return { x: Math.sin(yaw) * cp, y: Math.sin(p), z: Math.cos(yaw) * cp };
}

/** World position of one gun's muzzle, laid the way the gun is laid. */
export function hmgMuzzle(gun: number, yaw: number, pitch: number): { x: number; y: number; z: number } {
  const nest = HMG_NESTS[gun] ?? HMG_NESTS[0];
  const d = hmgDirection(yaw, pitch);
  return {
    x: nest.x + d.x * HMG_MUZZLE_OUT,
    y: HMG_MUZZLE_Y + d.y * HMG_MUZZLE_OUT,
    z: nest.z + d.z * HMG_MUZZLE_OUT,
  };
}

/** Where the gunner's eye sits behind a gun laid at `yaw`. */
export function hmgSeat(gun: number, yaw: number): { x: number; y: number; z: number } {
  const nest = HMG_NESTS[gun] ?? HMG_NESTS[0];
  return {
    x: nest.x - Math.sin(yaw) * HMG_SEAT_BACK,
    y: HMG_SEAT_Y,
    z: nest.z - Math.cos(yaw) * HMG_SEAT_BACK,
  };
}

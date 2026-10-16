import {
  MORTAR_ELEVATION,
  MORTAR_GRAVITY,
  MORTAR_MAX_RANGE,
  MORTAR_MIN_RANGE,
  MORTAR_POSITION,
} from './constants.js';

// ─── Weapons ───────────────────────────────────────────────
// The fort fields six stations and a pilot mans one of them at a time: the
// long-ranged FPV quad you fly yourself, a tube mortar laid on the courtyard pad
// that lobs shells across the middle of the field, and the four heavy machine guns
// bolted to the crest of the berm - one per face, numbered clockwise from the north.
export enum WeaponType {
  FPV = 'fpv',
  MORTAR = 'mortar',
  HMG_1 = 'hmg1',
  HMG_2 = 'hmg2',
  HMG_3 = 'hmg3',
  HMG_4 = 'hmg4',
}

/** Labels the HUD prints next to each weapon slot. */
export const WEAPON_LABELS: Record<WeaponType, string> = {
  [WeaponType.FPV]: 'FPV DRONE',
  [WeaponType.MORTAR]: 'MORTAR',
  [WeaponType.HMG_1]: 'HMG · NORTH FACE',
  [WeaponType.HMG_2]: 'HMG · EAST FACE',
  [WeaponType.HMG_3]: 'HMG · SOUTH FACE',
  [WeaponType.HMG_4]: 'HMG · WEST FACE',
};

// ─── Mortar ballistics ─────────────────────────────────────
/**
 * Pull a requested aim point back inside the ring of fire. The mortar covers the
 * middle ground only: too close and the shell would fall onto our own walls, too
 * far and it would sail past the map border the horde walks in from. Clamping
 * instead of refusing means a click beyond the horizon still lands a shell at the
 * furthest reachable line rather than doing nothing at all.
 */
export function clampMortarTarget(
  targetX: number,
  targetZ: number,
): { x: number; z: number; range: number } {
  const dx = targetX - MORTAR_POSITION.x;
  const dz = targetZ - MORTAR_POSITION.z;
  const d = Math.hypot(dx, dz);
  if (!(d > 0.001)) {
    return { x: MORTAR_POSITION.x + MORTAR_MIN_RANGE, z: MORTAR_POSITION.z, range: MORTAR_MIN_RANGE };
  }
  const range = Math.min(MORTAR_MAX_RANGE, Math.max(MORTAR_MIN_RANGE, d));
  const k = range / d;
  return { x: MORTAR_POSITION.x + dx * k, z: MORTAR_POSITION.z + dz * k, range };
}

/** One shell: the launch vector plus the point it is committed to landing on. */
export interface MortarShot {
  vx: number;
  vy: number;
  vz: number;
  /** Seconds from the muzzle down to the ground. */
  flight: number;
  impactX: number;
  impactZ: number;
  /** Top of the arc, meters above the ground. */
  apex: number;
}

/**
 * Closed-form ballistics at the standing elevation. The server resolves hits with
 * this and the client draws its aiming arc with it, so the dotted line a pilot
 * aims along is exactly the path the server later detonates on.
 *
 * Position at time t is `origin + v * t` with `y -= g * t * t / 2`; keeping it in
 * closed form (instead of integrating) is what lets both sides agree to the
 * centimetre without exchanging per-frame shell updates.
 */
export function mortarBallistics(
  originX: number,
  originY: number,
  originZ: number,
  targetX: number,
  targetZ: number,
): MortarShot {
  const dx = targetX - originX;
  const dz = targetZ - originZ;
  const d = Math.max(1, Math.hypot(dx, dz));
  const speed = Math.sqrt((MORTAR_GRAVITY * d) / Math.sin(2 * MORTAR_ELEVATION));
  const vh = speed * Math.cos(MORTAR_ELEVATION);
  const vy = speed * Math.sin(MORTAR_ELEVATION);
  // Fall back down to ground level from a muzzle that already sits originY up.
  const flight = (vy + Math.sqrt(vy * vy + 2 * MORTAR_GRAVITY * Math.max(0, originY))) / MORTAR_GRAVITY;
  const ux = dx / d;
  const uz = dz / d;
  return {
    vx: ux * vh,
    vy,
    vz: uz * vh,
    flight,
    impactX: originX + ux * vh * flight,
    impactZ: originZ + uz * vh * flight,
    apex: originY + (vy * vy) / (2 * MORTAR_GRAVITY),
  };
}

/** Height of a shell `t` seconds after it left the muzzle. */
export function mortarShellHeight(originY: number, vy: number, t: number): number {
  return originY + vy * t - 0.5 * MORTAR_GRAVITY * t * t;
}

/** Horizontal distance a shell has covered `t` seconds after the shot. */
export function mortarShellDistance(v: { x: number; z: number }, t: number): number {
  return Math.hypot(v.x, v.z) * t;
}

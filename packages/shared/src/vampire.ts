import { MORTAR_GRAVITY } from './constants.js';

// ─── Vampire drone-bomber ──────────────────────────────────
// The Vampire is a pilot-flown bomber: a heavier craft that carries a small stack
// of mini-bombs under its belly instead of a single shaped charge. Like the kamikaze
// FPV it is flown with the same stick — W/S push it forward or back, A/D and the mouse
// turn it — and it climbs and descends on the same keys (Space up, Shift down). The one
// difference is that it works a band of altitudes rather than the whole sky: the pilot
// flies it between a low ceiling and a high one (see VAMPIRE_MIN/MAX_ALTITUDE), staying
// above the rooftops at the bottom and under the cap at the top, then releases its bombs
// over the village. Once the stack is empty it flies itself home, hovers over the pad
// while the crew re-arms it, and hands the controls back for the next run — so one
// sortie is a loop of drop, drop, drop, home, re-arm, out again.

/** Mini-bombs the Vampire carries on a sortie. */
export const VAMPIRE_BOMB_CAPACITY = 5;
/**
 * The floor of the band the bomber is flown in, meters. It sits above the tallest
 * building (water tower, 15 m) and the tallest tree (~11 m) on the map, so even at
 * the bottom of its band a Vampire never clips a rooftop or treetop.
 */
export const VAMPIRE_MIN_ALTITUDE = 20;
/**
 * The ceiling of the band the bomber is flown in, meters. The pilot climbs toward it
 * with `Space` and sinks back to the floor with `Shift`; the server clamps the aircraft
 * between the two so it stays in play and on camera.
 */
export const VAMPIRE_MAX_ALTITUDE = 80;
/**
 * Vertical speed the bomber climbs or descends at, m/s, when the pilot holds `Space`
 * or `Shift`. A touch sedate for a heavy aircraft — it flies faster than it climbs.
 */
export const VAMPIRE_CLIMB_RATE = 10;
/**
 * Altitude in meters below which the crew refuses to release a bomb. The bomber now
 * always flies above the band floor, which is already above this line, so it is a
 * safety floor rather than a limit the pilot has to climb to: a bomb let go too low
 * has no time to spread its blast.
 */
export const VAMPIRE_MIN_DROP_ALTITUDE = 12;
/** Seconds the release must wait between two bombs, so a stack cannot be dumped at once. */
export const VAMPIRE_DROP_INTERVAL = 0.6;
/** Seconds on the pad to re-arm an empty Vampire back to a full stack. */
export const VAMPIRE_RELOAD_TIME = 6;
/** Cruise speed of the bomber, m/s — a touch slower than the nimble FPV. */
export const VAMPIRE_SPEED = 13;
/** Altitude the empty bomber holds on its autopilot trip home, meters. */
export const VAMPIRE_CRUISE_ALTITUDE = VAMPIRE_MIN_ALTITUDE;
/** Altitude the bomber lifts off to and settles back onto the pad at to re-arm, meters. */
export const VAMPIRE_LAUNCH_ALTITUDE = VAMPIRE_MIN_ALTITUDE;
/** Damage one mini-bomb deals to everything inside its blast. */
export const VAMPIRE_BOMB_DAMAGE = 3;
/** Blast radius of a mini-bomb, meters — a footprint between a quad and a shell. */
export const VAMPIRE_BOMB_RADIUS = 5;
/** Visual size of a mini-bomb blast relative to a drone detonation. */
export const VAMPIRE_BOMB_BLAST_SCALE = 1.2;
/** The pad the empty bomber returns to for its next load, on the fort courtyard. */
export const VAMPIRE_BASE = { x: 0, z: 0 };
/** How close to the pad centre counts as "arrived home", meters. */
export const VAMPIRE_BASE_RADIUS = 6;
/**
 * How fast a released mini-bomb falls. It shares the mortar's exaggerated gravity
 * so a dropped bomb reads on screen the way a shell does, rather than drifting down
 * in slow real-world free fall.
 */
export const VAMPIRE_BOMB_GRAVITY = MORTAR_GRAVITY;

/**
 * Seconds a mini-bomb takes to reach the ground once released. The bomb keeps the
 * aircraft's horizontal velocity but starts with no vertical velocity of its own, so
 * it simply falls from `altitude` under `VAMPIRE_BOMB_GRAVITY`. Closed form (rather
 * than integrated tick by tick) so the server and the client agree on the impact to
 * the centimetre, exactly like the mortar's shells.
 */
export function vampireBombFlight(altitude: number): number {
  const h = Math.max(0, altitude);
  return Math.sqrt((2 * h) / VAMPIRE_BOMB_GRAVITY);
}

/** Height of a released bomb `t` seconds after it left the aircraft. */
export function vampireBombHeight(altitude: number, t: number): number {
  return altitude - 0.5 * VAMPIRE_BOMB_GRAVITY * t * t;
}

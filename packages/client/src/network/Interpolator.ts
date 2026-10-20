/**
 * ─── Snapshot-buffer interpolation ────────────────────────────────────────────
 *
 * The server ticks at 20 Hz and the browser paints at 60, so a mesh handed the
 * raw server position visibly steps three frames at a time. This buffers each
 * moving entity's last few server positions and, at paint time, places it where
 * it would have been a moment ago — a fixed slice of the past, chosen so there is
 * always a pair of samples on either side of it even when a frame arrives late.
 *
 * That slice is the price of smoothness and it is small: one or two tick
 * intervals. It is also why the local pilot's own aircraft gets a shorter one —
 * a camera that lags the stick is far more noticeable than a tank that arrives
 * fifty milliseconds late.
 *
 * Tracks are fixed-size rings of typed arrays, so a busy field neither allocates
 * nor churns garbage on the way to the GPU.
 */
import type { Vec3 } from '@red-attack/shared';

/** Samples kept per entity. Eight is 400 ms of history at 20 Hz — plenty of slack. */
const SLOTS = 8;

interface Track {
  t: Float64Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** Index of the newest sample. */
  head: number;
  /** Samples written so far, capped at SLOTS. */
  count: number;
}

function makeTrack(): Track {
  return {
    t: new Float64Array(SLOTS), x: new Float32Array(SLOTS),
    y: new Float32Array(SLOTS), z: new Float32Array(SLOTS),
    head: 0, count: 0,
  };
}

/** Anything with an id and a position — enemies, drones, mini-bombs. */
export interface Smoothed { id: string; position: Vec3 }

export class Interpolator {
  private tracks = new Map<string, Track>();
  /** Newest server timestamp seen; everything is measured back from it. */
  private newest = 0;
  /**
   * How far behind the server we render. Two ticks absorbs jitter without the
   * pilot noticing; the aircraft they are flying gets one, because control feel
   * is worth more than a perfectly smooth bomber.
   */
  constructor(
    private readonly delayMs: number = 100,
    private readonly ownDelayMs: number = 50,
  ) {}

  /** Announce the clock the samples about to be recorded were taken at. */
  note(serverTime: number): void {
    this.newest = serverTime;
  }

  /** Store where an entity actually was, at the time given to the last `note`. */
  record(id: string, x: number, y: number, z: number): void {
    let tr = this.tracks.get(id);
    if (tr === undefined) {
      tr = makeTrack();
      this.tracks.set(id, tr);
    }
    tr.head = (tr.head + 1) % SLOTS;
    if (tr.count < SLOTS) tr.count++;
    tr.t[tr.head] = this.newest;
    tr.x[tr.head] = x;
    tr.y[tr.head] = y;
    tr.z[tr.head] = z;
  }

  /** Stop tracking something that left the field, so the map does not grow forever. */
  forget(id: string): void { this.tracks.delete(id); }

  clear(): void { this.tracks.clear(); }

  /**
   * Overwrite each entity's position with where it should be drawn. Entities with
   * only one sample yet are left exactly where the server put them.
   */
  smooth(entities: Map<string, Smoothed>, serverTime: number, ownId?: string | null): void {
    if (this.tracks.size === 0) return;
    this.newest = serverTime;
    for (const entity of entities.values()) {
      const tr = this.tracks.get(entity.id);
      if (tr === undefined || tr.count < 2) continue;
      const delay = ownId !== null && entity.id === ownId ? this.ownDelayMs : this.delayMs;
      // Never look further ahead than this entity's own newest sample: something
      // that has stopped moving stops being re-sent, and interpolating against its
      // last position is exactly right, whereas reaching past it would drag the
      // entity back to wherever it was before it stopped.
      const renderAt = Math.min(serverTime - delay, tr.t[tr.head]);

      // `b` ends up the newest sample at or after the render time, `a` the one
      // immediately before it, and the two bracket the moment we are drawing.
      let b = tr.head;
      for (let i = 1; i < tr.count; i++) {
        const prev = (b - 1 + SLOTS) % SLOTS;
        if (tr.t[prev] >= renderAt) b = prev; else break;
      }
      const a = (b - 1 + SLOTS) % SLOTS;
      const span = tr.t[b] - tr.t[a];
      // Clamped, never extrapolated: overshooting a stop or a turn looks worse than
      // holding still for one tick while the next sample arrives. A negative span
      // means the render time predates the whole buffer, and `f` of 1 picks the oldest.
      const f = span > 0 ? Math.min(1, Math.max(0, (renderAt - tr.t[a]) / span)) : 1;
      entity.position.x = tr.x[a] + (tr.x[b] - tr.x[a]) * f;
      entity.position.y = tr.y[a] + (tr.y[b] - tr.y[a]) * f;
      entity.position.z = tr.z[a] + (tr.z[b] - tr.z[a]) * f;
    }
  }
}

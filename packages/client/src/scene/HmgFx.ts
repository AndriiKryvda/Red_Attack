import * as THREE from 'three';
import { HmgShotEvent } from '@red-attack/shared';

/** Rounds drawn at once. A belt is ten a second, so this is several guns at once. */
const TRACER_POOL = 48;
/** Metres of glowing streak left behind the travelling round. */
const TRACER_TAIL = 7;
/**
 * Metres a second the streak is drawn at. A real round is far faster than this, but
 * a tracer that crosses the field in one frame is a flicker instead of a line, and
 * the whole point of drawing it is to show where the burst is walking.
 */
const TRACER_SPEED = 200;
/** Seconds the streak hangs in the air once the round has flown out. */
const TRACER_STAIN = 0.06;
/** Impact flashes drawn at once, and how long each one lasts. */
const SPARK_POOL = 24;
const SPARK_LIFE = 0.16;
/** The most kick the camera will take at any one moment, in metres. */
const SHAKE_MAX = 0.14;

/** A round currently crossing the field. */
interface Tracer {
  slot: number;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  /** Metres to fly before it is done: the server already decided how far it counted. */
  range: number;
  hit: boolean;
  t: number;
  life: number;
}

/** A flash where a round found something. */
interface Spark {
  mesh: THREE.Mesh;
  t: number;
  life: number;
}

/** A small puff of dust, handed to the scene's effects layer. */
export type ImpactPuff = (x: number, y: number, z: number, color: number) => void;

/**
 * What a burst looks like: a tracer out to wherever the server said the round was
 * worth, a flash where it landed, and a little kick in the camera while the belt is
 * running.
 *
 * The server already resolved every round, so nothing here is computed twice - each
 * event carries the muzzle, the direction with its spread already in it, and the
 * distance the round flew. Clients only draw what they were told.
 */
export class HmgFx {
  private readonly lines: THREE.LineSegments;
  private readonly positions: THREE.BufferAttribute;
  private readonly colors: THREE.BufferAttribute;
  private readonly sparks: Spark[] = [];
  private readonly free: number[] = [];
  private readonly active: Tracer[] = [];
  private readonly puff: ImpactPuff;
  private shake: number = 0;

  constructor(scene: THREE.Scene, puff: ImpactPuff) {
    this.puff = puff;

    // One draw call for every tracer in the game: a pool of two-vertex segments
    // whose colour is the fade, so an unused slot is simply black and additive
    // blending throws it away.
    this.positions = new THREE.BufferAttribute(new Float32Array(TRACER_POOL * 2 * 3), 3);
    this.colors = new THREE.BufferAttribute(new Float32Array(TRACER_POOL * 2 * 3), 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', this.positions);
    geo.setAttribute('color', this.colors);
    this.lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.lines.frustumCulled = false;
    scene.add(this.lines);

    for (let i = TRACER_POOL - 1; i >= 0; i--) this.free.push(i);
  }

  /** One round the server already fired. */
  spawnShot(ev: HmgShotEvent) {
    const slot = this.free.pop();
    if (slot === undefined) return;
    const from = new THREE.Vector3(ev.origin.x, ev.origin.y, ev.origin.z);
    const dir = new THREE.Vector3(ev.dir.x, ev.dir.y, ev.dir.z).normalize();
    const range = Math.max(1, ev.range);
    this.active.push({
      slot, from, dir, range, hit: ev.hit, t: 0,
      life: range / TRACER_SPEED + TRACER_STAIN,
    });
  }

  /** Add camera kick, clamped so a full belt shakes without being sickening. */
  addShake(amount: number) {
    this.shake = Math.min(SHAKE_MAX, this.shake + amount);
  }

  /**
   * Random offset the camera should take this frame from the kick of the gun, or
   * zero when the gun is quiet. Applied to both the eye and what it looks at, so
   * the view shakes rather than the camera merely sliding sideways.
   */
  shakeOffset(out: THREE.Vector3) {
    if (this.shake <= 0) return out.set(0, 0, 0);
    const s = this.shake;
    return out.set(
      (Math.random() * 2 - 1) * s,
      (Math.random() * 2 - 1) * s * 0.7,
      (Math.random() * 2 - 1) * s,
    );
  }

  update(dt: number) {
    this.shake = Math.max(0, this.shake - dt * 0.9);

    // Clear every slot first: a slot that went unused this frame must not keep the
    // streak it drew last frame.
    const pos = this.positions.array as Float32Array;
    const col = this.colors.array as Float32Array;
    col.fill(0);

    for (let i = this.active.length - 1; i >= 0; i--) {
      const tr = this.active[i];
      tr.t += dt;
      const head = Math.min(tr.range, TRACER_SPEED * tr.t);
      const tail = Math.max(0, head - TRACER_TAIL);

      if (tr.t >= tr.life) {
        this.impact(tr);
        this.free.push(tr.slot);
        this.active.splice(i, 1);
        continue;
      }

      const fade = tr.t > tr.life - TRACER_STAIN ? (tr.life - tr.t) / TRACER_STAIN : 1;
      const a = (tr.slot * 2) * 3;
      const b = a + 3;
      pos[a] = tr.from.x + tr.dir.x * tail;
      pos[a + 1] = tr.from.y + tr.dir.y * tail;
      pos[a + 2] = tr.from.z + tr.dir.z * tail;
      pos[b] = tr.from.x + tr.dir.x * head;
      pos[b + 1] = tr.from.y + tr.dir.y * head;
      pos[b + 2] = tr.from.z + tr.dir.z * head;
      // Hot at the round, cooling along the tail.
      col[a] = 0.55 * fade; col[a + 1] = 0.3 * fade; col[a + 2] = 0.08 * fade;
      col[b] = 1.5 * fade; col[b + 1] = 1.05 * fade; col[b + 2] = 0.55 * fade;
    }
    this.positions.needsUpdate = true;
    this.colors.needsUpdate = true;

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.t += dt;
      if (s.t >= s.life) {
        s.mesh.visible = false;
        this.sparks.splice(i, 1);
        continue;
      }
      const k = s.t / s.life;
      s.mesh.scale.setScalar(0.35 + k * 1.5);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
    }
  }

  /** Where a round finished, and what it threw up when it got there. */
  private impact(tr: Tracer) {
    const x = tr.from.x + tr.dir.x * tr.range;
    const y = tr.from.y + tr.dir.y * tr.range;
    const z = tr.from.z + tr.dir.z * tr.range;
    this.spawnSpark(x, y, z, tr.hit ? 0xff6a3d : 0xd8c9a4);
    // A round into the dirt kicks up dust; one into a body does not.
    if (!tr.hit) this.puff(x, y + 0.1, z, 0xb9b09a);
  }

  /**
   * Reuse whichever flash is furthest through its own fade, so a belt does not
   * allocate a mesh per round.
   */
  private spawnSpark(x: number, y: number, z: number, color: number) {
    let s = this.sparks.find(sp => sp.t > sp.life * 0.6);
    if (!s) {
      if (this.sparks.length >= SPARK_POOL) return;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 8, 6),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      mesh.visible = false;
      this.lines.parent!.add(mesh);
      s = { mesh, t: 0, life: SPARK_LIFE };
      this.sparks.push(s);
    }
    s.mesh.position.set(x, y, z);
    s.mesh.visible = true;
    (s.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    s.t = 0;
    s.life = SPARK_LIFE;
  }
}

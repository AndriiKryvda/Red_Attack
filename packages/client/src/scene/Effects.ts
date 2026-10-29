import * as THREE from 'three';
import { ENEMY_STATS, EnemyType } from '@red-attack/shared';
import { createGolfCartWreck, createMotorcyclistWreck, createTankWreck } from './VehicleModels';

type ParticleShape = 'box' | 'sphere';

interface Particle {
  mesh: THREE.Mesh;
  // Velocity kept as plain numbers, not a Vector3, so a busy field neither
  // allocates a vector per particle at spawn nor clones one every frame.
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  gravity: number;     // downward accel (negative = rises, e.g. smoke)
  grow: number;        // >0 = scale up over life (fireball/smoke); 0 = shrink
  baseOpacity: number;
  /** Base edge/radius; the shared unit geometry is scaled to this. */
  baseSize: number;
  /** Which pooled geometry this mesh reuses, so it returns to the right pool. */
  shape: ParticleShape;
}

/**
 * A destroyed vehicle left burning on the field. Particles cannot do this — they
 * are gone in a second. A wreck is a real group of meshes standing where the
 * vehicle died: it throws flame for a quarter of a minute, settles to smoke,
 * then fades out and is disposed of, so a long run never buries the map.
 */
interface Wreck {
  group: THREE.Group;
  /** Scorched metal that glows while the fire is alive (never the scorch mark). */
  hotMats: THREE.MeshStandardMaterial[];
  /** Every material of the pile, used for the fade-out at the end of its life. */
  allMats: THREE.Material[];
  /** World-space hot spots the flames come out of, so the whole pile flickers. */
  vents: THREE.Vector3[];
  life: number;
  nextEmit: number;
  /** Random offset so a row of wrecks does not flicker in lockstep. */
  phase: number;
}

/** At most this many wrecks burn at once; the oldest is cleared to make room. */
const MAX_WRECKS = 12;
/** Seconds of open flame before a wreck settles to smoke only. */
const WRECK_BURN = 14;
/** Seconds a wreck stays on the field before it is cleared for good. */
const WRECK_LIFE = 55;
/** Seconds of fade-out at the end of that, so nothing pops out of existence. */
const WRECK_FADE = 4;

export class EffectsManager {
  private scene: THREE.Scene;
  private particles: Particle[] = [];
  private wrecks: Wreck[] = [];

  /**
   * Every particle is one of two shared unit shapes scaled to size, so a burst
   * uploads its geometry once instead of once per spark. Spent meshes are parked
   * in a per-shape pool and reused, which keeps a busy field off the allocation
   * path entirely — no geometry or material is built or disposed per particle.
   */
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly unitSphere = new THREE.SphereGeometry(1, 8, 6);
  private readonly boxPool: THREE.Mesh[] = [];
  private readonly spherePool: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Take a ready-made particle mesh of the given shape, building one only if the pool is dry. */
  private acquire(shape: ParticleShape): THREE.Mesh {
    const pool = shape === 'box' ? this.boxPool : this.spherePool;
    const mesh = pool.pop();
    if (mesh) {
      mesh.visible = true;
      this.scene.add(mesh);
      return mesh;
    }
    const geo = shape === 'box' ? this.unitBox : this.unitSphere;
    const fresh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true }));
    this.scene.add(fresh);
    return fresh;
  }

  /** Park a spent particle mesh for reuse rather than disposing its buffers. */
  private release(p: Particle): void {
    this.scene.remove(p.mesh);
    p.mesh.visible = false;
    (p.shape === 'box' ? this.boxPool : this.spherePool).push(p.mesh);
  }

  /**
   * Launch one particle from the pool. Centralising the spawn keeps every burst
   * allocation-free: the mesh, its geometry and its material all come from the pool.
   */
  private emit(
    shape: ParticleShape, x: number, y: number, z: number, size: number,
    color: number, opacity: number,
    vx: number, vy: number, vz: number,
    maxLife: number, gravity: number, grow: number,
  ): void {
    const mesh = this.acquire(shape);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(size);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(color);
    mat.opacity = opacity;
    this.particles.push({
      mesh, vx, vy, vz, life: 0, maxLife, gravity, grow,
      baseOpacity: opacity, baseSize: size, shape,
    });
  }

  /** `scale` grows the whole burst: a mortar shell is a bigger affair than a quad. */
  spawnExplosion(x: number, y: number, z: number, scale = 1) {
    for (let i = 0; i < 30; i++) {
      const size = (0.2 + Math.random() * 0.4) * scale;
      const color = Math.random() > 0.5 ? 0xff4400 : (Math.random() > 0.5 ? 0xffaa00 : 0xff0000);
      this.emit(
        'box', x, y, z, size, color, 1,
        (Math.random() - 0.5) * 12 * scale, Math.random() * 8 * scale, (Math.random() - 0.5) * 12 * scale,
        0.8 + Math.random() * 0.5, 15, 0,
      );
    }
    // Flash sphere.
    this.emit('sphere', x, y, z, 2 * scale, 0xffff00, 0.8, 0, 0, 0, 0.3, 0, 2);
  }

  // Lingering crash effect (~5s): bright fireball + rising smoke column + embers.
  // Used by the crash-cam so the explosion stays visible before switching back.
  spawnCrash(x: number, y: number, z: number) {
    // Embers (short-lived hot debris)
    for (let i = 0; i < 24; i++) {
      const size = 0.15 + Math.random() * 0.3;
      const color = Math.random() > 0.5 ? 0xff6a00 : 0xffaa00;
      this.emit(
        'box', x, y, z, size, color, 1,
        (Math.random() - 0.5) * 10, Math.random() * 9, (Math.random() - 0.5) * 10,
        0.9 + Math.random() * 0.6, 15, 0,
      );
    }

    // Fireball (grows then fades ~1.4s)
    this.emit('sphere', x, y, z, 1.4, 0xff6a00, 0.9, 0, 1, 0, 1.4, 0, 3);

    // Smoke column (rises and lingers ~4-5s)
    for (let i = 0; i < 16; i++) {
      const s = 0.6 + Math.random() * 0.9;
      this.emit(
        'sphere',
        x + (Math.random() - 0.5) * 1.6, y, z + (Math.random() - 0.5) * 1.6,
        s, 0x44403c, 0.55,
        (Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 0.9, (Math.random() - 0.5) * 0.6,
        4 + Math.random(), -1, 1.6,
      );
    }
  }

  // Short-lived coloured puff dropped behind a remote drone so its flight path
  // is easy to follow across the sky.
  spawnTrailPuff(x: number, y: number, z: number, color: number) {
    const size = 0.6 + Math.random() * 0.5;
    this.emit(
      'sphere', x, y, z, size, color, 0.6,
      (Math.random() - 0.5) * 0.8, -0.2, (Math.random() - 0.5) * 0.8,
      1.4 + Math.random() * 0.6, 0.6, 2.2,
    );
  }

  /**
   * One puff of an ongoing fire: a flame tongue licking up off the wreck or the
   * roof of a burning building plus the odd ball of black smoke. Called over and
   * over while something burns, so it stays deliberately cheap. `scale` sizes the
   * flame — a house fire is bigger than a car fire.
   */
  spawnFirePuff(x: number, y: number, z: number, scale = 1) {
    this.emit(
      'sphere',
      x + (Math.random() - 0.5) * 0.6 * scale, y, z + (Math.random() - 0.5) * 0.6 * scale,
      (0.2 + Math.random() * 0.25) * scale, Math.random() > 0.45 ? 0xff7a1a : 0xffc24a, 0.9,
      (Math.random() - 0.5) * 0.7 * scale, (1.6 + Math.random() * 1.4) * scale, (Math.random() - 0.5) * 0.7 * scale,
      0.45 + Math.random() * 0.35, -1.5, 1.6,
    );

    // Every other puff leaves a short column of dark smoke behind the flame.
    if (Math.random() > 0.45) {
      this.emit(
        'sphere',
        x + (Math.random() - 0.5) * 0.8 * scale, y + 0.5 * scale, z + (Math.random() - 0.5) * 0.8 * scale,
        (0.35 + Math.random() * 0.3) * scale, 0x2a2a2a, 0.55,
        (Math.random() - 0.5) * 0.5 * scale, (2.2 + Math.random() * 1.2) * scale, (Math.random() - 0.5) * 0.5 * scale,
        2.2 + Math.random() * 1.2, -0.6, 2.4,
      );
    }
  }

  /** A lone column of black smoke, for a fire whose open flame has died down. */
  spawnSmokePuff(x: number, y: number, z: number, scale = 1) {
    this.emit(
      'sphere',
      x + (Math.random() - 0.5) * 0.7 * scale, y + 0.3 * scale, z + (Math.random() - 0.5) * 0.7 * scale,
      (0.3 + Math.random() * 0.3) * scale, 0x2a2a2a, 0.5,
      (Math.random() - 0.5) * 0.4 * scale, (1.8 + Math.random()) * scale, (Math.random() - 0.5) * 0.4 * scale,
      2.6 + Math.random() * 1.4, -0.5, 2.6,
    );
  }

  /**
   * Drop the burning remains of a vehicle at the spot it was destroyed. Foot
   * troops leave nothing behind — only the golf cart, the motorcyclist and the
   * tank are worth a wreck, so any other type is simply ignored.
   */
  spawnBurningWreck(type: EnemyType, x: number, z: number) {
    const size = ENEMY_STATS[type].size;
    const group = type === EnemyType.GOLF_CART ? createGolfCartWreck(size)
      : type === EnemyType.MOTORCYCLIST ? createMotorcyclistWreck(size)
      : type === EnemyType.TANK ? createTankWreck(size)
      : null;
    if (!group) return;

    if (this.wrecks.length >= MAX_WRECKS) this.removeWreck(0);
    // The corpse of the vehicle is still lying exactly where it died (the server
    // keeps dead enemies for half a minute), so the debris is thrown a little way
    // clear of it instead of being interleaved with it.
    const scatter = size * (1.0 + Math.random() * 0.5);
    const bearing = Math.random() * Math.PI * 2;
    group.position.set(x + Math.cos(bearing) * scatter, 0, z + Math.sin(bearing) * scatter);
    group.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(group);
    group.updateMatrixWorld(true);

    const hotMats: THREE.MeshStandardMaterial[] = [];
    const allMats: THREE.Material[] = [];
    const chunks: THREE.Object3D[] = [];
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material;
      if (allMats.indexOf(mat) < 0) allMats.push(mat);
      if (mesh.userData.scorch) return;
      chunks.push(mesh);
      if (mat instanceof THREE.MeshStandardMaterial && hotMats.indexOf(mat) < 0) hotMats.push(mat);
    });

    // The flames come out of a handful of pieces rather than one point, so the
    // whole pile flickers instead of a single candle.
    const vents: THREE.Vector3[] = [];
    for (let i = 0; i < 4 && chunks.length > 0; i++) {
      const chunk = chunks[(Math.random() * chunks.length) | 0];
      const v = new THREE.Vector3();
      chunk.getWorldPosition(v);
      v.y = Math.min(v.y + 0.15 * size, 0.45 * size);
      vents.push(v);
    }

    this.wrecks.push({
      group, hotMats, allMats, vents,
      life: 0, nextEmit: 0, phase: Math.random() * Math.PI * 2,
    });
  }

  private removeWreck(i: number) {
    const w = this.wrecks[i];
    this.wrecks.splice(i, 1);
    this.scene.remove(w.group);
    w.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) for (const one of mat) one.dispose();
      else mat.dispose();
    });
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.release(p);
        this.particles.splice(i, 1);
        continue;
      }

      const t = p.life / p.maxLife;
      // Gravity (negative gravity makes smoke rise), then integrate position in
      // place — no vector is cloned on the way, so the loop allocates nothing.
      p.vy -= p.gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      // Fade
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = p.baseOpacity * (1 - t);
      // Grow (fireball/smoke) or shrink (debris), about the particle's own size.
      const factor = p.grow > 0 ? 1 + t * p.grow : 1 - t * 0.5;
      p.mesh.scale.setScalar(p.baseSize * factor);
    }

    // Burning wrecks: open flame for the first quarter-minute, then smoke only,
    // then the whole pile fades out and is cleared away.
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i];
      w.life += dt;
      if (w.life >= WRECK_LIFE) {
        this.removeWreck(i);
        continue;
      }

      w.nextEmit -= dt;
      if (w.nextEmit <= 0 && w.vents.length > 0) {
        const flaming = w.life < WRECK_BURN;
        w.nextEmit = flaming ? 0.16 : 0.5;
        const v = w.vents[(Math.random() * w.vents.length) | 0];
        if (flaming) this.spawnFirePuff(v.x, v.y, v.z);
        else this.spawnSmokePuff(v.x, v.y, v.z);
      }

      // The metal cools as the fire dies, and at the very end the whole pile goes
      // dark with it.
      const cool = w.life < WRECK_BURN
        ? 0.55 + 0.45 * Math.sin(w.life * 9 + w.phase)
        : Math.max(0, 0.35 * (1 - (w.life - WRECK_BURN) / (WRECK_LIFE - WRECK_BURN)));
      const fade = Math.min(1, (WRECK_LIFE - w.life) / WRECK_FADE);
      for (const mat of w.hotMats) mat.emissive.setHex(0xff5a10).multiplyScalar(cool * fade * 0.5);
      if (fade < 1) for (const mat of w.allMats) mat.opacity = fade;
    }
  }
}

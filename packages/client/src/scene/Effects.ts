import * as THREE from 'three';
import { ENEMY_STATS, EnemyType } from '@red-attack/shared';
import { createGolfCartWreck, createMotorcyclistWreck, createTankWreck } from './VehicleModels';

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;     // downward accel (negative = rises, e.g. smoke)
  grow: number;        // >0 = scale up over life (fireball/smoke); 0 = shrink
  baseOpacity: number;
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

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  spawnExplosion(x: number, y: number, z: number) {
    const count = 30;
    for (let i = 0; i < count; i++) {
      const size = 0.2 + Math.random() * 0.4;
      const geo = new THREE.BoxGeometry(size, size, size);
      const color = Math.random() > 0.5 ? 0xff4400 : (Math.random() > 0.5 ? 0xffaa00 : 0xff0000);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);

      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        Math.random() * 8,
        (Math.random() - 0.5) * 12
      );

      this.particles.push({
        mesh, velocity: vel, life: 0, maxLife: 0.8 + Math.random() * 0.5,
        gravity: 15, grow: 0, baseOpacity: 1,
      });
    }

    // Flash sphere
    const flashGeo = new THREE.SphereGeometry(2, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.8 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(x, y, z);
    this.scene.add(flash);
    this.particles.push({
      mesh: flash, velocity: new THREE.Vector3(0, 0, 0), life: 0, maxLife: 0.3,
      gravity: 0, grow: 2, baseOpacity: 0.8,
    });
  }

  // Lingering crash effect (~5s): bright fireball + rising smoke column + embers.
  // Used by the crash-cam so the explosion stays visible before switching back.
  spawnCrash(x: number, y: number, z: number) {
    // Embers (short-lived hot debris)
    for (let i = 0; i < 24; i++) {
      const size = 0.15 + Math.random() * 0.3;
      const geo = new THREE.BoxGeometry(size, size, size);
      const color = Math.random() > 0.5 ? 0xff6a00 : 0xffaa00;
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true }));
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 10, Math.random() * 9, (Math.random() - 0.5) * 10),
        life: 0, maxLife: 0.9 + Math.random() * 0.6, gravity: 15, grow: 0, baseOpacity: 1,
      });
    }

    // Fireball (grows then fades ~1.4s)
    const fire = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff6a00, transparent: true, opacity: 0.9 }),
    );
    fire.position.set(x, y, z);
    this.scene.add(fire);
    this.particles.push({
      mesh: fire, velocity: new THREE.Vector3(0, 1, 0), life: 0, maxLife: 1.4,
      gravity: 0, grow: 3, baseOpacity: 0.9,
    });

    // Smoke column (rises and lingers ~4-5s)
    for (let i = 0; i < 16; i++) {
      const s = 0.6 + Math.random() * 0.9;
      const smoke = new THREE.Mesh(
        new THREE.SphereGeometry(s, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x44403c, transparent: true, opacity: 0.55 }),
      );
      smoke.position.set(x + (Math.random() - 0.5) * 1.6, y, z + (Math.random() - 0.5) * 1.6);
      this.scene.add(smoke);
      this.particles.push({
        mesh: smoke,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 0.9, (Math.random() - 0.5) * 0.6),
        life: 0, maxLife: 4 + Math.random(), gravity: -1, grow: 1.6, baseOpacity: 0.55,
      });
    }
  }

  // Short-lived coloured puff dropped behind a remote drone so its flight path
  // is easy to follow across the sky.
  spawnTrailPuff(x: number, y: number, z: number, color: number) {
    const size = 0.6 + Math.random() * 0.5;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(size, 6, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }),
    );
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.particles.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.8, -0.2, (Math.random() - 0.5) * 0.8),
      life: 0, maxLife: 1.4 + Math.random() * 0.6, gravity: 0.6, grow: 2.2, baseOpacity: 0.6,
    });
  }

  /**
   * One puff of an ongoing vehicle fire: a flame tongue licking up off the wreck
   * plus the odd ball of black smoke. Called over and over while an armoured
   * enemy burns, so it stays deliberately cheap.
   */
  spawnFirePuff(x: number, y: number, z: number) {
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.2 + Math.random() * 0.25, 8, 6),
      new THREE.MeshBasicMaterial({
        color: Math.random() > 0.45 ? 0xff7a1a : 0xffc24a, transparent: true, opacity: 0.9,
      }),
    );
    flame.position.set(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6);
    this.scene.add(flame);
    this.particles.push({
      mesh: flame,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.7, 1.6 + Math.random() * 1.4, (Math.random() - 0.5) * 0.7),
      life: 0, maxLife: 0.45 + Math.random() * 0.35, gravity: -1.5, grow: 1.6, baseOpacity: 0.9,
    });

    // Every other puff leaves a short column of dark smoke behind the flame.
    if (Math.random() > 0.45) {
      const smoke = new THREE.Mesh(
        new THREE.SphereGeometry(0.35 + Math.random() * 0.3, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.55 }),
      );
      smoke.position.set(x + (Math.random() - 0.5) * 0.8, y + 0.5, z + (Math.random() - 0.5) * 0.8);
      this.scene.add(smoke);
      this.particles.push({
        mesh: smoke,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 0.5, 2.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.5),
        life: 0, maxLife: 2.2 + Math.random() * 1.2, gravity: -0.6, grow: 2.4, baseOpacity: 0.55,
      });
    }
  }

  /** A lone column of black smoke, for a wreck whose open flame has died down. */
  spawnSmokePuff(x: number, y: number, z: number) {
    const smoke = new THREE.Mesh(
      new THREE.SphereGeometry(0.3 + Math.random() * 0.3, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.5 }),
    );
    smoke.position.set(x + (Math.random() - 0.5) * 0.7, y + 0.3, z + (Math.random() - 0.5) * 0.7);
    this.scene.add(smoke);
    this.particles.push({
      mesh: smoke,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.8 + Math.random(), (Math.random() - 0.5) * 0.4),
      life: 0, maxLife: 2.6 + Math.random() * 1.4, gravity: -0.5, grow: 2.6, baseOpacity: 0.5,
    });
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
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }

      const t = p.life / p.maxLife;
      // Gravity (negative gravity makes smoke rise)
      p.velocity.y -= p.gravity * dt;
      p.mesh.position.add(p.velocity.clone().multiplyScalar(dt));
      // Fade
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = p.baseOpacity * (1 - t);
      // Grow (fireball/smoke) or shrink (debris)
      const scale = p.grow > 0 ? 1 + t * p.grow : 1 - t * 0.5;
      p.mesh.scale.setScalar(scale);
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

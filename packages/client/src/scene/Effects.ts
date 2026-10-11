import * as THREE from 'three';

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;     // downward accel (negative = rises, e.g. smoke)
  grow: number;        // >0 = scale up over life (fireball/smoke); 0 = shrink
  baseOpacity: number;
}

export class EffectsManager {
  private scene: THREE.Scene;
  private particles: Particle[] = [];

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
  }
}

import * as THREE from 'three';

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
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
        mesh,
        velocity: vel,
        life: 0,
        maxLife: 0.8 + Math.random() * 0.5,
      });
    }

    // Flash sphere
    const flashGeo = new THREE.SphereGeometry(2, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.8 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(x, y, z);
    this.scene.add(flash);
    this.particles.push({
      mesh: flash,
      velocity: new THREE.Vector3(0, 0, 0),
      life: 0,
      maxLife: 0.3,
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
      // Gravity
      p.velocity.y -= 15 * dt;
      p.mesh.position.add(p.velocity.clone().multiplyScalar(dt));
      // Fade
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 1 - t;
      // Shrink
      const scale = 1 - t * 0.5;
      p.mesh.scale.setScalar(scale);
    }
  }
}

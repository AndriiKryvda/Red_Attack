import * as THREE from 'three';
import { EnemyData, EnemyType, ENEMY_STATS } from '@red-attack/shared';

const ENEMY_COLORS: Record<EnemyType, number> = {
  [EnemyType.CHEBURASHKA]: 0x8b4513,
  [EnemyType.BEAR]: 0x8b0000,
  [EnemyType.SOLDIER]: 0x556b2f,
};

export class EnemyRenderer {
  private scene: THREE.Scene;
  private meshes: Map<string, THREE.Mesh> = new Map();
  private geoCache: Map<string, THREE.BufferGeometry> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  sync(enemies: EnemyData[]) {
    const activeIds = new Set<string>();

    for (const enemy of enemies) {
      if (enemy.dead) continue;
      activeIds.add(enemy.id);

      let mesh = this.meshes.get(enemy.id);
      if (!mesh) {
        mesh = this.createMesh(enemy.type);
        this.scene.add(mesh);
        this.meshes.set(enemy.id, mesh);
      }

      mesh.position.set(enemy.position.x, enemy.position.y + ENEMY_STATS[enemy.type].size / 2, enemy.position.z);
      mesh.visible = true;

      // Flash if slowed/frozen
      const mat = mesh.material as THREE.MeshToonMaterial;
      if (enemy.frozenUntil > Date.now()) {
        mat.emissive.setHex(0x0000ff);
      } else if (enemy.slowedUntil > Date.now()) {
        mat.emissive.setHex(0x440044);
      } else {
        mat.emissive.setHex(0x000000);
      }
    }

    // Remove meshes no longer in state
    for (const [id, mesh] of this.meshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.meshes.delete(id);
      }
    }
  }

  private createMesh(type: EnemyType): THREE.Mesh {
    const size = ENEMY_STATS[type].size;
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshToonMaterial({ color: ENEMY_COLORS[type] });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
  }
}

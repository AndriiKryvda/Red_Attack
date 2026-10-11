import * as THREE from 'three';
import { DroneData } from '@red-attack/shared';

export class DroneRenderer {
  private scene: THREE.Scene;
  private meshes: Map<string, THREE.Group> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  sync(drones: DroneData[]) {
    const activeIds = new Set<string>();

    for (const drone of drones) {
      if (!drone.alive) continue;
      activeIds.add(drone.id);

      let group = this.meshes.get(drone.id);
      if (!group) {
        group = this.createDroneMesh();
        this.scene.add(group);
        this.meshes.set(drone.id, group);
      }

      group.position.set(drone.position.x, drone.position.y, drone.position.z);
      group.rotation.y = drone.yaw;
      group.rotation.x = -drone.pitch;
    }

    for (const [id, group] of this.meshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(group);
        this.meshes.delete(id);
      }
    }
  }

  private createDroneMesh(): THREE.Group {
    const group = new THREE.Group();

    // Body
    const bodyGeo = new THREE.BoxGeometry(0.6, 0.2, 0.6);
    const bodyMat = new THREE.MeshToonMaterial({ color: 0x333333 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // Arms + rotors
    const armGeo = new THREE.BoxGeometry(1.2, 0.05, 0.1);
    const armMat = new THREE.MeshToonMaterial({ color: 0x555555 });
    const arm1 = new THREE.Mesh(armGeo, armMat);
    const arm2 = new THREE.Mesh(armGeo, armMat);
    arm2.rotation.y = Math.PI / 2;
    group.add(arm1, arm2);

    // Rotor discs
    const rotorGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.02, 8);
    const rotorMat = new THREE.MeshToonMaterial({ color: 0x00aaff });
    const rotorPositions = [
      [-0.5, 0.1, -0.5], [0.5, 0.1, -0.5],
      [-0.5, 0.1, 0.5], [0.5, 0.1, 0.5],
    ];
    for (const [x, y, z] of rotorPositions) {
      const rotor = new THREE.Mesh(rotorGeo, rotorMat);
      rotor.position.set(x, y, z);
      group.add(rotor);
    }

    // Camera (front indicator)
    const camGeo = new THREE.SphereGeometry(0.08, 6, 6);
    const camMat = new THREE.MeshToonMaterial({ color: 0xff0000 });
    const cam = new THREE.Mesh(camGeo, camMat);
    cam.position.set(0, 0, -0.35);
    group.add(cam);

    group.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true;
    });

    return group;
  }
}

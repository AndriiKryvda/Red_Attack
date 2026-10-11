import * as THREE from 'three';
import { standardMaterial } from './Textures';
import { DroneData } from '@red-attack/shared';

// High-contrast per-pilot colours so allied drones stay visible at range.
const OWNER_PALETTE = [0xff5c5c, 0x4dd2ff, 0xffd166, 0x9b5de5, 0x43d9ad, 0xff9f1c];

function colorForOwner(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return OWNER_PALETTE[Math.abs(h) % OWNER_PALETTE.length];
}

interface DroneVisual {
  group: THREE.Group;
  label: THREE.Sprite | null;
  color: number;
  lastTrail: number;
}

export class DroneRenderer {
  private scene: THREE.Scene;
  private meshes: Map<string, DroneVisual> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Render every live drone. Remote drones (other pilots) additionally get a
   * bright owner-tinted beacon, a floating callsign and a smoke trail, because
   * a bare 0.6 m quad is otherwise impossible to spot against the terrain.
   */
  sync(
    drones: DroneData[],
    localOwnerId = '',
    names: Record<string, string> = {},
    viewPos?: THREE.Vector3,
    onTrail?: (x: number, y: number, z: number, color: number) => void,
  ) {
    const activeIds = new Set<string>();
    const now = performance.now() / 1000;

    for (const drone of drones) {
      if (!drone.alive) continue;
      activeIds.add(drone.id);

      const isOwn = drone.ownerId === localOwnerId;
      let vis = this.meshes.get(drone.id);
      if (!vis) {
        const color = colorForOwner(drone.ownerId);
        const group = this.createDroneMesh(color, isOwn);
        const label = isOwn ? null : this.createLabel(names[drone.ownerId] || 'PILOT', color);
        if (label) group.add(label);
        this.scene.add(group);
        vis = { group, label, color, lastTrail: 0 };
        this.meshes.set(drone.id, vis);
      }

      const group = vis.group;
      group.position.set(drone.position.x, drone.position.y, drone.position.z);
      group.rotation.y = drone.yaw;
      group.rotation.x = -drone.pitch;

      // Keep the callsign readable at any range by scaling it with distance.
      if (vis.label && viewPos) {
        const d = viewPos.distanceTo(group.position);
        const s = Math.min(4.5, Math.max(1.1, d * 0.055));
        vis.label.scale.set(s * 2.6, s * 0.65, 1);
      }

      // Smoke trail behind other pilots' drones (own drone is first-person).
      if (!isOwn && onTrail && now - vis.lastTrail > 0.12) {
        vis.lastTrail = now;
        onTrail(drone.position.x, drone.position.y, drone.position.z, vis.color);
      }
    }

    for (const [id, vis] of this.meshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(vis.group);
        this.dispose(vis.group);
        this.meshes.delete(id);
      }
    }
  }

  private createLabel(text: string, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 250, 58);
    ctx.font = 'bold 32px Segoe UI, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.toUpperCase().slice(0, 10), 128, 34);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
    );
    sprite.position.set(0, 0.9, 0);
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 10;
    return sprite;
  }

  private dispose(obj: THREE.Object3D) {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const m = mesh.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose();
      }
      const sprite = child as THREE.Sprite;
      if (sprite.isSprite) {
        const mat = sprite.material as THREE.SpriteMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
    });
  }

  private createDroneMesh(accent: number, plain: boolean): THREE.Group {
    const group = new THREE.Group();

    // Body — tinted with the pilot colour so allied drones pop against the sky
    // (a bare dark quad is invisible at 60+ m). Own drone stays neutral.
    const bodyGeo = new THREE.BoxGeometry(0.6, 0.2, 0.6);
    const bodyMat = plain
      ? standardMaterial('metal', { color: 0x2b2e33, metalness: 0.85, roughness: 0.45 })
      : new THREE.MeshStandardMaterial({
          color: accent, metalness: 0.25, roughness: 0.55,
          emissive: accent, emissiveIntensity: 0.25,
        });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // Top plate tinted with the pilot colour (own drone stays neutral).
    if (!plain) {
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.08, 0.5),
        new THREE.MeshStandardMaterial({
          color: accent, metalness: 0.3, roughness: 0.5,
          emissive: accent, emissiveIntensity: 0.35,
        }),
      );
      plate.position.y = 0.14;
      group.add(plate);
    }

    // Arms + rotors
    const armGeo = new THREE.BoxGeometry(1.2, 0.05, 0.1);
    const armMat = standardMaterial('metal', { color: 0x1c1f24, metalness: 0.5, roughness: 0.6 });
    const arm1 = new THREE.Mesh(armGeo, armMat);
    const arm2 = new THREE.Mesh(armGeo, armMat);
    arm2.rotation.y = Math.PI / 2;
    group.add(arm1, arm2);

    // Rotor discs
    const rotorGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.02, 8);
    const rotorMat = standardMaterial('metal', { color: 0x0e1116, metalness: 0.9, roughness: 0.35 });
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
    const camMat = new THREE.MeshStandardMaterial({
      color: 0x101216,
      metalness: 0.2,
      roughness: 0.1,
      emissive: 0xff2222,
      emissiveIntensity: 0.7,
    });
    const cam = new THREE.Mesh(camGeo, camMat);
    cam.position.set(0, 0, -0.35);
    group.add(cam);

    // Underslung beacon + soft halo: unlit so they stay bright at any distance.
    if (!plain) {
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.26, 10, 10),
        new THREE.MeshBasicMaterial({ color: accent }),
      );
      beacon.position.set(0, -0.24, 0);
      group.add(beacon);

      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.7, 10, 10),
        new THREE.MeshBasicMaterial({
          color: accent, transparent: true, opacity: 0.28, depthWrite: false,
        }),
      );
      group.add(halo);
    }

    group.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true;
    });

    return group;
  }
}

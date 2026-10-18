import * as THREE from 'three';
import { standardMaterial } from './Textures';
import { BombData, VAMPIRE_BOMB_RADIUS } from '@red-attack/shared';

/**
 * The Vampire's mini-bombs in the air. The server already knows exactly where each one
 * is — it resolves the whole fall in closed form and syncs the position every tick —
 * so this layer only has to put a readable shape on it: a dark, finned dart with a
 * faint glow so a falling bomb reads against the terrain on the way down. The meshes
 * are pooled by bomb id and simply follow the synced position.
 */
export class BombRenderer {
  private scene: THREE.Scene;
  private meshes: Map<string, THREE.Group> = new Map();
  private bodyGeo: THREE.CapsuleGeometry;
  private finGeo: THREE.BoxGeometry;
  private glowGeo: THREE.SphereGeometry;
  private bodyMat: THREE.MeshStandardMaterial;
  private finMat: THREE.MeshStandardMaterial;
  private glowMat: THREE.MeshBasicMaterial;
  /** Ground reticle marking where a bomb released right now would land (Vampire pilot only). */
  private indicator: THREE.Group;
  private indicatorMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    // Shared geometry and materials: the pooled meshes reuse them, so they are built
    // once here and never disposed with an individual bomb (only the group is dropped).
    this.bodyGeo = new THREE.CapsuleGeometry(0.12, 0.34, 4, 8);
    this.finGeo = new THREE.BoxGeometry(0.02, 0.16, 0.16);
    this.glowGeo = new THREE.SphereGeometry(0.17, 8, 8);
    this.bodyMat = standardMaterial('metal', { color: 0x2a2d33, metalness: 0.6, roughness: 0.5 });
    this.finMat = standardMaterial('metal', { color: 0x14161a, metalness: 0.5, roughness: 0.6 });
    this.glowMat = new THREE.MeshBasicMaterial({
      color: 0xff8a3c, transparent: true, opacity: 0.45, depthWrite: false,
    });

    // Ground reticle showing the footprint of a bomb released this instant: a flat
    // ring the size of the blast plus a cross to aim with, mirroring the mortar's
    // impact marker. The Scene drives it from the pilot's own drone each frame, so
    // it lives here with the bombs it points at and stays hidden for everyone else.
    this.indicatorMat = new THREE.MeshBasicMaterial({
      color: 0x7cff9a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
    });
    this.indicator = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(VAMPIRE_BOMB_RADIUS - 0.4, VAMPIRE_BOMB_RADIUS + 0.4, 56),
      this.indicatorMat,
    );
    ring.rotation.x = -Math.PI / 2;
    this.indicator.add(ring);
    for (const ry of [0, Math.PI / 2]) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.05, VAMPIRE_BOMB_RADIUS * 2), this.indicatorMat,
      );
      bar.rotation.y = ry;
      this.indicator.add(bar);
    }
    this.indicator.renderOrder = 5;
    this.indicator.visible = false;
    this.scene.add(this.indicator);
  }

  /**
   * Place the ground reticle at the point a bomb released right now would land.
   * Green when a drop is allowed, amber when it is not (flying too low, out of
   * bombs, or already on autopilot home). Hidden for anyone but the Vampire pilot.
   */
  updateImpact(x: number, z: number, valid: boolean, visible: boolean): void {
    this.indicator.visible = visible;
    if (!visible) return;
    this.indicator.position.set(x, 0.08, z);
    this.indicatorMat.color.setHex(valid ? 0x7cff9a : 0xffb04a);
  }

  /** Place one dart per falling bomb and drop the meshes of any that have detonated. */
  sync(bombs: BombData[]) {
    const active = new Set<string>();
    for (const b of bombs) {
      active.add(b.id);
      let g = this.meshes.get(b.id);
      if (!g) {
        g = this.createBomb();
        this.scene.add(g);
        this.meshes.set(b.id, g);
      }
      g.position.set(b.position.x, b.position.y, b.position.z);
    }
    for (const [id, g] of this.meshes) {
      if (!active.has(id)) {
        this.scene.remove(g);
        this.meshes.delete(id);
      }
    }
  }

  private createBomb(): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.bodyGeo, this.bodyMat);
    body.castShadow = true;
    group.add(body);
    // Four tail fins, splayed around the base so the dart reads as falling point-down.
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(this.finGeo, this.finMat);
      const a = (i / 4) * Math.PI * 2;
      fin.position.set(Math.cos(a) * 0.12, -0.18, Math.sin(a) * 0.12);
      fin.rotation.y = -a;
      group.add(fin);
    }
    const glow = new THREE.Mesh(this.glowGeo, this.glowMat);
    glow.position.y = 0.12;
    group.add(glow);
    return group;
  }
}

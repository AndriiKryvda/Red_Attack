import * as THREE from 'three';
import { standardMaterial } from './Textures';
import { MineData, MINE_TRIGGER_RADIUS } from '@red-attack/shared';

/**
 * Above this many mines in the ground, the trip circles stop being drawn. A full field is
 * dense enough that a hundred and twenty overlapping circles tile the whole belt in red
 * and tell the pilot nothing; below it, what is left of a field reads as circles again.
 */
const MINEFIELD_RING_LIMIT = 24;

/**
 * The mine field in the dirt around the fort. The server owns the field completely —
 * it decides where the mines go and when one is walked over — and syncs the list the
 * same way it syncs falling shells, so this layer only has to make each mine readable
 * from the fort: a dark buried disc with a slow blinking eye, and a faint ring on the
 * ground showing how close the horde has to come before it goes off. Meshes are pooled
 * by mine id, exactly the way the falling bombs are, so a mine simply disappears from
 * the field when the server stops sending it.
 */
export class MineRenderer {
  private scene: THREE.Scene;
  /** One mine's meshes: the group that sits in the scene, and its trip circle. */
  private meshes: Map<string, { group: THREE.Group; ring: THREE.Mesh }> = new Map();
  private bodyGeo: THREE.CylinderGeometry;
  private prongGeo: THREE.BoxGeometry;
  private eyeGeo: THREE.SphereGeometry;
  private ringGeo: THREE.RingGeometry;
  private bodyMat: THREE.MeshStandardMaterial;
  private prongMat: THREE.MeshStandardMaterial;
  private eyeMat: THREE.MeshBasicMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  /** Blink clock, so every eye in the field pulses on the same beat. */
  private phase = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    // Shared geometry and materials, built once: the pooled meshes reuse them, so
    // dropping a mine drops only its group.
    this.bodyGeo = new THREE.CylinderGeometry(0.3, 0.42, 0.16, 12);
    this.prongGeo = new THREE.BoxGeometry(0.07, 0.2, 0.07);
    this.eyeGeo = new THREE.SphereGeometry(0.09, 8, 8);
    // Fewer segments than a lone mine would want: a whole field is a lot of circles, and
    // at this radius nobody can tell a 24-gon from a 40-gon.
    this.ringGeo = new THREE.RingGeometry(MINE_TRIGGER_RADIUS - 0.14, MINE_TRIGGER_RADIUS, 24);
    this.bodyMat = standardMaterial('metal', { color: 0x24262b, metalness: 0.55, roughness: 0.7 });
    this.prongMat = standardMaterial('metal', { color: 0x3a3d44, metalness: 0.7, roughness: 0.45 });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xff4030, transparent: true, opacity: 0.8 });
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xff5a4a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
    });
  }

  /**
   * Place one mine per record the server sent and drop the meshes of any that have gone
   * off. `dt` advances the blink, so a live field shimmers without any extra state.
   */
  sync(mines: MineData[], dt: number) {
    this.phase += dt;
    // A slow pulse rather than a strobe: readable at distance, not obnoxious up close.
    this.eyeMat.opacity = 0.25 + 0.65 * (0.5 + 0.5 * Math.sin(this.phase * 2.4));
    const showRings = mines.length <= MINEFIELD_RING_LIMIT;
    const active = new Set<string>();
    for (const m of mines) {
      active.add(m.id);
      let entry = this.meshes.get(m.id);
      if (!entry) {
        entry = this.createMine();
        this.scene.add(entry.group);
        this.meshes.set(m.id, entry);
      }
      entry.group.position.set(m.position.x, 0, m.position.z);
      entry.ring.visible = showRings;
    }
    for (const [id, entry] of this.meshes) {
      if (!active.has(id)) {
        this.scene.remove(entry.group);
        this.meshes.delete(id);
      }
    }
  }

  private createMine(): { group: THREE.Group; ring: THREE.Mesh } {
    const group = new THREE.Group();
    // The charge itself, sunk halfway into the dirt so only the lid shows. No shadow:
    // a hand-sized disc on the ground has none worth the cost of a hundred of them.
    const body = new THREE.Mesh(this.bodyGeo, this.bodyMat);
    body.position.y = 0.06;
    body.castShadow = false;
    group.add(body);
    // Three short tines round the rim, the classic tell that this is not a rock.
    for (let i = 0; i < 3; i++) {
      const prong = new THREE.Mesh(this.prongGeo, this.prongMat);
      const a = (i / 3) * Math.PI * 2;
      prong.position.set(Math.cos(a) * 0.34, 0.16, Math.sin(a) * 0.34);
      prong.rotation.y = -a;
      group.add(prong);
    }
    const eye = new THREE.Mesh(this.eyeGeo, this.eyeMat);
    eye.position.y = 0.17;
    group.add(eye);
    // The trip radius, drawn flat on the ground so a pilot can see what the field
    // actually covers instead of guessing at an invisible circle.
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.renderOrder = 4;
    group.add(ring);
    return { group, ring };
  }
}
import * as THREE from 'three';
import { MORTAR_ELEVATION, MORTAR_POSITION } from '@red-attack/shared';
import { standardMaterial } from './Textures';

/**
 * The fort's tube mortar, standing on its concrete pad in the courtyard.
 *
 * The tube is laid at the standing elevation and never moves off it: aiming is
 * pure traverse, which is exactly how the server resolves a shot too (range comes
 * from the aim point, the elevation is a constant). The model therefore only ever
 * rotates around Y, and the barrel slides back along its own axis for recoil.
 */
export class MortarView {
  readonly group: THREE.Group;
  /** Slides along the tube axis for recoil; carries the barrel, muzzle and flash. */
  private readonly barrel: THREE.Group;
  private readonly flash: THREE.Mesh;
  private recoil: number = 0;

  constructor(scene: THREE.Scene) {
    const steel = standardMaterial('metal', { rx: 1, ry: 2, color: 0x5d6355, metalness: 0.8, roughness: 0.5 });
    const dark = standardMaterial('metal', { rx: 1, ry: 1, color: 0x2b2e2a, metalness: 0.6, roughness: 0.7 });
    const plate = standardMaterial('concrete', { rx: 2, ry: 2, roughness: 0.95 });

    const g = new THREE.Group();
    g.position.set(MORTAR_POSITION.x, 0, MORTAR_POSITION.z);

    // Carriage: a base plate the bipod heels dig into, on two skids.
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.22, 2.9), plate);
    base.position.y = 0.11;
    base.receiveShadow = true;
    g.add(base);
    for (const sx of [-0.78, 0.78]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 2.6), dark);
      skid.position.set(sx, 0.34, 0);
      skid.castShadow = true;
      g.add(skid);
    }
    // Bipod: two legs braced forward from the trunnion down onto the plate.
    for (const sx of [-0.6, 0.6]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1.25, 8), steel);
      leg.position.set(sx, 0.62, 0.46);
      leg.rotation.x = -0.66;
      leg.castShadow = true;
      g.add(leg);
      const heel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.42), dark);
      heel.position.set(sx, 0.28, 0.92);
      g.add(heel);
    }

    // Elevating mount: everything on it is tilted to the standing lay, so the
    // mount's own +Z points up and forward along the line of fire.
    const mount = new THREE.Group();
    mount.position.y = 0.98;
    mount.rotation.x = -MORTAR_ELEVATION;
    g.add(mount);

    const trunnion = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 1.25, 12), dark);
    trunnion.rotation.z = Math.PI / 2;
    trunnion.castShadow = true;
    mount.add(trunnion);

    this.barrel = new THREE.Group();
    mount.add(this.barrel);

    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.7, 14), steel);
    tube.rotation.x = Math.PI / 2; // cylinder axis now runs along +Z
    tube.position.z = 1.05;
    tube.castShadow = true;
    this.barrel.add(tube);

    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.34, 12), dark);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.z = 2.3;
    muzzle.castShadow = true;
    this.barrel.add(muzzle);

    // Blast at the muzzle, faded out with the recoil.
    this.flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffcc66, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.flash.position.z = 2.75;
    this.barrel.add(this.flash);

    // Ready rounds racked beside the tube.
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 1.5), standardMaterial('wood', { rx: 1, ry: 1, roughness: 0.85 }));
    crate.position.set(1.6, 0.28, -0.5);
    crate.castShadow = true;
    g.add(crate);
    for (let i = 0; i < 3; i++) {
      const round = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.62, 8), dark);
      round.position.set(1.6, 0.85, -0.95 + i * 0.45);
      round.castShadow = true;
      g.add(round);
      const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.09, 0.16, 8), steel);
      fin.position.set(1.6, 0.5, -0.95 + i * 0.45);
      g.add(fin);
    }

    // Lay it on the field the horde walks in from until the pilot takes aim.
    g.rotation.y = Math.PI;

    this.group = g;
    scene.add(g);
  }

  /** Traverse the tube onto a bearing (world yaw, atan2(dx, dz)). */
  aim(azimuth: number) {
    this.group.rotation.y = azimuth;
  }

  /** Start a recoil stroke; call the moment a shell leaves the tube. */
  kick() {
    this.recoil = 1;
  }

  update(dt: number) {
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 2.6);
    const r = this.recoil;
    this.barrel.position.z = -0.45 * r;
    const mat = this.flash.material as THREE.MeshBasicMaterial;
    mat.opacity = r * 0.85;
    this.flash.scale.setScalar(0.5 + (1 - r) * 1.6);
  }
}

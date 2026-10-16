import * as THREE from 'three';
import { HMG_NESTS, HMG_MUZZLE_Y, HMG_MUZZLE_OUT, clampHmgPitch } from '@red-attack/shared';
import { standardMaterial } from './Textures';

/**
 * Height of the deck plate the pedestal is bolted to. The berm crest, the deck and
 * the pedestal column itself are built in Outpost.ts as static scenery; this is
 * the one number that has to agree with them, so it is pinned to the shared muzzle
 * height (the trunnion sits 1.16 m above the deck) and every tracer therefore
 * starts exactly at the end of the barrel it was fired from.
 */
const DECK_Y = HMG_MUZZLE_Y - 1.16;
/** Height of the trunnion above the deck: the pivot the gun elevates around. */
const TRUNNION_Y = 1.16;

/**
 * The moving parts of one nest. The gun turns in `traverse` and tilts in
 * `elevation`, whose own +Z is the line of fire, so laying the gun is two angles and
 * nothing else - the same two the server keeps in `hmgYaw` and `hmgPitch`.
 */
interface HmgGun {
  traverse: THREE.Group;
  elevation: THREE.Group;
  /** Slides back along the line of fire for the recoil stroke. */
  barrel: THREE.Group;
  flash: THREE.Mesh;
  /** Countdown of the recoil stroke, 1 at the shot and 0 at rest. */
  recoil: number;
}

/**
 * The four machine guns as live weapons rather than as scenery: the deck, the
 * pedestal, the ammo can and the belts stay part of the fort, and this is the part
 * that moves - traverse, elevation, the recoil of a belt running out and the flash
 * at the muzzle.
 *
 * Nothing here decides anything. The lay comes from the server's copy of the pilot's
 * aim, so every client sees the same gun pointing the same way, and the flash fires
 * on the server's shot event instead of on a local guess at the cyclic rate.
 */
export class HmgView {
  private readonly guns: HmgGun[] = [];

  constructor(scene: THREE.Scene) {
    for (const nest of HMG_NESTS) this.guns.push(this.buildGun(scene, nest.x, nest.z, nest.yaw));
  }

  /** Lay one gun at a world yaw and an elevation, both already the server's. */
  aim(gun: number, yaw: number, pitch: number) {
    const g = this.guns[gun];
    if (!g) return;
    g.traverse.rotation.y = yaw;
    // The elevation group's +Z is the line of fire, so a positive elevation (up)
    // is a negative rotation about X.
    g.elevation.rotation.x = -clampHmgPitch(pitch);
  }

  /** Start a recoil stroke: call it on the round, not on the trigger. */
  kick(gun: number) {
    const g = this.guns[gun];
    if (g) g.recoil = 1;
  }

  update(dt: number) {
    for (const g of this.guns) {
      if (g.recoil > 0) g.recoil = Math.max(0, g.recoil - dt * 9);
      const r = g.recoil;
      g.barrel.position.z = -0.17 * r;
      const mat = g.flash.material as THREE.MeshBasicMaterial;
      mat.opacity = r * 0.9;
      g.flash.scale.set(1 + r, 1 + r, 0.6 + r * 1.9);
    }
  }

  /** One gun on its pedestal: a traverse group, an elevation group, a barrel. */
  private buildGun(scene: THREE.Scene, x: number, z: number, yaw: number): HmgGun {
    const gunMetal = standardMaterial('metal', { rx: 1, ry: 2, color: 0x3c4038, metalness: 0.85, roughness: 0.45 });
    const dark = standardMaterial('metal', { rx: 1, ry: 1, color: 0x24261f, metalness: 0.6, roughness: 0.7 });

    const traverse = new THREE.Group();
    traverse.position.set(x, DECK_Y, z);
    traverse.rotation.y = yaw;
    scene.add(traverse);

    const elevation = new THREE.Group();
    elevation.position.y = TRUNNION_Y;
    traverse.add(elevation);

    // Trunnion the whole gun rocks in, and the receiver and bolt behind it.
    const trunnion = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.42, 12), dark);
    trunnion.rotation.z = Math.PI / 2;
    trunnion.castShadow = true;
    elevation.add(trunnion);
    elevation.add(this.box(gunMetal, 0.17, 0.21, 0.72, 0, -0.04, 0.02));
    elevation.add(this.box(dark, 0.13, 0.1, 0.34, 0, 0.1, -0.06));
    // Spade grips, splayed out for the gunner standing behind them.
    for (const sx of [-0.17, 0.17]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.24, 8), dark);
      grip.position.set(sx, -0.12, -0.56);
      grip.rotation.x = 0.5;
      grip.castShadow = true;
      elevation.add(grip);
    }

    // Barrel assembly: everything that runs back under recoil, down to the brake.
    const barrel = new THREE.Group();
    elevation.add(barrel);

    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 1.05, 12), gunMetal);
    tube.rotation.x = Math.PI / 2;
    tube.position.z = 0.9;
    tube.castShadow = true;
    barrel.add(tube);
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 12), dark);
      ring.rotation.x = Math.PI / 2;
      ring.position.z = 0.55 + i * 0.16;
      barrel.add(ring);
    }
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 12), gunMetal);
    brake.rotation.x = Math.PI / 2;
    brake.position.z = 1.5;
    brake.castShadow = true;
    barrel.add(brake);
    // Sights: a post near the muzzle, a notch at the breech.
    barrel.add(this.box(dark, 0.03, 0.11, 0.03, 0, 0.12, 1.32));
    elevation.add(this.box(dark, 0.1, 0.1, 0.05, 0, 0.2, 0.12));

    // Muzzle flash, stretched along the line of fire and faded with the recoil.
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffd27a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    flash.position.z = HMG_MUZZLE_OUT + 0.05;
    barrel.add(flash);

    return { traverse, elevation, barrel, flash, recoil: 0 };
  }

  private box(
    mat: THREE.Material, w: number, h: number, d: number,
    x: number, y: number, z: number,
  ): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }
}

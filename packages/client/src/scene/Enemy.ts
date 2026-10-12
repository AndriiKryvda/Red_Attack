import * as THREE from 'three';
import { standardMaterial } from './Textures';
import { EnemyData, EnemyType, ENEMY_STATS } from '@red-attack/shared';

const ENEMY_COLORS: Record<EnemyType, number> = {
  [EnemyType.CHEBURASHKA]: 0x8b4513,
  // The bear is a shaggy brown tank; the red comes from the flag it carries
  // (see design doc: "Ведмідь (червоний прапор)"), not from its fur.
  [EnemyType.BEAR]: 0x4a3626,
  [EnemyType.SOLDIER]: 0x556b2f,
};

const FLAG_RED = 0xc8201c;
// Glossy off-white for the porcelain the soldiers lug around.
const CERAMIC_WHITE = 0xf6f6f1;

export class EnemyRenderer {
  private scene: THREE.Scene;
  private meshes: Map<string, THREE.Object3D> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  sync(enemies: EnemyData[]) {
    const activeIds = new Set<string>();
    const now = performance.now() / 1000;

    for (const enemy of enemies) {
      activeIds.add(enemy.id);

      let obj = this.meshes.get(enemy.id);
      if (!obj) {
        obj = this.createMesh(enemy.type);
        obj.userData.phase = Math.random() * Math.PI * 2;
        this.scene.add(obj);
        this.meshes.set(enemy.id, obj);
      }

      const size = ENEMY_STATS[enemy.type].size;

      // Enemies always march toward the outpost at the origin, so face that way
      // instead of sliding sideways.
      const yaw = Math.atan2(-enemy.position.x, -enemy.position.z);

      if (enemy.dead) {
        // Damaged wreck: keep the SAME recognizable model (never a generic cube),
        // tipped on its side and scorched, so a killed Cheburashka still reads as
        // a dead Cheburashka instead of vanishing or turning into a box.
        obj.position.set(enemy.position.x, enemy.position.y + size * 0.2, enemy.position.z);
        obj.rotation.set(0.35, yaw, Math.PI / 2);
        this.animate(obj, now, 0, false);
        this.setScorched(obj, true);
        this.setEmissive(obj, 0x000000);
      } else {
        // Subtle walking bob so the models read as living creatures, not props.
        const phase = (obj.userData.phase as number) ?? 0;
        const bob = Math.sin(now * 6 + phase) * size * 0.035;
        obj.position.set(enemy.position.x, enemy.position.y + size / 2 + bob, enemy.position.z);
        obj.rotation.set(0, yaw, 0);
        this.animate(obj, now, phase, true);
        this.setScorched(obj, false);

        // Flash tint when slowed/frozen (applied to every part of the model).
        let emissive = 0x000000;
        if (enemy.frozenUntil > Date.now()) emissive = 0x0000ff;
        else if (enemy.slowedUntil > Date.now()) emissive = 0x440044;
        this.setEmissive(obj, emissive);
      }
      obj.visible = true;
    }

    // Remove meshes no longer in state
    for (const [id, obj] of this.meshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(obj);
        this.disposeObject(obj);
        this.meshes.delete(id);
      }
    }
  }

  private setEmissive(obj: THREE.Object3D, hex: number) {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat && mat.emissive) mat.emissive.setHex(hex);
      }
    });
  }

  // -- Walk cycle -----------------------------------------------------------
  // Limb pivots are tagged with userData.swing (amplitude; the sign picks the
  // opposite leg) and cloth with userData.wave, so the upright models actually
  // walk and banners flutter instead of sliding along the ground. A corpse
  // passes walking = false and freezes in a neutral pose.
  private animate(obj: THREE.Object3D, now: number, phase: number, walking: boolean) {
    const step = walking ? Math.sin(now * 6 + phase) : 0;
    const flutter = walking ? Math.sin(now * 2.4 + phase) : 0;
    obj.traverse((child) => {
      const swing = child.userData.swing as number | undefined;
      if (swing !== undefined) child.rotation.x = step * swing;
      const wave = child.userData.wave as number | undefined;
      if (wave !== undefined) child.rotation.y = flutter * wave;
    });
  }

  // Darken (scorch) every part of a wrecked enemy. Original colors are cached on
  // first call so the same object can be restored if it were ever revived.
  private setScorched(obj: THREE.Object3D, on: boolean) {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat || !mat.color) return;
      if (mesh.userData.baseColor === undefined) {
        mesh.userData.baseColor = mat.color.getHex();
      }
      if (on) {
        const base = new THREE.Color(mesh.userData.baseColor as number);
        base.multiplyScalar(0.3);
        mat.color.copy(base);
      } else {
        mat.color.setHex(mesh.userData.baseColor as number);
      }
    });
  }

  private disposeObject(obj: THREE.Object3D) {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const m = mesh.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose();
      }
    });
  }

  private createMesh(type: EnemyType): THREE.Object3D {
    const size = ENEMY_STATS[type].size;
    if (type === EnemyType.CHEBURASHKA) return this.createCheburashka(size);
    if (type === EnemyType.BEAR) return this.createBear(size);
    return this.createSoldier(size);
  }

  // Shared helper: add a shadow-casting part to a model group (parts face +Z).
  private addPart(
    g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material,
    x: number, y: number, z: number, sx = 1, sy = 1, sz = 1,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    g.add(m);
    return m;
  }

  // A limb pivot: rotating the returned group around X swings the whole limb
  // from its attachment point (hip/shoulder). Tagged so animate() can drive it.
  private addLimb(g: THREE.Group, x: number, y: number, z: number, swing = 0): THREE.Group {
    const limb = new THREE.Group();
    limb.position.set(x, y, z);
    if (swing !== 0) limb.userData.swing = swing;
    g.add(limb);
    return limb;
  }

  // Flat five-pointed star (helmet badge / flag emblem), extruded so it catches light.
  private starGeometry(radius: number, depth: number): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? radius : radius * 0.45;
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  }

  // A red banner on a wooden pole with a gold finial and a gold star (design doc:
  // "Ведмідь (червоний прапор)"). Returns a group whose local +Y runs up the pole;
  // the cloth hangs backwards (-Z) from the top and is tagged so animate()
  // flutters it around the pole. Purely visual, no gameplay meaning.
  private makeFlag(s: number, poleH: number, clothW: number, clothH: number): THREE.Group {
    const flag = new THREE.Group();
    const wood = standardMaterial('wood', { color: 0x8a6a44, roughness: 0.95 });
    const gold = standardMaterial('metal', { color: 0xf2c14e, roughness: 0.4, metalness: 0.5 });
    const red = standardMaterial('fabric', { color: FLAG_RED, roughness: 0.85 });
    red.side = THREE.DoubleSide;

    this.addPart(flag, new THREE.CylinderGeometry(0.022 * s, 0.026 * s, poleH, 8), wood, 0, poleH / 2, 0);
    this.addPart(flag, new THREE.SphereGeometry(0.04 * s, 10, 8), gold, 0, poleH + 0.02 * s, 0);

    const cloth = new THREE.Group();
    cloth.position.set(0, poleH - clothH / 2 - 0.03 * s, -clothW / 2);
    cloth.userData.wave = 0.12;
    flag.add(cloth);

    // Subdivided plane pushed along its normal by a sine so the cloth reads as
    // fabric in motion, rotated so its width runs backwards along -Z.
    const geo = new THREE.PlaneGeometry(clothW, clothH, 8, 4);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, Math.sin((pos.getX(i) / clothW) * Math.PI * 2) * clothH * 0.14);
    }
    geo.computeVertexNormals();
    const sheet = new THREE.Mesh(geo, red);
    sheet.rotation.y = Math.PI / 2;
    sheet.castShadow = true;
    cloth.add(sheet);

    const star = new THREE.Mesh(this.starGeometry(clothH * 0.3, 0.012 * s), gold);
    star.rotation.y = Math.PI / 2;
    star.position.set(0.025 * s, 0, 0);
    star.castShadow = true;
    cloth.add(star);
    return flag;
  }

  // Upright low-poly bear that walks on two legs and marches a red banner on a
  // pole gripped in its raised right paw. Slow "tank" enemy: broad shoulders,
  // shaggy fur tufts, clawed paws and a fully modelled face.
  private createBear(size: number): THREE.Group {
    const g = new THREE.Group();
    const s = size;

    // One material per model (not per part) — cheap to build, and setScorched /
    // setEmissive still only ever tint this single enemy.
    const fur = standardMaterial('fabric', { color: ENEMY_COLORS[EnemyType.BEAR], roughness: 0.98 });
    const furLight = standardMaterial('fabric', { color: 0x6d4c33, roughness: 0.98 });
    const furDark = standardMaterial('fabric', { color: 0x241a12, roughness: 0.95 });
    const dark = standardMaterial('fabric', { color: 0x150f0a, roughness: 0.9 });
    const claw = standardMaterial('fabric', { color: 0xe6dcc4, roughness: 0.6 });
    const eye = standardMaterial('fabric', { color: 0xf3efe6, roughness: 0.5 });

    // Two legs: hip pivots swing the whole limb, opposite phase between them.
    for (const side of [-1, 1]) {
      const leg = this.addLimb(g, side * 0.155 * s, -0.06 * s, 0, side * 0.55);
      this.addPart(leg, new THREE.CylinderGeometry(0.135 * s, 0.115 * s, 0.20 * s, 10), fur, 0, -0.10 * s, 0);
      this.addPart(leg, new THREE.SphereGeometry(0.115 * s, 10, 8), furDark, 0, -0.20 * s, 0);
      this.addPart(leg, new THREE.CylinderGeometry(0.105 * s, 0.085 * s, 0.16 * s, 10), fur, 0, -0.29 * s, 0);
      this.addPart(leg, new THREE.BoxGeometry(0.17 * s, 0.09 * s, 0.26 * s), fur, 0, -0.40 * s, 0.05 * s);
      for (let t = -1; t <= 1; t++) {
        this.addPart(leg, new THREE.SphereGeometry(0.045 * s, 8, 6), furDark, t * 0.055 * s, -0.41 * s, 0.175 * s);
        const toe = this.addPart(leg, new THREE.ConeGeometry(0.017 * s, 0.06 * s, 6), claw, t * 0.055 * s, -0.415 * s, 0.225 * s);
        toe.rotation.x = Math.PI / 2;
      }
    }

    // Upright torso: pelvis, belly, broad chest and a lighter chest patch.
    this.addPart(g, new THREE.SphereGeometry(0.22 * s, 14, 10), fur, 0, 0, 0, 1, 0.85, 0.9);
    this.addPart(g, new THREE.SphereGeometry(0.28 * s, 16, 12), fur, 0, 0.15 * s, 0, 1, 1.1, 0.85);
    this.addPart(g, new THREE.SphereGeometry(0.26 * s, 16, 12), fur, 0, 0.29 * s, 0, 1.15, 0.85, 0.8);
    this.addPart(g, new THREE.SphereGeometry(0.17 * s, 14, 10), furLight, 0, 0.24 * s, 0.17 * s, 1, 1.3, 0.4);
    // Shaggy tufts down both flanks
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const tuft = this.addPart(g, new THREE.ConeGeometry(0.06 * s, 0.14 * s, 5), furDark,
          side * (0.20 + i * 0.03) * s, (0.34 - i * 0.11) * s, -0.02 * s);
        tuft.rotation.z = side * 1.1;
      }
    }

    // Neck, head and face
    this.addPart(g, new THREE.CylinderGeometry(0.11 * s, 0.14 * s, 0.10 * s, 10), fur, 0, 0.38 * s, 0);
    this.addPart(g, new THREE.SphereGeometry(0.155 * s, 16, 12), fur, 0, 0.45 * s, 0.02 * s);
    this.addPart(g, new THREE.SphereGeometry(0.09 * s, 12, 10), furLight, 0, 0.41 * s, 0.15 * s, 1, 0.8, 1.2);
    this.addPart(g, new THREE.SphereGeometry(0.035 * s, 8, 8), dark, 0, 0.435 * s, 0.235 * s);
    this.addPart(g, new THREE.BoxGeometry(0.06 * s, 0.015 * s, 0.03 * s), dark, 0, 0.385 * s, 0.20 * s);
    for (const side of [-1, 1]) {
      this.addPart(g, new THREE.SphereGeometry(0.06 * s, 10, 8), fur, side * 0.10 * s, 0.42 * s, 0.08 * s);
      this.addPart(g, new THREE.SphereGeometry(0.032 * s, 8, 6), eye, side * 0.065 * s, 0.475 * s, 0.135 * s);
      this.addPart(g, new THREE.SphereGeometry(0.016 * s, 6, 6), dark, side * 0.065 * s, 0.475 * s, 0.157 * s);
      const brow = this.addPart(g, new THREE.BoxGeometry(0.075 * s, 0.02 * s, 0.05 * s), furDark, side * 0.065 * s, 0.505 * s, 0.13 * s);
      brow.rotation.z = -side * 0.35;
      this.addPart(g, new THREE.SphereGeometry(0.055 * s, 10, 8), fur, side * 0.125 * s, 0.545 * s, 0);
      this.addPart(g, new THREE.SphereGeometry(0.03 * s, 8, 6), dark, side * 0.125 * s, 0.545 * s, 0.03 * s);
    }

    // Left arm: free, swings with the gait
    const leftArm = this.addLimb(g, -0.27 * s, 0.31 * s, 0, -0.4);
    leftArm.rotation.z = -0.12;
    this.addPart(leftArm, new THREE.CylinderGeometry(0.10 * s, 0.085 * s, 0.20 * s, 10), fur, 0, -0.10 * s, 0);
    this.addPart(leftArm, new THREE.SphereGeometry(0.085 * s, 10, 8), furDark, 0, -0.20 * s, 0);
    this.addPart(leftArm, new THREE.CylinderGeometry(0.085 * s, 0.07 * s, 0.18 * s, 10), fur, 0, -0.29 * s, 0);
    this.addPart(leftArm, new THREE.SphereGeometry(0.095 * s, 12, 10), fur, 0, -0.40 * s, 0.02 * s);
    for (let t = -1; t <= 1; t++) {
      const c = this.addPart(leftArm, new THREE.ConeGeometry(0.015 * s, 0.055 * s, 6), claw, t * 0.045 * s, -0.44 * s, 0.075 * s);
      c.rotation.x = Math.PI / 2;
    }

    // Right arm: raised, grips the banner pole (pole counter-rotated upright)
    const rightArm = this.addLimb(g, 0.27 * s, 0.31 * s, 0);
    rightArm.rotation.z = -0.35;
    this.addPart(rightArm, new THREE.CylinderGeometry(0.10 * s, 0.085 * s, 0.20 * s, 10), fur, 0, 0.10 * s, 0);
    this.addPart(rightArm, new THREE.SphereGeometry(0.085 * s, 10, 8), furDark, 0, 0.20 * s, 0);
    this.addPart(rightArm, new THREE.CylinderGeometry(0.085 * s, 0.07 * s, 0.18 * s, 10), fur, 0, 0.29 * s, 0);
    this.addPart(rightArm, new THREE.SphereGeometry(0.095 * s, 12, 10), fur, 0, 0.40 * s, 0.02 * s);
    for (let t = -1; t <= 1; t++) {
      const c = this.addPart(rightArm, new THREE.ConeGeometry(0.015 * s, 0.05 * s, 6), claw, t * 0.045 * s, 0.44 * s, 0.075 * s);
      c.rotation.x = Math.PI / 2;
    }
    const flag = this.makeFlag(s, 0.38 * s, 0.30 * s, 0.22 * s);
    flag.position.set(0, 0.44 * s, 0.02 * s);
    flag.rotation.z = 0.35;
    rightArm.add(flag);
    return g;
  }

  // Low-poly soldier marching on two legs and hauling a white ceramic water
  // closet in both hands - no banner, the flag duty belongs to the bear.
  // Detailed: lug-soled jackboots, knee pads, belt with buckle and pouches,
  // crossed webbing, backpack with bedroll and a slung rifle, helmet with a red
  // star and chin strap, and a moustached face.
  private createSoldier(size: number): THREE.Group {
    const g = new THREE.Group();
    const s = size;
    const uni = standardMaterial('fabric', { color: ENEMY_COLORS[EnemyType.SOLDIER], roughness: 0.95 });
    const uniDark = standardMaterial('fabric', { color: 0x41512a, roughness: 0.95 });
    const helmet = standardMaterial('fabric', { color: 0x5a6b3a, roughness: 0.85 });
    const skin = standardMaterial('fabric', { color: 0xd8a06a, roughness: 0.9 });
    const boot = standardMaterial('fabric', { color: 0x241d16, roughness: 0.7 });
    const web = standardMaterial('fabric', { color: 0x6b5a3a, roughness: 1 });
    const webDark = standardMaterial('fabric', { color: 0x463a24, roughness: 1 });
    const metal = standardMaterial('metal', { color: 0xb9b9b0, roughness: 0.4, metalness: 0.7 });
    const wood = standardMaterial('wood', { color: 0x6e4f2e, roughness: 0.9 });
    const red = standardMaterial('fabric', { color: FLAG_RED, roughness: 0.8 });
    const dark = standardMaterial('fabric', { color: 0x1a1a1a, roughness: 0.9 });
    const eye = standardMaterial('fabric', { color: 0xf3efe6, roughness: 0.5 });
    const ceramic = standardMaterial('concrete', { color: CERAMIC_WHITE, roughness: 0.22, metalness: 0.05 });
    const seatWood = standardMaterial('wood', { color: 0xc9b48c, roughness: 0.6 });

    // Legs: hip pivots swing the limbs, jackboots with lug soles
    for (const side of [-1, 1]) {
      const leg = this.addLimb(g, side * 0.095 * s, -0.11 * s, 0, side * 0.55);
      this.addPart(leg, new THREE.CylinderGeometry(0.075 * s, 0.062 * s, 0.16 * s, 8), uni, 0, -0.08 * s, 0);
      this.addPart(leg, new THREE.SphereGeometry(0.065 * s, 10, 8), uniDark, 0, -0.17 * s, 0);
      this.addPart(leg, new THREE.BoxGeometry(0.075 * s, 0.06 * s, 0.05 * s), webDark, 0, -0.17 * s, 0.05 * s);
      this.addPart(leg, new THREE.CylinderGeometry(0.062 * s, 0.055 * s, 0.15 * s, 8), uni, 0, -0.25 * s, 0);
      this.addPart(leg, new THREE.BoxGeometry(0.10 * s, 0.08 * s, 0.19 * s), boot, 0, -0.34 * s, 0.025 * s);
      this.addPart(leg, new THREE.BoxGeometry(0.11 * s, 0.025 * s, 0.21 * s), webDark, 0, -0.385 * s, 0.03 * s);
    }

    // Torso, belt and webbing
    this.addPart(g, new THREE.BoxGeometry(0.26 * s, 0.12 * s, 0.18 * s), uniDark, 0, -0.04 * s, 0);
    this.addPart(g, new THREE.BoxGeometry(0.30 * s, 0.30 * s, 0.19 * s), uni, 0, 0.13 * s, 0);
    this.addPart(g, new THREE.BoxGeometry(0.34 * s, 0.10 * s, 0.21 * s), uni, 0, 0.26 * s, 0);
    this.addPart(g, new THREE.BoxGeometry(0.31 * s, 0.05 * s, 0.20 * s), webDark, 0, 0, 0);
    this.addPart(g, new THREE.BoxGeometry(0.06 * s, 0.045 * s, 0.02 * s), metal, 0, 0, 0.105 * s);
    for (const side of [-1, 1]) {
      this.addPart(g, new THREE.BoxGeometry(0.09 * s, 0.08 * s, 0.05 * s), web, side * 0.09 * s, -0.005 * s, 0.115 * s);
      this.addPart(g, new THREE.BoxGeometry(0.09 * s, 0.03 * s, 0.13 * s), uniDark, side * 0.15 * s, 0.30 * s, 0);
      const strap = this.addPart(g, new THREE.BoxGeometry(0.045 * s, 0.30 * s, 0.02 * s), web, side * 0.06 * s, 0.15 * s, 0.10 * s);
      strap.rotation.z = side * 0.35;
    }
    // Backpack + bedroll + rifle slung across the pack
    this.addPart(g, new THREE.BoxGeometry(0.24 * s, 0.26 * s, 0.12 * s), web, 0, 0.14 * s, -0.16 * s);
    const bedroll = this.addPart(g, new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.24 * s, 10), webDark, 0, 0.30 * s, -0.16 * s);
    bedroll.rotation.z = Math.PI / 2;
    const barrel = this.addPart(g, new THREE.CylinderGeometry(0.014 * s, 0.014 * s, 0.46 * s, 6), metal, 0.05 * s, 0.18 * s, -0.24 * s);
    barrel.rotation.z = 0.4;
    const stock = this.addPart(g, new THREE.BoxGeometry(0.05 * s, 0.16 * s, 0.035 * s), wood, -0.04 * s, 0.02 * s, -0.24 * s);
    stock.rotation.z = 0.4;

    // Head, face and helmet
    this.addPart(g, new THREE.CylinderGeometry(0.05 * s, 0.06 * s, 0.06 * s, 8), skin, 0, 0.31 * s, 0);
    this.addPart(g, new THREE.BoxGeometry(0.16 * s, 0.05 * s, 0.15 * s), uniDark, 0, 0.31 * s, 0);
    this.addPart(g, new THREE.SphereGeometry(0.105 * s, 16, 12), skin, 0, 0.40 * s, 0);
    for (const side of [-1, 1]) {
      this.addPart(g, new THREE.BoxGeometry(0.035 * s, 0.04 * s, 0.02 * s), red, side * 0.05 * s, 0.315 * s, 0.078 * s);
      this.addPart(g, new THREE.SphereGeometry(0.025 * s, 8, 6), skin, side * 0.105 * s, 0.395 * s, 0);
      this.addPart(g, new THREE.SphereGeometry(0.024 * s, 8, 6), eye, side * 0.042 * s, 0.415 * s, 0.088 * s);
      this.addPart(g, new THREE.SphereGeometry(0.011 * s, 6, 6), dark, side * 0.042 * s, 0.415 * s, 0.105 * s);
      const brow = this.addPart(g, new THREE.BoxGeometry(0.045 * s, 0.012 * s, 0.02 * s), dark, side * 0.045 * s, 0.44 * s, 0.09 * s);
      brow.rotation.z = side * 0.2;
    }
    this.addPart(g, new THREE.SphereGeometry(0.022 * s, 8, 6), skin, 0, 0.395 * s, 0.10 * s);
    this.addPart(g, new THREE.BoxGeometry(0.07 * s, 0.018 * s, 0.02 * s), dark, 0, 0.368 * s, 0.095 * s);
    this.addPart(g, new THREE.BoxGeometry(0.04 * s, 0.008 * s, 0.02 * s), dark, 0, 0.345 * s, 0.095 * s);
    this.addPart(g, new THREE.SphereGeometry(0.125 * s, 16, 10), helmet, 0, 0.44 * s, 0, 1, 0.75, 1.05);
    this.addPart(g, new THREE.CylinderGeometry(0.15 * s, 0.16 * s, 0.03 * s, 14), helmet, 0, 0.44 * s, 0);
    const chinStrap = this.addPart(g, new THREE.TorusGeometry(0.105 * s, 0.008 * s, 6, 14), webDark, 0, 0.36 * s, 0);
    chinStrap.rotation.x = Math.PI / 2;
    this.addPart(g, this.starGeometry(0.035 * s, 0.012 * s), red, 0, 0.45 * s, 0.115 * s);

    // Arms: both hands are full, so they stay put instead of swinging
    for (const side of [-1, 1]) {
      const arm = this.addLimb(g, side * 0.20 * s, 0.24 * s, 0.01 * s);
      arm.rotation.x = -1.0;
      arm.rotation.z = -side * 0.10;
      this.addPart(arm, new THREE.CylinderGeometry(0.055 * s, 0.05 * s, 0.16 * s, 8), uni, 0, -0.08 * s, 0);
      this.addPart(arm, new THREE.SphereGeometry(0.05 * s, 8, 6), uniDark, 0, -0.16 * s, 0);
      this.addPart(arm, new THREE.CylinderGeometry(0.05 * s, 0.045 * s, 0.15 * s, 8), uni, 0, -0.24 * s, 0);
      this.addPart(arm, new THREE.SphereGeometry(0.05 * s, 10, 8), skin, 0, -0.32 * s, 0);
    }

    // The payload: a white ceramic water closet carried at chest height, gripped
    // by the bowl on both sides. Purely visual, no gameplay meaning.
    const wc = new THREE.Group();
    wc.position.set(0, 0.06 * s, 0.26 * s);
    g.add(wc);
    this.addPart(wc, new THREE.CylinderGeometry(0.10 * s, 0.075 * s, 0.16 * s, 12), ceramic, 0, -0.14 * s, -0.01 * s);
    this.addPart(wc, new THREE.SphereGeometry(0.15 * s, 16, 12), ceramic, 0, 0, 0, 1, 0.8, 1);
    const seat = this.addPart(wc, new THREE.TorusGeometry(0.115 * s, 0.03 * s, 8, 16), seatWood, 0, 0.10 * s, 0);
    seat.rotation.x = Math.PI / 2;
    this.addPart(wc, new THREE.BoxGeometry(0.26 * s, 0.20 * s, 0.02 * s), seatWood, 0, 0.20 * s, -0.09 * s);
    this.addPart(wc, new THREE.BoxGeometry(0.28 * s, 0.18 * s, 0.09 * s), ceramic, 0, 0.12 * s, -0.16 * s);
    this.addPart(wc, new THREE.BoxGeometry(0.30 * s, 0.025 * s, 0.11 * s), ceramic, 0, 0.225 * s, -0.16 * s);
    this.addPart(wc, new THREE.CylinderGeometry(0.025 * s, 0.025 * s, 0.02 * s, 10), metal, 0.06 * s, 0.25 * s, -0.16 * s);
    return g;
  }

  // Builds a recognizable low-poly Cheburashka: brown body, big round ears,
  // light belly/muzzle and small eyes + nose. Centered at the origin so the
  // existing position offset (y + size/2) keeps it standing on the ground.
  private createCheburashka(size: number): THREE.Group {
    const g = new THREE.Group();
    const s = size;

    const brown = () => standardMaterial('fabric', { color: 0x8b5a2b, roughness: 0.95 });
    const tan = () => standardMaterial('fabric', { color: 0xd9b38c, roughness: 0.95 });
    const dark = () => standardMaterial('fabric', { color: 0x3b2412, roughness: 0.9 });
    const white = () => standardMaterial('fabric', { color: 0xf5f5f5, roughness: 0.6 });

    const add = (
      geo: THREE.BufferGeometry, mat: THREE.Material,
      x: number, y: number, z: number, sx = 1, sy = 1, sz = 1,
    ) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      g.add(m);
    };

    // Body (slightly tall brown blob) + light belly patch
    add(new THREE.SphereGeometry(0.30 * s, 16, 12), brown(), 0, -0.02 * s, 0, 1, 1.15, 0.9);
    add(new THREE.SphereGeometry(0.20 * s, 16, 12), tan(), 0, -0.03 * s, 0.15 * s, 1, 1.1, 0.6);
    // Head
    add(new THREE.SphereGeometry(0.26 * s, 16, 12), brown(), 0, 0.30 * s, 0);
    // Big round ears (flattened spheres on the sides) + darker inner ears
    add(new THREE.SphereGeometry(0.22 * s, 16, 12), brown(), -0.30 * s, 0.34 * s, 0, 0.3, 1, 1);
    add(new THREE.SphereGeometry(0.22 * s, 16, 12), brown(), 0.30 * s, 0.34 * s, 0, 0.3, 1, 1);
    add(new THREE.SphereGeometry(0.14 * s, 12, 10), dark(), -0.34 * s, 0.34 * s, 0, 0.2, 1, 1);
    add(new THREE.SphereGeometry(0.14 * s, 12, 10), dark(), 0.34 * s, 0.34 * s, 0, 0.2, 1, 1);
    // Light muzzle / face patch
    add(new THREE.SphereGeometry(0.15 * s, 14, 12), tan(), 0, 0.26 * s, 0.18 * s, 1, 0.85, 0.6);
    // Eyes (white + black pupils)
    add(new THREE.SphereGeometry(0.05 * s, 10, 10), white(), -0.09 * s, 0.34 * s, 0.21 * s);
    add(new THREE.SphereGeometry(0.05 * s, 10, 10), white(), 0.09 * s, 0.34 * s, 0.21 * s);
    add(new THREE.SphereGeometry(0.025 * s, 8, 8), dark(), -0.09 * s, 0.34 * s, 0.25 * s);
    add(new THREE.SphereGeometry(0.025 * s, 8, 8), dark(), 0.09 * s, 0.34 * s, 0.25 * s);
    // Nose
    add(new THREE.SphereGeometry(0.03 * s, 8, 8), dark(), 0, 0.27 * s, 0.26 * s);

    return g;
  }
}

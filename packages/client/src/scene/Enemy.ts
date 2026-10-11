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
        this.setScorched(obj, true);
        this.setEmissive(obj, 0x000000);
      } else {
        // Subtle walking bob so the models read as living creatures, not props.
        const phase = (obj.userData.phase as number) ?? 0;
        const bob = Math.sin(now * 6 + phase) * size * 0.035;
        obj.position.set(enemy.position.x, enemy.position.y + size / 2 + bob, enemy.position.z);
        obj.rotation.set(0, yaw, 0);
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

  // A banner on a pole worn on the back (design doc: "Ведмідь (червоний прапор)",
  // "Солдат (прапор)"). Purely visual, no gameplay meaning.
  private addFlag(
    g: THREE.Group, s: number, z: number, baseY: number,
    poleH: number, flagH: number, flagLen: number,
  ) {
    const wood = standardMaterial('wood', { color: 0x8a6a44, roughness: 0.95 });
    const red = standardMaterial('fabric', { color: FLAG_RED, roughness: 0.85 });
    this.addPart(g, new THREE.CylinderGeometry(0.022 * s, 0.022 * s, poleH, 6), wood, 0, baseY + poleH / 2, z);
    this.addPart(g, new THREE.BoxGeometry(0.02 * s, flagH, flagLen), red, 0, baseY + poleH - flagH / 2, z + flagLen / 2);
  }

  // Low-poly bear: heavy brown body on four legs, humped shoulders, head with
  // snout/ears and a red banner on its back. Slower "tank" enemy.
  private createBear(size: number): THREE.Group {
    const g = new THREE.Group();
    const s = size;
    const fur = () => standardMaterial('fabric', { color: ENEMY_COLORS[EnemyType.BEAR], roughness: 0.98 });
    const dark = () => standardMaterial('fabric', { color: 0x241a12, roughness: 0.9 });

    // Four legs
    const legGeo = new THREE.CylinderGeometry(0.13 * s, 0.15 * s, 0.3 * s, 8);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.addPart(g, legGeo, fur(), sx * 0.22 * s, -0.36 * s, sz * 0.3 * s);
      }
    }
    // Massive body + shoulder hump
    this.addPart(g, new THREE.SphereGeometry(0.36 * s, 16, 12), fur(), 0, -0.05 * s, -0.02 * s, 1.15, 0.95, 1.35);
    this.addPart(g, new THREE.SphereGeometry(0.22 * s, 14, 10), fur(), 0, 0.22 * s, -0.18 * s, 1.15, 0.75, 1);
    // Head, snout, nose
    this.addPart(g, new THREE.SphereGeometry(0.21 * s, 16, 12), fur(), 0, 0.18 * s, 0.38 * s);
    this.addPart(g, new THREE.SphereGeometry(0.11 * s, 12, 10), fur(), 0, 0.1 * s, 0.55 * s, 0.9, 0.75, 1.2);
    this.addPart(g, new THREE.SphereGeometry(0.05 * s, 8, 8), dark(), 0, 0.14 * s, 0.64 * s);
    // Round ears + eyes
    this.addPart(g, new THREE.SphereGeometry(0.075 * s, 10, 8), fur(), -0.16 * s, 0.34 * s, 0.34 * s);
    this.addPart(g, new THREE.SphereGeometry(0.075 * s, 10, 8), fur(), 0.16 * s, 0.34 * s, 0.34 * s);
    this.addPart(g, new THREE.SphereGeometry(0.03 * s, 8, 8), dark(), -0.085 * s, 0.22 * s, 0.55 * s);
    this.addPart(g, new THREE.SphereGeometry(0.03 * s, 8, 8), dark(), 0.085 * s, 0.22 * s, 0.55 * s);
    // Red banner on its back
    this.addFlag(g, s, -0.1 * s, 0.28 * s, 0.45 * s, 0.26 * s, 0.4 * s);
    return g;
  }

  // Low-poly soldier: olive uniform, boots, webbing + backpack, skin head under
  // a helmet, and a banner on the back.
  private createSoldier(size: number): THREE.Group {
    const g = new THREE.Group();
    const s = size;
    const uni = () => standardMaterial('fabric', { color: ENEMY_COLORS[EnemyType.SOLDIER], roughness: 0.95 });
    const helmet = () => standardMaterial('fabric', { color: 0x5a6b3a, roughness: 0.85 });
    const skin = () => standardMaterial('fabric', { color: 0xd8a06a, roughness: 0.9 });
    const boot = () => standardMaterial('fabric', { color: 0x241d16, roughness: 0.9 });
    const web = () => standardMaterial('fabric', { color: 0x6b5a3a, roughness: 1 });

    // Legs + boots
    const legGeo = new THREE.BoxGeometry(0.14 * s, 0.4 * s, 0.16 * s);
    this.addPart(g, legGeo, uni(), -0.1 * s, -0.28 * s, 0);
    this.addPart(g, legGeo, uni(), 0.1 * s, -0.28 * s, 0);
    const bootGeo = new THREE.BoxGeometry(0.16 * s, 0.1 * s, 0.26 * s);
    this.addPart(g, bootGeo, boot(), -0.1 * s, -0.45 * s, 0.03 * s);
    this.addPart(g, bootGeo, boot(), 0.1 * s, -0.45 * s, 0.03 * s);
    // Torso + webbing + backpack
    this.addPart(g, new THREE.BoxGeometry(0.38 * s, 0.42 * s, 0.24 * s), uni(), 0, 0.08 * s, 0);
    this.addPart(g, new THREE.BoxGeometry(0.4 * s, 0.1 * s, 0.27 * s), web(), 0, 0.12 * s, 0);
    this.addPart(g, new THREE.BoxGeometry(0.3 * s, 0.32 * s, 0.14 * s), web(), 0, 0.1 * s, -0.19 * s);
    // Arms
    const armGeo = new THREE.BoxGeometry(0.12 * s, 0.38 * s, 0.14 * s);
    this.addPart(g, armGeo, uni(), -0.26 * s, 0.08 * s, 0);
    this.addPart(g, armGeo, uni(), 0.26 * s, 0.08 * s, 0);
    // Head + helmet
    this.addPart(g, new THREE.SphereGeometry(0.135 * s, 14, 12), skin(), 0, 0.4 * s, 0);
    this.addPart(g, new THREE.SphereGeometry(0.17 * s, 14, 10), helmet(), 0, 0.45 * s, 0, 1, 0.72, 1.05);
    this.addPart(g, new THREE.CylinderGeometry(0.21 * s, 0.21 * s, 0.035 * s, 12), helmet(), 0, 0.45 * s, 0);
    // Banner on the backpack
    this.addFlag(g, s, -0.19 * s, 0.26 * s, 0.45 * s, 0.22 * s, 0.34 * s);
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

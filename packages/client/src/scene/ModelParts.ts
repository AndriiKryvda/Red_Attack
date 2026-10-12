import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Shared building blocks for the hand-built enemy models (Enemy.ts for the foot
// troops, VehicleModels.ts for the golf car, the motorcyclist and the tank).
//
// Convention everywhere: local +Z is the direction of march, the origin sits in
// the middle of the model, and the ground plane is at local y = -size / 2.
// ─────────────────────────────────────────────────────────────────────────────

/** Add a shadow-casting part to a model group (parts face +Z). */
export function addPart(
  g: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
  x: number, y: number, z: number, sx = 1, sy = 1, sz = 1,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  g.add(m);
  return m;
}

/**
 * A limb pivot: place it at a joint and rotating the returned group swings
 * everything attached to it. Tagged so animate() adds the walking swing.
 */
export function addLimb(g: THREE.Object3D, x: number, y: number, z: number, swing = 0): THREE.Group {
  const limb = new THREE.Group();
  limb.position.set(x, y, z);
  if (swing !== 0) limb.userData.swing = swing;
  g.add(limb);
  return limb;
}

/** A wheel pivot at an axle point; animate() spins it around X at `roll` rad/s. */
export function addWheelPivot(g: THREE.Object3D, x: number, y: number, z: number, roll: number): THREE.Group {
  const w = new THREE.Group();
  w.position.set(x, y, z);
  w.userData.roll = roll;
  g.add(w);
  return w;
}

/** A straight tube between two points: forks, roll bars, exhausts, antennae. */
export function addTube(
  g: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, seg = 10,
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length() || 0.001;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  m.castShadow = true;
  g.add(m);
  return m;
}

/** Flat five-pointed star (helmet badge, turret emblem), extruded so it catches light. */
export function starGeometry(radius: number, depth: number): THREE.ExtrudeGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radius : radius * 0.42;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  return new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth, bevelEnabled: false });
}

/**
 * The animated parts of a model, collected once: swinging limbs and rolling
 * wheels. A tank carries a couple of hundred meshes, so walking the whole tree
 * every frame for every enemy would be wasted work.
 */
export function collectAnimated(root: THREE.Object3D): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  root.traverse(function visit(obj: THREE.Object3D) {
    if (obj.userData.swing !== undefined || obj.userData.roll !== undefined) parts.push(obj);
    for (const child of obj.children) visit(child);
  });
  return parts;
}
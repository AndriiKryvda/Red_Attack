import * as THREE from 'three';
import { standardMaterial } from './Textures';
import { MAP_SIZE, OUTPOST_RADIUS } from '@red-attack/shared';

// Deterministic PRNG (mulberry32): the forest is laid out identically on every
// client and on every reload, so the horizon reads as a real wood instead of
// reshuffling between sessions.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TREE_COUNT = 170;
const TREE_MIN_SPACING = 5.5;               // meters between neighbouring trunks
const TREE_MARGIN = 14;                     // keep trees inside the ground plane
const CLEARING_RADIUS = OUTPOST_RADIUS + 6; // never block the fort approach

interface TreeSpot { x: number; z: number; scale: number; rot: number; }

// Rejection-sampled scatter: random positions, but every trunk keeps a minimum
// distance from its neighbours so the wood reads as trees instead of noise.
function scatterTrees(rand: () => number): TreeSpot[] {
  const half = MAP_SIZE / 2 - TREE_MARGIN;
  const spots: TreeSpot[] = [];
  let guard = TREE_COUNT * 80; // hard stop so a tight packing can never hang
  while (spots.length < TREE_COUNT && guard-- > 0) {
    const x = (rand() * 2 - 1) * half;
    const z = (rand() * 2 - 1) * half;
    if (Math.hypot(x, z) < CLEARING_RADIUS) continue;
    let ok = true;
    for (const s of spots) {
      const dx = s.x - x;
      const dz = s.z - z;
      if (dx * dx + dz * dz < TREE_MIN_SPACING * TREE_MIN_SPACING) { ok = false; break; }
    }
    if (!ok) continue;
    spots.push({ x, z, scale: 0.6 + rand() * 0.95, rot: rand() * Math.PI * 2 });
  }
  return spots;
}

// One InstancedMesh per tree part: ~170 trees cost 4 draw calls instead of ~700
// separate meshes, so the much bigger forest is essentially free to render.
function addTrees(group: THREE.Group, spots: TreeSpot[], rand: () => number): void {
  const trunkMat = standardMaterial('bark', { rx: 1, ry: 2, roughness: 0.9 });
  const foliageMat = standardMaterial('foliage', { rx: 2, ry: 2, roughness: 1 });

  // Unit tree: base at y = 0, ~7 m tall before per-tree scaling.
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.45, 2, 6);
  trunkGeo.translate(0, 1, 0);
  const coneLow = new THREE.ConeGeometry(2.0, 3.2, 7);
  coneLow.translate(0, 3.4, 0);
  const coneMid = new THREE.ConeGeometry(1.55, 2.7, 7);
  coneMid.translate(0, 4.6, 0);
  const coneTop = new THREE.ConeGeometry(1.05, 2.3, 7);
  coneTop.translate(0, 5.7, 0);

  // Instance colors multiply the (already dark) bark/foliage textures, so the
  // palette stays light: white keeps the texture as authored, the rest add
  // per-tree variation so the forest does not look copy-pasted.
  const greens = [0xffffff, 0xdcead0, 0xbcd8a4, 0x9fc487, 0xe9f2dc];
  const browns = [0xffffff, 0xd9c6ad, 0xbfa483];

  const addLayer = (geo: THREE.BufferGeometry, mat: THREE.Material, palette: number[]) => {
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // instances live far from the source geometry
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    spots.forEach((s, i) => {
      dummy.position.set(s.x, 0, s.z);
      dummy.rotation.set(0, s.rot, 0);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.setHex(palette[(rand() * palette.length) | 0]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  };

  addLayer(trunkGeo, trunkMat, browns);
  addLayer(coneLow, foliageMat, greens);
  addLayer(coneMid, foliageMat, greens);
  addLayer(coneTop, foliageMat, greens);
}

export function createTerrain(): THREE.Group {
  const group = new THREE.Group();
  const rand = mulberry32(0x5eed1234);

  // Flat ground plane — the field has no hill, so nothing hides an elevation.
  const groundGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 30, 30);
  const groundMat = standardMaterial('grass', { rx: 40, ry: 40, roughness: 1, metalness: 0, normalScale: 1.2 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  addTrees(group, scatterTrees(rand), rand);

  return group;
}
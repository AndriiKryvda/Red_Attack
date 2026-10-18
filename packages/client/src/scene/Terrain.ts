import * as THREE from 'three';
import { standardMaterial } from './Textures';
import { MAP_SIZE, generateTreeSpots, type TreeSpot } from '@red-attack/shared';

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

  // Flat ground plane — the field has no hill, so nothing hides an elevation.
  const groundGeo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 30, 30);
  const groundMat = standardMaterial('grass', { rx: 40, ry: 40, roughness: 1, metalness: 0, normalScale: 1.2 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  addTrees(group, generateTreeSpots(), Math.random);

  return group;
}
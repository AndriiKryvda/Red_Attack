import * as THREE from 'three';
import { standardMaterial } from './Textures';

export function createTerrain(): THREE.Group {
  const group = new THREE.Group();

  // Ground plane
  const groundGeo = new THREE.PlaneGeometry(300, 300, 30, 30);
  const groundMat = standardMaterial('grass', { rx: 40, ry: 40, roughness: 1, metalness: 0, normalScale: 1.2 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Some decorative trees (low-poly cones)
  const treeMat = standardMaterial('foliage', { rx: 2, ry: 2, roughness: 1 });
  const trunkMat = standardMaterial('bark', { rx: 1, ry: 2, roughness: 0.9 });
  for (let i = 0; i < 30; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * 80;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const treeGroup = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2, 6), trunkMat);
    trunk.position.y = 1;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(2, 4, 6), treeMat);
    crown.position.y = 4;
    treeGroup.add(trunk, crown);
    treeGroup.position.set(x, 0, z);
    treeGroup.castShadow = true;
    group.add(treeGroup);
  }

  return group;
}

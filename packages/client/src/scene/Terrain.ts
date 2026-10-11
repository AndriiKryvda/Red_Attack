import * as THREE from 'three';

export function createTerrain(): THREE.Group {
  const group = new THREE.Group();

  // Ground plane
  const groundGeo = new THREE.PlaneGeometry(300, 300, 30, 30);
  const groundMat = new THREE.MeshToonMaterial({ color: 0x4a7c3f });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Hill (cone)
  const hillGeo = new THREE.ConeGeometry(40, 15, 16);
  const hillMat = new THREE.MeshToonMaterial({ color: 0x5a8c4f });
  const hill = new THREE.Mesh(hillGeo, hillMat);
  hill.position.y = 7.5;
  hill.receiveShadow = true;
  hill.castShadow = true;
  group.add(hill);

  // Some decorative trees (low-poly cones)
  const treeMat = new THREE.MeshToonMaterial({ color: 0x2d5a27 });
  const trunkMat = new THREE.MeshToonMaterial({ color: 0x5c3a1e });
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

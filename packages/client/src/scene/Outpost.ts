import * as THREE from 'three';

export function createOutpost(): THREE.Group {
  const group = new THREE.Group();

  // Main building
  const buildingGeo = new THREE.BoxGeometry(6, 4, 6);
  const buildingMat = new THREE.MeshToonMaterial({ color: 0x8b7355 });
  const building = new THREE.Mesh(buildingGeo, buildingMat);
  building.position.y = 2;
  building.castShadow = true;
  building.receiveShadow = true;
  group.add(building);

  // Roof
  const roofGeo = new THREE.ConeGeometry(5, 3, 4);
  const roofMat = new THREE.MeshToonMaterial({ color: 0x8b0000 });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.y = 5.5;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  group.add(roof);

  // Walls (4 sides)
  const wallMat = new THREE.MeshToonMaterial({ color: 0x6b5b3e });
  const wallGeo = new THREE.BoxGeometry(12, 3, 0.5);
  const positions = [
    { x: 0, z: 6, ry: 0 },
    { x: 0, z: -6, ry: 0 },
    { x: 6, z: 0, ry: Math.PI / 2 },
    { x: -6, z: 0, ry: Math.PI / 2 },
  ];
  for (const p of positions) {
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(p.x, 1.5, p.z);
    wall.rotation.y = p.ry;
    wall.castShadow = true;
    group.add(wall);
  }

  // Flag pole
  const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 8, 6);
  const poleMat = new THREE.MeshToonMaterial({ color: 0x888888 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(4, 4, 4);
  group.add(pole);

  // Flag
  const flagGeo = new THREE.PlaneGeometry(2, 1.2);
  const flagMat = new THREE.MeshToonMaterial({ color: 0xff0000, side: THREE.DoubleSide });
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(5, 7.2, 4);
  group.add(flag);

  group.position.y = 15; // on top of hill
  return group;
}

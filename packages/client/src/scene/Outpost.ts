import * as THREE from 'three';
import { standardMaterial } from './Textures';

export function createOutpost(): THREE.Group {
  const group = new THREE.Group();

  // Main building
  const buildingGeo = new THREE.BoxGeometry(6, 4, 6);
  const buildingMat = standardMaterial('wood', { rx: 3, ry: 2, roughness: 0.8 });
  const building = new THREE.Mesh(buildingGeo, buildingMat);
  building.position.y = 2;
  building.castShadow = true;
  building.receiveShadow = true;
  group.add(building);

  // Roof
  const roofGeo = new THREE.ConeGeometry(5, 3, 4);
  const roofMat = standardMaterial('roof', { rx: 4, ry: 2, roughness: 0.7 });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.y = 5.5;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  group.add(roof);

  // Walls (4 sides)
  const wallMat = standardMaterial('wood', { rx: 6, ry: 1.5, roughness: 0.85 });
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
  const poleMat = standardMaterial('metal', { rx: 1, ry: 2, metalness: 0.9, roughness: 0.4 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(4, 4, 4);
  group.add(pole);

  // Flag
  const flagGeo = new THREE.PlaneGeometry(2, 1.2);
  const flagMat = standardMaterial('fabric', { color: 0xff0000, roughness: 0.9 });
  flagMat.side = THREE.DoubleSide;
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(5, 7.2, 4);
  group.add(flag);

  group.position.y = 15; // on top of hill
  return group;
}

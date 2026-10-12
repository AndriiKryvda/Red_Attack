import * as THREE from 'three';
import { standardMaterial, getMaps } from './Textures';

// The fort flies the Ukrainian national flag: blue over yellow. Painted on a
// canvas so both bands live on one quad (no seam, no second mesh) and still pick
// up the shared fabric weave/normal map.
function ukraineFlagTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 160;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#0057b7'; // sky blue, top half
  ctx.fillRect(0, 0, w, h / 2);
  ctx.fillStyle = '#ffd700'; // wheat gold, bottom half
  ctx.fillRect(0, h / 2, w, h / 2);

  // Soft vertical shading so the cloth never reads as flat plastic, plus a
  // crisp seam line where the two bands meet.
  const shade = ctx.createLinearGradient(0, 0, w, 0);
  shade.addColorStop(0, 'rgba(0,0,0,0.22)');
  shade.addColorStop(0.35, 'rgba(255,255,255,0.10)');
  shade.addColorStop(0.7, 'rgba(0,0,0,0.14)');
  shade.addColorStop(1, 'rgba(255,255,255,0.12)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, h / 2 - 1, w, 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Flat quad gently rippled along its length: the free edge (away from the pole)
// swings the most, so the banner looks like it is hanging in a light breeze.
function flagGeometry(): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(2, 1.2, 14, 8);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = (x + 1) / 2; // 0 at the pole edge, 1 at the free edge
    pos.setZ(i, Math.sin(t * 5.5 + y * 1.6) * 0.11 * t * t);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

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

  // Flag — Ukrainian blue-and-yellow, woven cloth lit like the rest of the fort.
  const fabric = getMaps('fabric');
  const flagMat = new THREE.MeshStandardMaterial({
    map: ukraineFlagTexture(),
    normalMap: fabric.normalMap,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const flag = new THREE.Mesh(flagGeometry(), flagMat);
  flag.position.set(5, 7.2, 4);
  flag.castShadow = true;
  group.add(flag);

  group.position.y = 0; // on flat ground
  return group;
}

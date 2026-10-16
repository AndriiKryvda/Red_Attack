import * as THREE from 'three';
import { FORT_PERIMETER, MORTAR_POSITION } from '@red-attack/shared';
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

/** Half the side of the fenced perimeter, so the wire matches the breach line. */
const HALF = FORT_PERIMETER;

/** Materials shared across the whole fort so one texture cache serves it all. */
interface FortMats {
  earth: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  asphalt: THREE.MeshStandardMaterial;
  bag: THREE.MeshStandardMaterial;
  timber: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
}

function addBox(
  group: THREE.Group, mat: THREE.Material,
  w: number, h: number, d: number, x: number, y: number, z: number, ry = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

/**
 * A course of sandbags along a straight line: the fort's revetment. Bags are laid
 * half-offset between courses like real ones, with a touch of jitter so the wall
 * never looks machined.
 */
function sandbagCourse(
  group: THREE.Group, mat: THREE.Material,
  x1: number, z1: number, x2: number, z2: number, baseY: number, rows: number,
) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const n = Math.max(1, Math.round(len / 2.25));
  const ux = (x2 - x1) / len;
  const uz = (z2 - z1) / len;
  // Long axis of the bag along the wall: local +X has to land on (ux, uz).
  const yaw = Math.atan2(-uz, ux);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    for (let row = 0; row < rows; row++) {
      const shift = (row % 2 === 0 ? 0 : 0.5) * (len / n);
      const at = Math.min(len, t * len + shift - len / n / 2);
      const bag = new THREE.Mesh(SANDBAG_GEO, mat);
      bag.position.set(
        x1 + ux * at + (Math.random() - 0.5) * 0.12,
        baseY + row * 0.52,
        z1 + uz * at + (Math.random() - 0.5) * 0.12,
      );
      bag.rotation.y = yaw + (Math.random() - 0.5) * 0.07;
      bag.castShadow = true;
      bag.receiveShadow = true;
      group.add(bag);
    }
  }
}

const SANDBAG_GEO = new THREE.BoxGeometry(2.1, 0.5, 0.95);

/** Sandbagged firing platform in a corner: posts, deck, parapet. */
function watchtower(group: THREE.Group, mats: FortMats, x: number, z: number) {
  for (const [ox, oz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
    addBox(group, mats.timber, 0.22, 3.1, 0.22, x + ox, 1.55, z + oz);
  }
  addBox(group, mats.timber, 2.7, 0.24, 2.7, x, 3.15, z);
  addBox(group, mats.timber, 2.7, 0.16, 0.14, x, 3.7, z - 1.25);
  addBox(group, mats.timber, 0.14, 0.16, 2.7, x - 1.25, 3.7, z);
  // Sandbag parapet on the two faces that look out over the field.
  for (const [ox, oz] of [[-1.05, 0], [1.05, 0], [0, -1.05], [0, 1.05]]) {
    const bag = new THREE.Mesh(SANDBAG_GEO, mats.bag);
    bag.position.set(x + ox, 3.55, z + oz);
    bag.rotation.y = ox === 0 ? 0 : Math.PI / 2;
    bag.scale.set(0.9, 1, 1);
    bag.castShadow = true;
    group.add(bag);
  }
}

/**
 * The fort: an open fortified position rather than a building. A packed-dirt
 * courtyard inside an earth-and-sandbag berm with corner firing platforms, a
 * roofless concrete command bunker, a drone launch pad and the mortar slab - the
 * pilot stands in the middle of the yard and turns to face whatever is coming.
 *
 * Nothing here is a collision volume: the fort is scenery, and the horde is
 * stopped by the fence line (FORT_PERIMETER), which is where the server counts a
 * breach.
 */
export function createOutpost(): THREE.Group {
  const group = new THREE.Group();
  const mats: FortMats = {
    earth: standardMaterial('dirt', { rx: 5, ry: 5, color: 0x9c8a6b, roughness: 1 }),
    concrete: standardMaterial('concrete', { rx: 3, ry: 3, roughness: 0.95 }),
    asphalt: standardMaterial('concrete', { rx: 2, ry: 2, color: 0x4a4d4f, roughness: 0.95 }),
    bag: standardMaterial('fabric', { rx: 1, ry: 1, color: 0x9c8f6a, roughness: 0.95 }),
    timber: standardMaterial('wood', { rx: 2, ry: 1, roughness: 0.9 }),
    steel: standardMaterial('metal', { rx: 1, ry: 1, color: 0x50564b, metalness: 0.7, roughness: 0.55 }),
  };

  // Courtyard: packed earth, so the yard reads differently from the fields.
  const yard = new THREE.Mesh(new THREE.CircleGeometry(HALF + 2, 56), mats.earth);
  yard.rotation.x = -Math.PI / 2;
  yard.position.y = 0.02;
  yard.receiveShadow = true;
  group.add(yard);

  // Berm: an earth wall on all four sides with a gate in the south face.
  const H = 2.3;
  addBox(group, mats.earth, HALF * 2 + 2.4, H, 2.4, 0, H / 2, -HALF);
  addBox(group, mats.earth, 2.4, H, HALF * 2 + 2.4, HALF, H / 2, 0);
  addBox(group, mats.earth, 2.4, H, HALF * 2 + 2.4, -HALF, H / 2, 0);
  const seg = HALF + 1.2 - 3.6;
  addBox(group, mats.earth, seg, H, 2.4, -(3.6 + seg / 2), H / 2, HALF);
  addBox(group, mats.earth, seg, H, 2.4, 3.6 + seg / 2, H / 2, HALF);

  // Sandbag revetment along the crest, and a couple of courses at the gate.
  sandbagCourse(group, mats.bag, -HALF - 1, -HALF, HALF + 1, -HALF, H + 0.25, 2);
  sandbagCourse(group, mats.bag, -HALF - 1, HALF, -3.6, HALF, H + 0.25, 2);
  sandbagCourse(group, mats.bag, 3.6, HALF, HALF + 1, HALF, H + 0.25, 2);
  sandbagCourse(group, mats.bag, HALF, -HALF - 1, HALF, HALF + 1, H + 0.25, 2);
  sandbagCourse(group, mats.bag, -HALF, -HALF - 1, -HALF, HALF + 1, H + 0.25, 2);

  // Corner firing platforms.
  const t = HALF - 1.4;
  watchtower(group, mats, -t, -t);
  watchtower(group, mats, t, -t);
  watchtower(group, mats, -t, t);
  watchtower(group, mats, t, t);

  buildBunker(group, mats, -6.5, -6.5);
  buildDronePad(group, mats, -6.5, 6.5);
  buildMortarPad(group, mats);
  buildGate(group, mats);

  // Flag: the fort is worth knowing which flag it holds.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 11, 8), mats.steel);
  pole.position.set(0, 5.5, -9.5);
  pole.castShadow = true;
  group.add(pole);
  const fabric = getMaps('fabric');
  const flagMat = new THREE.MeshStandardMaterial({
    map: ukraineFlagTexture(),
    normalMap: fabric.normalMap,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const flag = new THREE.Mesh(flagGeometry(), flagMat);
  flag.position.set(1.05, 10.1, -9.5);
  flag.castShadow = true;
  group.add(flag);

  group.position.y = 0; // on flat ground
  return group;
}

/** Painted marking on concrete: pad rings and the mortar arc. */
function paintMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xdad5c2, roughness: 0.9, metalness: 0 });
}

/**
 * Roofless command bunker: four concrete walls, a floor slab and a sandbag
 * crest, open to the sky. It is a fighting position and a store, not a house -
 * the pilot can see over it from the middle of the yard.
 */
function buildBunker(group: THREE.Group, mats: FortMats, x: number, z: number) {
  const bw = 8;
  const bd = 7;
  const th = 0.7;
  const h = 2.6;
  addBox(group, mats.concrete, bw + 1.4, 0.18, bd + 1.4, x, 0.09, z);
  addBox(group, mats.concrete, bw, h, th, x, h / 2, z - bd / 2);
  addBox(group, mats.concrete, th, h, bd, x - bw / 2, h / 2, z);
  addBox(group, mats.concrete, th, h, bd, x + bw / 2, h / 2, z);
  // South face left open as a doorway, 2.6 m wide.
  addBox(group, mats.concrete, 2.7, h, th, x - 2.65, h / 2, z + bd / 2);
  addBox(group, mats.concrete, 2.7, h, th, x + 2.65, h / 2, z + bd / 2);

  sandbagCourse(group, mats.bag, x - bw / 2, z - bd / 2, x + bw / 2, z - bd / 2, h + 0.25, 1);
  sandbagCourse(group, mats.bag, x - bw / 2, z + bd / 2, x + bw / 2, z + bd / 2, h + 0.25, 1);

  // Stores inside: a work bench, crates of rounds, a generator.
  addBox(group, mats.timber, 2.6, 0.16, 1.1, x - 1.4, 0.95, z - 2.4);
  addBox(group, mats.timber, 0.16, 0.9, 1.0, x - 2.6, 0.45, z - 2.4);
  addBox(group, mats.timber, 0.16, 0.9, 1.0, x - 0.2, 0.45, z - 2.4);
  addBox(group, mats.timber, 1.1, 0.75, 1.1, x + 2.4, 0.55, z - 1.6, 0.2);
  addBox(group, mats.timber, 1.1, 0.75, 1.1, x + 2.4, 1.3, z - 1.6, -0.15);
  addBox(group, mats.steel, 1.5, 0.9, 0.9, x + 1.6, 0.63, z + 2.2);

  // Radio mast beside it: the fort's only tall thing apart from the flagpole.
  const mx = x - bw / 2 - 1.6;
  const mz = z + bd / 2 + 1.4;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 7.5, 8), mats.steel);
  mast.position.set(mx, 3.75, mz);
  mast.castShadow = true;
  group.add(mast);
  for (let i = 0; i < 3; i++) {
    addBox(group, mats.steel, 1.3 - i * 0.3, 0.07, 0.07, mx, 5.0 + i * 0.85, mz);
  }
}

/**
 * Drone launch pad: a dark asphalt circle with a painted ring, edge lamps and a
 * windsock. Quads lift from over the yard, but this is where they live between
 * sorties, and it is what tells the story of what the fort is for.
 */
function buildDronePad(group: THREE.Group, mats: FortMats, x: number, z: number) {
  const paint = paintMaterial();
  const pad = new THREE.Mesh(new THREE.CircleGeometry(3.6, 44), mats.asphalt);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(x, 0.05, z);
  pad.receiveShadow = true;
  group.add(pad);

  const ring = new THREE.Mesh(new THREE.RingGeometry(2.45, 2.8, 44), paint);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.07, z);
  group.add(ring);
  addBox(group, paint, 0.34, 0.02, 4.4, x, 0.07, z);
  addBox(group, paint, 4.4, 0.02, 0.34, x, 0.07, z);

  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd35c });
  for (const [ox, oz] of [[0, 3.25], [3.25, 0], [0, -3.25], [-3.25, 0]]) {
    addBox(group, mats.steel, 0.14, 0.6, 0.14, x + ox, 0.3, z + oz);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), lampMat);
    bulb.position.set(x + ox, 0.68, z + oz);
    group.add(bulb);
  }

  // Windsock: worth having when a quad is flown by eye as much as by camera.
  const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.3, 1.1, 8), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.8 }));
  sock.rotation.z = Math.PI / 2;
  sock.position.set(x + 4.6, 3.6, z - 4.6);
  group.add(sock);
  addBox(group, mats.steel, 0.12, 3.8, 0.12, x + 5.1, 1.9, z - 4.6);

  // Spare airframes and stores racked at the pad edge.
  addBox(group, mats.timber, 1.3, 0.8, 1.3, x - 4.4, 0.4, z + 2.2, 0.25);
  addBox(group, mats.timber, 1.3, 0.8, 1.3, x - 4.4, 1.2, z + 2.2, -0.1);
  addBox(group, mats.timber, 1.6, 0.5, 0.9, x - 4.2, 0.25, z - 2.6, 0.4);
}

/**
 * Mortar slab: a concrete pad under the tube with a painted lay-line, an ammo
 * dump and a sandbag shield on the side that faces the field. The tube itself is
 * a live model (MortarView) placed from the same constant, so the slab and the
 * weapon can never drift apart.
 */
function buildMortarPad(group: THREE.Group, mats: FortMats) {
  const mx = MORTAR_POSITION.x;
  const mz = MORTAR_POSITION.z;
  addBox(group, mats.concrete, 6.2, 0.2, 6.2, mx, 0.1, mz);

  const paint = paintMaterial();
  const arc = new THREE.Mesh(
    new THREE.RingGeometry(2.15, 2.4, 40, 1, Math.PI * 0.8, Math.PI * 1.4),
    paint,
  );
  arc.rotation.x = -Math.PI / 2;
  arc.position.set(mx, 0.21, mz);
  group.add(arc);

  // Shielding: the tube works to the north-east, so that is the side that gets
  // the sandbags; the rest of the slab stays open for the crew to work around.
  sandbagCourse(group, mats.bag, mx - 2.7, mz - 2.7, mx + 2.7, mz - 2.7, 0.45, 2);
  sandbagCourse(group, mats.bag, mx + 2.7, mz - 2.7, mx + 2.7, mz + 2.7, 0.45, 2);

  addBox(group, mats.timber, 1.15, 0.75, 1.15, mx - 2.3, 0.58, mz + 1.9, 0.18);
  addBox(group, mats.timber, 1.15, 0.75, 1.15, mx - 2.3, 1.33, mz + 1.9, -0.12);
  addBox(group, mats.steel, 0.9, 0.9, 0.9, mx + 1.9, 0.65, mz + 2.4, 0.4);
}

/** Gate through the berm on the south face: posts, a lintel and vehicle blocks. */
function buildGate(group: THREE.Group, mats: FortMats) {
  for (const sx of [-3.6, 3.6]) {
    addBox(group, mats.timber, 0.55, 3.4, 0.55, sx, 1.7, HALF);
  }
  addBox(group, mats.timber, 8.4, 0.55, 0.7, 0, 3.65, HALF);
  addBox(group, mats.timber, 3.2, 0.24, 0.24, -1.7, 0.85, HALF, 0.55);
  addBox(group, mats.timber, 3.2, 0.24, 0.24, 1.7, 0.85, HALF, -0.55);

  // Fuel drums and loose stores around the yard.
  const drum = new THREE.CylinderGeometry(0.42, 0.42, 1.15, 12);
  for (const [dx, dz] of [[-2.6, 9.6], [-1.7, 10.1], [9.6, -6.2], [10.2, -5.2]]) {
    const d = new THREE.Mesh(drum, mats.steel);
    d.position.set(dx, 0.58, dz);
    d.castShadow = true;
    group.add(d);
  }
}

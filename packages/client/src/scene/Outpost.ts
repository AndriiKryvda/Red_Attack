import * as THREE from 'three';
import { FORT_PERIMETER, MORTAR_POSITION } from '@red-attack/shared';
import { standardMaterial, getMaps } from './Textures';

// The fort flies the Ukrainian national flag: blue over yellow. Painted on a
// canvas so both bands live on one quad (no seam, no second mesh) and still pick
// up the shared fabric weave/normal map.
function ukraineFlagTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
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
function flagGeometry(w: number, h: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(w, h, 16, 9);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = (x + w / 2) / w; // 0 at the pole edge, 1 at the free edge
    pos.setZ(i, Math.sin(t * 5.5 + (y / h) * 3.2) * 0.06 * w * t * t);
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

// ─── Sandbags ──────────────────────────────────────────────────────────────
// The fort is built out of sandbags, so nearly every vertical surface in it is
// one or more courses of them. Bags are gathered into a plain list while the
// position is laid out and turned into a single InstancedMesh at the end: a few
// thousand bags stay one draw call that way, which is what lets the berm be
// bagged right through instead of only on the face.

/** One filled bag: long, flat, and deep enough that three of them fill a berm. */
const BAG_L = 1.15;
const BAG_H = 0.44;
const BAG_D = 0.8;
/** Vertical pitch between courses - bags squash flat onto the course below. */
const BAG_ROW = 0.38;

/** One bag waiting to be placed. */
interface Bag {
  x: number; y: number; z: number;
  yaw: number;
  sx: number; sy: number; sz: number;
  tint: number;
}

/** The canvas colours bags are cut from, so a wall is never one flat khaki. */
const BAG_TINTS = [0xa8996f, 0x9c8f6a, 0x90845f, 0xb2a37c, 0x877c5d, 0xa39771];

const SANDBAG_GEO = (() => {
  const g = new THREE.SphereGeometry(0.5, 10, 7);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // The tied ends of the sack pinch in, so it reads as a bag and not an egg.
    pos.setZ(i, z * (1 - 0.3 * Math.pow(Math.abs(x) / 0.5, 3)));
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.scale(BAG_L, BAG_H, BAG_D);
  return g;
})();

/**
 * Top of the berm crest: six courses of bags, the crown of the highest one
 * included. The heavy machine guns stand on this, so the number is shared by the
 * wall that carries them and the nests bolted to it.
 */
const CREST_Y = BAG_H + (6 - 1) * BAG_ROW;   // 0.44 + 1.90 = 2.34 m

// ─── Belts of linked rounds ─────────────────────────────────────────────────
// A belt is a chain of steel links with a brass round held in each, so it is two
// instanced meshes fed from one list of transforms - the same trick the sandbags
// use, and what lets a gun carry sixty rounds for two draw calls.

/** One link waiting to be placed: a position and the way it points along the belt. */
interface BeltLink {
  x: number; y: number; z: number;
  q: THREE.Quaternion;
}

/** The clip a belt is made of; its long axis is the direction the belt runs. */
const BELT_LINK_GEO = new THREE.BoxGeometry(0.075, 0.055, 0.105);

/** The round in the clip, a touch longer than the link so both ends show brass. */
const BELT_CASE_GEO = (() => {
  const g = new THREE.CylinderGeometry(0.026, 0.026, 0.135, 6);
  g.rotateX(Math.PI / 2);   // the nose points along +Z, the way the belt runs
  return g;
})();

const FORWARD = new THREE.Vector3(0, 0, 1);

function pushBag(bags: Bag[], x: number, y: number, z: number, yaw: number, jitter: number) {
  bags.push({
    x: x + (Math.random() - 0.5) * jitter,
    y: y + (Math.random() - 0.5) * jitter * 0.5,
    z: z + (Math.random() - 0.5) * jitter,
    yaw: yaw + (Math.random() - 0.5) * 0.09,
    sx: 1 + (Math.random() - 0.5) * 0.14,
    sy: 0.95 + Math.random() * 0.25,
    sz: 1 + (Math.random() - 0.5) * 0.12,
    tint: BAG_TINTS[(Math.random() * BAG_TINTS.length) | 0],
  });
}

/**
 * A wall of bags between two points: `rows` courses high and `depth` bags
 * thick, every course half-offset from the one below it and every bag given a
 * touch of jitter so the wall never looks machined.
 */
function sandbagCourse(
  bags: Bag[],
  x1: number, z1: number, x2: number, z2: number,
  baseY: number, rows: number,
  opts: { depth?: number; jitter?: number } = {},
) {
  const depth = opts.depth ?? 1;
  const jitter = opts.jitter ?? 0.07;
  const len = Math.hypot(x2 - x1, z2 - z1);
  const n = Math.max(1, Math.round(len / (BAG_L * 0.92)));
  const ux = (x2 - x1) / len;
  const uz = (z2 - z1) / len;
  // Long axis of the bag along the wall: local +X has to land on (ux, uz).
  const yaw = Math.atan2(-uz, ux);
  const step = len / n;
  for (let row = 0; row < rows; row++) {
    // Courses are staggered half a bag, the way a bricklayer breaks a wall.
    const shift = row % 2 === 0 ? 0 : step / 2;
    for (let i = 0; i < n; i++) {
      const at = i * step + shift;
      if (at > len) continue;
      for (let d = 0; d < depth; d++) {
        const off = (d - (depth - 1) / 2) * BAG_D;
        pushBag(
          bags,
          x1 + ux * at - uz * off,
          baseY + row * BAG_ROW,
          z1 + uz * at + ux * off,
          yaw, jitter,
        );
      }
    }
  }
}

/** A circular plinth of bags - the pit the fort's flagpole stands in. */
function sandbagRing(
  bags: Bag[], cx: number, cz: number, radius: number, baseY: number, rows: number,
) {
  for (let row = 0; row < rows; row++) {
    const r = radius - (row % 2 === 0 ? 0 : 0.1);
    const n = Math.max(6, Math.round((2 * Math.PI * r) / (BAG_L * 0.92)));
    const phase = row % 2 === 0 ? 0 : Math.PI / n;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + phase;
      pushBag(
        bags,
        cx + Math.cos(a) * r,
        baseY + row * BAG_ROW,
        cz + Math.sin(a) * r,
        -Math.PI / 2 - a,
        0.05,
      );
    }
  }
}

/** Turn the gathered bags into the one instanced mesh the fort is walled with. */
function flushSandbags(group: THREE.Group, bags: Bag[], mat: THREE.Material) {
  const mesh = new THREE.InstancedMesh(SANDBAG_GEO, mat, bags.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const c = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  bags.forEach((b, i) => {
    q.setFromAxisAngle(up, b.yaw);
    m.compose(p.set(b.x, b.y, b.z), q, s.set(b.sx, b.sy, b.sz));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setHex(b.tint));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

/**
 * The fort: an open fortified position rather than a building. A packed-dirt
 * courtyard inside a sandbag berm with corner firing platforms, a heavy machine
 * gun on a pedestal on the crest of each face, a roofless
 * sandbag command bunker, a drone launch pad and the mortar slab - the pilot
 * stands in the middle of the yard and turns to face whatever is coming.
 *
 * Nothing here is a collision volume: the fort is scenery, and the horde is
 * stopped by the fence line (FORT_PERIMETER), which is where the server counts a
 * breach.
 */
export function createOutpost(): THREE.Group {
  const group = new THREE.Group();
  const bags: Bag[] = [];
  const links: BeltLink[] = [];
  const mats: FortMats = {
    earth: standardMaterial('dirt', { rx: 5, ry: 5, color: 0x9c8a6b, roughness: 1 }),
    concrete: standardMaterial('concrete', { rx: 3, ry: 3, roughness: 0.95 }),
    asphalt: standardMaterial('concrete', { rx: 2, ry: 2, color: 0x4a4d4f, roughness: 0.95 }),
    // Every bag carries its own instance colour, so the material stays neutral.
    bag: standardMaterial('fabric', { rx: 1, ry: 1, roughness: 0.95 }),
    timber: standardMaterial('wood', { rx: 2, ry: 1, roughness: 0.9 }),
    steel: standardMaterial('metal', { rx: 1, ry: 1, color: 0x50564b, metalness: 0.7, roughness: 0.55 }),
  };

  // Courtyard: packed earth, so the yard reads differently from the fields.
  const yard = new THREE.Mesh(new THREE.CircleGeometry(HALF + 2, 56), mats.earth);
  yard.rotation.x = -Math.PI / 2;
  yard.position.y = 0.02;
  yard.receiveShadow = true;
  group.add(yard);

  // Perimeter: the berm keeps exactly the footprint it always had - 2.4 m thick,
  // 2.3 m high, with a vehicle gap in the south face - but it is sandbags from
  // the ground to the crest now, three bags deep and six courses high, so there
  // is no earth showing anywhere on the wall.
  const OUT = HALF + 1.2;   // the outer face of the berm
  const ROWS = 6;           // 6 courses of 0.38 m = 2.28 m of wall
  const baseY = BAG_H / 2;  // the first course lies on the ground
  const deep = { depth: 3 };

  sandbagCourse(bags, -OUT, -HALF, OUT, -HALF, baseY, ROWS, deep);
  sandbagCourse(bags, HALF, -OUT, HALF, OUT, baseY, ROWS, deep);
  sandbagCourse(bags, -HALF, -OUT, -HALF, OUT, baseY, ROWS, deep);
  sandbagCourse(bags, -OUT, HALF, -3.6, HALF, baseY, ROWS, deep);
  sandbagCourse(bags, 3.6, HALF, OUT, HALF, baseY, ROWS, deep);

  // Corner firing platforms.
  const t = HALF - 1.4;
  watchtower(group, bags, mats, -t, -t);
  watchtower(group, bags, mats, t, -t);
  watchtower(group, bags, mats, -t, t);
  watchtower(group, bags, mats, t, t);

  buildBunker(group, bags, mats, -6.5, -6.5);
  buildDronePad(group, mats, -6.5, 6.5);
  buildMortarPad(group, bags, mats);
  buildGate(group, bags, mats);
  buildFlag(group, bags, mats, 0, -3.4);

  // One heavy machine gun on the crest of every face, covering the ground its own
  // wall looks out over. Each is laid a few degrees off square so the four do not
  // read as one copy-pasted model. The south gun stands west of the gate: the gap
  // in the middle of that face is where the vehicles drive through.
  hmgNest(group, mats, links, 0, -HALF, Math.PI + 0.16);
  hmgNest(group, mats, links, HALF, 0, Math.PI / 2 - 0.1);
  hmgNest(group, mats, links, -6.5, HALF, 0.12);
  hmgNest(group, mats, links, -HALF, 0, -Math.PI / 2 + 0.08);

  flushSandbags(group, bags, mats.bag);
  flushBeltLinks(group, links);

  group.position.y = 0; // on flat ground
  return group;
}

/** Painted marking on concrete: pad rings and the mortar arc. */
function paintMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xdad5c2, roughness: 0.9, metalness: 0 });
}

/**
 * Roofless command bunker: four sandbag walls on a poured floor, open to the
 * sky. It is a fighting position and a store, not a house - the pilot can see
 * over it from the middle of the yard, and there is no roof for a drone to fly
 * into.
 */
function buildBunker(
  group: THREE.Group, bags: Bag[], mats: FortMats, x: number, z: number,
) {
  const bw = 8;
  const bd = 7;
  const rows = 7;             // 7 courses of 0.38 m = 2.66 m of wall
  const baseY = BAG_H / 2;
  addBox(group, mats.concrete, bw + 1.4, 0.18, bd + 1.4, x, 0.09, z);

  // One bag thick on every side, with the south face left open as a doorway.
  sandbagCourse(bags, x - bw / 2, z - bd / 2, x + bw / 2, z - bd / 2, baseY, rows);
  sandbagCourse(bags, x - bw / 2, z + bd / 2, x - 1.3, z + bd / 2, baseY, rows);
  sandbagCourse(bags, x + 1.3, z + bd / 2, x + bw / 2, z + bd / 2, baseY, rows);
  sandbagCourse(bags, x - bw / 2, z - bd / 2, x - bw / 2, z + bd / 2, baseY, rows);
  sandbagCourse(bags, x + bw / 2, z - bd / 2, x + bw / 2, z + bd / 2, baseY, rows);

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
/** Sandbagged firing platform in a corner: posts, deck and a parapet of bags. */
function watchtower(
  group: THREE.Group, bags: Bag[], mats: FortMats, x: number, z: number,
) {
  for (const [ox, oz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
    addBox(group, mats.timber, 0.22, 3.1, 0.22, x + ox, 1.55, z + oz);
  }
  addBox(group, mats.timber, 2.7, 0.24, 2.7, x, 3.15, z);
  // Two courses of bags all the way round the deck: the lookout stands behind
  // sandbags on every side, not just the two that face the field.
  const y = 3.49;
  sandbagCourse(bags, x - 1.2, z - 1.2, x + 1.2, z - 1.2, y, 2);
  sandbagCourse(bags, x + 1.2, z - 1.2, x + 1.2, z + 1.2, y, 2);
  sandbagCourse(bags, x + 1.2, z + 1.2, x - 1.2, z + 1.2, y, 2);
  sandbagCourse(bags, x - 1.2, z + 1.2, x - 1.2, z - 1.2, y, 2);
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
function buildMortarPad(group: THREE.Group, bags: Bag[], mats: FortMats) {
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
  sandbagCourse(bags, mx - 2.7, mz - 2.7, mx + 2.7, mz - 2.7, BAG_H / 2, 3);
  sandbagCourse(bags, mx + 2.7, mz - 2.7, mx + 2.7, mz + 2.7, BAG_H / 2, 3);

  addBox(group, mats.timber, 1.15, 0.75, 1.15, mx - 2.3, 0.58, mz + 1.9, 0.18);
  addBox(group, mats.timber, 1.15, 0.75, 1.15, mx - 2.3, 1.33, mz + 1.9, -0.12);
  addBox(group, mats.steel, 0.9, 0.9, 0.9, mx + 1.9, 0.65, mz + 2.4, 0.4);
}

/**
 * Gate through the berm on the south face. The bag walls stop short of the gap
 * and are themselves the jambs, so all that stands here is the lintel across
 * them, the barriers that close the gap and the loose stores around the yard.
 */
function buildGate(group: THREE.Group, bags: Bag[], mats: FortMats) {
  for (const sx of [-3.6, 3.6]) {
    addBox(group, mats.timber, 0.3, 0.75, 0.9, sx, 2.1, HALF);
  }
  addBox(group, mats.timber, 8.6, 0.45, 1.0, 0, 2.7, HALF);
  addBox(group, mats.timber, 3.2, 0.24, 0.24, -1.7, 0.85, HALF, 0.55);
  addBox(group, mats.timber, 3.2, 0.24, 0.24, 1.7, 0.85, HALF, -0.55);

  // Hasty sandbag blocks just inside the gap, so the entrance can be closed.
  sandbagCourse(bags, -2.4, HALF - 1.6, -0.8, HALF - 1.6, BAG_H / 2, 4, { depth: 2 });
  sandbagCourse(bags, 0.8, HALF - 1.6, 2.4, HALF - 1.6, BAG_H / 2, 4, { depth: 2 });

  // Fuel drums and loose stores around the yard.
  const drum = new THREE.CylinderGeometry(0.42, 0.42, 1.15, 12);
  for (const [dx, dz] of [[-2.6, 9.6], [-1.7, 10.1], [9.6, -6.2], [10.2, -5.2]]) {
    const d = new THREE.Mesh(drum, mats.steel);
    d.position.set(dx, 0.58, dz);
    d.castShadow = true;
    group.add(d);
  }
}

/**
 * The flag pit in the middle of the parade ground: a low circular sandbag
 * plinth, an 11 m pole with a gold finial and the halyard running up it, and the
 * Ukrainian blue-and-yellow flying from the truck.
 *
 * It sits a little north of the exact centre of the yard because that is where
 * the pilot stands: a pole straight through the middle would be inside the
 * camera rather than in front of it.
 */
function buildFlag(
  group: THREE.Group, bags: Bag[], mats: FortMats, x: number, z: number,
) {
  sandbagRing(bags, x, z, 1.05, BAG_H / 2, 2);

  const poleBase = 0.75;   // the top of the plinth
  const poleH = 11;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, poleH, 10), mats.steel);
  pole.position.set(x, poleBase + poleH / 2, z);
  pole.castShadow = true;
  group.add(pole);

  const gold = standardMaterial('metal', { color: 0xf2c14e, metalness: 0.6, roughness: 0.4 });
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.34, 12), gold);
  collar.position.set(x, poleBase + 0.17, z);
  group.add(collar);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), gold);
  finial.position.set(x, poleBase + poleH + 0.15, z);
  finial.castShadow = true;
  group.add(finial);

  // Halyard: the rope that runs from the truck down to a cleat at eye height.
  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, poleH - 1.4, 6),
    new THREE.MeshStandardMaterial({ color: 0xb09a6a, roughness: 1 }),
  );
  rope.position.set(x + 0.17, poleBase + 0.7 + (poleH - 1.4) / 2, z);
  group.add(rope);

  const fabric = getMaps('fabric');
  const flagMat = new THREE.MeshStandardMaterial({
    map: ukraineFlagTexture(),
    normalMap: fabric.normalMap,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const fw = 3;
  const fh = 1.5;
  const truck = new THREE.Group();
  truck.position.set(x, poleBase + poleH - fh / 2 - 0.1, z);
  const cloth = new THREE.Mesh(flagGeometry(fw, fh), flagMat);
  cloth.position.x = fw / 2 + 0.18;
  cloth.castShadow = true;
  truck.add(cloth);
  // The one thing in the yard that moves by itself: the cloth swings on the
  // truck in a light breeze. It is driven from the mesh because that is what the
  // renderer walks, not the group the mesh hangs off.
  cloth.onBeforeRender = () => {
    const t = performance.now() * 0.001;
    truck.rotation.y = Math.sin(t * 0.9) * 0.16;
    truck.rotation.z = Math.sin(t * 1.7) * 0.04;
  };
  group.add(truck);
}

// ─── Heavy machine guns ─────────────────────────────────────────────────────

/**
 * Lay a run of belt along a curve given in one gun's own frame and drop the links
 * into the fort-wide list in world space.
 *
 * Every link is turned to point along the belt, which is what makes a drooping run
 * read as a strip of links that is hanging under its own weight rather than a row
 * of boxes all facing the same way.
 */
function beltRun(
  links: BeltLink[], m: THREE.Matrix4, pts: THREE.Vector3[], count: number, closed = false,
) {
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.35);
  // The gun only turns and shifts, so the upper three by three of its matrix is
  // the whole local-to-world rotation the belt tangents need.
  const rot = new THREE.Matrix3().setFromMatrix4(m);
  const dir = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const t = closed ? i / count : i / Math.max(1, count - 1);
    const p = curve.getPointAt(t).applyMatrix4(m);
    dir.copy(curve.getTangentAt(t)).applyMatrix3(rot).normalize();
    links.push({
      x: p.x, y: p.y, z: p.z,
      q: new THREE.Quaternion().setFromUnitVectors(FORWARD, dir),
    });
  }
}

/** The gathered links become two instanced meshes: the clips and the rounds. */
function flushBeltLinks(group: THREE.Group, links: BeltLink[]) {
  const clipMat = standardMaterial('metal', { rx: 1, ry: 1, color: 0x3a3d36, metalness: 0.7, roughness: 0.55 });
  const brassMat = standardMaterial('metal', { rx: 1, ry: 1, color: 0xc08a3e, metalness: 0.85, roughness: 0.35 });

  const clips = new THREE.InstancedMesh(BELT_LINK_GEO, clipMat, links.length);
  const cases = new THREE.InstancedMesh(BELT_CASE_GEO, brassMat, links.length);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const off = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  links.forEach((b, i) => {
    p.set(b.x, b.y, b.z);
    m.compose(p, b.q, one);
    clips.setMatrixAt(i, m);
    // The round sits proud of its clip, so the belt shows brass along its whole
    // length instead of reading as one dark band.
    off.set(0, 0.045, 0).applyQuaternion(b.q).add(p);
    m.compose(off, b.q, one);
    cases.setMatrixAt(i, m);
  });
  clips.instanceMatrix.needsUpdate = true;
  cases.instanceMatrix.needsUpdate = true;
  clips.castShadow = true;
  cases.castShadow = true;
  group.add(clips, cases);
}

/**
 * A heavy machine gun nest on the crest of one face of the berm: a timber deck,
 * the gun on a pintle pedestal, an ammo can beside it and two belts of linked
 * rounds - one running from the can up into the feed tray, one coiled on the deck
 * ready to be hooked on.
 *
 * The gun is built facing its own local +Z and then turned out over the ground its
 * own wall looks over. Like everything else here it is scenery and no collision
 * volume: the weapons that fire are the quad and the tube.
 */
function hmgNest(
  group: THREE.Group, mats: FortMats, links: BeltLink[],
  x: number, z: number, yaw: number,
) {
  const gunMetal = standardMaterial('metal', { rx: 1, ry: 2, color: 0x3c4038, metalness: 0.85, roughness: 0.45 });
  const dark = standardMaterial('metal', { rx: 1, ry: 1, color: 0x24261f, metalness: 0.6, roughness: 0.7 });
  const olive = standardMaterial('fabric', { rx: 1, ry: 1, color: 0x4b5140, roughness: 0.9 });

  // Deck plate: bags are too round to bolt a pedestal to, and the crew wants a
  // flat floor to work on anyway.
  addBox(group, mats.timber, 1.7, 0.14, 1.7, x, CREST_Y + 0.07, z);

  const g = new THREE.Group();
  g.position.set(x, CREST_Y + 0.14, z);
  g.rotation.y = yaw;
  group.add(g);

  // Pedestal: a base plate on the deck, a tapered column, and the traverse yoke
  // the gun sits in.
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.44, 0.1, 16), dark);
  base.position.y = 0.05;
  base.castShadow = true;
  g.add(base);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.86, 12), gunMetal);
  column.position.y = 0.53;
  column.castShadow = true;
  g.add(column);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.1, 14), dark);
  collar.position.y = 0.95;
  g.add(collar);
  for (const sx of [-0.19, 0.19]) {
    addBox(g, dark, 0.09, 0.3, 0.36, sx, 1.02, 0);
  }

  // The gun: receiver and bolt, spade grips at the back, and a heavy barrel with
  // cooling rings, a muzzle brake and a sight at each end.
  addBox(g, gunMetal, 0.17, 0.21, 0.72, 0, 1.12, 0.02);
  addBox(g, dark, 0.13, 0.1, 0.34, 0, 1.26, -0.06);
  addBox(g, dark, 0.3, 0.2, 0.08, 0, 1.12, -0.4);
  for (const sx of [-0.17, 0.17]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.24, 8), dark);
    grip.position.set(sx, 1.16, -0.56);
    grip.rotation.x = 0.5;
    grip.castShadow = true;
    g.add(grip);
  }
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 1.05, 12), gunMetal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 1.16, 0.9);
  barrel.castShadow = true;
  g.add(barrel);
  for (let i = 0; i < 5; i++) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 12), dark);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 1.16, 0.55 + i * 0.16);
    g.add(ring);
  }
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 12), gunMetal);
  brake.rotation.x = Math.PI / 2;
  brake.position.set(0, 1.16, 1.5);
  brake.castShadow = true;
  g.add(brake);
  addBox(g, dark, 0.03, 0.11, 0.03, 0, 1.28, 1.32);
  addBox(g, dark, 0.1, 0.1, 0.05, 0, 1.36, 0.12);

  // Ammo can on the deck to the gun's right, its lid left a touch ajar.
  addBox(g, olive, 0.52, 0.34, 0.36, 0.58, 0.17, -0.3);
  addBox(g, dark, 0.54, 0.05, 0.38, 0.58, 0.36, -0.32, 0.06);

  // Belt one: out of the can, across the deck and up the left of the pedestal
  // into the feed tray.
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, CREST_Y + 0.14, z);
  beltRun(links, m, [
    new THREE.Vector3(0.5, 0.4, -0.3),
    new THREE.Vector3(0.3, 0.16, -0.05),
    new THREE.Vector3(-0.05, 0.12, 0.2),
    new THREE.Vector3(-0.34, 0.42, 0.26),
    new THREE.Vector3(-0.4, 0.84, 0.16),
    new THREE.Vector3(-0.3, 1.04, 0.16),
    new THREE.Vector3(-0.1, 1.13, 0.02),
  ], 26);

  // Belt two: the spare, coiled flat on the deck where a loader can grab it.
  const coil: THREE.Vector3[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    coil.push(new THREE.Vector3(
      -0.56 + Math.cos(a) * 0.26, 0.05, -0.6 + Math.sin(a) * 0.2,
    ));
  }
  beltRun(links, m, coil, 18, true);
}


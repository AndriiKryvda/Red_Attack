import * as THREE from 'three';
import {
  BuildingVariant, CarVariant, StructureKind, type StructureSpec, type StructureVariant,
} from '@red-attack/shared';
import { standardMaterial, getMaps } from './Textures';
import { addPart, addTube } from './ModelParts';

// ─────────────────────────────────────────────────────────────────────────────
// The village on the north and east edges: houses, a block of flats, a barn, a
// water tower, and the cars parked in front of them.
//
// Model convention (different from the enemy models on purpose): the origin sits
// on the ground in the middle of the footprint, local +Z is the facade — the side
// that faces the fort — and local X runs along the front. The server sends the
// footprint, so every model here fills exactly the box a drone collides with.
//
// Anything that can throw flame is tagged `userData.vent = true`, and the scorch
// mark is tagged `userData.scorch` so it never glows.
// ─────────────────────────────────────────────────────────────────────────────

/** Shadow-casting box part with an optional tilt. */
function addBox(
  g: THREE.Object3D, mat: THREE.Material,
  w: number, h: number, d: number, x: number, y: number, z: number,
  rx = 0, ry = 0, rz = 0,
): THREE.Mesh {
  const m = addPart(g, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

/** A round part (tank, cap, pipe) standing on the ground plane. */
function addRound(
  g: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
  x: number, y: number, z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  g.add(m);
  return m;
}

/** Marks a mesh as a hot spot the flames come out of. */
function vent(mesh: THREE.Object3D): THREE.Object3D {
  mesh.userData.vent = true;
  return mesh;
}

/** The blackened patch of ground under a fire. */
function addScorch(g: THREE.Object3D, r: number): void {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(r, 26),
    new THREE.MeshBasicMaterial({ color: 0x171310, transparent: true, opacity: 0.8 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.04;
  mesh.userData.scorch = true;
  g.add(mesh);
}

// Each structure owns its materials: the renderer pushes their emissive while they
// burn, and a shared material would set the whole village alight at once.
const plaster = (color: number) =>
  standardMaterial('concrete', { rx: 2, ry: 2, color, roughness: 0.95 });
const tile = (color: number) =>
  standardMaterial('roof', { rx: 2, ry: 1, color, roughness: 0.8 });
const timber = (color: number) =>
  standardMaterial('wood', { rx: 2, ry: 1, color, roughness: 0.85 });
const glass = () =>
  standardMaterial('metal', { color: 0x1d2a38, roughness: 0.16, metalness: 0.55 });
const steel = (color = 0x8d949a) =>
  standardMaterial('metal', { color, roughness: 0.5, metalness: 0.65 });
const paint = (color: number) =>
  standardMaterial('metal', { color, roughness: 0.42, metalness: 0.25 });
const charred = () =>
  standardMaterial('concrete', { rx: 2, ry: 2, color: 0x27211d, roughness: 1 });

// ─── Flags ───────────────────────────────────────────────────────────────────
// The village is Russian, and the clearest way to say so from 130 metres out is a
// white-blue-red tricolor on a pole. Painted on one canvas (three bands, no seam)
// and lit with the shared fabric weave, exactly like the fort's own flag.

let flagTex: THREE.CanvasTexture | null = null;

function makeFlagTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 160;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;

  // White, blue, red, top band down. The white is a shade off so it is not the
  // brightest thing on the map at dusk.
  const bands = ['#f4f1e8', '#0039a6', '#d52b1e'];
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = bands[i];
    ctx.fillRect(0, (i * h) / 3, w, h / 3 + 1);
  }

  // Soft vertical shading so the cloth never reads as flat plastic.
  const shade = ctx.createLinearGradient(0, 0, w, 0);
  shade.addColorStop(0, 'rgba(0,0,0,0.20)');
  shade.addColorStop(0.3, 'rgba(255,255,255,0.12)');
  shade.addColorStop(0.62, 'rgba(0,0,0,0.16)');
  shade.addColorStop(1, 'rgba(255,255,255,0.10)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);

  // Band seams, a chafed hoist edge and a little road dust.
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  for (let i = 1; i < 3; i++) ctx.fillRect(0, (i * h) / 3 - 1, w, 2);
  ctx.fillStyle = 'rgba(58,48,38,0.26)';
  ctx.fillRect(0, 0, 9, h);
  ctx.fillStyle = 'rgba(126,110,88,0.10)';
  for (let i = 0; i < 70; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 9, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Built once and shared by every flag; the materials on top are per structure. */
function flagTexture(): THREE.CanvasTexture {
  if (!flagTex) flagTex = makeFlagTexture();
  return flagTex;
}

/**
 * Rippled cloth with its hoist edge on the local origin, flying toward +X. The
 * free end swings further than the pole end, so it reads as fabric and not as a
 * road sign.
 */
function clothGeometry(w: number, h: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(w, h, 12, 6);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getX(i) + w / 2) / w; // 0 at the pole, 1 at the free edge
    pos.setZ(i, Math.sin(t * 5.5 + pos.getY(i) * 1.6) * 0.1 * t * t * w);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.translate(w / 2, 0, 0);
  return geo;
}

/**
 * One cloth material per structure: the renderer chars and lights up whatever a
 * model is made of, and a shared material would set every flag in the village
 * alight the moment one building catches.
 */
function clothMaterial(): THREE.MeshStandardMaterial {
  const fabric = getMaps('fabric');
  return new THREE.MeshStandardMaterial({
    map: flagTexture(),
    normalMap: fabric.normalMap,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });
}

/**
 * A flagpole with the Russian tricolor flying from it. Local +Z is the facade, so
 * the cloth runs along +X and turns its face to whoever is coming in from the
 * fort — which holds on both edges, because the whole group is already turned to
 * face it. The cloth sits in its own group tagged `userData.wave`, and the
 * renderer swings that group around the pole the way the enemy banners flutter.
 */
function addFlag(
  g: THREE.Object3D,
  x: number, y: number, z: number,
  poleH: number, clothW: number, clothH: number, wave = 0.16,
): void {
  const pole = standardMaterial('metal', { rx: 1, ry: 2, color: 0xb4ada0, roughness: 0.55, metalness: 0.5 });
  const r = Math.max(0.02, poleH * 0.013);
  addRound(g, new THREE.CylinderGeometry(r, r * 1.3, poleH, 8), pole, x, y + poleH / 2, z);
  addRound(g, new THREE.SphereGeometry(Math.max(0.03, poleH * 0.035), 10, 8), steel(0xd6b25e), x, y + poleH + poleH * 0.03, z);

  const cloth = new THREE.Group();
  cloth.position.set(x, y + poleH - clothH * 0.55, z);
  cloth.userData.wave = wave;
  g.add(cloth);

  const flag = new THREE.Mesh(clothGeometry(clothW, clothH), clothMaterial());
  flag.castShadow = true;
  cloth.add(flag);
}

/**
 * The flagpole brought down with the roof: a bent pole and a burnt, drooping
 * tricolor over the rubble. Deliberately not tagged to flutter — a wreck flies
 * nothing.
 */
function addFallenFlag(
  g: THREE.Object3D,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  clothW: number,
): void {
  addTube(g, new THREE.Vector3(x1, y1, z1), new THREE.Vector3(x2, y2, z2), 0.05, steel(0x3d3833));
  const rag = new THREE.Mesh(clothGeometry(clothW, clothW * 0.65), clothMaterial());
  rag.material.color.multiplyScalar(0.45);
  rag.position.set(x2, y2, z2);
  rag.rotation.set(0.3, 0.2, 1.35);
  g.add(rag);
}

// ─── Buildings ───────────────────────────────────────────────────────────────

/**
 * A village house: plastered walls, a pitched tile roof with a ridge, a door and
 * windows on the side that faces the fort, and a chimney the fire comes out of.
 */
function buildHouse(spec: StructureSpec): THREE.Group {
  const g = new THREE.Group();
  const { width: w, depth: d, height: h } = spec;
  const rise = 1.5;
  const wallH = h - rise;

  addBox(g, plaster(0xd8c8a6), w, wallH, d, 0, wallH / 2, 0);
  // Two roof planes meeting on a ridge beam.
  const pitch = Math.atan2(rise, d / 2 + 0.3);
  const len = Math.hypot(d / 2 + 0.3, rise);
  for (const s of [1, -1]) {
    addBox(g, tile(0x8d4a33), w + 0.6, 0.24, len, 0, h - rise / 2, s * (d / 4 + 0.15), s * pitch);
  }
  vent(addBox(g, tile(0x6d3724), w + 0.7, 0.26, 0.4, 0, h + 0.02, 0));
  vent(addBox(g, plaster(0x8f8577), 0.7, 1.9, 0.7, -w * 0.28, h + 0.35, -d * 0.2));

  // Facade: door under a lintel, four windows glazed on the outside face.
  addBox(g, timber(0x6b4a2a), 1.2, 2.1, 0.16, 0, 1.05, d / 2 + 0.06);
  addBox(g, plaster(0xbfae8c), 1.7, 0.16, 0.5, 0, 2.25, d / 2 + 0.2);
  for (const wx of [-w * 0.32, w * 0.32]) {
    addBox(g, glass(), 1.05, 1.25, 0.14, wx, 2.3, d / 2 + 0.06);
    addBox(g, glass(), 1.05, 1.25, 0.14, wx, 0.95, d / 2 + 0.06);
  }
  for (const sz of [1, -1]) {
    addBox(g, glass(), 1.0, 1.2, 0.14, w / 2 + 0.06, 2.3, sz * d * 0.24, 0, Math.PI / 2);
  }
  // Over the roof, so the row of houses reads as Russian from the fort.
  addFlag(g, w * 0.3, h - 0.5, -d * 0.15, 2.6, 1.8, 1.2);
  return g;
}

/**
 * A block of flats: three storeys of windows on the front and a flat roof with a
 * stair box poking above it — the tallest roof in the village and the most worth
 * destroying.
 */
function buildBlock(spec: StructureSpec): THREE.Group {
  const g = new THREE.Group();
  const { width: w, depth: d, height: h } = spec;

  addBox(g, plaster(0xc9c2b4), w, h, d, 0, h / 2, 0);
  addBox(g, tile(0x7d7469), w + 0.5, 0.45, d + 0.5, 0, h + 0.2, 0);
  vent(addBox(g, plaster(0xb3ab9c), 3.2, 2.6, 3.2, w * 0.28, h + 1.5, -d * 0.2));

  for (const row of [3.1, 6.1, 9.1]) {
    for (const col of [-0.34, -0.11, 0.11, 0.34]) {
      addBox(g, glass(), 1.15, 1.35, 0.14, col * w, row, d / 2 + 0.06);
    }
  }
  // Entrance: a dark recessed opening under a canopy, with two steps off the road.
  addBox(g, glass(), 2.4, 2.7, 0.2, 0, 1.35, d / 2 + 0.1);
  addBox(g, tile(0x6f665c), 3.4, 0.22, 1.1, 0, 2.95, d / 2 + 0.5);
  addBox(g, plaster(0xa8a094), 3.6, 0.2, 1.0, 0, 0.1, d / 2 + 0.5);
  addBox(g, plaster(0xa8a094), 3.6, 0.2, 0.6, 0, 0.3, d / 2 + 0.9);
  // The tallest thing in the village proper: the flag over the block of flats is
  // the landmark that says who is holding it.
  addFlag(g, -w * 0.3, h + 0.35, -d * 0.15, 4, 2.6, 1.7);
  return g;
}

/**
 * A barn: plank walls, a steep roof and a wagon door wide enough to drive the
 * horde through, braced in the traditional cross.
 */
function buildBarn(spec: StructureSpec): THREE.Group {
  const g = new THREE.Group();
  const { width: w, depth: d, height: h } = spec;
  const wallH = h * 0.62;
  const rise = h - wallH;

  addBox(g, timber(0x8c3f2f), w, wallH, d, 0, wallH / 2, 0);
  const pitch = Math.atan2(rise, d / 2 + 0.35);
  const len = Math.hypot(d / 2 + 0.35, rise);
  for (const s of [1, -1]) {
    addBox(g, tile(0x5d5147), w + 0.7, 0.26, len, 0, h - rise / 2, s * (d / 4 + 0.17), s * pitch);
  }
  vent(addBox(g, tile(0x4a4038), w + 0.8, 0.3, 0.5, 0, h + 0.04, 0));

  // Wagon door on the facade with its cross-bracing.
  addBox(g, timber(0x5c3a22), 3.0, 3.4, 0.2, 0, 1.7, d / 2 + 0.08);
  for (const dir of [1, -1]) {
    addTube(
      g,
      new THREE.Vector3(-1.4 * dir, 0.25, d / 2 + 0.22),
      new THREE.Vector3(1.4 * dir, 3.15, d / 2 + 0.22),
      0.09, timber(0x75523a),
    );
  }
  for (const sz of [1, -1]) {
    addBox(g, glass(), 0.7, 0.9, 0.14, -w * 0.3, wallH * 0.75, sz * d * 0.25, 0, Math.PI / 2);
  }
  // On the gable end, clear of the ridge vent.
  addFlag(g, w * 0.36, h - 0.3, 0, 2.4, 1.6, 1.05);
  return g;
}

/**
 * A water tower: four splayed legs under a banded tank with a conical cap. It is
 * the tallest thing on the map, so its vents sit on the tank itself.
 */
function buildTower(spec: StructureSpec): THREE.Group {
  const g = new THREE.Group();
  const r = spec.width * 0.42;
  const deckY = spec.height * 0.6;

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addTube(
        g,
        new THREE.Vector3(sx * r, 0, sz * r),
        new THREE.Vector3(sx * r * 0.8, deckY, sz * r * 0.8),
        0.2, steel(0x777f85),
      );
    }
  }
  // Girders on the two faces that look down on the field.
  for (const y of [deckY * 0.45, deckY * 0.85]) {
    addTube(g, new THREE.Vector3(-r, y, r), new THREE.Vector3(r, y, r), 0.09, steel(0x6a7177));
    addTube(g, new THREE.Vector3(r, y, -r), new THREE.Vector3(r, y, r), 0.09, steel(0x6a7177));
  }
  addBox(g, timber(0x6d5a44), r * 1.7, 2.4, r * 1.7, 0, 1.2, 0);

  const shell = addRound(
    g, new THREE.CylinderGeometry(r, r, spec.height * 0.28, 22),
    steel(0x9aa3a8), 0, deckY + spec.height * 0.14, 0,
  );
  vent(shell);
  addRound(
    g, new THREE.CylinderGeometry(r * 1.05, r * 1.05, 0.24, 22),
    steel(0x7c848a), 0, deckY + spec.height * 0.22, 0,
  );
  vent(addRound(
    g, new THREE.ConeGeometry(r * 1.12, spec.height * 0.12, 22),
    tile(0x6b5f52), 0, spec.height - spec.height * 0.06, 0,
  ));
  // On the cap where the whole map can see it.
  addFlag(g, 0, spec.height - 0.2, 0, 2.2, 1.6, 1.05);
  return g;
}

// ─── Cars ────────────────────────────────────────────────────────────────────

const CAR_PAINT: Record<CarVariant, number> = {
  [CarVariant.SEDAN]: 0x9aa7b0,
  [CarVariant.PICKUP]: 0x6b7a55,
  [CarVariant.VAN]: 0xd6d2c6,
  [CarVariant.BUS]: 0xc39a3a,
};

/** A wheel standing upright on the ground, axle along X (the car's long axis). */
function addWheel(
  g: THREE.Object3D, mat: THREE.Material,
  x: number, y: number, z: number, r: number, width: number,
): THREE.Mesh {
  const wheel = addRound(g, new THREE.CylinderGeometry(r, r, width, 16), mat, x, y, z);
  // A cylinder is built along Y; a wheel rolls with its axle across the car.
  wheel.rotation.z = Math.PI / 2;
  return wheel;
}

/**
 * A parked vehicle: the long axis runs along the edge (local X) so the cars read as
 * parallel parked on the road in front of the buildings, and the nose points at +X.
 * `spec.width` is its length and `spec.depth` its body width.
 */
function buildCar(spec: StructureSpec, variant: CarVariant): THREE.Group {
  const g = new THREE.Group();
  const L = spec.width, W = spec.depth, H = spec.height;
  const wr = Math.max(0.3, H * 0.17);
  const body = paint(CAR_PAINT[variant]);
  const tyre = standardMaterial('metal', { color: 0x1f1e1c, roughness: 0.95 });
  const low = wr;
  // Where the flagpole gets planted: the cab roof for the cars, the body roof for
  // the van and the bus.
  let roofY = low + H * 0.75;

  if (variant === CarVariant.SEDAN || variant === CarVariant.PICKUP) {
    const bodyH = H * 0.4;
    addBox(g, body, L, bodyH, W * 0.94, 0, low + bodyH / 2, 0);
    const cabL = variant === CarVariant.SEDAN ? L * 0.46 : L * 0.34;
    const cabX = variant === CarVariant.SEDAN ? -L * 0.04 : -L * 0.24;
    const cabH = H * 0.42;
    addBox(g, body, cabL, cabH, W * 0.88, cabX, low + bodyH + cabH / 2, 0);
    roofY = low + bodyH + cabH;
    vent(addBox(g, glass(), cabL * 0.96, cabH * 0.62, W * 0.9, cabX, low + bodyH + cabH * 0.55, 0));
    if (variant === CarVariant.PICKUP) {
      // Open bed: a floor plate with low side rails behind the cab.
      addBox(g, body, L * 0.42, H * 0.1, W * 0.9, L * 0.26, low + bodyH + H * 0.05, 0);
      for (const sz of [1, -1]) {
        addBox(g, body, L * 0.42, H * 0.16, 0.12, L * 0.26, low + bodyH + H * 0.13, sz * W * 0.42);
      }
    }
  } else {
    const bodyH = variant === CarVariant.VAN ? H * 0.7 : H * 0.74;
    addBox(g, body, L, bodyH, W * 0.92, 0, low + bodyH / 2, 0);
    roofY = low + bodyH;
    // One long band of glazing instead of individual windows.
    const bandL = variant === CarVariant.VAN ? L * 0.6 : L * 0.84;
    vent(addBox(g, glass(), bandL, bodyH * 0.42, W * 0.95, -L * 0.06, low + bodyH * 0.72, 0));
    vent(addBox(g, glass(), L * 0.12, bodyH * 0.4, W * 0.86, L * 0.42, low + bodyH * 0.72, 0));
    if (variant === CarVariant.BUS) {
      for (const dx of [0.18, -0.3]) {
        addBox(g, glass(), 0.16, bodyH * 0.72, 0.12, dx * L, low + bodyH * 0.45, W * 0.47);
      }
      addBox(g, paint(0xb6b0a2), L * 0.3, 0.16, W * 0.6, -L * 0.1, low + bodyH + 0.08, 0);
    }
  }

  for (const wx of [-L * 0.32, L * 0.32]) {
    for (const sz of [1, -1]) addWheel(g, tyre, wx, wr, sz * W * 0.44, wr, 0.24);
  }
  const lamp = standardMaterial('metal', { color: 0xf3e5b4, roughness: 0.25, metalness: 0.1 });
  for (const sz of [1, -1]) {
    addBox(g, lamp, 0.12, 0.18, 0.34, L / 2 + 0.02, low + H * 0.34, sz * W * 0.3);
  }
  // A short pole and a small tricolor over the cab: even the staff car flies it.
  addFlag(g, -L * 0.28, roofY, W * 0.22, 0.7, 0.55, 0.36, 0.24);
  return g;
}

// ─── Wreckage ────────────────────────────────────────────────────────────────

/**
 * What is left of a building: a scorched slab, the bottom metre of its walls still
 * standing and a beam or two across the doorway. Cheap on purpose — a ruin is
 * mostly smoke.
 */
function buildBuildingRuin(spec: StructureSpec, variant: StructureVariant): THREE.Group {
  const g = new THREE.Group();
  const { width: w, depth: d } = spec;
  const burnt = charred();
  addScorch(g, Math.max(w, d) * 0.75);
  addBox(g, burnt, w * 0.92, 0.3, d * 0.92, 0, 0.15, 0);

  if (variant === BuildingVariant.TOWER) {
    // The tank rolled off its legs and landed on its side.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        addTube(
          g,
          new THREE.Vector3(sx * w * 0.42, 0, sz * w * 0.42),
          new THREE.Vector3(sx * w * 0.3, spec.height * 0.42, sz * w * 0.3),
          0.2, steel(0x3a3631),
        );
      }
    }
    const tank = addRound(
      g, new THREE.CylinderGeometry(w * 0.42, w * 0.42, spec.height * 0.26, 20),
      charred(), 0, w * 0.42, d * 0.15,
    );
    tank.rotation.x = Math.PI / 2;
    vent(tank);
    vent(addBox(g, burnt, w * 0.5, 0.5, d * 0.4, -w * 0.2, 0.25, -d * 0.2, 0, 0.6));
    // Its flagpole went down with the tank and lies clear of the wreck.
    addFallenFlag(g, -w * 0.3, 0.05, -d * 0.45, w * 0.05, 0.6, -d * 0.3, w * 0.26);
    return g;
  }

  // Four wall stubs, each leaning a little differently.
  const stubs: [number, number, number, number][] = [
    [-w * 0.42, 0, 0.16, 0.5], [w * 0.4, 0, -0.2, 1.1],
    [0, -d * 0.42, 0.1, 2.2], [0, d * 0.4, -0.14, 3.4],
  ];
  for (const [sx, sz, tilt, ry] of stubs) {
    vent(addBox(g, burnt, w * 0.3, 1.1 + Math.abs(tilt) * 2, 0.3, sx, 0.7, sz, tilt, ry));
  }
  addTube(
    g, new THREE.Vector3(-w * 0.4, 0.1, d * 0.2), new THREE.Vector3(w * 0.3, 1.3, -d * 0.3),
    0.14, charred(),
  );
  vent(addBox(g, burnt, w * 0.34, 0.4, d * 0.3, w * 0.1, 0.5, 0, 0.3, 0.8));
  addBox(g, burnt, w * 0.2, 0.3, d * 0.22, -w * 0.15, 0.45, d * 0.1, -0.2, 1.4);
  // The flagpole came down with the roof and is still flying, burnt and drooping.
  addFallenFlag(g, -w * 0.3, 0.06, -d * 0.3, w * 0.05, 1.05, -d * 0.05, w * 0.26);
  return g;
}

/** A burnt-out car: the body collapsed in on itself, tyres blown off. */
function buildCarRuin(spec: StructureSpec): THREE.Group {
  const g = new THREE.Group();
  const L = spec.width, W = spec.depth;
  const burnt = charred();
  addScorch(g, L * 0.8);
  vent(addBox(g, burnt, L * 0.94, spec.height * 0.3, W * 0.86, 0, spec.height * 0.15, 0));
  vent(addBox(g, burnt, L * 0.4, spec.height * 0.26, W * 0.8, -L * 0.06, spec.height * 0.4, 0, 0.2));
  const tyre = standardMaterial('metal', { color: 0x1a1917, roughness: 1 });
  // Two tyres blown off and lying flat on the scorch.
  addRound(g, new THREE.CylinderGeometry(0.32, 0.32, 0.2, 14), tyre, L * 0.55, 0.1, W * 0.6);
  addRound(g, new THREE.CylinderGeometry(0.32, 0.32, 0.2, 14), tyre, -L * 0.62, 0.1, -W * 0.5);
  addTube(
    g, new THREE.Vector3(-L * 0.3, 0.1, -W * 0.4), new THREE.Vector3(L * 0.3, 0.35, W * 0.4),
    0.08, steel(0x3a3631),
  );
  return g;
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

/** The intact model that fills the server's collision box for this variant. */
export function createStructureModel(
  variant: StructureVariant, spec: StructureSpec,
): THREE.Group {
  switch (variant) {
    case BuildingVariant.HOUSE: return buildHouse(spec);
    case BuildingVariant.BLOCK: return buildBlock(spec);
    case BuildingVariant.BARN: return buildBarn(spec);
    case BuildingVariant.TOWER: return buildTower(spec);
    default: return buildCar(spec, variant as CarVariant);
  }
}

/** The charred remains that replace it once the server marks it destroyed. */
export function createStructureRuin(
  variant: StructureVariant, spec: StructureSpec,
): THREE.Group {
  if (spec.kind === StructureKind.CAR) return buildCarRuin(spec);
  return buildBuildingRuin(spec, variant);
}


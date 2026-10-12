import * as THREE from 'three';
import { standardMaterial } from './Textures';
import { addLimb, addPart, addTube, addWheelPivot, starGeometry } from './ModelParts';

// ─────────────────────────────────────────────────────────────────────────────
// The three vehicle-mounted enemies that join the horde once the pilots start
// racking up kills: the green golf car with two soldiers aboard (10 kills), the
// motorcyclist (20 kills) and the armoured tank (30 kills).
//
// Same convention as the foot models: local +Z is the direction of march and the
// origin sits in the middle of the model, so the renderer's `y + size / 2` offset
// puts every wheel exactly on the ground plane (local y = -0.5 * size).
//
// Everything is built from primitives with generous segment counts — tyre bands,
// spoked rims, track links, road wheels, bolts and decals — because a single
// drone pass goes by at 15-30 m/s and a machine made of six boxes reads as a
// smudge. Roughly: golf car ~1.5 k tris, motorcyclist ~1.2 k tris, tank ~4 k tris.
// ─────────────────────────────────────────────────────────────────────────────

/** Local y of the ground plane, in units of `size`. */
const GROUND = -0.5;

/** Olive drab shared by every soldier riding a vehicle. */
const UNIFORM = 0x556b2f;
const UNIFORM_DARK = 0x41512a;
const HELMET_GREEN = 0x5a6b3a;
const FLAG_RED = 0xc8201c;

// -- Wheels -------------------------------------------------------------------

/**
 * A rolling wheel: fat tyre with rounded shoulders and a tread band, spoked rim
 * plates on both faces and a hub. The returned group is tagged so animate()
 * spins it around X at `roll` rad/s while the enemy is alive.
 */
function makeWheel(
  parent: THREE.Object3D,
  x: number, y: number, z: number,
  r: number, width: number,
  tyre: THREE.Material, rim: THREE.Material, roll: number,
): THREE.Group {
  const w = addWheelPivot(parent, x, y, z, roll);

  addPart(w, new THREE.CylinderGeometry(r, r, width, 24), tyre, 0, 0, 0).rotation.z = Math.PI / 2;
  addPart(w, new THREE.TorusGeometry(r - width * 0.40, width * 0.40, 10, 26), tyre, 0, 0, 0).rotation.y = Math.PI / 2;

  for (const side of [-1, 1]) {
    addPart(w, new THREE.CylinderGeometry(r * 0.62, r * 0.62, width * 0.12, 20), rim, 0, 0, side * width * 0.50).rotation.z = Math.PI / 2;
    addPart(w, new THREE.CylinderGeometry(r * 0.20, r * 0.20, width * 0.22, 12), rim, 0, 0, side * width * 0.56).rotation.z = Math.PI / 2;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spoke = addPart(
        w, new THREE.BoxGeometry(width * 0.10, r * 0.56, r * 0.17), rim,
        side * width * 0.50, Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.32,
      );
      spoke.rotation.x = a;
    }
  }
  return w;
}

// -- Soldier figure -----------------------------------------------------------

interface SoldierPose {
  /** Torso tilt forward, rad. */
  lean?: number;
  /** Thigh angle: 0 is straight out in front, positive drops the knee. */
  thigh?: number;
  /** Shin angle relative to the thigh, negative bends the knee back. */
  shin?: number;
  /** Upper-arm swing from the shoulder: 0 reaches forward, positive drops down. */
  arm?: number;
  /** How far the elbows sit out from the ribs. */
  armSpread?: number;
  /** Slung rifle across the back. */
  rifle?: boolean;
}

/**
 * A soldier built to be sat on something: hip pivots at the origin, thighs
 * forward and shins down instead of the marching pose of the foot model. Reuses
 * the same kit — webbing, jackboots, helmet with the red star — so the crew of a
 * golf car is unmistakably the same infantry that marches on foot.
 */
function makeSoldierFigure(s: number, pose: SoldierPose = {}): THREE.Group {
  const {
    lean = 0.12, thigh = 0.30, shin = 1.25, arm = -0.9, armSpread = 0.14, rifle = false,
  } = pose;
  const g = new THREE.Group();

  const uni = standardMaterial('fabric', { color: UNIFORM, roughness: 0.95 });
  const uniDark = standardMaterial('fabric', { color: UNIFORM_DARK, roughness: 0.95 });
  const helmetMat = standardMaterial('fabric', { color: HELMET_GREEN, roughness: 0.85 });
  const skin = standardMaterial('fabric', { color: 0xd8a06a, roughness: 0.9 });
  const boot = standardMaterial('fabric', { color: 0x241d16, roughness: 0.7 });
  const web = standardMaterial('fabric', { color: 0x6b5a3a, roughness: 1 });
  const metal = standardMaterial('metal', { color: 0xb9b9b0, roughness: 0.4, metalness: 0.7 });
  const wood = standardMaterial('wood', { color: 0x6e4f2e, roughness: 0.9 });
  const red = standardMaterial('fabric', { color: FLAG_RED, roughness: 0.8 });
  const dark = standardMaterial('fabric', { color: 0x1a1a1a, roughness: 0.9 });

  // Hips and the torso that leans out of them
  addPart(g, new THREE.BoxGeometry(0.17 * s, 0.11 * s, 0.15 * s), uniDark, 0, 0, 0.01 * s);
  const torso = addLimb(g, 0, 0.04 * s, 0);
  torso.rotation.x = lean;

  addPart(torso, new THREE.BoxGeometry(0.21 * s, 0.26 * s, 0.15 * s), uni, 0, 0.13 * s, 0.01 * s);
  addPart(torso, new THREE.BoxGeometry(0.225 * s, 0.15 * s, 0.175 * s), uniDark, 0, 0.17 * s, 0.01 * s);
  addPart(torso, new THREE.BoxGeometry(0.22 * s, 0.045 * s, 0.16 * s), web, 0, 0.04 * s, 0.01 * s);
  addPart(torso, new THREE.BoxGeometry(0.05 * s, 0.04 * s, 0.02 * s), metal, 0, 0.04 * s, 0.09 * s);
  for (const side of [-1, 1]) {
    addPart(torso, new THREE.BoxGeometry(0.055 * s, 0.07 * s, 0.045 * s), web, side * 0.07 * s, 0.09 * s, 0.09 * s);
    addPart(torso, new THREE.BoxGeometry(0.05 * s, 0.24 * s, 0.02 * s), web, side * 0.06 * s, 0.16 * s, 0.085 * s).rotation.z = -side * 0.22;
  }
  if (rifle) {
    // Slung across the back, muzzle up over the shoulder.
    addPart(torso, new THREE.BoxGeometry(0.05 * s, 0.20 * s, 0.04 * s), wood, 0.02 * s, 0.10 * s, -0.11 * s).rotation.z = 0.5;
    addPart(torso, new THREE.CylinderGeometry(0.014 * s, 0.014 * s, 0.34 * s, 8), metal, 0.06 * s, 0.26 * s, -0.12 * s).rotation.z = 0.5;
  }

  // Head, face and helmet with the red star
  addPart(torso, new THREE.CylinderGeometry(0.045 * s, 0.055 * s, 0.05 * s, 10), skin, 0, 0.29 * s, 0.01 * s);
  addPart(torso, new THREE.SphereGeometry(0.085 * s, 18, 14), skin, 0, 0.37 * s, 0.01 * s);
  for (const side of [-1, 1]) {
    addPart(torso, new THREE.SphereGeometry(0.02 * s, 8, 6), skin, side * 0.085 * s, 0.365 * s, 0.01 * s);
    addPart(torso, new THREE.SphereGeometry(0.019 * s, 8, 6), dark, side * 0.034 * s, 0.385 * s, 0.085 * s);
    addPart(torso, new THREE.BoxGeometry(0.04 * s, 0.011 * s, 0.02 * s), dark, side * 0.036 * s, 0.408 * s, 0.082 * s).rotation.z = side * 0.2;
  }
  addPart(torso, new THREE.SphereGeometry(0.018 * s, 8, 6), skin, 0, 0.362 * s, 0.09 * s);
  addPart(torso, new THREE.BoxGeometry(0.05 * s, 0.012 * s, 0.02 * s), dark, 0, 0.33 * s, 0.085 * s);
  addPart(torso, new THREE.SphereGeometry(0.10 * s, 20, 14), helmetMat, 0, 0.40 * s, 0.005 * s, 1, 0.8, 1.05);
  addPart(torso, new THREE.CylinderGeometry(0.135 * s, 0.145 * s, 0.025 * s, 18), helmetMat, 0, 0.40 * s, 0.005 * s);
  addPart(torso, starGeometry(0.03 * s, 0.01 * s), red, 0, 0.41 * s, 0.105 * s);

  // Arms reaching for the wheel / bars
  for (const side of [-1, 1]) {
    const shoulder = addLimb(torso, side * 0.115 * s, 0.235 * s, 0.01 * s);
    shoulder.rotation.x = arm;
    shoulder.rotation.z = -side * armSpread;
    addPart(shoulder, new THREE.CylinderGeometry(0.05 * s, 0.045 * s, 0.15 * s, 10), uni, 0, -0.075 * s, 0);
    addPart(shoulder, new THREE.SphereGeometry(0.045 * s, 10, 8), uniDark, 0, -0.15 * s, 0);
    addPart(shoulder, new THREE.CylinderGeometry(0.042 * s, 0.038 * s, 0.14 * s, 10), uni, 0, -0.22 * s, 0);
    addPart(shoulder, new THREE.SphereGeometry(0.045 * s, 10, 8), skin, 0, -0.30 * s, 0);
  }

  // Thighs forward, shins down, heavy boots
  for (const side of [-1, 1]) {
    const hip = addLimb(g, side * 0.075 * s, -0.02 * s, 0.02 * s);
    hip.rotation.x = thigh;
    addPart(hip, new THREE.CylinderGeometry(0.062 * s, 0.055 * s, 0.18 * s, 10), uni, 0, 0, 0.09 * s).rotation.x = Math.PI / 2;
    addPart(hip, new THREE.SphereGeometry(0.058 * s, 10, 8), uniDark, 0, 0, 0.18 * s);
    addPart(hip, new THREE.BoxGeometry(0.065 * s, 0.045 * s, 0.05 * s), web, 0, 0, 0.20 * s);

    const shinP = addLimb(hip, 0, 0, 0.18 * s);
    shinP.rotation.x = shin;
    addPart(shinP, new THREE.CylinderGeometry(0.052 * s, 0.046 * s, 0.17 * s, 10), uni, 0, -0.085 * s, 0);
    addPart(shinP, new THREE.BoxGeometry(0.08 * s, 0.07 * s, 0.16 * s), boot, 0, -0.19 * s, 0.03 * s);
    addPart(shinP, new THREE.BoxGeometry(0.09 * s, 0.022 * s, 0.18 * s), web, 0, -0.235 * s, 0.03 * s);
  }
  return g;
}
// -- Golf car with two soldiers -----------------------------------------------

/**
 * The 10-kill reinforcement: a green golf car rolling on four spoked wheels,
 * two helmeted soldiers in the back, cargo bed behind them. Local +Z is the
 * front, so the windshield, headlights and grille lead the way.
 */
export function createGolfCart(s: number): THREE.Group {
  const g = new THREE.Group();

  const paint = standardMaterial('metal', { color: 0x2f7d32, roughness: 0.45, metalness: 0.25 });
  const paintDark = standardMaterial('metal', { color: 0x24631f, roughness: 0.5, metalness: 0.25 });
  const chrome = standardMaterial('metal', { color: 0xd6d6d0, roughness: 0.18, metalness: 0.95 });
  const steel = standardMaterial('metal', { color: 0x8f8f88, roughness: 0.4, metalness: 0.8 });
  const rubber = standardMaterial('concrete', { color: 0x1b1b1b, roughness: 1 });
  const vinyl = standardMaterial('fabric', { color: 0x22261f, roughness: 0.9 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xbfe0ff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0, side: THREE.DoubleSide,
  });
  const lamp = standardMaterial('metal', { color: 0xfff3cf, roughness: 0.2, metalness: 0.1 });
  const amber = standardMaterial('metal', { color: 0xff9a2a, roughness: 0.3, metalness: 0.2 });
  const tail = standardMaterial('metal', { color: 0xc42020, roughness: 0.3, metalness: 0.2 });

  const wheelR = 0.15, wheelW = 0.09, axleY = GROUND + wheelR;

  // Chassis, floor pan and the tail cap of the cargo bed
  addPart(g, new THREE.BoxGeometry(0.44 * s, 0.05 * s, 0.86 * s), paintDark, 0, -0.425 * s, -0.05 * s);
  addPart(g, new THREE.BoxGeometry(0.42 * s, 0.04 * s, 0.24 * s), paint, 0, -0.40 * s, -0.42 * s);
  for (const side of [-1, 1]) {
    addPart(g, new THREE.BoxGeometry(0.03 * s, 0.13 * s, 0.26 * s), paint, side * 0.205 * s, -0.33 * s, -0.42 * s);
    addPart(g, new THREE.BoxGeometry(0.06 * s, 0.05 * s, 0.06 * s), steel, side * 0.14 * s, -0.44 * s, 0.30 * s);
  }
  addPart(g, new THREE.BoxGeometry(0.44 * s, 0.11 * s, 0.03 * s), paint, 0, -0.40 * s, -0.545 * s);
  for (const side of [-1, 1]) {
    addPart(g, new THREE.BoxGeometry(0.07 * s, 0.045 * s, 0.02 * s), tail, side * 0.15 * s, -0.40 * s, -0.56 * s);
    addPart(g, new THREE.BoxGeometry(0.04 * s, 0.02 * s, 0.02 * s), chrome, side * 0.15 * s, -0.44 * s, -0.56 * s);
  }

  // Bonnet, grille and the front end
  addPart(g, new THREE.BoxGeometry(0.44 * s, 0.18 * s, 0.18 * s), paint, 0, -0.41 * s, 0.34 * s);
  addPart(g, new THREE.BoxGeometry(0.44 * s, 0.05 * s, 0.18 * s), paint, 0, -0.33 * s, 0.35 * s).rotation.x = -0.55;
  addPart(g, new THREE.BoxGeometry(0.24 * s, 0.09 * s, 0.02 * s), vinyl, 0, -0.44 * s, 0.425 * s);
  for (let i = 0; i < 3; i++) {
    addPart(g, new THREE.BoxGeometry(0.22 * s, 0.012 * s, 0.015 * s), chrome, 0, (-0.465 + i * 0.025) * s, 0.435 * s);
  }
  addPart(g, new THREE.BoxGeometry(0.46 * s, 0.05 * s, 0.05 * s), chrome, 0, -0.46 * s, 0.44 * s);
  for (const side of [-1, 1]) {
    addPart(g, new THREE.SphereGeometry(0.035 * s, 16, 12), lamp, side * 0.155 * s, -0.35 * s, 0.40 * s);
    addPart(g, new THREE.TorusGeometry(0.038 * s, 0.008 * s, 8, 16), chrome, side * 0.155 * s, -0.35 * s, 0.40 * s);
    addPart(g, new THREE.BoxGeometry(0.045 * s, 0.028 * s, 0.02 * s), amber, side * 0.09 * s, -0.44 * s, 0.435 * s);
    addPart(g, new THREE.CylinderGeometry(0.018 * s, 0.018 * s, 0.10 * s, 10), chrome, side * 0.16 * s, -0.46 * s, 0.46 * s).rotation.x = Math.PI / 2;
  }

  // Windshield in its chrome frame
  addPart(g, new THREE.PlaneGeometry(0.40 * s, 0.30 * s), glassMat, 0, -0.14 * s, 0.265 * s).rotation.x = -0.12;
  for (const side of [-1, 1]) {
    addTube(g, new THREE.Vector3(side * 0.20 * s, -0.30 * s, 0.30 * s), new THREE.Vector3(side * 0.205 * s, 0.01 * s, 0.25 * s), 0.014 * s, chrome, 8);
  }
  addTube(g, new THREE.Vector3(-0.205 * s, 0.01 * s, 0.25 * s), new THREE.Vector3(0.205 * s, 0.01 * s, 0.25 * s), 0.014 * s, chrome, 8);

  // Bench seat, backrest and the steering wheel
  addPart(g, new THREE.BoxGeometry(0.44 * s, 0.26 * s, 0.20 * s), vinyl, 0, -0.27 * s, -0.06 * s);
  addPart(g, new THREE.BoxGeometry(0.44 * s, 0.30 * s, 0.06 * s), vinyl, 0, 0.01 * s, -0.17 * s);
  for (const side of [-1, 1]) {
    addPart(g, new THREE.BoxGeometry(0.05 * s, 0.24 * s, 0.02 * s), vinyl, side * 0.16 * s, 0.01 * s, -0.155 * s);
  }
  addTube(g, new THREE.Vector3(-0.11 * s, -0.12 * s, 0.20 * s), new THREE.Vector3(-0.11 * s, -0.02 * s, 0.16 * s), 0.012 * s, steel, 8);
  addPart(g, new THREE.TorusGeometry(0.055 * s, 0.011 * s, 8, 18), vinyl, -0.11 * s, -0.02 * s, 0.155 * s).rotation.x = -1.15;
  addPart(g, new THREE.CylinderGeometry(0.016 * s, 0.016 * s, 0.02 * s, 10), chrome, -0.11 * s, -0.02 * s, 0.15 * s).rotation.x = -1.15;

  // Roof on four posts, with a whip antenna at the rear
  addPart(g, new THREE.BoxGeometry(0.50 * s, 0.03 * s, 0.86 * s), paintDark, 0, 0.47 * s, -0.05 * s);
  addPart(g, new THREE.BoxGeometry(0.52 * s, 0.02 * s, 0.04 * s), paint, 0, 0.46 * s, 0.38 * s);
  addPart(g, new THREE.BoxGeometry(0.52 * s, 0.02 * s, 0.04 * s), paint, 0, 0.46 * s, -0.48 * s);
  for (const side of [-1, 1]) {
    for (const zz of [0.28, -0.40]) {
      addTube(g, new THREE.Vector3(side * 0.22 * s, 0.46 * s, zz * s), new THREE.Vector3(side * 0.22 * s, -0.34 * s, zz * s), 0.016 * s, chrome, 8);
    }
  }
  addTube(g, new THREE.Vector3(0.20 * s, 0.47 * s, -0.44 * s), new THREE.Vector3(0.26 * s, 0.86 * s, -0.50 * s), 0.006 * s, steel, 6);

  // Crew: driver on the left, rifleman on the right
  const driver = makeSoldierFigure(s, { lean: 0.28, thigh: 0.30, shin: 1.25, arm: -1.05, armSpread: 0.06 });
  driver.position.set(-0.11 * s, -0.10 * s, -0.06 * s);
  g.add(driver);
  const gunner = makeSoldierFigure(s, { lean: 0.05, thigh: 0.30, shin: 1.25, arm: -0.55, rifle: true });
  gunner.position.set(0.11 * s, -0.10 * s, -0.06 * s);
  g.add(gunner);

  // Wheels: the front pair steers slightly out, all four spin while alive
  for (const side of [-1, 1]) {
    makeWheel(g, side * 0.20 * s, axleY * s, 0.26 * s, wheelR * s, wheelW * s, rubber, chrome, 9).rotation.y = side * 0.06;
    makeWheel(g, side * 0.20 * s, axleY * s, -0.30 * s, wheelR * s, wheelW * s, rubber, chrome, 9);
  }
  return g;
}

// -- Motorcyclist --------------------------------------------------------------

/**
 * The 20-kill reinforcement: a single soldier on a military motorbike, leaning
 * forward over the tank with a rifle slung behind. Fastest thing in the horde.
 */
export function createMotorcyclist(s: number): THREE.Group {
  const g = new THREE.Group();

  const paint = standardMaterial('metal', { color: 0x3c5a2a, roughness: 0.4, metalness: 0.35 });
  const steel = standardMaterial('metal', { color: 0x9a9a92, roughness: 0.35, metalness: 0.85 });
  const chrome = standardMaterial('metal', { color: 0xd6d6d0, roughness: 0.16, metalness: 0.95 });
  const rubber = standardMaterial('concrete', { color: 0x1b1b1b, roughness: 1 });
  const iron = standardMaterial('metal', { color: 0x3a3a36, roughness: 0.6, metalness: 0.7 });
  const vinyl = standardMaterial('fabric', { color: 0x22261f, roughness: 0.9 });
  const web = standardMaterial('fabric', { color: 0x6b5a3a, roughness: 1 });
  const lamp = standardMaterial('metal', { color: 0xfff6d8, roughness: 0.15, metalness: 0.1 });
  const red = standardMaterial('fabric', { color: FLAG_RED, roughness: 0.8 });

  const wheelR = 0.16, wheelW = 0.075, axleY = GROUND + wheelR;

  // Frame, engine and exhaust
  addTube(g, new THREE.Vector3(0, -0.12 * s, 0.20 * s), new THREE.Vector3(0, -0.32 * s, -0.26 * s), 0.018 * s, iron, 10);
  addTube(g, new THREE.Vector3(0, -0.12 * s, 0.20 * s), new THREE.Vector3(0, -0.26 * s, 0.02 * s), 0.016 * s, iron, 10);
  addTube(g, new THREE.Vector3(0, -0.20 * s, 0.10 * s), new THREE.Vector3(0, -0.34 * s, -0.28 * s), 0.016 * s, iron, 10);
  addPart(g, new THREE.BoxGeometry(0.19 * s, 0.16 * s, 0.22 * s), iron, 0, -0.25 * s, 0.02 * s);
  addPart(g, new THREE.BoxGeometry(0.22 * s, 0.06 * s, 0.14 * s), steel, 0, -0.16 * s, 0.06 * s);
  for (let i = 0; i < 4; i++) {
    addPart(g, new THREE.BoxGeometry(0.23 * s, 0.012 * s, 0.02 * s), steel, 0, (-0.27 + i * 0.03) * s, 0.10 * s);
  }
  for (const side of [-1, 1]) {
    addTube(g, new THREE.Vector3(side * 0.09 * s, -0.26 * s, 0.04 * s), new THREE.Vector3(side * 0.12 * s, -0.30 * s, -0.16 * s), 0.022 * s, chrome, 10);
    addPart(g, new THREE.CylinderGeometry(0.035 * s, 0.035 * s, 0.18 * s, 14), chrome, side * 0.12 * s, -0.30 * s, -0.26 * s).rotation.x = Math.PI / 2;
  }

  // Tank, seat and rear fender
  addPart(g, new THREE.SphereGeometry(0.13 * s, 20, 14), paint, 0, -0.10 * s, 0.06 * s, 1, 0.6, 1.35);
  addPart(g, starGeometry(0.035 * s, 0.012 * s), red, 0.125 * s, -0.10 * s, 0.06 * s).rotation.y = Math.PI / 2;
  addPart(g, starGeometry(0.035 * s, 0.012 * s), red, -0.125 * s, -0.10 * s, 0.06 * s).rotation.y = -Math.PI / 2;
  addPart(g, new THREE.BoxGeometry(0.13 * s, 0.05 * s, 0.26 * s), vinyl, 0, -0.075 * s, -0.10 * s);
  addPart(g, new THREE.BoxGeometry(0.14 * s, 0.02 * s, 0.06 * s), web, 0, -0.05 * s, -0.02 * s);
  addPart(g, new THREE.BoxGeometry(0.10 * s, 0.03 * s, 0.24 * s), paint, 0, -0.16 * s, -0.28 * s).rotation.x = 0.5;
  addPart(g, new THREE.BoxGeometry(0.05 * s, 0.04 * s, 0.02 * s), red, 0, -0.14 * s, -0.40 * s);

  // Front forks, bars, headlight and fender
  for (const side of [-1, 1]) {
    addTube(g, new THREE.Vector3(side * 0.045 * s, -0.11 * s, 0.19 * s), new THREE.Vector3(side * 0.045 * s, axleY, 0.32 * s), 0.017 * s, chrome, 10);
    addPart(g, new THREE.CylinderGeometry(0.024 * s, 0.024 * s, 0.07 * s, 10), iron, side * 0.045 * s, -0.13 * s, 0.20 * s);
    addPart(g, new THREE.CylinderGeometry(0.016 * s, 0.016 * s, 0.09 * s, 10), vinyl, side * 0.16 * s, -0.055 * s, 0.19 * s).rotation.z = Math.PI / 2;
    addTube(g, new THREE.Vector3(side * 0.10 * s, -0.04 * s, 0.19 * s), new THREE.Vector3(side * 0.13 * s, 0.02 * s, 0.16 * s), 0.006 * s, steel, 6);
    addPart(g, new THREE.SphereGeometry(0.022 * s, 10, 8), chrome, side * 0.135 * s, 0.025 * s, 0.155 * s, 1.3, 0.8, 0.5);
  }
  addPart(g, new THREE.CylinderGeometry(0.012 * s, 0.012 * s, 0.34 * s, 10), steel, 0, -0.055 * s, 0.19 * s).rotation.z = Math.PI / 2;
  addPart(g, new THREE.BoxGeometry(0.11 * s, 0.06 * s, 0.06 * s), iron, 0, -0.11 * s, 0.20 * s);
  addPart(g, new THREE.CylinderGeometry(0.055 * s, 0.05 * s, 0.06 * s, 18), paint, 0, -0.10 * s, 0.30 * s).rotation.x = Math.PI / 2;
  addPart(g, new THREE.SphereGeometry(0.045 * s, 16, 12), lamp, 0, -0.10 * s, 0.33 * s);
  addPart(g, new THREE.TorusGeometry(0.055 * s, 0.008 * s, 8, 18), chrome, 0, -0.10 * s, 0.32 * s);
  addPart(g, new THREE.BoxGeometry(0.11 * s, 0.03 * s, 0.26 * s), paint, 0, -0.20 * s, 0.30 * s).rotation.x = -0.6;

  // Rider: forward in the saddle, hands down on the bars
  const rider = makeSoldierFigure(s, { lean: 0.5, thigh: 0.75, shin: 0.95, arm: -1.3, armSpread: 0.05, rifle: true });
  rider.position.set(0, 0.02 * s, -0.06 * s);
  g.add(rider);

  makeWheel(g, 0, axleY * s, 0.32 * s, wheelR * s, wheelW * s, rubber, chrome, 16);
  makeWheel(g, 0, axleY * s, -0.28 * s, wheelR * s, wheelW * s, rubber, chrome, 16);
  return g;
}
// -- Tank ----------------------------------------------------------------------

/** A plain steel road wheel: tread band, two side discs and a hub. */
function makeRoadWheel(
  parent: THREE.Object3D, x: number, y: number, z: number,
  r: number, width: number, tread: THREE.Material, disc: THREE.Material, roll: number,
): THREE.Group {
  const w = addWheelPivot(parent, x, y, z, roll);
  addPart(w, new THREE.CylinderGeometry(r, r, width, 22), tread, 0, 0, 0).rotation.z = Math.PI / 2;
  addPart(w, new THREE.TorusGeometry(r - width * 0.30, width * 0.30, 8, 22), tread, 0, 0, 0).rotation.y = Math.PI / 2;
  for (const side of [-1, 1]) {
    addPart(w, new THREE.CylinderGeometry(r * 0.82, r * 0.82, width * 0.16, 20), disc, 0, 0, side * width * 0.48).rotation.z = Math.PI / 2;
    addPart(w, new THREE.CylinderGeometry(r * 0.26, r * 0.26, width * 0.30, 12), disc, 0, 0, side * width * 0.55).rotation.z = Math.PI / 2;
  }
  return w;
}

/**
 * The 30-kill reinforcement: an armoured tank on five road wheels a side with
 * track links, a cast round turret, a long gun with a muzzle brake, an AA
 * machine gun on the cupola and red stars on the cheeks.
 *
 * It is also the only enemy that survives a hit — the server gives it two hit
 * points, so the first drone leaves it burning (`Enemy.burning`, drawn by
 * EnemyRenderer with scorched paint, an emissive fire glow and flame particles)
 * and it takes a second quad to stop it.
 */
export function createTank(s: number): THREE.Group {
  const g = new THREE.Group();

  const hull = standardMaterial('metal', { color: 0x4a5a33, roughness: 0.62, metalness: 0.35 });
  const hullDark = standardMaterial('metal', { color: 0x3b4829, roughness: 0.66, metalness: 0.35 });
  const trackMat = standardMaterial('metal', { color: 0x2a2a26, roughness: 0.78, metalness: 0.6 });
  const steel = standardMaterial('metal', { color: 0x8a8a80, roughness: 0.45, metalness: 0.8 });
  const iron = standardMaterial('metal', { color: 0x33332e, roughness: 0.7, metalness: 0.6 });
  const red = standardMaterial('fabric', { color: FLAG_RED, roughness: 0.8 });
  const lamp = standardMaterial('metal', { color: 0xfff3cf, roughness: 0.2, metalness: 0.2 });

  // ── Running gear: tracks, road wheels, sprockets, fenders ──
  const wheelY = GROUND + 0.075;
  for (const side of [-1, 1]) {
    const x = side * 0.29 * s;
    addPart(g, new THREE.BoxGeometry(0.085 * s, 0.03 * s, 1.30 * s), trackMat, x, -0.485 * s, 0);
    addPart(g, new THREE.BoxGeometry(0.085 * s, 0.035 * s, 1.24 * s), trackMat, x, -0.30 * s, -0.02 * s);
    for (let i = 0; i < 14; i++) {
      addPart(g, new THREE.BoxGeometry(0.092 * s, 0.038 * s, 0.035 * s), iron, x, -0.481 * s, (-0.62 + i * 0.0955) * s);
    }
    for (let i = 0; i < 10; i++) {
      addPart(g, new THREE.BoxGeometry(0.092 * s, 0.038 * s, 0.035 * s), iron, x, -0.29 * s, (-0.44 + i * 0.098) * s);
    }
    for (const zz of [-0.23, 0, 0.23]) {
      addPart(g, new THREE.CylinderGeometry(0.03 * s, 0.03 * s, 0.07 * s, 12), steel, x, -0.335 * s, zz * s).rotation.z = Math.PI / 2;
    }
    for (const zz of [-0.46, -0.23, 0, 0.23, 0.46]) {
      makeRoadWheel(g, x, wheelY * s, zz * s, 0.075 * s, 0.07 * s, trackMat, hullDark, 2.2);
    }
    makeRoadWheel(g, x, -0.36 * s, -0.62 * s, 0.10 * s, 0.06 * s, iron, steel, 2.2);
    makeRoadWheel(g, x, -0.36 * s, 0.62 * s, 0.10 * s, 0.06 * s, iron, steel, 2.2);

    // Fender skirt and mud flaps over the tracks
    addPart(g, new THREE.BoxGeometry(0.05 * s, 0.025 * s, 1.44 * s), hullDark, side * 0.315 * s, -0.265 * s, 0);
    addPart(g, new THREE.BoxGeometry(0.06 * s, 0.09 * s, 0.04 * s), hullDark, side * 0.315 * s, -0.32 * s, 0.70 * s);
    addPart(g, new THREE.BoxGeometry(0.06 * s, 0.09 * s, 0.04 * s), hullDark, side * 0.315 * s, -0.32 * s, -0.70 * s);
  }

  // ── Hull ──
  addPart(g, new THREE.BoxGeometry(0.50 * s, 0.16 * s, 1.30 * s), hull, 0, -0.34 * s, 0);
  addPart(g, new THREE.BoxGeometry(0.54 * s, 0.16 * s, 1.34 * s), hull, 0, -0.18 * s, 0);
  addPart(g, new THREE.BoxGeometry(0.52 * s, 0.06 * s, 0.34 * s), hullDark, 0, -0.26 * s, 0.66 * s).rotation.x = -0.62;
  addPart(g, new THREE.BoxGeometry(0.52 * s, 0.05 * s, 0.22 * s), hull, 0, -0.10 * s, 0.64 * s).rotation.x = -0.35;
  addPart(g, new THREE.BoxGeometry(0.52 * s, 0.22 * s, 0.05 * s), hullDark, 0, -0.20 * s, -0.68 * s);
  addPart(g, new THREE.BoxGeometry(0.50 * s, 0.04 * s, 0.34 * s), hullDark, 0, -0.08 * s, -0.50 * s);
  for (let i = 0; i < 6; i++) {
    addPart(g, new THREE.BoxGeometry(0.40 * s, 0.015 * s, 0.02 * s), iron, 0, -0.055 * s, (-0.60 + i * 0.04) * s);
  }
  for (const side of [-1, 1]) {
    addPart(g, new THREE.CylinderGeometry(0.026 * s, 0.026 * s, 0.14 * s, 12), iron, side * 0.17 * s, -0.03 * s, -0.72 * s).rotation.x = Math.PI / 2.4;
    addPart(g, new THREE.CylinderGeometry(0.055 * s, 0.055 * s, 0.20 * s, 16), hullDark, side * 0.26 * s, -0.05 * s, -0.52 * s).rotation.x = Math.PI / 2;
    // Row of hull bolts, driver's hatch and headlamp
    for (let i = 0; i < 6; i++) {
      addPart(g, new THREE.CylinderGeometry(0.012 * s, 0.012 * s, 0.02 * s, 8), steel, side * 0.272 * s, -0.10 * s, (-0.40 + i * 0.16) * s).rotation.z = Math.PI / 2;
    }
    addTube(g, new THREE.Vector3(side * 0.24 * s, -0.09 * s, 0.30 * s), new THREE.Vector3(side * 0.24 * s, -0.09 * s, -0.30 * s), 0.011 * s, steel, 6);
  }
  addPart(g, new THREE.BoxGeometry(0.17 * s, 0.03 * s, 0.17 * s), hullDark, 0, -0.09 * s, 0.44 * s).rotation.x = -0.3;
  addPart(g, new THREE.BoxGeometry(0.06 * s, 0.03 * s, 0.08 * s), steel, 0, -0.06 * s, 0.50 * s).rotation.x = -0.3;
  addPart(g, new THREE.BoxGeometry(0.09 * s, 0.08 * s, 0.04 * s), lamp, 0.16 * s, -0.14 * s, 0.70 * s);
  for (const side of [-1, 1]) {
    addPart(g, new THREE.TorusGeometry(0.025 * s, 0.008 * s, 8, 12), steel, side * 0.16 * s, -0.30 * s, 0.76 * s).rotation.y = Math.PI / 2;
  }

  // ── Turret ──
  addPart(g, new THREE.CylinderGeometry(0.24 * s, 0.25 * s, 0.04 * s, 24), hullDark, 0, -0.09 * s, 0);
  addPart(g, new THREE.CylinderGeometry(0.20 * s, 0.27 * s, 0.20 * s, 24), hull, 0, 0.02 * s, 0);
  addPart(g, new THREE.BoxGeometry(0.30 * s, 0.15 * s, 0.16 * s), hull, 0, 0.00 * s, -0.26 * s);
  addPart(g, new THREE.BoxGeometry(0.22 * s, 0.08 * s, 0.10 * s), hullDark, 0, 0.02 * s, -0.34 * s);
  addPart(g, new THREE.BoxGeometry(0.20 * s, 0.14 * s, 0.10 * s), hullDark, 0, 0.02 * s, 0.24 * s);
  addPart(g, starGeometry(0.055 * s, 0.015 * s), red, 0.268 * s, 0.02 * s, 0).rotation.y = Math.PI / 2;
  addPart(g, starGeometry(0.055 * s, 0.015 * s), red, -0.268 * s, 0.02 * s, 0).rotation.y = -Math.PI / 2;

  // Main gun: mantlet, barrel, fume extractor and muzzle brake
  addPart(g, new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.18 * s, 16), iron, 0, 0.02 * s, 0.34 * s).rotation.x = Math.PI / 2;
  addPart(g, new THREE.CylinderGeometry(0.03 * s, 0.03 * s, 0.60 * s, 16), steel, 0, 0.02 * s, 0.66 * s).rotation.x = Math.PI / 2;
  addPart(g, new THREE.CylinderGeometry(0.048 * s, 0.048 * s, 0.10 * s, 16), steel, 0, 0.02 * s, 0.94 * s).rotation.x = Math.PI / 2;
  addPart(g, new THREE.BoxGeometry(0.11 * s, 0.02 * s, 0.04 * s), iron, 0, 0.02 * s, 0.94 * s);
  addPart(g, new THREE.CylinderGeometry(0.018 * s, 0.018 * s, 0.24 * s, 10), iron, 0.11 * s, -0.04 * s, 0.40 * s).rotation.x = Math.PI / 2;

  // Cupola, hatches, anti-aircraft machine gun and antenna
  addPart(g, new THREE.CylinderGeometry(0.085 * s, 0.095 * s, 0.08 * s, 18), hullDark, -0.07 * s, 0.15 * s, -0.04 * s);
  addPart(g, new THREE.CylinderGeometry(0.075 * s, 0.075 * s, 0.02 * s, 18), hull, -0.07 * s, 0.20 * s, -0.02 * s).rotation.x = -0.25;
  addPart(g, new THREE.BoxGeometry(0.04 * s, 0.03 * s, 0.07 * s), iron, -0.07 * s, 0.21 * s, 0.04 * s).rotation.x = -0.2;
  addPart(g, new THREE.CylinderGeometry(0.014 * s, 0.014 * s, 0.26 * s, 10), iron, -0.07 * s, 0.24 * s, 0.10 * s).rotation.x = -1.25;
  addPart(g, new THREE.TorusGeometry(0.03 * s, 0.007 * s, 8, 12), steel, -0.07 * s, 0.22 * s, 0.16 * s).rotation.x = -0.25;
  addPart(g, new THREE.CylinderGeometry(0.09 * s, 0.09 * s, 0.02 * s, 18), hull, 0.09 * s, 0.125 * s, 0.04 * s).rotation.z = 0.2;
  addTube(g, new THREE.Vector3(0.17 * s, 0.10 * s, -0.22 * s), new THREE.Vector3(0.26 * s, 0.60 * s, -0.34 * s), 0.006 * s, steel, 6);
  return g;
}

// -- Burning wreckage ---------------------------------------------------------
//
// What is left on the field after a vehicle enemy is destroyed: the same parts
// the living model is made of, blown apart, scorched and lying flat where the
// drone caught it. Effects.ts drops these groups at the kill point and keeps a
// flame going on them for a while, so they are built with the ground at local
// y = 0 (not at -size / 2 like the marching models) and never animated.
//
// Every piece goes through addChunk / restOnGround, which work out where the
// rotated piece's lowest vertex is and lower it onto the ground plane — so a
// wreck never floats above the grass or sinks through it, whatever the scatter.

/**
 * One piece of wreckage at (x, z), rotated as given and dropped onto the ground.
 */
function addChunk(
  g: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
  x: number, z: number, rx = 0, ry = 0, rz = 0, scale = 1,
): THREE.Mesh {
  if (scale !== 1) geo.scale(scale, scale, scale);
  geo.computeBoundingBox();
  const box = (geo.boundingBox
    ?? new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5)))
    .clone()
    .applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  const m = new THREE.Mesh(geo, mat);
  m.rotation.set(rx, ry, rz);
  m.position.set(x, -box.min.y, z);
  m.castShadow = true;
  g.add(m);
  return m;
}

/**
 * The same, for a pre-built sub-assembly (an axle with wheels still on it, a
 * turret with its gun): whatever tilt the assembly carries, its lowest point
 * ends up on the ground.
 */
function restOnGround(g: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(g);
  if (Number.isFinite(box.min.y)) g.position.y = -box.min.y;
}

/** The blackened patch of ground under a burning vehicle. */
function addScorch(g: THREE.Object3D, r: number): void {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(r, 28),
    new THREE.MeshStandardMaterial({ color: 0x14110e, roughness: 1, metalness: 0, transparent: true }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  m.receiveShadow = true;
  m.userData.scorch = true;
  g.add(m);
}

/**
 * A wheel torn off its axle. `tilt` is the roll around Z: 0 leaves it lying flat
 * like a dropped plate, PI / 2 stands it on its rim.
 */
function addWreckWheel(
  g: THREE.Object3D, x: number, z: number, r: number, width: number,
  tyre: THREE.Material, rim: THREE.Material, tilt = 0, ry = 0,
): void {
  const w = new THREE.Group();
  w.position.set(x, 0, z);
  w.rotation.set(0, ry, tilt);
  addPart(w, new THREE.CylinderGeometry(r, r, width, 20), tyre, 0, 0, 0).rotation.z = Math.PI / 2;
  addPart(w, new THREE.TorusGeometry(r - width * 0.35, width * 0.35, 8, 20), tyre, 0, 0, 0).rotation.x = Math.PI / 2;
  addPart(w, new THREE.CylinderGeometry(r * 0.30, r * 0.30, width * 1.20, 12), rim, 0, 0, 0).rotation.z = Math.PI / 2;
  restOnGround(w);
  g.add(w);
}

/**
 * The burnt-out paint and bare metal of a wreck. A fresh material is made per
 * call (standardMaterial never hands the same instance out twice), which is what
 * lets Effects fade one wreck out without touching anything else in the scene.
 */
function wreckMaterials(paintColor: number) {
  const mats = {
    paint: standardMaterial('metal', { color: paintColor, roughness: 0.92, metalness: 0.2 }),
    char: standardMaterial('metal', { color: 0x1e1b17, roughness: 1, metalness: 0.1 }),
    iron: standardMaterial('metal', { color: 0x2c2925, roughness: 0.8, metalness: 0.6 }),
    steel: standardMaterial('metal', { color: 0x6e6a62, roughness: 0.6, metalness: 0.85 }),
    rubber: standardMaterial('concrete', { color: 0x141311, roughness: 1 }),
    vinyl: standardMaterial('fabric', { color: 0x1c1a16, roughness: 1 }),
    red: standardMaterial('fabric', { color: 0x6e1512, roughness: 0.9 }),
  };
  // Transparent from the start: Effects fades a wreck out by lowering opacity, and
  // switching `transparent` on afterwards would force a shader rebuild mid-flight.
  for (const key of Object.keys(mats) as (keyof typeof mats)[]) mats[key].transparent = true;
  return mats;
}


// -- Golf car wreck -----------------------------------------------------------

/**
 * The remains of the golf car: the body torn into its big panels, the bench
 * thrown out, the roof folded across the grass and the rear axle still carrying
 * both of its wheels.
 */
export function createGolfCartWreck(s: number): THREE.Group {
  const g = new THREE.Group();
  const m = wreckMaterials(0x24421f);
  addScorch(g, 0.75 * s);

  // Floor pan, tail panel, bonnet and the front bumper
  addChunk(g, new THREE.BoxGeometry(0.44 * s, 0.05 * s, 0.50 * s), m.char, 0, 0, 0.18, 0.2, 0.12);
  addChunk(g, new THREE.BoxGeometry(0.44 * s, 0.11 * s, 0.03 * s), m.paint, -0.45 * s, 0.35 * s, 0, 0.5, 1.45);
  addChunk(g, new THREE.BoxGeometry(0.44 * s, 0.18 * s, 0.18 * s), m.paint, 0.50 * s, -0.35 * s, 0, -0.6, 0.9);
  addChunk(g, new THREE.BoxGeometry(0.46 * s, 0.05 * s, 0.05 * s), m.steel, 0.20 * s, 0.75 * s, 0, -0.4, 0.1);

  // Bench, backrest, roof and the cooler box from the bed
  addChunk(g, new THREE.BoxGeometry(0.44 * s, 0.26 * s, 0.20 * s), m.vinyl, -0.30 * s, -0.50 * s, 1.50, 0.3);
  addChunk(g, new THREE.BoxGeometry(0.44 * s, 0.30 * s, 0.06 * s), m.vinyl, 0.15 * s, 0.55 * s, 1.57, 0.3);
  addChunk(g, new THREE.BoxGeometry(0.50 * s, 0.03 * s, 0.60 * s), m.char, 0.55 * s, 0.45 * s, 0, 0.9);
  addChunk(g, new THREE.BoxGeometry(0.26 * s, 0.18 * s, 0.20 * s), m.paint, -0.70 * s, 0.15 * s, 0, 0.8, 0.2);

  // Two canopy posts, snapped off the roof and flat on the ground
  for (const [px, pz, ry] of [[-0.15, -0.75, 0.4], [0.80, 0.05, -0.9]] as const) {
    addChunk(g, new THREE.CylinderGeometry(0.016 * s, 0.016 * s, 0.50 * s, 8), m.steel, px * s, pz * s, 0, ry, Math.PI / 2);
  }

  // Rear axle with both wheels still bolted to it...
  const axle = new THREE.Group();
  axle.position.set(-0.50 * s, 0, -0.25 * s);
  axle.rotation.set(0, 0.6, 0.25);
  addPart(axle, new THREE.CylinderGeometry(0.022 * s, 0.022 * s, 0.46 * s, 10), m.steel, 0, 0, 0).rotation.z = Math.PI / 2;
  for (const side of [-1, 1]) {
    const hub = new THREE.Group();
    hub.position.set(side * 0.19 * s, 0, 0);
    addPart(hub, new THREE.CylinderGeometry(0.15 * s, 0.15 * s, 0.09 * s, 20), m.rubber, 0, 0, 0).rotation.z = Math.PI / 2;
    addPart(hub, new THREE.TorusGeometry(0.115 * s, 0.035 * s, 8, 20), m.rubber, 0, 0, 0).rotation.z = Math.PI / 2;
    axle.add(hub);
  }
  restOnGround(axle);
  g.add(axle);

  // ...and one wheel that rolled off on its own
  addWreckWheel(g, 0.85 * s, -0.75 * s, 0.15 * s, 0.09 * s, m.rubber, m.steel, 0.2, 0.7);

  // Headlights knocked out of the grille
  for (const [px, pz] of [[-0.85, -0.55], [0.05, 0.90]] as const) {
    addChunk(g, new THREE.SphereGeometry(0.035 * s, 10, 8), m.steel, px * s, pz * s);
  }
  return g;
}


// -- Motorcyclist wreck -------------------------------------------------------

/**
 * The remains of the motorcyclist: the bike broken into a front end and a rear
 * triangle, the tank split open, and the rider's helmet, rifle and boot flung
 * out along the direction it was travelling.
 */
export function createMotorcyclistWreck(s: number): THREE.Group {
  const g = new THREE.Group();
  const m = wreckMaterials(0x2b3f22);
  addScorch(g, 0.55 * s);

  // Front end: forks, handlebar, headlight and the front fender, all in one
  // twisted bunch that slid along the road.
  const front = new THREE.Group();
  front.position.set(0.30 * s, 0, -0.40 * s);
  front.rotation.set(0, 0.35, 1.45);
  for (const side of [-1, 1]) {
    addPart(front, new THREE.CylinderGeometry(0.017 * s, 0.017 * s, 0.30 * s, 8), m.steel, side * 0.045 * s, 0, 0.06 * s);
    addPart(front, new THREE.CylinderGeometry(0.016 * s, 0.016 * s, 0.09 * s, 8), m.vinyl, side * 0.16 * s, 0.02 * s, 0.02 * s).rotation.z = Math.PI / 2;
  }
  addPart(front, new THREE.CylinderGeometry(0.012 * s, 0.012 * s, 0.34 * s, 8), m.steel, 0, 0.02 * s, 0.02 * s).rotation.z = Math.PI / 2;
  addPart(front, new THREE.SphereGeometry(0.045 * s, 12, 10), m.steel, 0, 0.02 * s, 0.10 * s);
  addPart(front, new THREE.BoxGeometry(0.11 * s, 0.03 * s, 0.26 * s), m.paint, 0, -0.02 * s, 0.22 * s).rotation.x = -0.6;
  restOnGround(front);
  g.add(front);

  // The two wheels: the front one rolled a good way off, the rear is still on the
  // swingarm and leaning against the engine.
  addWreckWheel(g, -0.85 * s, 0.70 * s, 0.14 * s, 0.08 * s, m.rubber, m.steel, 0, 0.4);
  addWreckWheel(g, 0.10 * s, 0.30 * s, 0.14 * s, 0.08 * s, m.rubber, m.steel, 1.35, -0.5);

  // Frame, engine, tank, seat, exhaust and the rear fender
  addChunk(g, new THREE.BoxGeometry(0.16 * s, 0.14 * s, 0.20 * s), m.iron, -0.10 * s, -0.15 * s, 0, 0.4, 0.15);
  addChunk(g, new THREE.SphereGeometry(0.13 * s, 16, 12), m.paint, 0.05 * s, -0.05 * s, 0, 0.9);
  addChunk(g, new THREE.BoxGeometry(0.13 * s, 0.05 * s, 0.26 * s), m.vinyl, -0.40 * s, 0.20 * s, 0, 1.1);
  addChunk(g, new THREE.BoxGeometry(0.11 * s, 0.03 * s, 0.26 * s), m.paint, 0.35 * s, 0.55 * s, 0, -0.7);
  addChunk(g, new THREE.CylinderGeometry(0.035 * s, 0.035 * s, 0.30 * s, 12), m.steel, 0.50 * s, 0.25 * s, 0, 0.3, Math.PI / 2);

  // What is left of the rider
  addChunk(g, new THREE.SphereGeometry(0.085 * s, 14, 10), m.paint, -0.60 * s, -0.60 * s);
  addChunk(g, new THREE.BoxGeometry(0.13 * s, 0.045 * s, 0.07 * s), m.char, -0.60 * s, -0.78 * s, 0, 0.6);
  addChunk(g, new THREE.BoxGeometry(0.06 * s, 0.05 * s, 0.13 * s), m.char, -0.35 * s, -0.85 * s, 0, 1.2);
  addChunk(g, new THREE.BoxGeometry(0.05 * s, 0.16 * s, 0.05 * s), m.iron, -0.20 * s, 0.85 * s, Math.PI / 2, 0.5);
  addChunk(g, new THREE.CylinderGeometry(0.014 * s, 0.014 * s, 0.34 * s, 8), m.steel, -0.05 * s, 0.95 * s, 0, 0.5, Math.PI / 2);
  return g;
}


// -- Tank wreck ---------------------------------------------------------------

/**
 * The remains of the tank: the turret blown off with its gun still attached, a
 * stretch of track unrolled across the scorch, road wheels thrown clear and the
 * hull broken into its front and rear sections.
 */
export function createTankWreck(s: number): THREE.Group {
  const g = new THREE.Group();
  const m = wreckMaterials(0x333d24);
  addScorch(g, 1.05 * s);

  // Turret, gun and all, lying on its side a few metres from the hull
  const turret = new THREE.Group();
  turret.position.set(0.30 * s, 0, -0.35 * s);
  turret.rotation.set(0, 0.45, 1.15);
  addPart(turret, new THREE.CylinderGeometry(0.26 * s, 0.31 * s, 0.24 * s, 24), m.char, 0, 0, 0);
  addPart(turret, new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.18 * s, 14), m.iron, 0, 0.14 * s, 0);
  addPart(turret, new THREE.CylinderGeometry(0.03 * s, 0.03 * s, 0.60 * s, 14), m.steel, 0, 0.14 * s, 0.40 * s).rotation.x = Math.PI / 2;
  addPart(turret, new THREE.CylinderGeometry(0.048 * s, 0.048 * s, 0.10 * s, 14), m.steel, 0, 0.14 * s, 0.68 * s).rotation.x = Math.PI / 2;
  addPart(turret, starGeometry(0.07 * s, 0.012 * s), m.red, 0.33 * s, 0, 0).rotation.y = Math.PI / 2;
  restOnGround(turret);
  g.add(turret);

  // Road wheels thrown clear of the running gear
  addWreckWheel(g, -0.55 * s, 0.40 * s, 0.075 * s, 0.07 * s, m.char, m.steel, 0, 0.3);
  addWreckWheel(g, 0.65 * s, 0.55 * s, 0.075 * s, 0.07 * s, m.char, m.steel, 0, 1.1);
  addWreckWheel(g, -0.15 * s, 0.75 * s, 0.075 * s, 0.07 * s, m.char, m.steel, 1.5, 0.2);

  // One side of track, unrolled where it snapped
  const track = new THREE.Group();
  track.position.set(-0.55 * s, 0, -0.55 * s);
  track.rotation.y = 0.7;
  for (let i = 0; i < 7; i++) {
    addPart(track, new THREE.BoxGeometry(0.11 * s, 0.035 * s, 0.05 * s), i % 2 ? m.iron : m.char, (i - 3) * 0.105 * s, 0, 0);
  }
  restOnGround(track);
  g.add(track);

  // Hull in two big pieces, the engine deck and the glacis
  addChunk(g, new THREE.BoxGeometry(0.55 * s, 0.30 * s, 0.45 * s), m.paint, 0.50 * s, 0.35 * s, 0.25, 0.4);
  addChunk(g, new THREE.BoxGeometry(0.60 * s, 0.22 * s, 0.40 * s), m.char, -0.60 * s, 0.10 * s, 0, -0.5, 0.2);
  addChunk(g, new THREE.BoxGeometry(0.50 * s, 0.06 * s, 0.30 * s), m.iron, 0.15 * s, 0.70 * s, 0, 0.8);

  // Hatches, antenna, fuel drum and the crew's stores
  addChunk(g, new THREE.CylinderGeometry(0.09 * s, 0.09 * s, 0.03 * s, 16), m.paint, 0.70 * s, -0.70 * s, 0, 0.5);
  addChunk(g, new THREE.CylinderGeometry(0.006 * s, 0.006 * s, 0.50 * s, 6), m.steel, -0.80 * s, -0.75 * s, 0, 0.9, Math.PI / 2);
  addChunk(g, new THREE.CylinderGeometry(0.09 * s, 0.09 * s, 0.28 * s, 14), m.paint, -0.75 * s, 0.65 * s, 0, 0.4, Math.PI / 2);
  addChunk(g, new THREE.BoxGeometry(0.12 * s, 0.07 * s, 0.20 * s), m.iron, 0.05 * s, -0.85 * s, 0, 0.3);
  addChunk(g, new THREE.BoxGeometry(0.12 * s, 0.07 * s, 0.20 * s), m.iron, 0.25 * s, -0.95 * s, 0, -0.6, 0.3);
  return g;
}


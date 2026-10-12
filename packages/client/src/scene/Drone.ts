import * as THREE from 'three';
import { standardMaterial } from './Textures';
import { DroneData } from '@red-attack/shared';

// High-contrast per-pilot colours so allied drones stay visible at range.
const OWNER_PALETTE = [0xff5c5c, 0x4dd2ff, 0xffd166, 0x9b5de5, 0x43d9ad, 0xff9f1c];

// Visual rotor speed in rad/s. Real 5" props spin far past what a frame budget
// can draw, so this is slowed down until the blades stay readable.
const PROP_SPIN = 55;

// X-frame layout: four motors on the diagonals, props sweeping PROP_REACH out
// from each motor bell.
const MOTOR_OFFSET = 0.40;
const PROP_REACH = 0.335;

function colorForOwner(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return OWNER_PALETTE[Math.abs(h) % OWNER_PALETTE.length];
}

interface PropRef {
  obj: THREE.Object3D;
  dir: number;   // +1 / -1: CW and CCW motors alternate across the frame
  phase: number; // random start angle so the four props are not synchronised
}

interface DroneVisual {
  group: THREE.Group;
  label: THREE.Sprite | null;
  color: number;
  lastTrail: number;
  props: PropRef[];
}

export class DroneRenderer {
  private scene: THREE.Scene;
  private meshes: Map<string, DroneVisual> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Render every live drone. Remote drones (other pilots) additionally get a
   * bright owner-tinted beacon, a floating callsign and a smoke trail, because
   * a carbon quad seen from 60 m is otherwise impossible to spot against the
   * terrain.
   */
  sync(
    drones: DroneData[],
    localOwnerId = '',
    names: Record<string, string> = {},
    viewPos?: THREE.Vector3,
    onTrail?: (x: number, y: number, z: number, color: number) => void,
  ) {
    const activeIds = new Set<string>();
    const now = performance.now() / 1000;

    for (const drone of drones) {
      if (!drone.alive) continue;
      activeIds.add(drone.id);

      const isOwn = drone.ownerId === localOwnerId;
      let vis = this.meshes.get(drone.id);
      if (!vis) {
        const color = colorForOwner(drone.ownerId);
        const built = this.createDroneMesh(color, isOwn);
        const label = isOwn ? null : this.createLabel(names[drone.ownerId] || 'PILOT', color);
        if (label) built.group.add(label);
        this.scene.add(built.group);
        vis = { group: built.group, label, color, lastTrail: 0, props: built.props };
        this.meshes.set(drone.id, vis);
      }

      const group = vis.group;
      group.position.set(drone.position.x, drone.position.y, drone.position.z);
      group.rotation.y = drone.yaw;
      group.rotation.x = -drone.pitch;

      // The pilot's camera sits inside their own quad, so hide that mesh from
      // its own pilot (no frame or props through the lens). Teammates still see
      // the full quad with its spinning propellers.
      group.visible = !isOwn;

      // Keep the props spinning: frame-rate independent, alternating direction.
      for (const p of vis.props) p.obj.rotation.y = p.phase + p.dir * now * PROP_SPIN;

      // Keep the callsign readable at any range by scaling it with distance.
      if (vis.label && viewPos) {
        const d = viewPos.distanceTo(group.position);
        const s = Math.min(4.5, Math.max(1.1, d * 0.055));
        vis.label.scale.set(s * 2.6, s * 0.65, 1);
      }

      // Smoke trail behind other pilots' drones (own drone is first-person).
      if (!isOwn && onTrail && now - vis.lastTrail > 0.12) {
        vis.lastTrail = now;
        onTrail(drone.position.x, drone.position.y, drone.position.z, vis.color);
      }
    }

    for (const [id, vis] of this.meshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(vis.group);
        this.dispose(vis.group);
        this.meshes.delete(id);
      }
    }
  }

  private createLabel(text: string, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 250, 58);
    ctx.font = 'bold 32px Segoe UI, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.toUpperCase().slice(0, 10), 128, 34);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
    );
    sprite.position.set(0, 0.9, 0);
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 10;
    return sprite;
  }

  private dispose(obj: THREE.Object3D) {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const m = mesh.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose();
      }
      const sprite = child as THREE.Sprite;
      if (sprite.isSprite) {
        const mat = sprite.material as THREE.SpriteMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
    });
  }

  /**
   * A 5" FPV freestyle quad: carbon X-frame, electronics stack and battery on
   * top, four motors with two-blade propellers, a nose-mounted FPV camera and a
   * VTX antenna at the rear. Nothing here is a fixed wing — every bit of lift
   * comes from a spinning prop, which is what an FPV pilot expects to see.
   */
  private createDroneMesh(accent: number, plain: boolean): { group: THREE.Group; props: PropRef[] } {
    const group = new THREE.Group();
    const props: PropRef[] = [];

    const carbon = standardMaterial('metal', { color: 0x24282e, metalness: 0.55, roughness: 0.6 });
    const darkMetal = standardMaterial('metal', { color: 0x11141a, metalness: 0.9, roughness: 0.35 });
    const rubber = standardMaterial('fabric', { color: 0x16181c, roughness: 0.95 });

    // Pilot-coloured parts keep allied drones visible against the terrain at
    // 60+ m; the own drone (seen first-person) stays neutral carbon.
    const accentMat = plain
      ? standardMaterial('metal', { color: 0x3c434c, metalness: 0.6, roughness: 0.45 })
      : new THREE.MeshStandardMaterial({
          color: accent, metalness: 0.25, roughness: 0.55,
          emissive: accent, emissiveIntensity: 0.3,
        });

    // -- Centre stack: bottom plate, FC/ESC, top plate, battery and strap -----
    group.add(new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.035, 0.54), carbon));

    const stack = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.07, 0.34), darkMetal);
    stack.position.y = 0.055;
    group.add(stack);

    const plateTop = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.48), accentMat);
    plateTop.position.y = 0.105;
    group.add(plateTop);

    const battery = new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.09, 0.40), accentMat);
    battery.position.y = 0.168;
    group.add(battery);

    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.265, 0.012, 0.05), rubber);
    strap.position.y = 0.222;
    group.add(strap);

    // -- Arms, motors and propellers on the four diagonals --------------------
    const armGeo = new THREE.BoxGeometry(0.075, 0.04, 0.46);
    const statorGeo = new THREE.CylinderGeometry(0.072, 0.078, 0.055, 12);
    const bellGeo = new THREE.CylinderGeometry(0.058, 0.064, 0.05, 12);
    const nutGeo = new THREE.CylinderGeometry(0.016, 0.02, 0.03, 6);
    const hubGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10);
    const bladeGeo = new THREE.BoxGeometry(0.07, 0.012, PROP_REACH - 0.035);
    const blurGeo = new THREE.CylinderGeometry(PROP_REACH, PROP_REACH, 0.004, 20);
    const blurMat = new THREE.MeshBasicMaterial({
      color: plain ? 0x9aa4b0 : accent, transparent: true, opacity: 0.1, depthWrite: false,
    });

    for (const [sx, sz] of [[1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
      const x = sx * MOTOR_OFFSET;
      const z = sz * MOTOR_OFFSET;
      const dir = sx * sz; // diagonal motors share a direction, neighbours oppose

      const arm = new THREE.Mesh(armGeo, carbon);
      arm.position.set(x * 0.5, 0.005, z * 0.5);
      arm.rotation.y = Math.atan2(x, z); // local +Z now points at this corner
      group.add(arm);

      const stator = new THREE.Mesh(statorGeo, darkMetal);
      stator.position.set(x, 0.03, z);
      group.add(stator);

      const bell = new THREE.Mesh(bellGeo, accentMat);
      bell.position.set(x, 0.078, z);
      group.add(bell);

      const nut = new THREE.Mesh(nutGeo, darkMetal);
      nut.position.set(x, 0.108, z);
      group.add(nut);

      // Two-blade prop, pitched along its span and spun around the shaft.
      const prop = new THREE.Group();
      prop.position.set(x, 0.118, z);
      prop.add(new THREE.Mesh(hubGeo, darkMetal));
      for (const side of [-1, 1]) {
        const blade = new THREE.Mesh(bladeGeo, plain ? carbon : accentMat);
        blade.position.z = side * (0.035 + (PROP_REACH - 0.035) / 2);
        blade.rotation.z = 0.24 * dir;
        prop.add(blade);
      }
      group.add(prop);
      props.push({ obj: prop, dir, phase: Math.random() * Math.PI * 2 });

      // Faint sweep disc sells the blur of a prop at full throttle.
      const blur = new THREE.Mesh(blurGeo, blurMat);
      blur.position.set(x, 0.12, z);
      group.add(blur);
    }

    // -- FPV camera block on the nose: the lens the pilot looks through -------
    const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.13), darkMetal);
    camBody.position.set(0, 0.1, 0.3);
    camBody.rotation.x = -0.28; // raked up, like a freestyle cam strap
    group.add(camBody);

    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.05, 0.04, 12),
      new THREE.MeshStandardMaterial({
        color: 0x101216,
        metalness: 0.2,
        roughness: 0.1,
        emissive: 0xff2222,
        emissiveIntensity: 0.7,
      }),
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0, 0.075);
    camBody.add(lens);

    // VTX antenna leaning back off the rear of the top plate.
    const antenna = new THREE.Group();
    antenna.position.set(0.09, 0.12, -0.24);
    antenna.rotation.x = -0.5;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 6), rubber);
    rod.position.y = 0.13;
    antenna.add(rod);
    const lollipop = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), accentMat);
    lollipop.position.y = 0.27;
    antenna.add(lollipop);
    group.add(antenna);

    // Underslung beacon + soft halo: unlit so they stay bright at any distance.
    if (!plain) {
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 10, 10),
        new THREE.MeshBasicMaterial({ color: accent }),
      );
      beacon.position.set(0, -0.14, 0);
      group.add(beacon);

      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.62, 10, 10),
        new THREE.MeshBasicMaterial({
          color: accent, transparent: true, opacity: 0.28, depthWrite: false,
        }),
      );
      group.add(halo);
    }

    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Transparent parts (prop blur, halo) must not drop solid shadows.
        child.castShadow = !(child.material as THREE.Material).transparent;
      }
    });

    return { group, props };
  }
}

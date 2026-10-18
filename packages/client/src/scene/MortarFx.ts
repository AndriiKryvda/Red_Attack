import * as THREE from 'three';
import {
  MORTAR_CAM_HOLD,
  MORTAR_GRAVITY,
  MORTAR_KILL_RADIUS,
  MORTAR_MAX_RANGE,
  MORTAR_MIN_RANGE,
  MORTAR_MUZZLE_HEIGHT,
  MORTAR_POSITION,
  MortarFireEvent,
  clampMortarTarget,
  mortarBallistics,
  mortarShellHeight,
} from '@red-attack/shared';

/** A shell the client flies on screen, advanced from the launch vector it was sent with. */
interface FlyingShell {
  mesh: THREE.Mesh;
  origin: THREE.Vector3;
  vel: THREE.Vector3;
  impact: THREE.Vector3;
  /** Unit vector across the flight path: the side the camera watches from. */
  side: THREE.Vector3;
  flight: number;
  /** Seconds since it left the muzzle, on this client's clock. */
  t: number;
  ownerId: string;
  /** Countdown to the next smoke puff. */
  puff: number;
}

/** Where the eye should be this frame to watch a shell, or to sit on the crater. */
export interface MortarCamShot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  /** True while the shell is still over the field, false while holding on the hit. */
  tracking: boolean;
}

export type TrailPuff = (x: number, y: number, z: number, color: number) => void;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Everything the mortar station shows beyond the tube itself: the ring of fire and
 * the predicted arc while aiming, the shells as they cross the field, and the
 * side-on camera that follows a shell down to its own detonation.
 *
 * Nothing here is authoritative. The arc is drawn with the same closed-form
 * ballistics the server resolves hits with, and each shell is replayed from the
 * launch vector it was sent with, so the pilot sees the shot land where the server
 * already decided it would.
 */
export class MortarFx {
  private readonly aim: THREE.Group;
  private readonly arc: THREE.Line;
  private readonly marker: THREE.Group;
  private readonly markerMat: THREE.MeshBasicMaterial;
  private readonly shells: FlyingShell[] = [];
  private readonly puff: TrailPuff;
  /** Told a shell left the tube, so its whistle can run the length of the flight. */
  private readonly onShell?: (shellId: string, flight: number) => void;

  /** This layer's own clock, so camera holds do not depend on server time. */
  private clock: number = 0;
  private holdUntil: number = 0;
  private readonly holdPos = new THREE.Vector3();
  private readonly holdLook = new THREE.Vector3();
  /** Samples drawn along the predicted path. */
  private static readonly ARC_POINTS = 44;

  constructor(scene: THREE.Scene, puff: TrailPuff, onShell?: (shellId: string, flight: number) => void) {
    this.puff = puff;
    this.onShell = onShell;

    this.aim = new THREE.Group();
    this.aim.visible = false;
    scene.add(this.aim);

    // Ring of fire: the near limit keeps a shell off our own fence, the far limit is
    // as far as the tube can throw. Both lie flat on the ground around the pad, so
    // the ring is on screen before the shell ever leaves the tube.
    const near = this.groundRing(MORTAR_MIN_RANGE, 0xffcc33);
    const far = this.groundRing(MORTAR_MAX_RANGE, 0x6fd0ff);
    near.position.set(MORTAR_POSITION.x, 0.07, MORTAR_POSITION.z);
    far.position.set(MORTAR_POSITION.x, 0.07, MORTAR_POSITION.z);
    this.aim.add(near, far);

    // Predicted path, dashed so it reads as a prediction and not a cable.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(MortarFx.ARC_POINTS * 3), 3),
    );
    this.arc = new THREE.Line(
      geo,
      new THREE.LineDashedMaterial({
        color: 0xfff2a8, dashSize: 1.8, gapSize: 1.2, transparent: true, opacity: 0.9,
      }),
    );
    this.arc.frustumCulled = false;
    this.aim.add(this.arc);

    // Impact marker: what the blast actually covers, plus a cross to aim with.
    this.marker = new THREE.Group();
    this.markerMat = new THREE.MeshBasicMaterial({
      color: 0x7cff9a, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });
    const kill = new THREE.Mesh(
      new THREE.RingGeometry(MORTAR_KILL_RADIUS - 0.4, MORTAR_KILL_RADIUS + 0.4, 56),
      this.markerMat,
    );
    kill.rotation.x = -Math.PI / 2;
    this.marker.add(kill);
    for (const ry of [0, Math.PI / 2]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 5), this.markerMat);
      bar.rotation.y = ry;
      this.marker.add(bar);
    }
    this.aim.add(this.marker);
  }

  /** Show the aiming aids only while the tube is the manned weapon. */
  setVisible(visible: boolean) {
    this.aim.visible = visible;
  }

  /**
   * Redraw the arc and the impact marker for a requested aim point. The point is
   * clamped exactly the way the server clamps it, so what the pilot sees is what
   * the crew actually gets - and the marker turns amber when the aim was pulled
   * back inside the ring instead of landing where it was clicked.
   */
  setPreview(requestX: number, requestZ: number): { x: number; z: number; range: number } {
    const clamped = clampMortarTarget(requestX, requestZ);
    const shot = mortarBallistics(
      MORTAR_POSITION.x, MORTAR_MUZZLE_HEIGHT, MORTAR_POSITION.z, clamped.x, clamped.z,
    );
    const attr = this.arc.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = MortarFx.ARC_POINTS;
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * shot.flight;
      attr.setXYZ(
        i,
        MORTAR_POSITION.x + shot.vx * t,
        mortarShellHeight(MORTAR_MUZZLE_HEIGHT, shot.vy, t),
        MORTAR_POSITION.z + shot.vz * t,
      );
    }
    attr.needsUpdate = true;
    this.arc.geometry.computeBoundingSphere();
    this.arc.computeLineDistances();

    this.marker.position.set(shot.impactX, 0.08, shot.impactZ);
    const pulled = Math.hypot(requestX - clamped.x, requestZ - clamped.z) > 0.5;
    this.markerMat.color.setHex(pulled ? 0xffb04a : 0x7cff9a);
    return clamped;
  }

  /** Put a shell that just left the tube (anybody's) into the world. */
  spawnShell(ev: MortarFireEvent) {
    const vel = new THREE.Vector3(ev.velocity.x, ev.velocity.y, ev.velocity.z);
    const dir = new THREE.Vector3(ev.velocity.x, 0, ev.velocity.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x30332e, roughness: 0.6, metalness: 0.4 }),
    );
    mesh.position.set(ev.origin.x, ev.origin.y, ev.origin.z);
    mesh.castShadow = true;
    this.aim.parent!.add(mesh);
    this.shells.push({
      mesh,
      origin: new THREE.Vector3(ev.origin.x, ev.origin.y, ev.origin.z),
      vel,
      impact: new THREE.Vector3(ev.impact.x, 0, ev.impact.z),
      side: new THREE.Vector3(dir.z, 0, -dir.x),
      flight: Math.max(0.1, ev.flight),
      t: 0,
      ownerId: ev.ownerId,
      puff: 0,
    });
    this.onShell?.(ev.shellId, Math.max(0.1, ev.flight));
  }

  /**
   * Advance every shell. The camera holds are started here, at the moment the
   * client's own shell comes down, so the pilot watches the detonation of their
   * own shot for a beat before the view goes back to the fort.
   */
  update(dt: number, localId: string) {
    this.clock += dt;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.t += dt;
      if (s.t >= s.flight) {
        if (s.ownerId === localId) {
          this.holdLook.copy(s.impact).setY(1.2);
          this.holdPos.copy(s.impact).addScaledVector(s.side, 17).setY(9);
          this.holdUntil = this.clock + MORTAR_CAM_HOLD;
        }
        s.mesh.parent?.remove(s.mesh);
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.shells.splice(i, 1);
        continue;
      }
      const x = s.origin.x + s.vel.x * s.t;
      const y = mortarShellHeight(s.origin.y, s.vel.y, s.t);
      const z = s.origin.z + s.vel.z * s.t;
      s.mesh.position.set(x, y, z);
      // Point the nose along the current velocity, not the launch vector.
      this.tmp.set(s.vel.x, s.vel.y - MORTAR_GRAVITY * s.t, s.vel.z).normalize();
      s.mesh.quaternion.setFromUnitVectors(UP, this.tmp);
      s.puff -= dt;
      if (s.puff <= 0) {
        s.puff = 0.06;
        this.puff(x, y, z, 0xb9bfc4);
      }
    }
  }

  /**
   * The camera for the local pilot's shot: a side-on tracking shot that walks with
   * the shell, then the hold on the crater. Null when there is nothing to watch.
   */
  cameraShot(localId: string): MortarCamShot | null {
    for (const s of this.shells) {
      if (s.ownerId !== localId) continue;
      const p = s.mesh.position;
      const back = 16 + p.y * 0.4;
      const pos = p.clone().addScaledVector(s.side, back);
      pos.y = Math.max(4, p.y * 0.8 + 3);
      pos.x = Math.max(-140, Math.min(140, pos.x));
      pos.z = Math.max(-140, Math.min(140, pos.z));
      return { pos, look: p.clone(), tracking: true };
    }
    if (this.clock < this.holdUntil) {
      return { pos: this.holdPos, look: this.holdLook, tracking: false };
    }
    return null;
  }

  /** True while the pilot is watching their own shell or its detonation. */
  isBusy(localId: string): boolean {
    return this.cameraShot(localId) !== null;
  }

  /** A flat ring lying on the ground, used for the range limits. */
  private groundRing(radius: number, color: number): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.45, radius + 0.45, 96),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  private readonly tmp = new THREE.Vector3();
}

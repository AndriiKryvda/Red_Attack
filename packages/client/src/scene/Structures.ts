import * as THREE from 'three';
import { STRUCTURE_SPECS, StructureKind, type StructureData } from '@red-attack/shared';
import { createStructureModel, createStructureRuin } from './VillageModels';

// ─────────────────────────────────────────────────────────────────────────────
// The client side of the village. Structures never move, so this renderer only has
// to react to three things: a structure appears (build the model that matches the
// server's collision box), it catches fire (char it and throw flame out of its
// vents), and it gets levelled (swap the model for a ruin).
//
// The fire follows the pattern of a burning wreck in Effects.ts: open flame for a
// while, then smoke only, then nothing but a blackened shell — a village that has
// been through a drone raid stays visibly burnt for the rest of the run.
// ─────────────────────────────────────────────────────────────────────────────

/** Seconds of open flame before a burning structure settles to smoke only. */
const FLAME_TIME = 26;
/** Seconds until the embers are out and only the charred model is left. */
const EMBER_TIME = 75;
/** Flame size: a house fire towers, a car fire does not. */
const BUILDING_FLAME_SCALE = 2.6;
const CAR_FLAME_SCALE = 1;

export type FlameEmit = (x: number, y: number, z: number, scale: number) => void;

interface StructureView {
  intact: THREE.Group;
  /** Built the first time the structure is destroyed, never before. */
  ruin: THREE.Group | null;
  /** The model's own materials, pushed hot while it burns. */
  hot: THREE.MeshStandardMaterial[];
  /** World-space hot spots the flames come out of. */
  vents: THREE.Vector3[];
  /** Cloth tagged to flutter around its pole (the tricolors). */
  waves: THREE.Object3D[];
  scale: number;
  /** Seconds since it first caught fire; -1 while it is still intact. */
  burn: number;
  nextEmit: number;
  /** Random offset so a row of burning houses does not flicker in lockstep. */
  phase: number;
  scorched: boolean;
}

export class StructureRenderer {
  private scene: THREE.Scene;
  private views = new Map<string, StructureView>();
  /** Wall clock in seconds, so a row of flags does not flutter in lockstep. */
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  sync(
    structures: StructureData[], onFlame: FlameEmit, onSmoke: FlameEmit, dt: number,
  ) {
    this.time += dt;
    const alive = new Set<string>();
    for (const data of structures) {
      alive.add(data.id);
      let view = this.views.get(data.id);
      if (!view) view = this.create(data);
      this.update(view, data, onFlame, onSmoke, dt);
    }
    // Anything the server dropped (a room reset) goes away with its geometry.
    for (const [id, view] of this.views) {
      if (alive.has(id)) continue;
      this.dispose(view.intact);
      if (view.ruin) this.dispose(view.ruin);
      this.views.delete(id);
    }
  }

  private create(data: StructureData): StructureView {
    const spec = STRUCTURE_SPECS[data.variant];
    const group = createStructureModel(data.variant, spec);
    group.position.set(data.x, 0, data.z);
    group.rotation.y = data.yaw;
    this.scene.add(group);
    group.updateMatrixWorld(true);

    const view: StructureView = {
      intact: group,
      ruin: null,
      hot: [],
      vents: [],
      waves: [],
      scale: spec.kind === StructureKind.CAR ? CAR_FLAME_SCALE : BUILDING_FLAME_SCALE,
      burn: -1,
      nextEmit: 0,
      phase: Math.random() * Math.PI * 2,
      scorched: false,
    };
    this.collect(group, view);
    this.views.set(data.id, view);
    return view;
  }

  /** Gathers the materials that can glow and the points that throw flame. */
  private collect(group: THREE.Object3D, view: StructureView) {
    view.hot = [];
    view.vents = [];
    view.waves = [];
    group.traverse((obj) => {
      // A flag flutters as a whole group hanging off its pole, so it is picked up
      // before the mesh test below skips everything that is not geometry.
      if (obj.userData.wave !== undefined) view.waves.push(obj);
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.scorch) return;
      const mat = mesh.material as THREE.Material;
      if (mat instanceof THREE.MeshStandardMaterial && view.hot.indexOf(mat) < 0) {
        view.hot.push(mat);
      }
      if (mesh.userData.vent && view.vents.length < 5) {
        const v = new THREE.Vector3();
        mesh.getWorldPosition(v);
        view.vents.push(v);
      }
    });
  }

  private update(
    view: StructureView, data: StructureData,
    onFlame: FlameEmit, onSmoke: FlameEmit, dt: number,
  ) {
    if (data.destroyed && !view.ruin) {
      const spec = STRUCTURE_SPECS[data.variant];
      const ruin = createStructureRuin(data.variant, spec);
      ruin.position.set(data.x, 0, data.z);
      ruin.rotation.y = data.yaw;
      this.scene.add(ruin);
      ruin.updateMatrixWorld(true);
      view.intact.visible = false;
      view.ruin = ruin;
      this.collect(ruin, view);
      view.scorched = true;
    }

    // The tricolor flutters for as long as this is the model on show. A ruin's
    // flag fell with the roof and is not tagged, so it stays where it landed.
    if (view.waves.length > 0) {
      const swing = Math.sin(this.time * 2.4 + view.phase);
      for (const cloth of view.waves) cloth.rotation.y = swing * (cloth.userData.wave as number);
    }

    if (!data.burning) return;
    if (view.burn < 0) {
      // Its first taste of fire: blacken whatever is left of the paintwork.
      view.burn = 0;
      if (!view.scorched) {
        view.scorched = true;
        for (const mat of view.hot) mat.color.multiplyScalar(0.45);
      }
    }
    view.burn += dt;
    if (view.burn > EMBER_TIME) return;

    const flaming = view.burn < FLAME_TIME;
    view.nextEmit -= dt;
    if (view.nextEmit <= 0 && view.vents.length > 0) {
      view.nextEmit = flaming ? 0.16 : 0.55;
      const v = view.vents[(Math.random() * view.vents.length) | 0];
      if (flaming) onFlame(v.x, v.y, v.z, view.scale);
      else onSmoke(v.x, v.y, v.z, view.scale);
    }

    // The glow dies back with the fire, exactly like a wreck cooling down.
    const cool = flaming
      ? 0.55 + 0.45 * Math.sin(view.burn * 9 + view.phase)
      : Math.max(0, 0.35 * (1 - (view.burn - FLAME_TIME) / (EMBER_TIME - FLAME_TIME)));
    for (const mat of view.hot) mat.emissive.setHex(0xff5a10).multiplyScalar(cool * 0.5);
  }

  private dispose(group: THREE.Group) {
    this.scene.remove(group);
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) for (const one of mat) one.dispose();
      else mat.dispose();
    });
  }
}

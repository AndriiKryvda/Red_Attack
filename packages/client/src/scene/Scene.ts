import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  GameState, EnemyType, PlayerState, ServerEvent, WeaponType,
  clampMortarTarget, MORTAR_POSITION, MORTAR_MUZZLE_HEIGHT,
  hmgGunOf, hmgSeat, hmgDirection,
} from '@red-attack/shared';
import { createTerrain } from './Terrain';
import { createOutpost } from './Outpost';
import { EnemyRenderer } from './Enemy';
import { DroneRenderer } from './Drone';
import { EffectsManager } from './Effects';
import { StructureRenderer } from './Structures';
import { MortarView } from './Mortar';
import { MortarFx } from './MortarFx';
import { HmgView } from './Hmg';
import { HmgFx } from './HmgFx';
import { audio } from '../audio/AudioManager';

export class GameScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private enemyRenderer: EnemyRenderer;
  private droneRenderer: DroneRenderer;
  private effects: EffectsManager;
  private structureRenderer: StructureRenderer;
  private mortar: MortarView;
  private mortarFx: MortarFx;
  private hmg: HmgView;
  private hmgFx: HmgFx;
  /** Where the local gunner is laying his gun, from his own mouse this frame. */
  private hmgAim = { yaw: 0, pitch: 0 };
  /** Scratch vector for the camera kick, so the frame loop does not allocate. */
  private readonly _shake = new THREE.Vector3();
  /** Field of view currently set, so it is only rebuilt when it actually changes. */
  private fov: number = 70;
  /** Where the tube is currently laid, already clamped inside the ring of fire. */
  private mortarAim = clampMortarTarget(0, 0);
  private clock: THREE.Clock;
  private localPlayerId: string = '';

  // Fort camera position (eye height on flat ground)
  private readonly FORT_POS = new THREE.Vector3(0, 6, 0);

  // Crash-cam + compass state
  private lastDronePos = new THREE.Vector3();
  private hadDrone = false;
  private deathCamUntil = 0;
  private deathCamPos = new THREE.Vector3();
  private heading = 0;
  private _fwd = new THREE.Vector3();

  /** Compass heading (radians, clockwise from north = -Z). */
  getHeading(): number { return this.heading; }

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Filmic tone mapping + sRGB output give PBR materials a realistic response.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 100, 250);

    // Image-based lighting so metals/rough surfaces reflect a neutral studio
    // environment (without this, metallic PBR surfaces render near-black).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.7;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
    this.camera.position.copy(this.FORT_POS);
    this.camera.lookAt(0, 10, -50);

    // Lighting (tuned for physically-based materials + IBL environment)
    const ambient = new THREE.AmbientLight(0xffffff, 0.15);
    this.scene.add(ambient);

    // Sky/ground fill light for natural outdoor ambience.
    const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6b5b3e, 0.45);
    hemi.position.set(0, 60, 0);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
    sun.position.set(50, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 200;
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    this.scene.add(sun);

    // Terrain + Outpost
    this.scene.add(createTerrain());
    this.scene.add(createOutpost());

    // Entity renderers
    this.enemyRenderer = new EnemyRenderer(this.scene);
    this.droneRenderer = new DroneRenderer(this.scene);
    this.effects = new EffectsManager(this.scene);
    this.structureRenderer = new StructureRenderer(this.scene);

    // The fort's mortar: a live model on its slab plus the aiming and flight layer.
    this.mortar = new MortarView(this.scene);
    this.mortarFx = new MortarFx(
      this.scene,
      (x, y, z, color) => this.effects.spawnTrailPuff(x, y, z, color),
      (shellId, flight) => audio.startWhistle(shellId, flight),
    );

    // The four machine guns: the guns themselves, and the burst layer that draws
    // every round the server says left a barrel.
    this.hmg = new HmgView(this.scene);
    this.hmgFx = new HmgFx(
      this.scene,
      (x, y, z, color) => this.effects.spawnTrailPuff(x, y, z, color),
    );

    this.clock = new THREE.Clock();

    // The fort is one of the player's two ears for the horde's battle cries;
    // the audio layer only needs to know where it stands, once.
    audio.setFortPos(this.FORT_POS);

    window.addEventListener('resize', () => this.onResize());
  }

  setLocalPlayerId(id: string) {
    this.localPlayerId = id;
  }

  update(state: GameState | null, events: ServerEvent[], _dt: number, playerYaw: number, playerPitch: number) {
    if (!state) return;

    // Update enemies
    // An armoured enemy that survived its first drone keeps burning: hand the
    // effects layer one flame puff per burning enemy per frame.
    this.enemyRenderer.sync(state.enemies, (x, y, z) => this.effects.spawnFirePuff(x, y, z));

    // The village on the north and east edges: static models that burn, collapse
    // and stay burnt for the rest of the run.
    this.structureRenderer.sync(
      state.structures ?? [],
      (x, y, z, scale) => this.effects.spawnFirePuff(x, y, z, scale),
      (x, y, z, scale) => this.effects.spawnSmokePuff(x, y, z, scale),
      _dt,
    );

    // Update drones. Remote drones get a per-pilot colour, a callsign tag and a
    // smoke trail so every pilot can see the others in the sky. The colour is
    // picked by the seat each pilot took in the room: the server builds the
    // player list in join order, so every client numbers the crew alike and a
    // full ten-man room never dresses two pilots in the same colour.
    const names: Record<string, string> = {};
    const seats: Record<string, number> = {};
    state.players.forEach((p, i) => {
      names[p.id] = p.name;
      seats[p.id] = i;
    });
    this.droneRenderer.sync(
      state.drones,
      this.localPlayerId,
      names,
      seats,
      this.camera.position,
      (x, y, z, color) => this.effects.spawnTrailPuff(x, y, z, color),
    );

    // Process events (explosions etc)
    for (const ev of events) {
      if (ev.type === 'explosion') {
        this.effects.spawnExplosion(ev.position.x, ev.position.y, ev.position.z, ev.scale ?? 1);
        audio.explosion(ev.position.x, ev.position.y, ev.position.z, ev.scale ?? 1);
      } else if (ev.type === 'mortar_fire') {
        // A shell left the tube: kick the model, throw a blast at the muzzle and
        // hand the shell to the flight layer, which also drives the camera.
        this.mortar.kick();
        this.effects.spawnExplosion(
          MORTAR_POSITION.x, MORTAR_MUZZLE_HEIGHT + 0.4, MORTAR_POSITION.z, 0.3,
        );
        audio.mortarLaunch(MORTAR_POSITION.x, MORTAR_MUZZLE_HEIGHT, MORTAR_POSITION.z);
        this.mortarFx.spawnShell(ev);
      } else if (ev.type === 'hmg_shot') {
        // A round left a barrel somewhere. Every client draws it; only the man at
        // that gun feels it, so the kick goes on the model and in the camera.
        this.hmgFx.spawnShot(ev);
        audio.hmgShot(ev.origin.x, ev.origin.y, ev.origin.z, ev.ownerId === this.localPlayerId);
        if (ev.ownerId === this.localPlayerId) {
          this.hmg.kick(ev.gun);
          this.hmgFx.addShake(0.05);
        }
      } else if (ev.type === 'enemy_killed') {
        // A destroyed vehicle leaves a burning wreck on the field. Foot troops
        // have no hull to burn, so the call simply ignores them.
        this.effects.spawnBurningWreck(ev.enemyType, ev.position.x, ev.position.z);
        audio.enemyKilled(ev.enemyType, ev.position.x, ev.position.y, ev.position.z);
      } else if (ev.type === 'enemy_breach') {
        // An enemy slipped through at the wall: mark it with a red puff so the
        // breach is visible without ending anything.
        this.effects.spawnTrailPuff(ev.position.x, ev.position.y + 0.8, ev.position.z, 0xff3b30);
        audio.breachAlarm();
      } else if (ev.type === 'structure_destroyed') {
        // A building coming down is a bigger affair than a drone hitting a tank:
        // a full fireball and a smoke column over the rubble.
        this.effects.spawnCrash(ev.position.x, 1.5, ev.position.z);
        audio.bigCrash(ev.position.x, 1.5, ev.position.z);
      } else if (ev.type === 'horde_start') {
        audio.hordeSiren();
      }
    }

    // Find local player
    const me = state.players.find(p => p.id === this.localPlayerId);
    const elapsed = this.clock.getElapsedTime();

    // Detect our drone being destroyed -> hold a 5s crash-cam on the explosion
    // before returning to the fort view.
    const piloting = !!(me && me.state === PlayerState.PILOTING && me.droneId);
    const myDrone = piloting ? state.drones.find(d => d.id === me!.droneId) : undefined;
    if (myDrone) {
      this.lastDronePos.set(myDrone.position.x, myDrone.position.y, myDrone.position.z);
      this.hadDrone = true;
    }
    if (this.hadDrone && !piloting) {
      this.deathCamPos.copy(this.lastDronePos);
      this.deathCamUntil = elapsed + 5;
      this.effects.spawnCrash(this.deathCamPos.x, this.deathCamPos.y, this.deathCamPos.z);
      this.hadDrone = false;
    }

    // ─── Mortar station ────────────────────────────────────
    // The tube is manned whenever the pilot has it selected and is standing in the
    // fort: while a quad is in the air the pilot is flying it, not laying the tube.
    const manningMortar = (me?.weapon ?? WeaponType.FPV) === WeaponType.MORTAR && !piloting;
    if (manningMortar) {
      const requested = this.groundAim(playerYaw, playerPitch);
      this.mortarAim = clampMortarTarget(requested.x, requested.z);
      this.mortar.aim(Math.atan2(
        this.mortarAim.x - MORTAR_POSITION.x,
        this.mortarAim.z - MORTAR_POSITION.z,
      ));
      this.mortarFx.setPreview(requested.x, requested.z);
    }
    this.mortarFx.setVisible(manningMortar);
    this.mortar.update(_dt);
    this.mortarFx.update(_dt, this.localPlayerId);

    // ─── Machine gun stations ──────────────────────────────
    // Every gun on the field follows the lay its own crew is holding. Ours comes
    // from our own mouse and not from the server's copy of it, so the barrel we aim
    // with is the one we moved this frame and not one tick behind it.
    const manningGun = (me && !piloting) ? hmgGunOf(me.weapon) : -1;
    for (const p of state.players) {
      if (p.manningGun < 0) continue;
      // A crew of ten has more pilots than nests, so two of them can stand at the
      // same gun with a belt each. My screen draws my own lay on the gun I hold:
      // a remote crew sharing it never gets to swing the barrel I am aiming with.
      if (p.manningGun === manningGun && p.id !== this.localPlayerId) continue;
      if (p.id === this.localPlayerId) this.hmg.aim(p.manningGun, this.hmgAim.yaw, this.hmgAim.pitch);
      else this.hmg.aim(p.manningGun, p.hmgYaw, p.hmgPitch);
    }
    this.hmg.update(_dt);
    this.hmgFx.update(_dt);

    // Camera logic. Watching our own shell come down outranks the crash-cam: it is
    // the thing the pilot just did and is the reason the view left the fort.
    const mortarCam = this.mortarFx.cameraShot(this.localPlayerId);
    this.setFov(manningGun >= 0 ? 55 : 70);
    if (piloting && myDrone) {
      // FPV drone camera
      this.camera.position.set(myDrone.position.x, myDrone.position.y, myDrone.position.z);
      const yaw = myDrone.yaw;
      const pitch = myDrone.pitch;
      const lookX = myDrone.position.x + Math.sin(yaw) * Math.cos(pitch) * 10;
      const lookY = myDrone.position.y + Math.sin(pitch) * 10;
      const lookZ = myDrone.position.z + Math.cos(yaw) * Math.cos(pitch) * 10;
      this.camera.lookAt(lookX, lookY, lookZ);
    } else if (manningGun >= 0) {
      // At the gun: stand behind the spade grips and look down the barrel, with the
      // kick of the belt shaking the view along with the gun.
      const seat = hmgSeat(manningGun, this.hmgAim.yaw);
      const d = hmgDirection(this.hmgAim.yaw, this.hmgAim.pitch);
      this.hmgFx.shakeOffset(this._shake);
      this.camera.position.set(
        seat.x + this._shake.x, seat.y + this._shake.y, seat.z + this._shake.z,
      );
      this.camera.lookAt(
        seat.x + d.x * 40 + this._shake.x,
        seat.y + d.y * 40 + this._shake.y,
        seat.z + d.z * 40 + this._shake.z,
      );
    } else if (mortarCam) {
      // Side-on tracking of the shell, then a beat held on the crater it makes.
      this.camera.position.copy(mortarCam.pos);
      this.camera.lookAt(mortarCam.look);
    } else if (elapsed < this.deathCamUntil) {
      // Crash-cam: linger on the explosion for a few seconds, then switch back.
      this.camera.position.set(
        this.deathCamPos.x,
        this.deathCamPos.y + 3,
        this.deathCamPos.z + 7,
      );
      this.camera.lookAt(this.deathCamPos);
    } else {
      // First-person fort view: stand in fort, look around with mouse
      this.camera.position.copy(this.FORT_POS);
      const lookX = this.FORT_POS.x + Math.sin(playerYaw) * Math.cos(playerPitch) * 50;
      const lookY = this.FORT_POS.y + Math.sin(playerPitch) * 50;
      const lookZ = this.FORT_POS.z + Math.cos(playerYaw) * Math.cos(playerPitch) * 50;
      this.camera.lookAt(lookX, lookY, lookZ);
    }

    // Compass heading: view direction measured clockwise from north (-Z).
    this.camera.getWorldDirection(this._fwd);
    this.heading = Math.atan2(this._fwd.x, -this._fwd.z);

    // Audio: the camera is this frame's ear for the battlefield's sounds, and
    // the looping layers (tank engines, the quad's own hum) follow it. The
    // horde's battle cries instead answer to where the player *is*: the fort,
    // and his drone while he flies it.
    audio.setListener(this.camera.position);
    audio.update(_dt, state.enemies, piloting && !!myDrone, myDrone?.position ?? null);

    // Update effects
    this.effects.update(_dt);
  }

  /**
   * Where the fort view is pointing, dropped onto the ground: the crosshair in the
   * middle of the screen as an aim point on the field. Looking at or above the
   * horizon gives no ground to hit, so the ray runs out to a long stand-in distance
   * and the clamp pulls it back onto the far edge of the ring of fire.
   */
  private groundAim(yaw: number, pitch: number): { x: number; z: number } {
    const horiz = Math.cos(pitch);
    const dy = Math.sin(pitch);
    const t = dy < -0.02 ? this.FORT_POS.y / -dy : 150;
    return {
      x: this.FORT_POS.x + Math.sin(yaw) * horiz * t,
      z: this.FORT_POS.z + Math.cos(yaw) * horiz * t,
    };
  }

  /** The spot the crew is laid on right now, already inside the ring of fire. */
  getMortarAim(): { x: number; z: number } {
    return { x: this.mortarAim.x, z: this.mortarAim.z };
  }

  /**
   * The lay the local gunner is holding this frame, handed over before the update so
   * the gun, the camera and the shot effects all agree on where the barrel points.
   */
  setHmgAim(yaw: number, pitch: number) {
    this.hmgAim.yaw = yaw;
    this.hmgAim.pitch = pitch;
  }

  /** Narrow the view down to the gun optic, widen it back out everywhere else. */
  private setFov(fov: number) {
    if (this.fov === fov) return;
    this.fov = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

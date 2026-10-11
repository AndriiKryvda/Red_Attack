import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GameState, EnemyType, PlayerState, ServerEvent } from '@red-attack/shared';
import { createTerrain } from './Terrain';
import { createOutpost } from './Outpost';
import { EnemyRenderer } from './Enemy';
import { DroneRenderer } from './Drone';
import { EffectsManager } from './Effects';

export class GameScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private enemyRenderer: EnemyRenderer;
  private droneRenderer: DroneRenderer;
  private effects: EffectsManager;
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

    this.clock = new THREE.Clock();

    window.addEventListener('resize', () => this.onResize());
  }

  setLocalPlayerId(id: string) {
    this.localPlayerId = id;
  }

  update(state: GameState | null, events: ServerEvent[], _dt: number, playerYaw: number, playerPitch: number) {
    if (!state) return;

    // Update enemies
    this.enemyRenderer.sync(state.enemies);

    // Update drones. Remote drones get a per-pilot colour, a callsign tag and a
    // smoke trail so every pilot can see the others in the sky.
    const names: Record<string, string> = {};
    for (const p of state.players) names[p.id] = p.name;
    this.droneRenderer.sync(
      state.drones,
      this.localPlayerId,
      names,
      this.camera.position,
      (x, y, z, color) => this.effects.spawnTrailPuff(x, y, z, color),
    );

    // Process events (explosions etc)
    for (const ev of events) {
      if (ev.type === 'explosion') {
        this.effects.spawnExplosion(ev.position.x, ev.position.y, ev.position.z);
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

    // Camera logic
    if (piloting && myDrone) {
      // FPV drone camera
      this.camera.position.set(myDrone.position.x, myDrone.position.y, myDrone.position.z);
      const yaw = myDrone.yaw;
      const pitch = myDrone.pitch;
      const lookX = myDrone.position.x + Math.sin(yaw) * Math.cos(pitch) * 10;
      const lookY = myDrone.position.y + Math.sin(pitch) * 10;
      const lookZ = myDrone.position.z + Math.cos(yaw) * Math.cos(pitch) * 10;
      this.camera.lookAt(lookX, lookY, lookZ);
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

    // Update effects
    this.effects.update(_dt);
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

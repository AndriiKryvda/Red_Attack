import * as THREE from 'three';
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

  // Fort camera position (top of hill + eye height)
  private readonly FORT_POS = new THREE.Vector3(0, 17, 0);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 100, 250);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
    this.camera.position.copy(this.FORT_POS);
    this.camera.lookAt(0, 10, -50);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
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

    // Update drones
    this.droneRenderer.sync(state.drones);

    // Process events (explosions etc)
    for (const ev of events) {
      if (ev.type === 'explosion') {
        this.effects.spawnExplosion(ev.position.x, ev.position.y, ev.position.z);
      }
    }

    // Find local player
    const me = state.players.find(p => p.id === this.localPlayerId);

    // Camera logic
    if (me && me.state === PlayerState.PILOTING && me.droneId) {
      // FPV drone camera
      const myDrone = state.drones.find(d => d.id === me.droneId);
      if (myDrone) {
        this.camera.position.set(myDrone.position.x, myDrone.position.y, myDrone.position.z);
        const yaw = myDrone.yaw;
        const pitch = myDrone.pitch;
        const lookX = myDrone.position.x + Math.sin(yaw) * Math.cos(pitch) * 10;
        const lookY = myDrone.position.y + Math.sin(pitch) * 10;
        const lookZ = myDrone.position.z + Math.cos(yaw) * Math.cos(pitch) * 10;
        this.camera.lookAt(lookX, lookY, lookZ);
      }
    } else {
      // First-person fort view: stand on hill, look around with mouse
      this.camera.position.copy(this.FORT_POS);
      const lookX = this.FORT_POS.x + Math.sin(playerYaw) * Math.cos(playerPitch) * 50;
      const lookY = this.FORT_POS.y + Math.sin(playerPitch) * 50;
      const lookZ = this.FORT_POS.z + Math.cos(playerYaw) * Math.cos(playerPitch) * 50;
      this.camera.lookAt(lookX, lookY, lookZ);
    }

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

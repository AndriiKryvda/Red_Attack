import { GameState, PlayerState, DroneData, PlayerData, WeaponType } from '@red-attack/shared';
import { DRONE_MAX_FLIGHT_TIME } from '@red-attack/shared';

export class HUD {
  private breachDisplay: HTMLElement;
  private breachFlash: HTMLElement | null;
  private lastLeaks = -1;
  private breachFlashTimeout: ReturnType<typeof setTimeout> | null = null;
  private waveInfo: HTMLElement;
  private droneStatus: HTMLElement;
  private scoreDisplay: HTMLElement;
  private announcement: HTMLElement;
  private crosshair: HTMLElement;
  private roomCodeDisplay: HTMLElement;
  private compassRose: HTMLElement;
  private flightPanel: HTMLElement;
  private flAlt: HTMLElement;
  private flSpd: HTMLElement;
  private flDist: HTMLElement;
  private flTime: HTMLElement;
  private weaponPanel: HTMLElement;
  private wpFpv: HTMLElement;
  private wpMortar: HTMLElement;
  private wpFpvState: HTMLElement;
  private wpMortarState: HTMLElement;
  private keysGuide: HTMLElement;
  private kgLaunch: HTMLElement;
  private keysGuideVisible: boolean;
  private announceTimeout: ReturnType<typeof setTimeout> | null = null;
  private static readonly KEYS_GUIDE_PREF = 'red-attack:keys-guide';

  constructor() {
    this.breachDisplay = document.getElementById('breach-display')!;
    this.breachFlash = document.getElementById('breach-flash');
    this.waveInfo = document.getElementById('wave-info')!;
    this.droneStatus = document.getElementById('drone-status')!;
    this.scoreDisplay = document.getElementById('score-display')!;
    this.announcement = document.getElementById('announcement')!;
    this.crosshair = document.getElementById('crosshair')!;
    this.roomCodeDisplay = document.getElementById('room-code-display')!;
    this.compassRose = document.getElementById('compass-rose')!;
    this.flightPanel = document.getElementById('flight-panel')!;
    this.flAlt = document.getElementById('fl-alt')!;
    this.flSpd = document.getElementById('fl-spd')!;
    this.flDist = document.getElementById('fl-dist')!;
    this.flTime = document.getElementById('fl-time')!;
    this.weaponPanel = document.getElementById('weapon-panel')!;
    this.wpFpv = document.getElementById('wp-fpv')!;
    this.wpMortar = document.getElementById('wp-mortar')!;
    this.wpFpvState = document.getElementById('wp-fpv-state')!;
    this.wpMortarState = document.getElementById('wp-mortar-state')!;
    this.keysGuide = document.getElementById('keys-guide')!;
    this.kgLaunch = document.getElementById('kg-launch')!;
    this.keysGuideVisible = HUD.readKeysGuidePref();
    this.applyKeysGuide();
  }

  update(state: GameState | null, localSessionId: string, heading = 0) {
    if (!state) return;

    // Compass: rotate the rose so the N marker points to world north (-Z).
    if (this.compassRose) {
      this.compassRose.style.transform = `rotate(${(-heading * 180) / Math.PI}deg)`;
    }

    // Room code
    if (state.roomCode) {
      this.roomCodeDisplay.textContent = `ROOM: ${state.roomCode}`;
    }

    // Breach counter — enemies that made it to the fort. It is purely a score:
    // breaching never ends the run, the horde just keeps coming.
    if (this.breachDisplay) {
      this.breachDisplay.innerHTML = `${state.leaks}<small>BREACHES</small>`;
      if (this.lastLeaks >= 0 && state.leaks > this.lastLeaks) this.flashBreach();
    }
    this.lastLeaks = state.leaks;

    // Horde status: how deep into the assault we are, and what is still alive.
    const mm = Math.floor(state.elapsed / 60);
    const ss = String(state.elapsed % 60).padStart(2, '0');
    this.waveInfo.textContent =
      `⚠ THREAT ${state.threatLevel} · ${mm}:${ss} · ${state.enemiesAlive} ALIVE · ${state.kills} KILLS · ${state.leaks} BREACHED`;

    // Drone status — find local player by sessionId
    const player = state.players.find(p => p.id === localSessionId);
    if (player) {
      // Two weapons, one fire button: what SPACE does, and what the status line
      // counts down, depends on which station the pilot is manning.
      const mortarMode = (player.weapon ?? WeaponType.FPV) === WeaponType.MORTAR;
      const mortarWait = Math.max(
        0, Math.ceil(((player.mortarReadyAt ?? 0) - state.serverTime) / 1000));
      const droneWait = player.state === PlayerState.COOLDOWN
        ? Math.max(0, Math.ceil((player.cooldownUntil - state.serverTime) / 1000))
        : 0;
      if (player.state === PlayerState.PILOTING) {
        this.droneStatus.textContent = '🛩️ In Flight';
        this.crosshair.classList.add('show');
      } else if (mortarMode) {
        // The tube is laid and loaded, and the crosshair doubles as its aim ray.
        this.droneStatus.textContent = mortarWait > 0
          ? `⏳ Mortar reload: ${mortarWait}s`
          : '💥 Press SPACE / LMB to fire';
        this.crosshair.classList.add('show');
      } else if (player.state === PlayerState.COOLDOWN) {
        this.droneStatus.textContent = `⏳ Reload: ${droneWait}s`;
        this.crosshair.classList.remove('show');
      } else {
        this.droneStatus.textContent = '✅ Press SPACE to launch';
        this.crosshair.classList.remove('show');
      }
      this.updateWeaponPanel(player, mortarWait, droneWait);
      this.scoreDisplay.textContent = `Score: ${player.score}`;

      // Key guide: pulse the Space row while a launch is available.
      this.kgLaunch.classList.toggle('on', player.state !== PlayerState.PILOTING);

      // Flight instruments (only while actively piloting a live drone)
      let drone: DroneData | undefined;
      if (player.state === PlayerState.PILOTING && player.droneId) {
        drone = state.drones.find(d => d.id === player.droneId);
      }
      if (drone) {
        this.flightPanel.style.display = 'block';
        const spd = Math.hypot(drone.velocity.x, drone.velocity.y, drone.velocity.z);
        const dist = Math.hypot(drone.position.x, drone.position.z);
        const timeLeft = Math.max(0, DRONE_MAX_FLIGHT_TIME - (state.serverTime - drone.launchedAt) / 1000);
        this.flAlt.textContent = drone.position.y.toFixed(1);
        this.flSpd.textContent = spd.toFixed(1);
        this.flDist.textContent = dist.toFixed(0);
        this.flTime.textContent = timeLeft.toFixed(1);
      } else {
        this.flightPanel.style.display = 'none';
      }
    }
  }

  /** The weapon rack: which station is manned, and what each one is doing. */
  private updateWeaponPanel(player: PlayerData, mortarWait: number, droneWait: number) {
    if (!this.weaponPanel) return;
    const fpvOn = (player.weapon ?? WeaponType.FPV) === WeaponType.FPV;
    this.wpFpv.classList.toggle('on', fpvOn);
    this.wpMortar.classList.toggle('on', !fpvOn);
    this.wpFpvState.textContent = player.state === PlayerState.PILOTING
      ? 'IN FLIGHT'
      : (droneWait > 0 ? `RELOAD ${droneWait}s` : 'READY');
    this.wpMortarState.textContent = mortarWait > 0 ? `RELOAD ${mortarWait}s` : 'READY';
    this.wpFpv.classList.toggle('cool', droneWait > 0);
    this.wpMortar.classList.toggle('cool', mortarWait > 0);
  }

  /** Show/hide the on-screen FPV key guide (bound to the H key). */
  toggleKeysGuide() {
    this.keysGuideVisible = !this.keysGuideVisible;
    this.applyKeysGuide();
  }

  private applyKeysGuide() {
    this.keysGuide.classList.toggle('hidden', !this.keysGuideVisible);
    try {
      localStorage.setItem(HUD.KEYS_GUIDE_PREF, this.keysGuideVisible ? '1' : '0');
    } catch {
      // Storage can be unavailable (private mode / file://) — the toggle still works this session.
    }
  }

  private static readKeysGuidePref(): boolean {
    try {
      return localStorage.getItem(HUD.KEYS_GUIDE_PREF) !== '0';
    } catch {
      return true;
    }
  }

  /** Red screen-edge pulse each time the breach counter ticks up. */
  private flashBreach() {
    this.breachDisplay?.classList.add('flash');
    this.breachFlash?.classList.add('show');
    if (this.breachFlashTimeout) clearTimeout(this.breachFlashTimeout);
    this.breachFlashTimeout = setTimeout(() => {
      this.breachDisplay?.classList.remove('flash');
      this.breachFlash?.classList.remove('show');
    }, 150);
  }

  showAnnouncement(text: string) {
    this.announcement.textContent = text;
    this.announcement.classList.add('show');
    if (this.announceTimeout) clearTimeout(this.announceTimeout);
    this.announceTimeout = setTimeout(() => {
      this.announcement.classList.remove('show');
    }, 3000);
  }
}

import { GameState, PlayerState, DroneData } from '@red-attack/shared';
import { DRONE_MAX_FLIGHT_TIME } from '@red-attack/shared';

export class HUD {
  private hpFill: HTMLElement;
  private hpLabel: HTMLElement;
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
  private announceTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.hpFill = document.getElementById('hp-fill')!;
    this.hpLabel = document.getElementById('hp-label')!;
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

    // HP bar
    const hpPct = Math.max(0, (state.outpostHp / state.outpostMaxHp) * 100);
    this.hpFill.style.width = `${hpPct}%`;
    this.hpFill.style.background = hpPct > 50 ? '#4caf50' : hpPct > 25 ? '#ff9800' : '#f44336';
    this.hpLabel.textContent = `Outpost: ${state.outpostHp}/${state.outpostMaxHp}`;

    // Horde status: how deep into the assault we are, and what is still alive.
    const mm = Math.floor(state.elapsed / 60);
    const ss = String(state.elapsed % 60).padStart(2, '0');
    this.waveInfo.textContent =
      `⚠ THREAT ${state.threatLevel} · ${mm}:${ss} · ${state.enemiesAlive} ALIVE · ${state.kills} KILLS`;

    // Drone status — find local player by sessionId
    const player = state.players.find(p => p.id === localSessionId);
    if (player) {
      if (player.state === PlayerState.PILOTING) {
        this.droneStatus.textContent = '🛩️ In Flight';
        this.crosshair.classList.add('show');
      } else if (player.state === PlayerState.COOLDOWN) {
        const remaining = Math.max(0, Math.ceil((player.cooldownUntil - state.serverTime) / 1000));
        this.droneStatus.textContent = `⏳ Reload: ${remaining}s`;
        this.crosshair.classList.remove('show');
      } else {
        this.droneStatus.textContent = '✅ Press SPACE to launch';
        this.crosshair.classList.remove('show');
      }
      this.scoreDisplay.textContent = `Score: ${player.score}`;

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

  showAnnouncement(text: string) {
    this.announcement.textContent = text;
    this.announcement.classList.add('show');
    if (this.announceTimeout) clearTimeout(this.announceTimeout);
    this.announceTimeout = setTimeout(() => {
      this.announcement.classList.remove('show');
    }, 3000);
  }
}

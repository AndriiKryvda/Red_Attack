import { GameState, PlayerState } from '@red-attack/shared';

export class HUD {
  private hpFill: HTMLElement;
  private hpLabel: HTMLElement;
  private waveInfo: HTMLElement;
  private droneStatus: HTMLElement;
  private scoreDisplay: HTMLElement;
  private announcement: HTMLElement;
  private crosshair: HTMLElement;
  private roomCodeDisplay: HTMLElement;
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
  }

  update(state: GameState | null, localSessionId: string) {
    if (!state) return;

    // Room code
    if (state.roomCode) {
      this.roomCodeDisplay.textContent = `ROOM: ${state.roomCode}`;
    }

    // HP bar
    const hpPct = Math.max(0, (state.outpostHp / state.outpostMaxHp) * 100);
    this.hpFill.style.width = `${hpPct}%`;
    this.hpFill.style.background = hpPct > 50 ? '#4caf50' : hpPct > 25 ? '#ff9800' : '#f44336';
    this.hpLabel.textContent = `Outpost: ${state.outpostHp}/${state.outpostMaxHp}`;

    // Wave info
    if (state.phase === 'wave_intermission') {
      this.waveInfo.textContent = `Next wave in ${state.waveCountdown}s`;
    } else {
      this.waveInfo.textContent = `Wave ${state.wave} / ${state.totalWaves}`;
    }

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

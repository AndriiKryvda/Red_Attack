import { GameScene } from './scene/Scene';
import { NetworkClient } from './network/Client';
import { InputManager } from './input/InputManager';
import { HUD } from './ui/HUD';
import { ENEMY_DISPLAY_NAMES } from '@red-attack/shared';

// ─── Bootstrap ─────────────────────────────────────────────
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;
const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnJoin = document.getElementById('btn-join') as HTMLButtonElement;
const nameInput = document.getElementById('player-name') as HTMLInputElement;
const roomCodeInput = document.getElementById('room-code') as HTMLInputElement;
const errorMsg = document.getElementById('error-msg') as HTMLElement;
const roomToast = document.getElementById('room-toast') as HTMLElement;
const roomToastCode = document.getElementById('room-toast-code') as HTMLElement;
const btnCopyCode = document.getElementById('btn-copy-code') as HTMLButtonElement;
const lockHint = document.getElementById('lock-hint') as HTMLElement | null;

const hud = new HUD();
const input = new InputManager(canvas);
const scene = new GameScene(canvas);
const network = new NetworkClient();

let gameStarted = false;

// Wire immediate-action callbacks (bypass rate limiter)
input.onLaunch = () => { network.sendLaunch(); };
input.onSelfDestruct = () => { network.sendSelfDestruct(); };
input.onToggleKeysGuide = () => { hud.toggleKeysGuide(); };

// The browser drops the mouse capture whenever the window loses focus; the
// InputManager wins it back on return, and asks for this hint when it needs a
// click to finish the job (e.g. after the player pressed Esc).
input.onLockHintChange = (show) => {
  lockHint?.classList.toggle('hidden', !show);
};

// "Create Game" button
btnStart.addEventListener('click', async () => {
  if (gameStarted) return;
  gameStarted = true;
  const name = nameInput.value.trim() || 'Pilot';
  overlay.classList.add('hidden');
  try {
    await network.connect(name);
    scene.setLocalPlayerId(network.sessionId);
    input.lockPointer();
    // Show room code toast once state arrives
    waitForRoomCode();
  } catch (e: any) {
    gameStarted = false;
    overlay.classList.remove('hidden');
    if (errorMsg) errorMsg.textContent = e?.message || 'Failed to create game';
  }
});

// Show room code toast when first state arrives
function waitForRoomCode() {
  const check = setInterval(() => {
    const state = network.getState();
    if (state?.roomCode) {
      clearInterval(check);
      showRoomToast(state.roomCode);
    }
  }, 100);
  // Stop checking after 5s
  setTimeout(() => clearInterval(check), 5000);
}

function showRoomToast(code: string) {
  roomToastCode.textContent = code;
  roomToast.classList.remove('hidden');
  // Auto-hide after 8 seconds
  setTimeout(() => roomToast.classList.add('hidden'), 8000);
}

// Copy room code to clipboard
btnCopyCode.addEventListener('click', () => {
  const code = roomToastCode.textContent;
  if (code) {
    navigator.clipboard.writeText(code).then(() => {
      btnCopyCode.textContent = '✓';
      setTimeout(() => { btnCopyCode.textContent = '📋'; }, 1500);
    });
  }
});

// "Join Game" button
btnJoin.addEventListener('click', async () => {
  if (gameStarted) return;
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) { if (errorMsg) errorMsg.textContent = 'Enter a room code'; return; }
  gameStarted = true;
  const name = nameInput.value.trim() || 'Pilot';
  overlay.classList.add('hidden');
  try {
    await network.connect(name, code);
    scene.setLocalPlayerId(network.sessionId);
    input.lockPointer();
  } catch (e: any) {
    gameStarted = false;
    overlay.classList.remove('hidden');
    if (errorMsg) errorMsg.textContent = e?.message || 'Failed to join game';
  }
});

// ─── Game Loop ─────────────────────────────────────────────
let lastTime = performance.now();

function gameLoop(time: number) {
  // requestAnimationFrame is paused while the tab is hidden, so the first frame
  // after alt-tabbing back reports a huge elapsed time — clamp it.
  const dt = Math.min(0.1, (time - lastTime) / 1000);
  lastTime = time;

  if (gameStarted) {
    // Send continuous input to server (rate-limited internally)
    network.sendInput(input.getState());
  }

  // Update scene from network state
  scene.update(network.getState(), network.getEvents(), dt, input.getYaw(), input.getPitch());
  scene.render();
  hud.update(network.getState(), network.sessionId, scene.getHeading());

  // Clear events after processing
  network.clearEvents();

  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

// ─── Events from server ────────────────────────────────────
network.onEvent((event) => {
  if (event.type === 'horde_start') {
    hud.showAnnouncement('HORDE INCOMING');
  } else if (event.type === 'threat_level') {
    hud.showAnnouncement(`⚠ THREAT LEVEL ${event.level}`);
  } else if (event.type === 'new_enemy') {
    hud.showAnnouncement(`⚠ NEW ENEMY INCOMING: ${ENEMY_DISPLAY_NAMES[event.enemyType]}`);
  } else if (event.type === 'enemy_hit') {
    hud.showAnnouncement('🔥 TARGET IGNITED - ONE MORE DRONE');
  } else if (event.type === 'enemy_breach') {
    // Enemies reaching the fort are only counted — the fight never stops.
    // Announce milestones so a late-game burst of leaks doesn't spam the screen.
    if (event.leaks % 10 === 0) hud.showAnnouncement(`☠ ${event.leaks} BREACHES`);
  } else if (event.type === 'game_over') {
    hud.showAnnouncement(event.victory ? '🎉 VICTORY!' : '💀 DEFEAT');
  }
});

console.log('[Client] Initialized');

import { GameScene } from './scene/Scene';
import { NetworkClient } from './network/Client';
import { InputManager } from './input/InputManager';
import { HUD } from './ui/HUD';

// ─── Bootstrap ─────────────────────────────────────────────
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;
const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnJoin = document.getElementById('btn-join') as HTMLButtonElement;
const nameInput = document.getElementById('player-name') as HTMLInputElement;
const roomCodeInput = document.getElementById('room-code') as HTMLInputElement;

const hud = new HUD();
const input = new InputManager(canvas);
const scene = new GameScene(canvas);
const network = new NetworkClient();

let gameStarted = false;

// Wire immediate-action callbacks (bypass rate limiter)
input.onLaunch = () => { network.sendLaunch(); };
input.onSelfDestruct = () => { network.sendSelfDestruct(); };

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
  } catch (e) {
    gameStarted = false;
    overlay.classList.remove('hidden');
  }
});

// "Join Game" button
btnJoin.addEventListener('click', async () => {
  if (gameStarted) return;
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) { alert('Enter a room code'); return; }
  gameStarted = true;
  const name = nameInput.value.trim() || 'Pilot';
  overlay.classList.add('hidden');
  try {
    await network.connect(name, code);
    scene.setLocalPlayerId(network.sessionId);
    input.lockPointer();
  } catch (e) {
    gameStarted = false;
    overlay.classList.remove('hidden');
  }
});

// ─── Game Loop ─────────────────────────────────────────────
let lastTime = performance.now();

function gameLoop(time: number) {
  const dt = (time - lastTime) / 1000;
  lastTime = time;

  if (gameStarted) {
    // Send continuous input to server (rate-limited internally)
    network.sendInput(input.getState());
  }

  // Update scene from network state
  scene.update(network.getState(), network.getEvents(), dt, input.getYaw(), input.getPitch());
  scene.render();
  hud.update(network.getState(), network.sessionId);

  // Clear events after processing
  network.clearEvents();

  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

// ─── Events from server ────────────────────────────────────
network.onEvent((event) => {
  if (event.type === 'wave_start') {
    hud.showAnnouncement(`WAVE ${event.wave}`);
  } else if (event.type === 'wave_complete') {
    hud.showAnnouncement(`WAVE ${event.wave} CLEARED!`);
  } else if (event.type === 'game_over') {
    hud.showAnnouncement(event.victory ? '🎉 VICTORY!' : '💀 DEFEAT');
  }
});

console.log('[Client] Initialized');

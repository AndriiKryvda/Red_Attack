import { GameScene } from './scene/Scene';
import { NetworkClient } from './network/Client';
import { InputManager } from './input/InputManager';
import { HUD } from './ui/HUD';
import { audio } from './audio/AudioManager';
import {
  ENEMY_DISPLAY_NAMES, STRUCTURE_SPECS, WeaponType, PlayerState,
  HMG_NESTS, HMG_WEAPONS, hmgGunOf, Difficulty,
} from '@red-attack/shared';

// ─── Bootstrap ─────────────────────────────────────────────
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;
const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
const btnJoin = document.getElementById('btn-join') as HTMLButtonElement;
const nameInput = document.getElementById('player-name') as HTMLInputElement;
const roomCodeInput = document.getElementById('room-code') as HTMLInputElement;
const difficultySelect = document.getElementById('difficulty') as HTMLSelectElement;
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

// The pilot's own row of the latest state, if it has arrived yet.
function localPlayer() {
  const state = network.getState();
  return state?.players.find(p => p.id === network.sessionId);
}

/**
 * The stations Tab walks through, in the order the HUD lists them: the quad, the
 * tube, then the four machine guns along the berm.
 */
const WEAPON_CYCLE: WeaponType[] = [
  WeaponType.FPV, WeaponType.MORTAR, ...HMG_WEAPONS,
];

/**
 * Take a station: tell the server, and hand the controls over to that station. On a
 * gun the mouse lays the barrel instead of looking around the fort, so the input
 * layer has to know the pilot is no longer just standing about.
 */
function selectWeapon(weapon: WeaponType): void {
  network.sendSelectWeapon(weapon);
  const gun = hmgGunOf(weapon);
  input.setHmgMode(gun >= 0);
  // Taking a crew starts from the lay that crew was left holding, which is exactly
  // what the server resets its own copy of the gun to.
  if (gun >= 0) input.resetHmgAim(HMG_NESTS[gun].yaw);
}

/**
 * Which gun the local pilot is standing at, or -1 for none of them. A pilot with a
 * quad in the air is flying it, not serving a crew-served weapon.
 */
function manningGun(): number {
  const me = localPlayer();
  if (!me || me.state === PlayerState.PILOTING) return -1;
  return hmgGunOf(me.weapon);
}

/**
 * While a hand is on a gun, its lay and its trigger go to the server every frame the
 * way drone input does. The server owns the belt, the rate and the hits; this is only
 * the gunner's hands, and it stops the moment he walks off the gun.
 */
function sendHmgInput(): void {
  const gun = manningGun();
  if (gun < 0) {
    input.setHmgMode(false);
    return;
  }
  input.setHmgMode(true);
  const aim = input.getHmgAim();
  scene.setHmgAim(aim.yaw, aim.pitch);
  network.sendHmgInput(gun, aim.yaw, aim.pitch, aim.firing);
}

// Wire immediate-action callbacks (bypass rate limiter)
// Space is the fire button for whichever weapon the pilot is manning: it launches
// the quad, or it sends a shell from the mortar at wherever the fort view is
// pointing. The server clamps the shot into the ring of fire either way.
function fireWeapon() {
  // On a machine gun the trigger is held and the server runs the belt, so the fire
  // button has nothing to do here at all.
  if (hmgGunOf(localPlayer()?.weapon) >= 0) return;
  if (localPlayer()?.weapon === WeaponType.MORTAR) {
    const aim = scene.getMortarAim();
    network.sendMortarFire(aim.x, aim.z);
  } else {
    network.sendLaunch();
  }
}
input.onLaunch = () => { fireWeapon(); };
// The left mouse button is the tube's trigger too. With the quad manned the click
// stays what it always was — boost — so the mouse never launches a drone behind
// the pilot's back.
input.onFireMouse = () => {
  if (localPlayer()?.weapon === WeaponType.MORTAR) fireWeapon();
};
input.onSelfDestruct = () => { network.sendSelfDestruct(); };
input.onToggleKeysGuide = () => { hud.toggleKeysGuide(); };
input.onSelectWeapon = (weapon) => { selectWeapon(weapon); };
input.onCycleWeapon = () => {
  const at = WEAPON_CYCLE.indexOf(localPlayer()?.weapon ?? WeaponType.FPV);
  const next = WEAPON_CYCLE[(at + 1) % WEAPON_CYCLE.length];
  selectWeapon(next);
};

// The browser drops the mouse capture whenever the window loses focus; the
// InputManager wins it back on return, and asks for this hint when it needs a
// click to finish the job (e.g. after the player pressed Esc).
input.onLockHintChange = (show) => {
  lockHint?.classList.toggle('hidden', !show);
};

// M mutes the whole game — gunfire, engines and the horde's battle cries alike.
document.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyM' || e.repeat) return;
  const muted = audio.toggleMute();
  hud.showAnnouncement(muted ? '🔇 SOUND OFF' : '🔊 SOUND ON');
});

// "Create Game" button
btnStart.addEventListener('click', async () => {
  if (gameStarted) return;
  gameStarted = true;
  // The browser only lets a page make noise after its pilot clicks something,
  // and this click is that something: the audio world is built right here.
  audio.init();
  const name = nameInput.value.trim() || 'Pilot';
  const difficulty = (difficultySelect?.value as Difficulty) || Difficulty.EASY;
  overlay.classList.add('hidden');
  try {
    await network.connect(name, undefined, difficulty);
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
  audio.init(); // same gesture rule as the Create Game button
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
    sendHmgInput();
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
  if (event.type === 'hmg_shot') {
    // Our own round kicks the lay: the muzzle climbs and wanders a touch, so a burst
    // has to be walked onto a running target instead of painted on it.
    if (event.ownerId === network.sessionId) input.addHmgRecoil();
    return;
  }
  if (event.type === 'horde_start') {
    hud.showAnnouncement('HORDE INCOMING');
  } else if (event.type === 'threat_level') {
    hud.showAnnouncement(`⚠ THREAT LEVEL ${event.level}`);
  } else if (event.type === 'new_enemy') {
    hud.showAnnouncement(`⚠ NEW ENEMY INCOMING: ${ENEMY_DISPLAY_NAMES[event.enemyType]}`);
  } else if (event.type === 'enemy_hit') {
    hud.showAnnouncement('🔥 TARGET IGNITED - ONE MORE DRONE');
  } else if (event.type === 'structure_hit') {
    // The building is still standing, but it is burning and worth another pass.
    hud.showAnnouncement(`🔥 ${STRUCTURE_SPECS[event.variant].label} ON FIRE`);
  } else if (event.type === 'structure_destroyed') {
    hud.showAnnouncement(`💥 ${STRUCTURE_SPECS[event.variant].label} DESTROYED +${event.score}`);
  } else if (event.type === 'enemy_breach') {
    // Enemies reaching the fort are only counted — the fight never stops.
    // Announce milestones so a late-game burst of leaks doesn't spam the screen.
    if (event.leaks % 10 === 0) hud.showAnnouncement(`☠ ${event.leaks} BREACHES`);
  } else if (event.type === 'game_over') {
    hud.showAnnouncement(event.victory ? '🎉 VICTORY!' : '💀 DEFEAT');
  }
});

console.log('[Client] Initialized');

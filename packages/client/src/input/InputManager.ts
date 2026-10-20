import { WeaponType, clampHmgPitch, shopItemByHotkey } from '@red-attack/shared';

export interface InputState {
  forward: number;
  yawDelta: number;   // incremental yaw from mouse + A/D keys
  pitch: number;      // absolute pitch from mouse Y
  up: number;
  boost: boolean;
  /** Held while the Vampire's bomb release (F) is down; the server paces the drops. */
  bombDrop: boolean;
}

/**
 * The lay of a manned machine gun and whether the trigger is held, sent to the
 * server every frame the way drone input is. The server owns the belt, the rate of
 * fire and the hits; this only says where the gun is pointed and that a hand is on
 * the grips.
 */
export interface HmgAim {
  yaw: number;
  pitch: number;
  firing: boolean;
}

/** Keys that man one of the four machine guns, in the order the HUD numbers them. */
const HMG_KEYS: Record<string, WeaponType> = {
  Digit3: WeaponType.HMG_1, Numpad3: WeaponType.HMG_1,
  Digit4: WeaponType.HMG_2, Numpad4: WeaponType.HMG_2,
  Digit5: WeaponType.HMG_3, Numpad5: WeaponType.HMG_3,
  Digit6: WeaponType.HMG_4, Numpad6: WeaponType.HMG_4,
};

export class InputManager {
  private keys: Set<string> = new Set();
  private pitch: number = 0;
  private canvas: HTMLCanvasElement;
  private pointerLocked: boolean = false;
  private mouseDown: boolean = false;
  /** True while the Vampire's bomb-release key (F) is held. */
  private bombDropHeld: boolean = false;
  /**
   * True while the armory panel is up. Reading it is a deliberate pause: nothing in
   * the fort responds until it is shut again, so a pilot cannot fly and shop at the
   * same time — and the number keys buy instead of changing stations.
   */
  private shopMode: boolean = false;

  // Pointer-lock bookkeeping. A browser drops the pointer lock the moment the
  // window or tab loses focus, so the game has to win it back when the player
  // alt-tabs back — otherwise the mouse stops steering the drone for good.
  private wantLock: boolean = false;   // the game wants the mouse captured
  private autoRelock: boolean = false; // automatic (gesture-free) re-capture allowed
  private relockTimer: ReturnType<typeof setTimeout> | null = null;
  private decisionTimer: ReturnType<typeof setTimeout> | null = null;
  private relockAttempts: number = 0;

  // Accumulated yaw delta since last getState() call (mouse + keyboard)
  private pendingYawDelta: number = 0;

  // Callbacks fired immediately on keydown (bypass rate limiter)
  onLaunch: (() => void) | null = null;
  /**
   * Fired on a left mouse press, and only while the mouse is already captured —
   * the click that wins the capture back must never double as a shot.
   */
  onFireMouse: (() => void) | null = null;
  /**
   * Fired on a left mouse press while manning the Vampire: one click releases one
   * mini-bomb. Like onFireMouse it only counts once the mouse is already captured.
   */
  onDropBomb: (() => void) | null = null;
  onSelfDestruct: (() => void) | null = null;
  onToggleKeysGuide: (() => void) | null = null;
  /** Pick a weapon outright (1 = quad, 2 = mortar). */
  onSelectWeapon: ((weapon: WeaponType) => void) | null = null;
  /** Flip to the other weapon without naming it (Tab). */
  onCycleWeapon: (() => void) | null = null;
  /** Open or shut the armory (B). */
  onToggleShop: (() => void) | null = null;
  /**
   * Buy the catalogue row whose hotkey was pressed while the armory was open. The
   * hotkey belongs to the row, not to the input layer, so a new item can be sold
   * without touching these bindings.
   */
  onShopBuy: ((hotkey: string) => void) | null = null;
  /** Tells the UI to show/hide the "click to resume mouse look" hint. */
  onLockHintChange: ((show: boolean) => void) | null = null;

  // Fort view yaw (absolute, for camera when not piloting)
  private fortYaw: number = 0;

  // ─── Machine gun station ───────────────────────────────────
  // On a gun the mouse stops looking around the fort and starts laying the weapon:
  // the lay belongs to the gun, it is clamped to what the pintle allows, and the
  // trigger is held down for as long as the belt is meant to run.
  private hmgMode: boolean = false;
  /** True while the pilot is flying a Vampire: LMB drops a bomb instead of boosting. */
  private vampireMode: boolean = false;
  private hmgYaw: number = 0;
  private hmgPitch: number = 0;
  /** Space or the left button, for as long as it is held. */
  private trigger: boolean = false;

  private readonly KEYBOARD_YAW_RATE = 2.5; // radians/sec for A/D turning
  private readonly KEYBOARD_PITCH_RATE = 1.5; // radians/sec for Arrow / Q-E tilting
  private readonly MAX_PITCH = Math.PI / 2.2; // nose up/down limit (~82°)

  // Pointer-lock recovery timing.
  private readonly RELOCK_DECIDE_MS = 300;  // wait to learn why the lock was lost
  private readonly RELOCK_DELAY_MS = 150;   // let the browser mark the document focused
  private readonly RELOCK_RETRY_MS = 600;   // Chrome refuses a re-lock briefly after Esc
  private readonly RELOCK_MAX_ATTEMPTS = 5;

  // Real time of the previous getState() call, so held-key rates are frame-rate independent
  private lastStateTime: number = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.setupListeners();
  }

  private setupListeners() {
    document.addEventListener('keydown', (e) => {
      // Ignore keystrokes aimed at a text field (the lobby callsign and room-code inputs):
      // the game weapon keys must not swallow what a pilot is typing, so digits 1-6 (station
      // hotkeys) and Space/Tab/arrows reach the field instead of being swallowed here.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (e.repeat) return;

      // The armory is a deliberate pause. While it is up the fort hears nothing at
      // all: gameplay keys are not even recorded, so a held W cannot keep flying a
      // drone while the pilot reads prices. B shuts the panel again, and the number
      // keys buy the row they are printed on instead of changing stations.
      if (e.code === 'KeyB') { this.onToggleShop?.(); return; }
      if (this.shopMode) {
        const spec = shopItemByHotkey(InputManager.digitOf(e.code));
        if (spec) this.onShopBuy?.(spec.hotkey);
        return;
      }

      this.keys.add(e.code);
      if (e.code === 'Space') {
        e.preventDefault();
        // On a machine gun the trigger is held rather than pressed: the belt and the
        // cyclic rate are the server's business, so a keydown must not fire once per
        // auto-repeat.
        this.trigger = true;
        if (!this.hmgMode && this.onLaunch) this.onLaunch();
      }
      if (e.code === 'KeyR') {
        if (this.onSelfDestruct) this.onSelfDestruct();
      }
      if (e.code === 'KeyF') {
        // Vampire bomb release. Held, not tapped: the server paces the stack at its
        // own drop interval, so holding F walks the bombs off one at a time.
        e.preventDefault();
        this.bombDropHeld = true;
      }
      if (e.code === 'KeyH') {
        if (this.onToggleKeysGuide) this.onToggleKeysGuide();
      }
      if (e.code === 'Digit1' || e.code === 'Numpad1') {
        e.preventDefault();
        if (this.onSelectWeapon) this.onSelectWeapon(WeaponType.FPV);
      }
      if (e.code === 'Digit2' || e.code === 'Numpad2') {
        e.preventDefault();
        if (this.onSelectWeapon) this.onSelectWeapon(WeaponType.MORTAR);
      }
      if (e.code === 'Digit7' || e.code === 'Numpad7') {
        // The Vampire bomber: a flown quad like the FPV, but it drops bombs instead
        // of flying into the target. 7 mans it; V is kept below as an alias.
        e.preventDefault();
        if (this.onSelectWeapon) this.onSelectWeapon(WeaponType.VAMPIRE);
      }
      if (e.code === 'KeyV') {
        // Alias for the Vampire bomber (7 is the primary key).
        e.preventDefault();
        if (this.onSelectWeapon) this.onSelectWeapon(WeaponType.VAMPIRE);
      }
      // 3 to 6 man one of the four machine guns.
      const hmg = HMG_KEYS[e.code];
      if (hmg !== undefined) {
        e.preventDefault();
        if (this.onSelectWeapon) this.onSelectWeapon(hmg);
      }
      if (e.code === 'Tab') {
        e.preventDefault(); // otherwise Tab walks the keyboard focus off the canvas
        if (this.onCycleWeapon) this.onCycleWeapon();
      }
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault(); // arrows tilt the drone instead of scrolling the page
      }
    });

    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') this.trigger = false;
      if (e.code === 'KeyF') this.bombDropHeld = false;
    });

    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      // The armory swallows the click too: shutting it is the B key's job, and a
      // stray click must not fire a shell or drop a bomb behind the panel.
      if (this.shopMode) return;
      this.mouseDown = true;
      this.trigger = true;
      // While manning the Vampire the left button is the bomb release: one click,
      // one mini-bomb (the server still paces the stack and refuses a drop that is
      // too low, empty or already homing home). It only counts once the mouse is
      // already captured, so the click that re-captures it cannot drop a bomb.
      if (this.pointerLocked && this.vampireMode) {
        if (this.onDropBomb) this.onDropBomb();
        return;
      }
      // Left click is the mortar's trigger as well as the drone's boost. It only
      // counts once the mouse is captured, so the click that re-captures it (or a
      // click on the menu before the game starts) cannot send a shell by accident.
      // On a machine gun there is nothing to fire: the held trigger says it instead.
      if (this.pointerLocked && !this.hmgMode && this.onFireMouse) this.onFireMouse();
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouseDown = false;
        this.trigger = false;
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      const sensitivity = 0.002;
      // On a gun the mouse lays the weapon instead of looking past it: the lay is
      // the gun's own, and its elevation stops where the pintle stops.
      if (this.hmgMode) {
        this.hmgYaw -= e.movementX * sensitivity;
        this.hmgPitch = clampHmgPitch(this.hmgPitch - e.movementY * sensitivity);
        return;
      }
      // Mouse X contributes to yaw delta (incremental rotation)
      this.pendingYawDelta -= e.movementX * sensitivity;
      this.fortYaw -= e.movementX * sensitivity;
      // Mouse Y controls pitch (absolute, clamped)
      this.pitch -= e.movementY * sensitivity;
      this.pitch = Math.max(-this.MAX_PITCH, Math.min(this.MAX_PITCH, this.pitch));
    });

    document.addEventListener('pointerlockchange', () => {
      const wasLocked = this.pointerLocked;
      this.pointerLocked = document.pointerLockElement === this.canvas;

      if (this.pointerLocked) {
        this.clearRelockTimer();
        this.relockAttempts = 0;
        this.emitLockHint();
        return;
      }

      this.emitLockHint();
      if (wasLocked && this.wantLock) this.judgeLockLoss();
    });

    // The request itself was refused (document not focused yet, or still inside
    // the short cooldown Chrome applies after an Esc exit).
    document.addEventListener('pointerlockerror', () => this.handleRelockFailure());

    // A click is the one gesture every browser accepts for locking, so it is the
    // fallback whenever the automatic re-capture is refused.
    document.addEventListener('mousedown', (e) => {
      if (!this.wantLock || this.pointerLocked) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('button, input, textarea, select, a')) return;
      this.autoRelock = true;
      this.relockAttempts = 0;
      this.requestLock();
    });

    // Leaving the window also means keyup/mouseup never arrive for whatever was
    // held down, so the input state must be flushed before the player returns.
    window.addEventListener('blur', () => this.handleDeactivated());
    window.addEventListener('focus', () => this.handleReactivated());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.handleDeactivated();
      else this.handleReactivated();
    });
  }

  /** Ask for the mouse capture and remember that the game wants it. */
  lockPointer() {
    this.wantLock = true;
    this.autoRelock = true;
    this.relockAttempts = 0;
    this.requestLock();
  }

  /** Release the mouse capture and stop trying to re-acquire it. */
  unlockPointer() {
    this.wantLock = false;
    this.autoRelock = false;
    this.clearRelockTimer();
    this.clearDecisionTimer();
    this.emitLockHint();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  get isPointerLocked(): boolean { return this.pointerLocked; }

  private requestLock() {
    if (!this.wantLock || this.pointerLocked) return;
    try {
      // Chrome 113+ returns a Promise, older browsers return undefined.
      const result = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (result && typeof result.catch === 'function') {
        result.catch(() => this.handleRelockFailure());
      }
    } catch {
      this.handleRelockFailure();
    }
  }

  /**
   * Work out why the lock disappeared. Losing focus also loses the lock, and the
   * two events can arrive in either order, so the call is deferred a beat: if the
   * page is unfocused or hidden by then it was an alt-tab (re-capture on return);
   * if it is still focused the player pressed Esc on purpose, so the cursor is
   * left alone until the next click.
   */
  private judgeLockLoss() {
    this.clearDecisionTimer();
    this.decisionTimer = setTimeout(() => {
      this.decisionTimer = null;
      if (this.pointerLocked || !this.wantLock) return;
      if (document.hidden || !document.hasFocus()) {
        this.autoRelock = true;
      } else {
        this.autoRelock = false;
        this.emitLockHint();
      }
    }, this.RELOCK_DECIDE_MS);
  }

  private handleRelockFailure() {
    if (!this.autoRelock || this.pointerLocked || !this.wantLock) return;
    this.relockAttempts++;
    if (this.relockAttempts >= this.RELOCK_MAX_ATTEMPTS) {
      this.autoRelock = false;
      this.emitLockHint();
      return;
    }
    this.scheduleRelock(this.RELOCK_RETRY_MS);
  }

  private scheduleRelock(delay: number) {
    this.clearRelockTimer();
    this.relockTimer = setTimeout(() => {
      this.relockTimer = null;
      if (!this.wantLock || this.pointerLocked || document.hidden) return;
      this.requestLock();
    }, delay);
  }

  private clearRelockTimer() {
    if (this.relockTimer !== null) {
      clearTimeout(this.relockTimer);
      this.relockTimer = null;
    }
  }

  private clearDecisionTimer() {
    if (this.decisionTimer !== null) {
      clearTimeout(this.decisionTimer);
      this.decisionTimer = null;
    }
  }

  private handleDeactivated() {
    this.keys.clear();
    this.mouseDown = false;
    this.trigger = false;
    this.bombDropHeld = false;
    this.pendingYawDelta = 0;
  }

  private handleReactivated() {
    this.clearDecisionTimer();
    if (!this.wantLock || this.pointerLocked || document.hidden) return;
    // Coming back to the window is exactly the case that needs no click; the
    // document has to be focused already for the request to be granted.
    this.autoRelock = true;
    this.relockAttempts = 0;
    this.scheduleRelock(this.RELOCK_DELAY_MS);
  }

  private emitLockHint() {
    if (this.onLockHintChange) {
      this.onLockHintChange(this.wantLock && !this.pointerLocked);
    }
  }

  /** Fort view camera yaw (absolute) */
  getYaw(): number { return this.fortYaw; }
  getPitch(): number { return this.pitch; }

  /**
   * Step onto a machine gun or leave it. The trigger is always released by the change
   * of station: a belt must never keep running because a pilot walked off the gun.
   */
  setHmgMode(on: boolean) {
    if (on === this.hmgMode) return;
    this.hmgMode = on;
    this.trigger = false;
  }

  /**
   * Fly a Vampire or not: while true the left mouse button releases a mini-bomb
   * instead of boosting the aircraft.
   */
  setVampireMode(on: boolean) {
    this.vampireMode = on;
  }

  /**
   * Put a gun back on the bearing its crew was left holding, as when a pilot walks
   * over and mans a nest or swaps between two of them.
   */
  resetHmgAim(yaw: number) {
    this.hmgYaw = yaw;
    this.hmgPitch = 0;
  }

  get inHmgMode(): boolean { return this.hmgMode; }

  /**
   * Raise or shut the armory. Either way the held input is flushed the same way
   * losing the window flushes it: a key or button that was down when the panel came
   * up must not still be down after it goes back down.
   */
  setShopMode(on: boolean) {
    if (on === this.shopMode) return;
    this.shopMode = on;
    this.keys.clear();
    this.mouseDown = false;
    this.trigger = false;
    this.bombDropHeld = false;
  }

  get shopIsOpen(): boolean { return this.shopMode; }

  /** The digit a key press carries, or '' when it carries none. */
  private static digitOf(code: string): string {
    const m = /^Digit(\d)$/.exec(code) ?? /^Numpad(\d)$/.exec(code);
    return m ? m[1] : '';
  }

  /** The lay the gunner is holding, and whether his hand is on the trigger. */
  getHmgAim(): HmgAim {
    return { yaw: this.hmgYaw, pitch: this.hmgPitch, firing: this.trigger };
  }

  /**
   * Kick the lay the way a round does: the muzzle climbs and wanders a little to one
   * side, so walking a burst onto a running soldier stays a job for the gunner.
   */
  addHmgRecoil() {
    this.hmgPitch = clampHmgPitch(this.hmgPitch + 0.006);
    this.hmgYaw += (Math.random() * 2 - 1) * 0.003;
  }

  getState(): InputState {
    // While the armory is up the fort is deaf: no thrust, no yaw, no trigger. The
    // clock still advances so that closing the panel does not read as one long frame.
    if (this.shopMode) {
      this.lastStateTime = performance.now();
      this.pendingYawDelta = 0;
      return { forward: 0, yawDelta: 0, pitch: this.pitch, up: 0, boost: false, bombDrop: false };
    }

    let forward = 0;
    let up = 0;

    // Real elapsed time since the last poll — held-key rates must not depend on frame rate.
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastStateTime) / 1000));
    this.lastStateTime = now;

    if (this.keys.has('KeyW')) forward += 1;
    if (this.keys.has('KeyS')) forward -= 1;
    if (this.keys.has('Space')) up += 1;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) up -= 1;

    // A/D adds keyboard yaw rotation
    if (this.keys.has('KeyA')) this.pendingYawDelta += this.KEYBOARD_YAW_RATE * 0.05;
    if (this.keys.has('KeyD')) this.pendingYawDelta -= this.KEYBOARD_YAW_RATE * 0.05;

    // Arrow keys / Q-E tilt the nose up or down, exactly like moving the mouse vertically.
    let pitchDir = 0;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyQ')) pitchDir += 1;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyE')) pitchDir -= 1;
    if (this.hmgMode) {
      // The same keys lay the gun instead of tilting a view: A/D traverse, arrows
      // elevate, and the pintle decides how far up or down the gun will go.
      if (this.keys.has('KeyA')) this.hmgYaw += this.KEYBOARD_YAW_RATE * dt;
      if (this.keys.has('KeyD')) this.hmgYaw -= this.KEYBOARD_YAW_RATE * dt;
      if (pitchDir !== 0) this.hmgPitch = clampHmgPitch(this.hmgPitch + pitchDir * this.KEYBOARD_PITCH_RATE * dt);
    } else if (pitchDir !== 0) {
      this.pitch += pitchDir * this.KEYBOARD_PITCH_RATE * dt;
      this.pitch = Math.max(-this.MAX_PITCH, Math.min(this.MAX_PITCH, this.pitch));
    }

    const yawDelta = this.pendingYawDelta;
    this.pendingYawDelta = 0; // consume accumulated delta

    return {
      forward,
      yawDelta,
      pitch: this.pitch,
      up,
      // While bombing from the Vampire the left button is the bomb release, not a
      // boost, so suppress boost there (Shift/Space still set altitude).
      boost: this.mouseDown && !this.vampireMode,
      bombDrop: this.bombDropHeld,
    };
  }
}

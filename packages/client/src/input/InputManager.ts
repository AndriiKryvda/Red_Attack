import { WeaponType } from '@red-attack/shared';

export interface InputState {
  forward: number;
  yawDelta: number;   // incremental yaw from mouse + A/D keys
  pitch: number;      // absolute pitch from mouse Y
  up: number;
  boost: boolean;
}

export class InputManager {
  private keys: Set<string> = new Set();
  private pitch: number = 0;
  private canvas: HTMLCanvasElement;
  private pointerLocked: boolean = false;
  private mouseDown: boolean = false;

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
  onSelfDestruct: (() => void) | null = null;
  onToggleKeysGuide: (() => void) | null = null;
  /** Pick a weapon outright (1 = quad, 2 = mortar). */
  onSelectWeapon: ((weapon: WeaponType) => void) | null = null;
  /** Flip to the other weapon without naming it (Tab). */
  onCycleWeapon: (() => void) | null = null;
  /** Tells the UI to show/hide the "click to resume mouse look" hint. */
  onLockHintChange: ((show: boolean) => void) | null = null;

  // Fort view yaw (absolute, for camera when not piloting)
  private fortYaw: number = 0;

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
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.onLaunch) this.onLaunch();
      }
      if (e.code === 'KeyR') {
        if (this.onSelfDestruct) this.onSelfDestruct();
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
    });

    document.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.mouseDown = true;
      // Left click is the mortar's trigger as well as the drone's boost. It only
      // counts once the mouse is captured, so the click that re-captures it (or a
      // click on the menu before the game starts) cannot send a shell by accident.
      if (this.pointerLocked && this.onFireMouse) this.onFireMouse();
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      const sensitivity = 0.002;
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

  getState(): InputState {
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
    if (pitchDir !== 0) {
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
      boost: this.mouseDown,
    };
  }
}

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

  // Accumulated yaw delta since last getState() call (mouse + keyboard)
  private pendingYawDelta: number = 0;

  // Callbacks fired immediately on keydown (bypass rate limiter)
  onLaunch: (() => void) | null = null;
  onSelfDestruct: (() => void) | null = null;

  // Fort view yaw (absolute, for camera when not piloting)
  private fortYaw: number = 0;

  private readonly KEYBOARD_YAW_RATE = 2.5; // radians/sec for A/D turning

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
    });

    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    document.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouseDown = true;
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
      this.pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.pitch));
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
  }

  lockPointer() {
    this.canvas.requestPointerLock();
  }

  /** Fort view camera yaw (absolute) */
  getYaw(): number { return this.fortYaw; }
  getPitch(): number { return this.pitch; }

  getState(): InputState {
    let forward = 0;
    let up = 0;

    if (this.keys.has('KeyW')) forward += 1;
    if (this.keys.has('KeyS')) forward -= 1;
    if (this.keys.has('Space')) up += 1;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) up -= 1;

    // A/D adds keyboard yaw rotation
    if (this.keys.has('KeyA')) this.pendingYawDelta += this.KEYBOARD_YAW_RATE * 0.05;
    if (this.keys.has('KeyD')) this.pendingYawDelta -= this.KEYBOARD_YAW_RATE * 0.05;

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

export interface InputState {
  forward: number;
  right: number;
  up: number;
  yaw: number;
  pitch: number;
  boost: boolean;
}

export class InputManager {
  private keys: Set<string> = new Set();
  private yaw: number = 0;
  private pitch: number = 0;
  private canvas: HTMLCanvasElement;
  private pointerLocked: boolean = false;
  private mouseDown: boolean = false;

  // Callbacks fired immediately on keydown (bypass rate limiter)
  onLaunch: (() => void) | null = null;
  onSelfDestruct: (() => void) | null = null;

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
        // Fire launch immediately — don't wait for rate-limited input send
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
      this.yaw -= e.movementX * sensitivity;
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

  getYaw(): number { return this.yaw; }
  getPitch(): number { return this.pitch; }

  getState(): InputState {
    let forward = 0;
    let right = 0;
    let up = 0;

    if (this.keys.has('KeyW')) forward += 1;
    if (this.keys.has('KeyS')) forward -= 1;
    if (this.keys.has('KeyD')) right += 1;
    if (this.keys.has('KeyA')) right -= 1;
    if (this.keys.has('Space')) up += 1;
    if (this.keys.has('ShiftLeft')) up -= 1;

    return {
      forward,
      right,
      up,
      yaw: this.yaw,
      pitch: this.pitch,
      boost: this.mouseDown,
    };
  }
}

import { Client, Room } from '@colyseus/sdk';
import { GameState, ServerEvent } from '@red-attack/shared';

export class NetworkClient {
  private client: Client;
  private room: Room | null = null;
  private state: GameState | null = null;
  private events: ServerEvent[] = [];
  private eventCallbacks: ((event: ServerEvent) => void)[] = [];
  private inputRate: number = 0;
  private readonly INPUT_INTERVAL = 50;
  private _sessionId: string = '';

  constructor() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.client = new Client(`${protocol}//${window.location.hostname}:2567`);
  }

  get sessionId(): string { return this._sessionId; }

  async connect(name: string, roomCode?: string) {
    try {
      if (roomCode) {
        // Resolve room code to roomId via server HTTP endpoint
        const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
        const res = await fetch(`${protocol}//${window.location.hostname}:2567/join/${roomCode}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Room "${roomCode}" not found`);
        }
        const { roomId } = await res.json();
        this.room = await this.client.joinById(roomId, { name });
      } else {
        this.room = await this.client.joinOrCreate('game', { name });
      }
      this._sessionId = this.room.sessionId;
      console.log('[Net] Joined room:', this.room.roomId, 'as', this._sessionId);

      this.room.onMessage('state', (state: GameState) => {
        this.state = state;
      });

      this.room.onMessage('event', (event: ServerEvent) => {
        this.events.push(event);
        for (const cb of this.eventCallbacks) cb(event);
      });

      this.room.onLeave(() => {
        console.log('[Net] Left room');
        this.room = null;
      });
    } catch (err: any) {
      const message = err?.message || 'Failed to connect to server';
      console.error('[Net] Failed to join:', message);
      throw new Error(message);
    }
  }

  /** Send immediately — no rate limit */
  sendLaunch() {
    if (this.room) this.room.send('launch_drone', { type: 'launch_drone' });
  }

  /** Send immediately — no rate limit */
  sendSelfDestruct() {
    if (this.room) this.room.send('self_destruct', { type: 'self_destruct' });
  }

  /** Rate-limited continuous drone input */
  sendInput(input: { forward: number; yawDelta: number; pitch: number; up: number; boost: boolean }) {
    const now = performance.now();
    if (now - this.inputRate < this.INPUT_INTERVAL) return;
    this.inputRate = now;
    if (this.room) {
      this.room.send('drone_input', {
        type: 'drone_input',
        forward: input.forward,
        yawDelta: input.yawDelta,
        pitch: input.pitch,
        up: input.up,
        boost: input.boost,
      });
    }
  }

  getState(): GameState | null {
    return this.state;
  }

  getEvents(): ServerEvent[] {
    return this.events;
  }

  clearEvents() {
    this.events = [];
  }

  onEvent(cb: (event: ServerEvent) => void) {
    this.eventCallbacks.push(cb);
  }
}


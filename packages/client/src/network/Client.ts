import { Client, Room } from '@colyseus/sdk';
import { GameState, ServerEvent, WeaponType, MAX_PLAYERS, Difficulty } from '@red-attack/shared';

export class NetworkClient {
  private client: Client;
  private room: Room | null = null;
  private state: GameState | null = null;
  private events: ServerEvent[] = [];
  private eventCallbacks: ((event: ServerEvent) => void)[] = [];
  private inputRate: number = 0;
  private readonly INPUT_INTERVAL = 50;
  /** Machine gun lay: a little quicker than drone input so a release lands fast. */
  private hmgRate: number = 0;
  private readonly HMG_INTERVAL = 40;
  /** Vampire bomb release: held open, but no need to shout faster than the server paces it. */
  private vampireDropRate: number = 0;
  private readonly VAMPIRE_DROP_INTERVAL = 120;
  private _sessionId: string = '';

  constructor() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.client = new Client(`${protocol}//${window.location.hostname}:2567`);
  }

  get sessionId(): string { return this._sessionId; }

  async connect(name: string, roomCode?: string, difficulty?: Difficulty) {
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
        this.room = await this.client.joinOrCreate('game', { name, difficulty });
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
      let message = err?.message || 'Failed to connect to server';
      // A room that already holds MAX_PLAYERS pilots answers a join with Colyseus's
      // own "room is locked", which means nothing to a pilot holding a room code.
      if (/is locked|is full|not joinable/i.test(message)) {
        message = `That room is full — ${MAX_PLAYERS} pilots maximum`;
      }
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

  /** Swap the pilot between the quad and the tube - immediate, no rate limit. */
  sendSelectWeapon(weapon: WeaponType) {
    if (this.room) this.room.send('select_weapon', { type: 'select_weapon', weapon });
  }

  /** Drop a shell on a spot of the field; the server clamps it into the ring of fire. */
  sendMortarFire(x: number, z: number) {
    if (this.room) this.room.send('mortar_fire', { type: 'mortar_fire', x, z });
  }

  /**
   * Release one mini-bomb from the Vampire in the air. Held open the way drone input
   * is, but lightly rate-limited: the server is the one that paces the stack at its own
   * drop interval and refuses a drop that is too low or empty, so the client only has
   * to keep saying "still dropping" while the key is down.
   */
  sendVampireDrop() {
    const now = performance.now();
    if (now - this.vampireDropRate < this.VAMPIRE_DROP_INTERVAL) return;
    this.vampireDropRate = now;
    if (this.room) this.room.send('vampire_drop', { type: 'vampire_drop' });
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

  /**
   * Rate-limited lay and trigger of a manned machine gun. The gun fires on the
   * server's clock, so what a client has to keep saying is where the barrel is and
   * that a hand is still on the grips; the server stops the belt if the talk stops.
   */
  sendHmgInput(gun: number, yaw: number, pitch: number, firing: boolean) {
    const now = performance.now();
    if (now - this.hmgRate < this.HMG_INTERVAL) return;
    this.hmgRate = now;
    if (this.room) {
      this.room.send('hmg_input', { type: 'hmg_input', gun, yaw, pitch, firing });
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


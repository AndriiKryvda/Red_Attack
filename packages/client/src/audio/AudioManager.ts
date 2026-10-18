import type { EnemyData, EnemyType } from '@red-attack/shared';
import { EnemyType as EnemyTypeEnum } from '@red-attack/shared';
import { BattleCries } from './BattleCries';

/** Minimal read-only point; the camera and event payloads both satisfy it. */
interface Vec { x: number; y: number; z: number }

/** One looping tank-engine voice: a rumble of filtered noise over a low saw. */
interface EngineVoice {
  out: GainNode;
  noise: AudioBufferSourceNode;
  lp: BiquadFilterNode;
  osc: OscillatorNode;
  phase: number;
}

/** One in-flight mortar shell's descending whistle. */
interface Whistle {
  osc: OscillatorNode;
  gain: GainNode;
}

/**
 * The looping background track, dropped into `public/audio/` and served at
 * `/audio/...` by Vite. The game ships without it: if the file is absent the
 * music simply fails to load and the battle plays on without a soundtrack.
 */
const MUSIC_URL = '/audio/lenta-za-lentoyu.mp3';
/** Music sits under the battlefield: gunfire and explosions stay the loudest layer. */
const MUSIC_VOLUME = 0.35;

/**
 * Every sound in the game, synthesized live with the Web Audio API — gunfire,
 * explosions, the mortar's whistle, tank engines and the drone's buzz all come
 * out of oscillators and noise buffers, so the game ships without a single audio
 * file and works with the network unplugged.
 *
 * Sounds are placed in the world the cheap, honest way: each one-shot measures
 * its distance from the camera and scales its volume with a squared falloff,
 * which is all a first-person field battle needs and none of the bookkeeping a
 * full HRTF listener would cost. The continuous layers (tank engines, the quad's
 * hum) are looping voices whose gain is walked toward its target every frame.
 *
 * The browser will not let a page make noise until its pilot has done something
 * on purpose, so the context is only built on a click — `init()` is called from
 * the menu buttons. Every other call is safe before that and simply does nothing.
 */
export class AudioManager {
  readonly cries = new BattleCries();

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private muted = false;

  /** The ear every sound is measured against: the camera, fed each frame. */
  private lx = 0; private ly = 6; private lz = 0;
  /**
   * The player's two ears for the horde's battle cries: the fort, then his
   * drone — parked far underground whenever he is not flying, so a stale drone
   * position can never make an enemy close enough to shout.
   */
  private readonly cryAnchors: Vec[] = [{ x: 0, y: 6, z: 0 }, { x: 0, y: -1e6, z: 0 }];

  /** Rough count of live one-shot sources, to keep a full room from overloading. */
  private oneShots = 0;
  private static readonly MAX_ONESHOTS = 26;

  private readonly engines: EngineVoice[] = [];
  private droneGain: GainNode | null = null;
  private droneOn = false;
  private readonly whistles = new Map<string, Whistle>();

  /** The looping background track: an <audio> element folded into the master bus. */
  private musicEl: HTMLAudioElement | null = null;
  private musicSrc: MediaElementAudioSourceNode | null = null;
  private musicGain: GainNode | null = null;

  /** Build the audio graph. Must run inside a user gesture (a menu click). */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    this.white = this.makeNoise(1.0, false);
    this.brown = this.makeNoise(2.5, true);

    for (let i = 0; i < 2; i++) this.engines.push(this.createEngine());
    this.droneGain = this.createDroneHum();
    this.initMusic();
  }

  /**
   * A looping background track on the master bus, so the M mute already covers it
   * alongside gunfire and engines. It is started here, inside init()'s user
   * gesture, to satisfy the browser's autoplay rule. If the file is missing the
   * game plays on silently — the music is a bonus, never a requirement.
   */
  private initMusic(): void {
    if (!this.ctx || !this.master || this.musicEl) return;
    const el = new Audio(MUSIC_URL);
    el.loop = true;
    el.preload = 'auto';
    el.volume = 1; // the level is set by musicGain, not the element itself.
    el.addEventListener('error', () => {
      console.warn(`[Audio] background track not found at ${MUSIC_URL}; playing without music`);
    });
    try {
      const src = this.ctx.createMediaElementSource(el);
      const gain = this.ctx.createGain();
      gain.gain.value = MUSIC_VOLUME;
      src.connect(gain).connect(this.master);
      this.musicSrc = src;
      this.musicGain = gain;
      this.musicEl = el;
      void el.play().catch(() => { /* autoplay still blocked; stays silent until the next gesture */ });
    } catch (e) {
      console.warn('[Audio] could not start background music', e);
    }
  }

  get ready(): boolean {
    return !!this.ctx && !!this.master && this.ctx.state !== 'closed';
  }

  /** Mute or unmute everything, battle cries included. Returns the muted state. */
  toggleMute(): boolean {
    this.muted = !this.muted;
    this.cries.enabled = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  setListener(v: Vec): void {
    this.lx = v.x; this.ly = v.y; this.lz = v.z;
  }

  /** Where the fort stands: enemies near it count as near the player. */
  setFortPos(v: Vec): void {
    const a = this.cryAnchors[0];
    a.x = v.x; a.y = v.y; a.z = v.z;
  }

  // ─── One-shot battlefield sounds ─────────────────────────

  /** One round left a machine gun: a crack, a thump, distance in the volume. */
  hmgShot(x: number, y: number, z: number, isLocal: boolean): void {
    if (!this.ready || this.muted) return;
    const g = this.falloff(x, y, z, isLocal ? 260 : 140) * (isLocal ? 0.6 : 0.42);
    if (g <= 0.002 || !this.cap()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;

    // The crack: a slice of white noise through a high band, gone in a blink.
    const n = this.noiseSrc(this.white);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.9 * g, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    n.connect(bp).connect(ng).connect(this.master!);
    n.start(t); n.stop(t + 0.07);

    // The thump under it: what a round sounds like when the shot is far enough
    // that the crack has lost its teeth.
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.07);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.55 * g, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og).connect(this.master!);
    o.start(t); o.stop(t + 0.11);
    this.count(n);
  }

  /** A detonation on the field, sized by `scale` (a shell is bigger than a quad). */
  explosion(x: number, y: number, z: number, scale = 1): void {
    if (!this.ready || this.muted) return;
    const g = this.falloff(x, y, z, 150 + 120 * scale) * 0.9;
    if (g <= 0.002) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const len = 0.5 + 0.5 * scale;

    // The boom: brown noise squeezed through a lowpass that collapses as it fades.
    const n = this.noiseSrc(this.brown);
    n.playbackRate.value = 0.8 + Math.random() * 0.3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(4000, 500 * scale + 150), t);
    lp.frequency.exponentialRampToValueAtTime(60, t + len);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.9 * g, t + 0.012);
    ng.gain.exponentialRampToValueAtTime(0.001, t + len);
    n.connect(lp).connect(ng).connect(this.master!);
    n.start(t); n.stop(t + len + 0.05);

    // The chest hit: a sine dropping out of hearing.
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(70 + 20 * scale, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 0.35);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.75 * g, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(og).connect(this.master!);
    o.start(t); o.stop(t + 0.65);

    // Debris hiss over the top, short and bright.
    const n2 = this.noiseSrc(this.white);
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass'; bp2.frequency.value = 1500; bp2.Q.value = 0.5;
    const n2g = ctx.createGain();
    n2g.gain.setValueAtTime(0.25 * g, t);
    n2g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    n2.connect(bp2).connect(n2g).connect(this.master!);
    n2.start(t); n2.stop(t + 0.32);
    this.count(n);
  }

  /** The fort's tube firing: a squat thump at the muzzle. */
  mortarLaunch(x: number, y: number, z: number): void {
    if (!this.ready || this.muted) return;
    const g = this.falloff(x, y, z, 130) * 0.65;
    if (g <= 0.002) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const n = this.noiseSrc(this.brown);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + 0.25);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.8 * g, t + 0.008);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    n.connect(lp).connect(ng).connect(this.master!);
    n.start(t); n.stop(t + 0.32);
    this.count(n);
  }

  /** A shell is in the air: a whistle that falls the whole way down to the hit. */
  startWhistle(shellId: string, flight: number): void {
    if (!this.ready || this.muted || flight < 0.3) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1600, t);
    o.frequency.exponentialRampToValueAtTime(320, t + flight);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.15);
    g.gain.setValueAtTime(0.05, t + Math.max(0.2, flight - 0.1));
    g.gain.exponentialRampToValueAtTime(0.001, t + flight);
    o.connect(g).connect(this.master!);
    o.start(t); o.stop(t + flight + 0.05);
    const w: Whistle = { osc: o, gain: g };
    o.onended = () => { if (this.whistles.get(shellId) === w) this.whistles.delete(shellId); };
    this.whistles.set(shellId, w);
  }

  /** A building coming down: a bigger boom and a long rubble rumble. */
  bigCrash(x: number, y: number, z: number): void {
    this.explosion(x, y, z, 2.1);
    if (!this.ready || this.muted) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const g = this.falloff(x, y, z, 260) * 0.35;
    if (g <= 0.002) return;
    const n = this.noiseSrc(this.brown);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 260;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t + 0.15);
    ng.gain.linearRampToValueAtTime(g, t + 0.4);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    n.connect(lp).connect(ng).connect(this.master!);
    n.start(t); n.stop(t + 1.65);
    this.count(n);
  }

  /** An enemy went down: foot troops thud, vehicles clang off metal. */
  enemyKilled(type: EnemyType, x: number, y: number, z: number): void {
    if (!this.ready || this.muted) return;
    const g = this.falloff(x, y, z, 90) * 0.35;
    if (g <= 0.002) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    if (type === EnemyTypeEnum.TANK || type === EnemyTypeEnum.GOLF_CART || type === EnemyTypeEnum.MOTORCYCLIST) {
      // A clang: a bright triangle wave ringing down onto the hull.
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(340, t);
      o.frequency.exponentialRampToValueAtTime(150, t + 0.2);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.5 * g, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(og).connect(this.master!);
      o.start(t); o.stop(t + 0.26);
    } else {
      // A body hitting the dirt: a soft, muffled slap.
      const n = this.noiseSrc(this.white);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 220;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.8 * g, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      n.connect(lp).connect(ng).connect(this.master!);
      n.start(t); n.stop(t + 0.15);
      this.count(n);
    }
  }

  /** An enemy slipped through the wall: a short two-tone klaxon at the fort. */
  breachAlarm(): void {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const beep = (freq: number, at: number) => {
      const o = ctx.createOscillator();
      o.type = 'square'; o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.1, at + 0.01);
      g.gain.setValueAtTime(0.1, at + 0.11);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.14);
      o.connect(g).connect(this.master!);
      o.start(at); o.stop(at + 0.15);
    };
    beep(760, t);
    beep(560, t + 0.2);
  }

  /** The horde is coming: a long wailing siren over the fort. */
  hordeSiren(): void {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(400, t);
    o.frequency.linearRampToValueAtTime(680, t + 0.9);
    o.frequency.linearRampToValueAtTime(400, t + 1.8);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 950;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.12);
    g.gain.setValueAtTime(0.13, t + 1.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.0);
    o.connect(lp).connect(g).connect(this.master!);
    o.start(t); o.stop(t + 2.05);
  }

  // ─── Continuous layers, updated once a frame ─────────────

  /**
   * Walk the looping layers to where they belong this frame: tank engines follow
   * the nearest tanks, the quad hum follows our own drone, and the horde gets its
   * one chance a frame to start yelling — but only at enemies near the player's
   * ears, which are the fort and, while piloting, the drone itself.
   */
  update(_dt: number, enemies: EnemyData[] | undefined, droneOn: boolean, dronePos?: Vec | null): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.updateEngines(enemies ?? [], t);

    this.droneOn = droneOn;
    this.droneGain!.gain.setTargetAtTime(droneOn ? 0.08 : 0, t, 0.12);

    // The drone's ear is only live while he flies it; parked underground the
    // rest of the time, it never pulls a cry toward a stale position.
    const d = this.cryAnchors[1];
    if (droneOn && dronePos) {
      d.x = dronePos.x; d.y = dronePos.y; d.z = dronePos.z;
    } else {
      d.y = -1e6;
    }
    this.cries.tryCry(enemies ?? [], this.cryAnchors, performance.now() / 1000);
  }

  private updateEngines(enemies: EnemyData[], t: number): void {
    const tanks: number[] = [];
    for (const e of enemies) {
      if (e.dead || e.type !== EnemyTypeEnum.TANK) continue;
      tanks.push(Math.hypot(e.position.x - this.lx, e.position.y - this.ly, e.position.z - this.lz));
    }
    tanks.sort((a, b) => a - b);
    for (let i = 0; i < this.engines.length; i++) {
      const v = this.engines[i];
      const d = tanks[i];
      const vol = d === undefined ? 0 : Math.pow(Math.max(0, 1 - d / 110), 1.6) * 0.45;
      v.out.gain.setTargetAtTime(vol, t, 0.25);
      // Idling lurch with a touch of throttle when a tank is actually out there.
      const rpm = 0.85 + 0.12 * Math.sin(t * 2.7 + v.phase) + (d === undefined ? 0 : 0.15);
      v.noise.playbackRate.setTargetAtTime(rpm, t, 0.3);
      v.osc.frequency.setTargetAtTime(44 * rpm, t, 0.3);
      v.lp.frequency.setTargetAtTime(150 + 80 * rpm, t, 0.3);
    }
  }

  // ─── Internals ───────────────────────────────────────────

  /** Squared distance falloff from the listener, 1 at the ear and 0 at maxDist. */
  private falloff(x: number, y: number, z: number, maxDist: number): number {
    const d = Math.hypot(x - this.lx, y - this.ly, z - this.lz);
    if (d >= maxDist) return 0;
    const f = 1 - d / maxDist;
    return f * f;
  }

  /** True while the one-shot budget has room for another voice. */
  private cap(): boolean {
    if (this.oneShots >= AudioManager.MAX_ONESHOTS) return false;
    this.oneShots++;
    return true;
  }

  private count(src: AudioScheduledSourceNode): void {
    src.onended = () => { this.oneShots = Math.max(0, this.oneShots - 1); };
  }

  private noiseSrc(buf: AudioBuffer | null): AudioBufferSourceNode {
    const n = this.ctx!.createBufferSource();
    n.buffer = buf;
    return n;
  }

  private makeNoise(seconds: number, brown: boolean): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (brown) {
      let last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    } else {
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  /** A diesel growl: looping brown noise and a low sawtooth, both filtered dark. */
  private createEngine(): EngineVoice {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master!);

    const noise = ctx.createBufferSource();
    noise.buffer = this.brown;
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 180; lp.Q.value = 0.6;
    const ng = ctx.createGain();
    ng.gain.value = 0.85;
    noise.connect(lp).connect(ng).connect(out);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 46;
    const olp = ctx.createBiquadFilter();
    olp.type = 'lowpass'; olp.frequency.value = 140;
    const og = ctx.createGain();
    og.gain.value = 0.3;
    osc.connect(olp).connect(og).connect(out);

    noise.start();
    osc.start();
    return { out, noise, lp, osc, phase: Math.random() * Math.PI * 2 };
  }

  /**
   * The quad's roar: two detuned low saws beating like twin motors over a sub
   * sine and brown-noise air, everything kept under a dark lowpass — a heavy
   * drone in the chest, not a thin squeal in the ears. Silent until airborne.
   */
  private createDroneHum(): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master!);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.7;
    lp.connect(g);

    // Detuned by a few hertz, the two saws beat against each other the way
    // four props on off-throttle do.
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth'; o1.frequency.value = 90;
    const g1 = ctx.createGain(); g1.gain.value = 0.5;
    o1.connect(g1).connect(lp);

    const o2 = ctx.createOscillator();
    o2.type = 'sawtooth'; o2.frequency.value = 94;
    const g2 = ctx.createGain(); g2.gain.value = 0.45;
    o2.connect(g2).connect(lp);

    // The part you feel more than hear, an octave under the motors.
    const sub = ctx.createOscillator();
    sub.type = 'sine'; sub.frequency.value = 45;
    const sg = ctx.createGain(); sg.gain.value = 0.35;
    sub.connect(sg).connect(lp);

    // Airframe roar under the growl: looping brown noise squeezed dark.
    const n = this.noiseSrc(this.brown);
    n.loop = true;
    const nlp = ctx.createBiquadFilter();
    nlp.type = 'lowpass'; nlp.frequency.value = 500; nlp.Q.value = 0.6;
    const ng = ctx.createGain(); ng.gain.value = 0.5;
    n.connect(nlp).connect(ng).connect(lp);

    o1.start(); o2.start(); sub.start(); n.start();
    return g;
  }
}

/** One audio world shared by the scene, the menu and the hotkeys. */
export const audio = new AudioManager();

// A handle for the browser console: lets a developer poke the audio world live
// (state, mute, one-shot triggers) without a rebuild. Nothing in the game reads it.
(window as unknown as { __audio?: AudioManager }).__audio = audio;




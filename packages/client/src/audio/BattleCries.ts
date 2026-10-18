import type { EnemyData } from '@red-attack/shared';

/**
 * The horde's battle cries: living enemies within earshot of the player shout
 * "Урааааа!" and "За Путина!" out loud, in Russian, through the browser's own
 * speech synthesis — no audio files, no network, no voices to ship.
 *
 * The player's ears are wherever he is: the fort when he stands in the turret,
 * his drone when he flies it. An enemy only opens his mouth when he is close to
 * one of those anchors, so cries never drift in from the far side of the map.
 *
 * A real battlefield is a wall of yelling, and a browser tab is not: one voice at
 * a time, a global cooldown between shouts, and a longer per-enemy cooldown on
 * top, so a horde of forty charges with a steady roll of cries instead of forty
 * throats talking over each other. Volume follows distance the way every other
 * sound in the game does, and a cry from across the map is simply not worth
 * opening a mouth for.
 */
export class BattleCries {
  /** False while the game is muted; the manager flips this with the master gain. */
  enabled = true;

  private voice: SpeechSynthesisVoice | null = null;
  /** Seconds (game clock) the last cry went out at. */
  private lastGlobal = -10;
  /** Per-enemy earliest next cry, keyed by enemy id. */
  private readonly nextAt = new Map<string, number>();

  /**
   * Battle cries, weighted so "За Путина!" lands half as often as "Урааааа!"
   * — the uniform pick below turns the duplicated entry into a 2:1 ratio.
   */
  private static readonly PHRASES = ['Урааааа!', 'Урааааа!', 'За Путина!'];
  /** Metres: further than this from every anchor, the horde keeps its mouth shut. */
  private static readonly RANGE = 30;
  /** Seconds between any two cries, whoever is doing the shouting. */
  private static readonly COOLDOWN = 1.6;

  constructor() {
    if (!('speechSynthesis' in window)) return;
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      this.voice = voices.find(v => /^ru/i.test(v.lang)) ?? null;
    };
    pick();
    // Most browsers fill the voice list late and say so; a Russian voice is what
    // makes "За Путина" come out as Russian and not as a tourist reading it.
    try {
      window.speechSynthesis.addEventListener('voiceschanged', pick);
    } catch {
      /* older engines without the event: the up-front pick stands on its own */
    }
  }

  /**
   * One chance per frame to let the horde yell. `now` is a plain seconds clock
   * (performance.now()/1000) and `anchors` are the player's ears this frame —
   * the fort and, while piloting, his drone. At most one enemy speaks per call.
   */
  tryCry(
    enemies: EnemyData[],
    anchors: readonly { x: number; y: number; z: number }[],
    now: number,
  ): void {
    if (!this.enabled || !('speechSynthesis' in window) || anchors.length === 0) return;
    const ss = window.speechSynthesis;
    if (ss.speaking || ss.pending) return;
    if (now - this.lastGlobal < BattleCries.COOLDOWN) return;

    // Enemy ids are unique per spawn and the horde never stops coming, so the
    // bookkeeping gets swept wholesale once it drifts past a sane size.
    if (this.nextAt.size > 96) this.nextAt.clear();

    for (const e of enemies) {
      if (e.dead) continue;
      // The enemy counts as "near the player" by his closest ear: an enemy at
      // the wall is heard from the fort, one at the drone is heard in the
      // goggles, and one near both is heard just as loudly as either alone.
      let d = Infinity;
      for (const a of anchors) {
        const da = Math.hypot(e.position.x - a.x, e.position.y - a.y, e.position.z - a.z);
        if (da < d) d = da;
      }
      if (d > BattleCries.RANGE) continue;

      const next = this.nextAt.get(e.id);
      if (next === undefined) {
        // First time this enemy is in earshot: stagger its debut so a fresh
        // wave does not arrive all shouting at the same instant.
        this.nextAt.set(e.id, now + 1 + Math.random() * 6);
        continue;
      }
      if (now < next) continue;

      this.shout(d);
      this.nextAt.set(e.id, now + 6 + Math.random() * 8);
      this.lastGlobal = now;
      return;
    }
  }

  private shout(dist: number): void {
    const text = BattleCries.PHRASES[(Math.random() * BattleCries.PHRASES.length) | 0];
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ru-RU';
    if (this.voice) u.voice = this.voice;
    u.volume = Math.max(0.2, Math.min(1, 1.15 - dist / BattleCries.RANGE));
    // A little pitch and tempo jitter keeps ten soldiers from sounding like
    // one soldier on a loop.
    u.rate = 0.95 + Math.random() * 0.35;
    u.pitch = 0.6 + Math.random() * 0.9;
    try {
      window.speechSynthesis.speak(u);
    } catch {
      /* some engines throw on speak without a gesture; the game just goes quiet */
    }
  }
}

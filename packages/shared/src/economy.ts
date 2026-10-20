import { WeaponType } from './mortar.js';
import { HMG_WEAPONS } from './hmg.js';
import { Difficulty } from './types.js';

// ─── The fort's economy ────────────────────────────────────
// Pilots earn credits alongside the score for every kill, and spend them at the
// armory on stations the fort was not built holding. The score stays a pure record
// of who did the damage — spending never touches it — while credits are the purse
// that buys a weapon outright for the rest of the run.
//
// Everything the shop sells lives in SHOP_CATALOG below, so a new weapon is one row
// here rather than a change spread across the server, the HUD and the key bindings.

/** What the armory can sell. One entry per station or consumable. */
export enum ShopItem {
  VAMPIRE = 'vampire',
  MINEFIELD = 'minefield',
}

export interface ShopItemSpec {
  item: ShopItem;
  /** The station this buys, or null when the purchase is a consumable. */
  weapon: WeaponType | null;
  /** What it costs, in credits. */
  cost: number;
  /** Name the shop panel and the announcement print. */
  label: string;
  /** One line of what the pilot gets for his money. */
  desc: string;
  /** Key that buys this row while the shop is open. */
  hotkey: string;
}

/**
 * The catalogue, in the order the panel lists it. The Vampire is the first thing
 * the fort can buy: it starts locked away, and a pilot has to earn its price out
 * of the horde before key `7` will answer him.
 */
export const SHOP_CATALOG: ShopItemSpec[] = [
  {
    item: ShopItem.VAMPIRE,
    weapon: WeaponType.VAMPIRE,
    cost: 300,
    label: 'VAMPIRE BOMBER',
    desc: 'Heavy bomber · 5 mini-bombs · returns to re-arm',
    // The same key the station is manned with: while the armory is up, 7 buys the
    // Vampire; once it is yours, 7 flies it.
    hotkey: '7',
  },
  {
    item: ShopItem.MINEFIELD,
    // No station: a mine field is a consumable, so the owned check never applies and
    // the row can be bought again to refill the dirt around the fort.
    weapon: null,
    cost: 500,
    label: 'MINE FIELD',
    desc: '120 mines ring the fort · kills anything that walks into them',
    // Buys wherever the armory is open, and on the weapon panel the rest of the time:
    // there is nothing to man, so the key spends the credits and the mines go down.
    hotkey: '8',
  },
];

/**
 * Credits a pilot starts a run with, before he has killed anything, per difficulty.
 * Easy opens with enough to walk straight into the armory and buy everything it sells —
 * the bomber and a mine field together — so a new crew spends its first minute shooting
 * instead of saving. The other two hand out nothing: there the bomber is earned out of
 * the horde, which is the whole point of the purse.
 */
export const STARTING_CREDITS: Record<Difficulty, number> = {
  [Difficulty.EASY]: 1000,
  [Difficulty.MEDIUM]: 0,
  [Difficulty.HARD]: 0,
};

/**
 * Credits paid out per point of score earned. One for now, so a kill is worth the
 * same in both ledgers; raising it makes the shop cheap, lowering it makes a pilot
 * work harder for a bomber without touching the scoreboard.
 */
export const CREDIT_PAYOUT = 1;

/**
 * The stations a pilot is handed at the start: the quad, the tube and all four
 * machine guns. Anything the shop sells is deliberately not in this list, which is
 * what keeps key `7` dead until somebody pays for it.
 */
export function defaultLoadout(): WeaponType[] {
  return [WeaponType.FPV, WeaponType.MORTAR, ...HMG_WEAPONS];
}

/** The catalogue row a station is sold under, or undefined when it comes free. */
export function shopItemFor(weapon: WeaponType): ShopItemSpec | undefined {
  return SHOP_CATALOG.find((spec) => spec.weapon === weapon);
}

/** A catalogue row by its own key, or undefined for anything else. */
export function shopItemByKey(item: ShopItem): ShopItemSpec | undefined {
  return SHOP_CATALOG.find((spec) => spec.item === item);
}

/** The row a shop hotkey buys, or undefined when the key sells nothing. */
export function shopItemByHotkey(hotkey: string): ShopItemSpec | undefined {
  return SHOP_CATALOG.find((spec) => spec.hotkey === hotkey);
}

/** True when a pilot holding `unlocked` may man this station. */
export function weaponIsUnlocked(weapon: WeaponType, unlocked: WeaponType[]): boolean {
  if (!shopItemFor(weapon)) return true;   // free station: nobody has to buy it
  return unlocked.includes(weapon);
}

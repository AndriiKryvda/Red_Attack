import { GameState, PlayerState, DroneData, PlayerData, WeaponType, HMG_NESTS, hmgGunOf, DIFFICULTY_LABELS, SHOP_CATALOG, ShopItemSpec, ShopItem, shopItemFor, shopItemByKey, weaponIsUnlocked, MINEFIELD_MINES } from '@red-attack/shared';

export class HUD {
  private breachDisplay: HTMLElement;
  private breachFlash: HTMLElement | null;
  private lastLeaks = -1;
  private breachFlashTimeout: ReturnType<typeof setTimeout> | null = null;
  private waveInfo: HTMLElement;
  private droneStatus: HTMLElement;
  private scoreDisplay: HTMLElement;
  private creditsDisplay: HTMLElement;
  private announcement: HTMLElement;
  private crosshair: HTMLElement;
  private roomCodeDisplay: HTMLElement;
  private compassRose: HTMLElement;
  private flightPanel: HTMLElement;
  private flAlt: HTMLElement;
  private flSpd: HTMLElement;
  private flDist: HTMLElement;
  private flTime: HTMLElement;
  private weaponPanel: HTMLElement;
  private wpFpv: HTMLElement;
  private wpMortar: HTMLElement;
  private wpFpvState: HTMLElement;
  private wpMortarState: HTMLElement;
  private wpVampire: HTMLElement;
  private wpVampireState: HTMLElement;
  private wpMinefield: HTMLElement;
  private wpMinefieldState: HTMLElement;
  /** One row and one state cell per machine gun, in the order the nests are numbered. */
  private wpHmg: HTMLElement[] = [];
  private wpHmgState: HTMLElement[] = [];
  private keysGuide: HTMLElement;
  private kgLaunch: HTMLElement;
  private keysGuideVisible: boolean;
  /**
   * The armory panel and the row built for each catalogue entry. The rows are built
   * once from the shared catalogue, so a weapon added server-side shows up here
   * without a single line of markup changing.
   */
  private shopPanel: HTMLElement;
  private shopRowsEl: HTMLElement;
  private spCredits: HTMLElement;
  private shopRows: { spec: ShopItemSpec; el: HTMLElement; state: HTMLElement }[] = [];
  private shopVisible: boolean = false;
  /** Fired when a shop row is clicked; main.ts turns it into a purchase message. */
  onShopBuy: ((spec: ShopItemSpec) => void) | null = null;
  private announceTimeout: ReturnType<typeof setTimeout> | null = null;
  private static readonly KEYS_GUIDE_PREF = 'red-attack:keys-guide';
  /** The FPS readout and whether it is on screen (F3 toggles it, default on). */
  private fpsDisplay: HTMLElement;
  private fpsVisible: boolean;
  private static readonly FPS_PREF = 'red-attack:fps';

  constructor() {
    this.breachDisplay = document.getElementById('breach-display')!;
    this.breachFlash = document.getElementById('breach-flash');
    this.waveInfo = document.getElementById('wave-info')!;
    this.droneStatus = document.getElementById('drone-status')!;
    this.scoreDisplay = document.getElementById('score-display')!;
    this.creditsDisplay = document.getElementById('credits-display')!;
    this.announcement = document.getElementById('announcement')!;
    this.crosshair = document.getElementById('crosshair')!;
    this.roomCodeDisplay = document.getElementById('room-code-display')!;
    this.compassRose = document.getElementById('compass-rose')!;
    this.flightPanel = document.getElementById('flight-panel')!;
    this.flAlt = document.getElementById('fl-alt')!;
    this.flSpd = document.getElementById('fl-spd')!;
    this.flDist = document.getElementById('fl-dist')!;
    this.flTime = document.getElementById('fl-time')!;
    this.weaponPanel = document.getElementById('weapon-panel')!;
    this.wpFpv = document.getElementById('wp-fpv')!;
    this.wpMortar = document.getElementById('wp-mortar')!;
    this.wpFpvState = document.getElementById('wp-fpv-state')!;
    this.wpMortarState = document.getElementById('wp-mortar-state')!;
    this.wpVampire = document.getElementById('wp-vampire')!;
    this.wpVampireState = document.getElementById('wp-vampire-state')!;
    this.wpMinefield = document.getElementById('wp-minefield')!;
    this.wpMinefieldState = document.getElementById('wp-minefield-state')!;
    // The four gun rows are looked up rather than written out: the panel and the
    // nests are numbered the same way, 3 to 6.
    for (let i = 1; i <= HMG_NESTS.length; i++) {
      const row = document.getElementById(`wp-hmg-${i}`);
      const state = document.getElementById(`wp-hmg-state-${i}`);
      if (!row || !state) continue;
      this.wpHmg.push(row);
      this.wpHmgState.push(state);
    }
    this.keysGuide = document.getElementById('keys-guide')!;
    this.kgLaunch = document.getElementById('kg-launch')!;
    this.keysGuideVisible = HUD.readKeysGuidePref();
    this.applyKeysGuide();
    this.fpsDisplay = document.getElementById('fps-display')!;
    this.fpsVisible = HUD.readFpsPref();
    this.applyFps();
    this.shopPanel = document.getElementById('shop-panel')!;
    this.shopRowsEl = document.getElementById('shop-rows')!;
    this.spCredits = document.getElementById('sp-credits')!;
    this.buildShop();
  }

  /**
   * Build the armory rows from the shared catalogue. Each row carries the price the
   * server charges for it, so the panel can never advertise something the fort will
   * not sell at that figure.
   */
  private buildShop() {
    for (const spec of SHOP_CATALOG) {
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `<span class="sp-key">${spec.hotkey}</span>`
        + `<span class="sp-name">${spec.label}<small>${spec.desc}</small></span>`
        + `<span class="sp-cost">${spec.cost}</span>`
        + `<span class="sp-state">—</span>`;
      row.addEventListener('click', () => {
        if (row.classList.contains('owned')) return;
        this.onShopBuy?.(spec);
      });
      this.shopRowsEl.appendChild(row);
      this.shopRows.push({
        spec, el: row,
        state: row.querySelector('.sp-state') as HTMLElement,
      });
    }
  }

  update(state: GameState | null, localSessionId: string, heading = 0) {
    if (!state) return;

    // Compass: rotate the rose so the N marker points to world north (-Z).
    if (this.compassRose) {
      this.compassRose.style.transform = `rotate(${(-heading * 180) / Math.PI}deg)`;
    }

    // Room code, with the difficulty the host created the room with.
    if (state.roomCode) {
      const diff = state.difficulty ? ` · ${DIFFICULTY_LABELS[state.difficulty]}` : '';
      this.roomCodeDisplay.textContent = `ROOM: ${state.roomCode}${diff}`;
    }

    // Breach counter — enemies that made it to the fort. It is purely a score:
    // breaching never ends the run, the horde just keeps coming.
    if (this.breachDisplay) {
      this.breachDisplay.innerHTML = `${state.leaks}<small>BREACHES</small>`;
      if (this.lastLeaks >= 0 && state.leaks > this.lastLeaks) this.flashBreach();
    }
    this.lastLeaks = state.leaks;

    // Horde status: how deep into the assault we are, and what is still alive.
    const mm = Math.floor(state.elapsed / 60);
    const ss = String(state.elapsed % 60).padStart(2, '0');
    this.waveInfo.textContent =
      `⚠ THREAT ${state.threatLevel} · ${mm}:${ss} · ${state.enemiesAlive} ALIVE · ${state.kills} KILLS · ${state.leaks} BREACHED`;

    // Drone status — find local player by sessionId
    const player = state.players.find(p => p.id === localSessionId);
    if (player) {
      // Two weapons, one fire button: what SPACE does, and what the status line
      // counts down, depends on which station the pilot is manning.
      const hmgGun = player.state === PlayerState.PILOTING ? -1 : hmgGunOf(player.weapon);
      // A gun's swap timer is the moment its fresh belt goes in - the server sets it
      // from the last round fired - so it is only worth showing once the belt is dry.
      const hmgWait = (player.hmgReloadAt ?? []).map(t =>
        Math.max(0, Math.ceil((t - state.serverTime) / 1000)));
      const mortarMode = (player.weapon ?? WeaponType.FPV) === WeaponType.MORTAR;
      const mortarWait = Math.max(
        0, Math.ceil(((player.mortarReadyAt ?? 0) - state.serverTime) / 1000));
      const droneWait = player.state === PlayerState.COOLDOWN
        ? Math.max(0, Math.ceil((player.cooldownUntil - state.serverTime) / 1000))
        : 0;
      const vampireRearm = Math.max(
        0, Math.ceil(((player.vampireReloadAt ?? 0) - state.serverTime) / 1000));
      if (player.state === PlayerState.PILOTING) {
        this.droneStatus.textContent = '🛩️ In Flight';
        this.crosshair.classList.add('show');
      } else if (hmgGun >= 0) {
        // At a gun the crosshair is the barrel and the status line is the belt.
        const left = player.hmgAmmo?.[hmgGun] ?? 0;
        this.droneStatus.textContent = left > 0
          ? `🔫 ${HMG_NESTS[hmgGun].label}: ${left} rounds`
          : `⏳ Belt swap: ${hmgWait[hmgGun] ?? 0}s`;
        this.crosshair.classList.add('show');
      } else if (mortarMode) {
        // The tube is laid and loaded, and the crosshair doubles as its aim ray.
        this.droneStatus.textContent = mortarWait > 0
          ? `⏳ Mortar reload: ${mortarWait}s`
          : '💥 Press SPACE / LMB to fire';
        this.crosshair.classList.add('show');
      } else if (player.state === PlayerState.COOLDOWN) {
        this.droneStatus.textContent = `⏳ Reload: ${droneWait}s`;
        this.crosshair.classList.remove('show');
      } else {
        this.droneStatus.textContent = '✅ Press SPACE to launch';
        this.crosshair.classList.remove('show');
      }
      // A Vampire in the air reports its own bomb stack rather than a plain "In Flight".
      if (player.state === PlayerState.PILOTING && (player.weapon ?? WeaponType.FPV) === WeaponType.VAMPIRE) {
        this.droneStatus.textContent = player.vampireReturning
          ? (vampireRearm > 0 ? `Returning · rearm ${vampireRearm}s` : 'Returning to base')
          : `${player.vampireBombs ?? 0} bombs · LMB to drop`;
      }
      // Mines this pilot paid for that are still in the dirt. The whole room can see a
      // field, but only the buyer's count matters here: he is the one it kills for. The
      // belt's own total is what decides whether there is anything left to buy — the
      // field is one shared ring of holes, whoever happens to pay for each mine in it.
      const minesInGround = (state.mines ?? []).filter(m => m.ownerId === localSessionId).length;
      const minesInBelt = (state.mines ?? []).length;
      this.updateWeaponPanel(player, mortarWait, droneWait, hmgGun, hmgWait, vampireRearm, minesInGround, minesInBelt);
      this.scoreDisplay.textContent = `Score: ${player.score}`;
      // The purse sits under the score: the score is what he did, the credits are
      // what he has not spent yet. They tick up together and only ever diverge when
      // he buys something.
      this.creditsDisplay.innerHTML = `CREDITS <b>${player.credits ?? 0}</b>`;
      this.renderShop(player, minesInBelt);

      // Key guide: pulse the Space row while a launch is available.
      this.kgLaunch.classList.toggle('on', player.state !== PlayerState.PILOTING);

      // Flight instruments (only while actively piloting a live drone)
      let drone: DroneData | undefined;
      if (player.state === PlayerState.PILOTING && player.droneId) {
        drone = state.drones.find(d => d.id === player.droneId);
      }
      if (drone) {
        this.flightPanel.style.display = 'block';
        const spd = Math.hypot(drone.velocity.x, drone.velocity.y, drone.velocity.z);
        const dist = Math.hypot(drone.position.x, drone.position.z);
        const elapsed = (state.serverTime - drone.launchedAt) / 1000;
        this.flAlt.textContent = drone.position.y.toFixed(1);
        this.flSpd.textContent = spd.toFixed(1);
        this.flDist.textContent = dist.toFixed(0);
        this.flTime.textContent = elapsed.toFixed(1);
      } else {
        this.flightPanel.style.display = 'none';
      }
    }
  }

  /** The weapon rack: which station is manned, and what each one is doing. */
  private updateWeaponPanel(
    player: PlayerData, mortarWait: number, droneWait: number,
    hmgGun: number, hmgWait: number[], vampireRearm: number,
    minesInGround: number = 0, minesInBelt: number = 0,
  ) {
    if (!this.weaponPanel) return;
    const weapon = player.weapon ?? WeaponType.FPV;
    const piloting = player.state === PlayerState.PILOTING;
    const fpvOn = weapon === WeaponType.FPV;
    const vampireOn = weapon === WeaponType.VAMPIRE;
    this.wpFpv.classList.toggle('on', fpvOn);
    this.wpMortar.classList.toggle('on', weapon === WeaponType.MORTAR);
    // The FPV row only claims "IN FLIGHT" when it is the FPV actually flying; a
    // Vampire in the air belongs to its own row below, not this one.
    this.wpFpvState.textContent = (fpvOn && piloting)
      ? 'IN FLIGHT'
      : (fpvOn && droneWait > 0 ? `RELOAD ${droneWait}s` : 'READY');
    this.wpMortarState.textContent = mortarWait > 0 ? `RELOAD ${mortarWait}s` : 'READY';
    this.wpFpv.classList.toggle('cool', fpvOn && droneWait > 0);
    this.wpMortar.classList.toggle('cool', mortarWait > 0);
    // The Vampire row: how many mini-bombs are left in the stack, or what the
    // autopilot is doing on the way home to re-arm. Until it is paid for the row
    // shows its price instead — the key is dead, and the panel says why.
    const vampireOwned = weaponIsUnlocked(WeaponType.VAMPIRE, player.unlocked ?? []);
    const vampireCost = shopItemFor(WeaponType.VAMPIRE)?.cost ?? 0;
    this.wpVampire.classList.toggle('locked', !vampireOwned);
    this.wpVampire.classList.toggle('on', vampireOn);
    this.wpVampire.classList.toggle('cool', vampireOn && !!player.vampireReturning);
    this.wpVampireState.textContent = !vampireOwned
      ? `LOCKED · ${vampireCost}`
      : (!vampireOn || !piloting)
        ? 'READY'
        : player.vampireReturning
          ? (vampireRearm > 0 ? `REARM ${vampireRearm}s` : 'RETURNING')
          : `${player.vampireBombs ?? 0} BOMBS`;
    // The mine field is not a station to man, so its row counts what is left in the
    // dirt instead: how many of this pilot's mines are still waiting. A full belt says
    // so — pressing 8 then would buy nothing, and the panel says why before the credits
    // are asked for. Once the horde has walked some of them off, the row falls back to
    // its price and says what 8 buys.
    const mineCost = shopItemByKey(ShopItem.MINEFIELD)?.cost ?? 0;
    this.wpMinefield.classList.toggle('on', minesInGround > 0);
    this.wpMinefieldState.textContent = minesInBelt >= MINEFIELD_MINES
      ? 'FULL'
      : minesInGround > 0
        ? `${minesInGround} IN GROUND`
        : `BUY · ${mineCost}`;
    // The four guns: whose trigger is manned, and what is left in each belt. An
    // empty one shows the swap countdown instead of a number.
    for (let i = 0; i < this.wpHmg.length; i++) {
      const ammo = player.hmgAmmo?.[i] ?? 0;
      this.wpHmg[i].classList.toggle('on', i === hmgGun);
      this.wpHmg[i].classList.toggle('cool', ammo <= 0);
      this.wpHmgState[i].textContent = ammo > 0 ? `${ammo}` : `SWAP ${hmgWait[i] ?? 0}s`;
    }
  }

  /** Show/hide the on-screen FPV key guide (bound to the H key). */
  toggleKeysGuide() {
    this.keysGuideVisible = !this.keysGuideVisible;
    this.applyKeysGuide();
  }

  /** Open or shut the armory (bound to the B key). */
  setShopOpen(open: boolean) {
    this.shopVisible = open;
    this.shopPanel.classList.toggle('hidden', !open);
  }

  toggleShop() {
    this.setShopOpen(!this.shopVisible);
  }

  get shopIsOpen(): boolean { return this.shopVisible; }

  /**
   * Settle every armory row against what this pilot holds: bought, affordable, or
   * short by however much the panel spells out. It runs off the server's own
   * credits and unlock list, so the shop never offers what the server would refuse.
   */
  private renderShop(player: PlayerData, minesInBelt: number = 0) {
    if (!this.shopVisible) return;
    const credits = player.credits ?? 0;
    const unlocked = player.unlocked ?? [];
    this.spCredits.textContent = `${credits}`;
    for (const row of this.shopRows) {
      const owned = !!row.spec.weapon && unlocked.includes(row.spec.weapon);
      // A mine field refills the belt rather than stacking another one, so a belt with no
      // empty hole left is as spent as a station he already owns: the row says so, and the
      // server would refuse the credits anyway.
      const full = row.spec.item === ShopItem.MINEFIELD && minesInBelt >= MINEFIELD_MINES;
      const short = Math.max(0, row.spec.cost - credits);
      row.el.classList.toggle('owned', owned || full);
      row.el.classList.toggle('affordable', !owned && !full && short === 0);
      row.el.classList.toggle('expensive', !owned && !full && short > 0);
      row.el.title = owned
        ? `${row.spec.label} — already yours`
        : full
          ? `${row.spec.label} — every hole in the belt is already mined`
          : `Buy ${row.spec.label} for ${row.spec.cost} credits`;
      row.state.textContent = owned
        ? 'OWNED'
        : full ? 'FIELD FULL'
          : (short === 0 ? 'AFFORDABLE' : `SHORT ${short}`);
    }
  }

  private applyKeysGuide() {
    this.keysGuide.classList.toggle('hidden', !this.keysGuideVisible);
    try {
      localStorage.setItem(HUD.KEYS_GUIDE_PREF, this.keysGuideVisible ? '1' : '0');
    } catch {
      // Storage can be unavailable (private mode / file://) — the toggle still works this session.
    }
  }

  private static readKeysGuidePref(): boolean {
    try {
      return localStorage.getItem(HUD.KEYS_GUIDE_PREF) !== '0';
    } catch {
      return true;
    }
  }

  /**
   * Paint the FPS readout. Colour-coded so a dip reads at a glance: green at a
   * smooth frame rate, amber when it starts to sag, red when the field is heavy.
   * A no-op while the counter is hidden, so a switched-off toggle costs nothing.
   */
  setFps(fps: number, worstMs: number) {
    if (!this.fpsDisplay || !this.fpsVisible) return;
    // The worst frame time in the window is shown next to the average: a steady
    // 144 FPS that occasionally drops a 40 ms frame stutters, and this reveals it.
    this.fpsDisplay.textContent = `${fps} FPS · ${worstMs}ms`;
    this.fpsDisplay.classList.toggle('mid', fps < 50 && fps >= 30);
    this.fpsDisplay.classList.toggle('low', fps < 30);
  }

  /** Show/hide the FPS counter (bound to the F3 key). */
  toggleFps() {
    this.fpsVisible = !this.fpsVisible;
    this.applyFps();
  }

  get fpsIsVisible(): boolean { return this.fpsVisible; }

  private applyFps() {
    this.fpsDisplay.classList.toggle('hidden', !this.fpsVisible);
    try {
      localStorage.setItem(HUD.FPS_PREF, this.fpsVisible ? '1' : '0');
    } catch {
      // Storage can be unavailable (private mode / file://) — the toggle still works this session.
    }
  }

  private static readFpsPref(): boolean {
    try {
      return localStorage.getItem(HUD.FPS_PREF) !== '0';
    } catch {
      return true;
    }
  }

  /** Red screen-edge pulse each time the breach counter ticks up. */
  private flashBreach() {
    this.breachDisplay?.classList.add('flash');
    this.breachFlash?.classList.add('show');
    if (this.breachFlashTimeout) clearTimeout(this.breachFlashTimeout);
    this.breachFlashTimeout = setTimeout(() => {
      this.breachDisplay?.classList.remove('flash');
      this.breachFlash?.classList.remove('show');
    }, 150);
  }

  showAnnouncement(text: string) {
    this.announcement.textContent = text;
    this.announcement.classList.add('show');
    if (this.announceTimeout) clearTimeout(this.announceTimeout);
    this.announceTimeout = setTimeout(() => {
      this.announcement.classList.remove('show');
    }, 3000);
  }
}

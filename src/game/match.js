// Match: Round/Turn-Manager + Game-Loop-Bindung.
//
// State-Machine:
//   "aim"       — Spieler zielt + lädt Power. Input erlaubt.
//   "firing"    — Geschoss(e) fliegen. Eingabe aus.
//   "animating" — Explosion + Falling-Dirt + Falling-Tanks abwarten.
//   "gameover"  — Match ist entschieden.

import { createWeapon } from "./weapon.js";
import { AI } from "./ai.js";
import { Quote } from "./effects.js";

/** Zufälliger Spruch des Tanks + Sprechblase. Auch Menschen können Sprüche
 *  abgeben (wenn ihre Persönlichkeit welche hat). `talkingCPUs` ist global. */
function sayQuote(match, tank, quotes, weaponName, victimName) {
  if (!match.rules.talkingCPUs) return;
  if (!quotes || quotes.length === 0) return;
  let line = quotes[(Math.random() * quotes.length) | 0];
  // Original-Convention: %w = Waffenname, %t = Name des Opfers
  if (weaponName)  line = line.replace("%w", weaponName);
  if (victimName) line = line.replace("%t", victimName);
  match.effects.push(new Quote(tank, line));
}

export class Match {
  constructor({ dirtField, tanks, rules, width = 480, height = 320, rounds = 3, rng = Math.random }) {
    this.dirtField = dirtField;
    this.tanks = tanks;
    this.weapons = [];
    this.effects = [];
    this.rules = rules;
    this.width = width;
    this.height = height;
    this.rng = rng;
    this.round = 1;
    this.totalRounds = rounds;
    this.turn = 0;
    this.currentPlayerIndex = 0;
    this.wind = 0;
    this.state = "aim";
    this.winner = null;
    this.whiteoutFrames = 0;
    this.shake = 0;
    this.ai = new AI(this);
    /** True solange das gesamte Match läuft. Round-Ende setzt es nicht. */
    this._matchOver = false;
    this.onMatchOver = null;
    this.onRoundOver = null;
    this._initRound();
  }

  /** Wird beim Round-Wechsel von main.js aufgerufen (neue Karte ist schon
   *  geladen). Zählt die Match-Runde hoch und baut die Runde frisch auf. */
  beginNewRound() {
    this.round++;
    for (const t of this.tanks) {
      t.health = t.maxHealth;
      t.kills = 0;                 // Kills sind rundenbezogen für die KI/HUD
      t.cash = t.cash;             // Cash bleibt über Runden erhalten
      t.checkWeapon?.();
    }
    this._setupRound();
  }

  _initRound() {
    const hp = +this.rules.tankHealth || 100;
    for (const t of this.tanks) {
      t.maxHealth = hp;
      t.health = hp;
      t.checkWeapon?.();
    }
    this._setupRound();
  }

  /** Gemeinsamer Runden-Aufbau: Tanks neu verteilen, Spawn-Drop, Wind, State. */
  _setupRound() {
    this.weapons.length = 0;
    this.effects.length = 0;
    this.turn = 0;
    this.winner = null;
    this.whiteoutFrames = 0;
    this.shake = 0;

    const n = this.tanks.length;
    const spacing = this.width / (n + 1);
    this.tanks.forEach((t, i) => {
      t.x = Math.round((i + 1) * spacing);
      t.y = -10;                   // oberhalb der Map → fällt herab
      t.falling = false;
      t.fallVelocity = 0;
      t.hitThisFrame = false;
      t.fuel = this.rules.fuel ?? 0;
      t.cashAtTurnStart = t.cash;
      t.startFall(true);            // Spawn-Drop verursacht keinen Fallschaden
    });

    this.currentPlayerIndex = -1;
    this._advancePlayerCursor();
    this._rollWind();
    this.state = "aim";
  }

  _rollWind() {
    const max = this.rules.maxWind ?? 0;
    this.wind = (this.rng() * 2 - 1) * max;
  }

  currentTank() { return this.tanks[this.currentPlayerIndex] ?? null; }
  aliveTanks() { return this.tanks.filter(t => !t.isDead()); }

  /** True solange eine Sprechblase sichtbar ist — damit der Fast-Forward
   *  pausiert und CPU-Sprüche lesbar bleiben. */
  anyQuoteActive() { return this.effects.some((e) => e instanceof Quote); }

  /** Sucht den nächsten lebenden Spieler im Kreis. Setzt state="gameover",
   *  wenn keiner mehr lebt. Verändert NICHT this.round — die Match-Runde
   *  zählt nur beginNewRound hoch (Turn-Cycle ≠ Match-Runde!). */
  _advancePlayerCursor() {
    const n = this.tanks.length;
    const prevIdx = this.currentPlayerIndex;
    for (let step = 1; step <= n; step++) {
      const idx = (prevIdx + step + n) % n;
      if (!this.tanks[idx].isDead()) {
        this.currentPlayerIndex = idx;
        return;
      }
    }
    this._endMatch();
  }

  _endMatch() {
    this.state = "gameover";
    this._matchOver = true;
    // Match-Sieger ist der Spieler mit den meisten Round-Wins.
    let best = this.tanks[0];
    for (const t of this.tanks) {
      if (t.wins > best.wins) best = t;
    }
    this.winner = best;
    this.onMatchOver?.();
  }

  _endRound() {
    // Round-Sieger ist der letzte lebende oder mit meiste Health.
    const alive = this.aliveTanks();
    const roundWinner = alive.length === 1
      ? alive[0]
      : (alive.sort((a, b) => b.health - a.health)[0] ?? null);
    if (roundWinner) roundWinner.wins++;
    this._roundWinner = roundWinner;

    if (this.round >= this.totalRounds || alive.length === 0) {
      this._endMatch();
      return;
    }
    // Zwischen-Runden-State: main.js soll Karte neu laden + beginNewRound().
    this.state = "roundover";
    this.onRoundOver?.();
  }

  // -- API für die Eingabe ---------------------------------------------------

  isAcceptingInput() {
    return this.state === "aim" && this.dirtField.ready && this._allTanksSettled();
  }

  _allTanksSettled() {
    for (const t of this.tanks) {
      if (t.isDead()) continue;
      if (t.falling) return false;
    }
    return true;
  }

  fire(power) {
    if (!this.isAcceptingInput()) return false;
    const tank = this.currentTank();
    if (!tank || tank.isDead()) return false;
    const inv = tank.selectedWeaponEntry();
    if (!inv || (inv.count !== -1 && inv.count <= 0)) return false;
    // Spazbot-Effekt: 25% Chance, dass eine ZUFÄLLIGE Waffe rauskommt.
    // Original: Tank.fireWithPower:_ — wenn spazWeapons gesetzt sind.
    let key = inv.key;
    if (tank.spazWeapons && tank.spazWeapons.length > 0 && Math.random() < 0.25) {
      key = tank.spazWeapons[(Math.random() * tank.spazWeapons.length) | 0];
    }
    const cfg = { ...this.rules.weapons[key], _key: key };
    if (!cfg.type) { return false; }       // ungültige Spaz-Waffe → skippen
    const w = createWeapon(cfg, tank, this.rules);
    const tip = tank.barrelTip();
    w.fireFrom(tip.x, tip.y, tank.angle, power, tank.facingLeft);
    this.weapons.push(w);
    tank.consumeWeapon();
    if (cfg.launchSound) this.playSfx?.(cfg.launchSound);
    sayQuote(this, tank, tank.shotQuotes);    // CPU-Spruch beim Schuss
    this.state = "firing";
    this.turn++;
    return true;
  }

  /** Wird aus Weapon._applyImpact gerufen, sobald ein Tank stirbt.
   *  Killer-Quote + leicht versetzter Victim-Quote (Original-Pacing). */
  onTankKilled(victim, killer, weaponName) {
    if (killer && killer !== victim) {
      sayQuote(this, killer, killer.killQuotes, weaponName, victim.name);
    }
    setTimeout(() => {
      sayQuote(this, victim, victim.deathQuotes, weaponName);
    }, killer && killer !== victim ? 800 : 0);

    // Tank-Tod als ECHTE Explosion austragen (Original: Tank.explode.c spawnt
    // eine Death-Weapon mit Folgeschaden + getinteten Smoke). Wir simulieren
    // das mit einer kleinen Shell, die sofort explodiert.
    this._spawnDeathExplosion(victim);
  }

  _spawnDeathExplosion(tank) {
    const cfg = {
      type: "shell",
      damage: 25,
      blastRadius: 12,
      _key: "_deathExplosion",
      explosionTexture: "Explosion.png",
      smokeEnabled: false,
      dirtClods: 8,
    };
    const w = createWeapon(cfg, tank, this.rules);
    w.x = tank.x;
    w.y = tank.y - tank.height() * 0.5;
    w.xv = 0; w.yv = 0;
    // Skip Flight — direkt in Explosions-Phase
    w.exploding = true;
    w.currentRadius = 0;
    this.weapons.push(w);
  }

  // -- Game-Loop -------------------------------------------------------------

  tick() {
    if (this.state === "gameover" || this.state === "roundover") return;

    if (this.whiteoutFrames > 0) this.whiteoutFrames--;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 0.5);

    // KI agiert während "aim"
    this.ai?.tick();

    // Frame-Beginn: hitThisFrame zurücksetzen (sonst kann z.B. ein zweiter
    // Cluster-Splitter Tanks nicht mehr treffen).
    for (const t of this.tanks) t.hitThisFrame = false;

    // Terrain (Falling-Dirt)
    this.dirtField.advance();

    // Tanks: Falling, Geländeausrichtung.
    // Re-Adjust nur solange das Terrain noch NICHT ruht (während/nach
    // Explosionen) — sonst sparen wir die teure Hang-Regression jeden Frame
    // und vermeiden Mikro-Oszillation auf statischem Boden.
    const terrainSettling = !this.dirtField.ready;
    for (const t of this.tanks) {
      if (t.isDead()) continue;
      if (t.falling) { t.updateFalling(this.dirtField, this.rules); continue; }
      if (terrainSettling) {
        const ground = this.dirtField.getGroundLevelForX(t.x);
        if (ground - t.y > 4) t.startFall();   // Boden klar weg → fallen
        else t.adjustToTerrain(this.dirtField);
      }
    }

    // Waffen tickern
    for (let i = this.weapons.length - 1; i >= 0; i--) {
      const w = this.weapons[i];
      w.advance(this);
      if (w.isFinished()) this.weapons.splice(i, 1);
    }

    // Effects
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.advance?.(this);
      if (e.isFinished?.()) this.effects.splice(i, 1);
    }

    // State-Transitions
    if (this.state === "firing" && this.weapons.length === 0) {
      this.state = "animating";
    }
    if (this.state === "animating"
        && this.dirtField.ready
        && this._allTanksSettled()
        && this.effects.length === 0) {
      this._nextTurn();
    }
  }

  _nextTurn() {
    // Tote prüfen — bei nur noch einem Lebenden endet die RUNDE, nicht
    // zwingend das ganze Match (siehe _endRound).
    if (this.aliveTanks().length <= 1) {
      this._endRound();
      return;
    }
    const wasIdx = this.currentPlayerIndex;
    this._advancePlayerCursor();
    if (this.state === "gameover") return;

    // Wenn wir wieder bei Spieler 0 sind, war eine ganze Runde → Cash-Bonus
    if (this.currentPlayerIndex <= wasIdx) {
      for (const t of this.tanks) {
        if (t.isDead()) continue;
        const cap = t.cashAtTurnStart + this.rules.maxCashPerRound;
        t.cash = Math.min(t.cash + (this.rules.cashPerRoundIncrease ?? 0), cap);
      }
    }
    const cur = this.currentTank();
    if (cur) {
      cur.cashAtTurnStart = cur.cash;
      cur.fuel = this.rules.fuel ?? 0;
    }
    this._rollWind();
    this.state = "aim";
  }

  // -- Render ----------------------------------------------------------------

  render(ctx, assets) {
    for (const t of this.tanks) if (!t.isDead()) t.render(ctx);
    for (const w of this.weapons) w.render(ctx, assets);
    for (const e of this.effects) e.render?.(ctx, assets);
    // Aim-Indikator über aktivem Human-Spieler
    const cur = this.currentTank();
    if (cur && !cur.isDead() && cur.controller === 0 && this.state === "aim") {
      cur.renderAimIndicator(ctx, assets?.images?.get("Arrow.png"));
    }
    for (const t of this.tanks) if (!t.isDead()) t.renderUI(ctx, t === this.currentTank());
  }
}

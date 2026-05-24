// CPU-Spieler.
//
// Schwierigkeit (Tank.controller):
//   1 = Easy   — viel Streuung, kleine Power-Auflösung
//   2 = Medium — mittlere Streuung
//   3 = Hard   — präzise, viele Probeschüsse

import { POWER_SCALE, GRAVITY_FACTOR, WIND_FACTOR } from "./weapon.js";

const THINK_DELAY_TICKS = 24;     // ~0.8 s sichtbares "Nachdenken"
const DRIVE_TICKS_PER_TURN = 30;  // Maximum-Fahrleistung pro Turn

// Schuss-Fehler je Schwierigkeit: NACHDEM die ideale Lösung gefunden wurde,
// wird Winkel/Power verrauscht. Das bestimmt die echte Trefferquote — Easy
// streut deutlich, Hard trifft fast immer.
//   ang = Standard-Winkelfehler (Grad), pow = Standard-Power-Fehler.
const SHOT_ERROR = {
  1: { ang: 6.0, pow: 17 },   // Easy
  2: { ang: 2.6, pow: 8  },   // Medium
  3: { ang: 0.8, pow: 3  },   // Hard
};

// Dreieck-verteiltes Rauschen in [-1, 1] (Summe zweier Uniforms), damit kleine
// Fehler häufiger sind als große.
function gaussish() { return (Math.random() + Math.random()) - 1; }

export class AI {
  constructor(match) {
    this.match = match;
    this._thinking = 0;
    this._driveBudget = 0;
    this._lastTank = null;
  }

  tick() {
    const m = this.match;
    if (m.state !== "aim") { this._thinking = 0; this._lastTank = null; return; }
    const tank = m.currentTank();
    if (!tank || tank.controller === 0 || tank.isDead()) return;

    if (tank !== this._lastTank) {
      this._thinking = 0;
      this._driveBudget = DRIVE_TICKS_PER_TURN;
      this._lastTank = tank;
      // Einmal pro Turn: evtl. bessere Waffen kaufen + Waffe festlegen.
      this._maybeBuyWeapons(tank);
      tank.selectedWeapon = this._selectWeapon(tank);
    }
    this._thinking++;
    if (this._thinking < THINK_DELAY_TICKS) return;

    const target = this._selectTarget(tank);
    if (!target) { m.fire(50); return; }

    // Ggf. erst fahren, wenn keine gute Lösung von hier
    if (this._driveBudget > 0 && tank.fuel > 0) {
      const probe = this._findSolution(tank, target);
      // Wenn Treffer schon gut (< target.width/2), nicht mehr fahren
      const wantDrive = probe.dist > target.width() * 0.5;
      if (wantDrive) {
        const dir = target.x < tank.x ? -1 : +1;
        if (tank.drive(dir, m.dirtField, m.tanks, m.rules)) {
          this._driveBudget--;
          // Eine Bewegung pro Tick — nächster Tick weiter
          return;
        }
      }
    }

    // Ideale Lösung berechnen, dann je Schwierigkeit verrauschen → echte
    // Trefferquote: Easy streut stark, Hard trifft fast immer.
    const solution = this._findSolution(tank, target);
    const err = SHOT_ERROR[tank.controller] || SHOT_ERROR[2];
    let angle = solution.angle + gaussish() * err.ang * Math.PI / 180;
    let power = solution.power + gaussish() * err.pow;
    angle = Math.max(6 * Math.PI / 180, Math.min(89 * Math.PI / 180, angle));
    power = Math.max(12, Math.min(100, power));
    tank.angle = angle;
    tank.facingLeft = solution.facingLeft;
    m.fire(power);
  }

  // -------------------------------------------------------------------------

  _selectTarget(tank) {
    const enemies = this.match.tanks.filter((t) => t !== tank && !t.isDead());
    if (enemies.length === 0) return null;
    // Easy: zufällig; Medium/Hard: nächster
    if (tank.controller === 1) {
      return enemies[(Math.random() * enemies.length) | 0];
    }
    enemies.sort((a, b) => Math.abs(a.x - tank.x) - Math.abs(b.x - tank.x));
    return enemies[0];
  }

  _selectWeapon(tank) {
    const usable = [];
    for (let i = 0; i < tank.weapons.length; i++) {
      if (tank.weapons[i].count !== 0) usable.push(i);
    }
    if (usable.length === 0) return 0;
    const limited = usable.filter((i) => tank.weapons[i].count > 0);
    const diff = tank.controller;
    // Wahrscheinlichkeit, eine begrenzte (gekaufte/stärkere) Waffe statt der
    // ∞-Standard-Mortar zu nehmen — steigt mit der Schwierigkeit.
    const pSpecial = diff === 1 ? 0.3 : diff === 2 ? 0.6 : 0.9;
    if (limited.length > 0 && Math.random() < pSpecial) {
      if (diff >= 3) {
        // Hard: die stärkste verfügbare Waffe.
        let best = limited[0], bestScore = -Infinity;
        for (const i of limited) {
          const s = this._weaponScore(tank.weapons[i].key);
          if (s > bestScore) { bestScore = s; best = i; }
        }
        return best;
      }
      return limited[(Math.random() * limited.length) | 0];
    }
    return usable[(Math.random() * usable.length) | 0];
  }

  /** Grobe Stärke einer Waffe (für KI-Wahl/-Kauf): Schaden × Blast + Preis. */
  _weaponScore(key) {
    const w = this.match.rules.weapons[key];
    if (!w) return 0;
    return (+w.damage || 0) * (+w.blastRadius || 1) + (+w.price || 0) * 0.05;
  }

  /** Einmal pro Turn: die CPU kauft je nach Schwierigkeit Waffen.
   *  Easy kauft selten und billig, Hard fast immer das Stärkste, das es sich
   *  leisten kann. (Menschliche Spieler nutzen stattdessen den Shop.) */
  _maybeBuyWeapons(tank) {
    const diff = tank.controller;
    if (diff <= 0) return;
    const pBuy = diff === 1 ? 0.15 : diff === 2 ? 0.5 : 0.9;
    if (Math.random() > pBuy) return;

    const buyable = Object.entries(this.match.rules.weapons)
      .filter(([, w]) => +w.price > 0)
      .map(([k, w]) => ({ k, price: +w.price, score: this._weaponScore(k) }));
    if (buyable.length === 0) return;

    // Easy: billigste zuerst; Medium/Hard: stärkste zuerst.
    buyable.sort((a, b) => (diff === 1 ? a.price - b.price : b.score - a.score));

    let budget = tank.cash * (diff === 1 ? 0.4 : diff === 2 ? 0.75 : 1.0);
    const maxBuys = diff === 1 ? 1 : diff === 2 ? 2 : 4;
    let buys = 0;
    for (const item of buyable) {
      if (buys >= maxBuys) break;
      if (item.price > budget || item.price > tank.cash) continue;
      tank.cash -= item.price;
      budget -= item.price;
      const ex = tank.weapons.find((w) => w.key === item.k);
      if (ex && ex.count !== -1) ex.count++;
      else if (!ex) tank.weapons.push({ key: item.k, count: 1 });
      buys++;
    }
  }

  _findSolution(tank, target) {
    const difficulty = tank.controller;       // 1..3
    // Auf die Tank-Mitte zielen; die Streuung kommt aus dem Schussfehler
    // (SHOT_ERROR) in tick(), nicht mehr aus einem Ziel-Versatz.
    const aimX = target.x;
    const aimY = target.y - target.height() * 0.5;

    const facingLeft = aimX < tank.x;

    // Anzahl Probeschüsse abhängig von Schwierigkeit
    const angleSteps = difficulty === 1 ? 9  : difficulty === 2 ? 13 : 17;
    const powerStep  = difficulty === 1 ? 8  : difficulty === 2 ? 5  : 3;
    const angles = [];
    for (let deg = 18; deg <= 84; deg += (66 / (angleSteps - 1))) {
      angles.push(deg * Math.PI / 180);
    }

    let best = null;
    let bestDist = Infinity;
    for (const angle of angles) {
      for (let power = 25; power <= 100; power += powerStep) {
        const landing = this._simulate(tank, angle, power, facingLeft);
        if (!landing) continue;
        const dx = landing.x - aimX;
        const dy = landing.y - aimY;
        const dist = Math.hypot(dx, dy);
        if (dist < bestDist) {
          bestDist = dist;
          best = { angle, power, facingLeft, dist };
          if (dist < target.width() * 0.4) return best;
        }
      }
    }
    return best ?? { angle: Math.PI / 4, power: 60, facingLeft, dist: Infinity };
  }

  /** Simuliert eine Flugbahn mit aktueller Wind/Gravity-Konfiguration. */
  _simulate(tank, angle, power, facingLeft) {
    const barrelLen = 11;
    const baseX = tank.x;
    const baseY = tank.y - tank.height() * 0.6;
    const dir = facingLeft ? -1 : 1;
    let x = baseX + dir * Math.cos(angle) * barrelLen;
    let y = baseY + -Math.sin(angle) * barrelLen;
    let xv = dir * Math.cos(angle) * power * POWER_SCALE;
    let yv = -Math.sin(angle) * power * POWER_SCALE;

    const g = this.match.rules.gravity * GRAVITY_FACTOR;
    const w = this.match.wind * WIND_FACTOR;
    const dirt = this.match.dirtField;
    const W = this.match.width, H = this.match.height;

    for (let i = 0; i < 600; i++) {
      x += xv; y += yv;
      xv += w; yv += g;
      if (y > H + 50 || x < -100 || x > W + 100) return null;
      if (dirt.isSolid(x, y)) return { x, y };
    }
    return null;
  }
}

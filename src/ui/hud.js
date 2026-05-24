// HUD: oberer Streifen mit Wind, aktivem Spieler und Aim.
// Power-Bar unten links während des Ladens.

import { t } from "../i18n/index.js";
import { settings } from "./settings.js";
import { POWER_SCALE, GRAVITY_FACTOR, WIND_FACTOR } from "../game/weapon.js";

const WIDTH = 480;
const HEIGHT = 320;

/** Geldbetrag mit Tausender-Trennzeichen (de-DE: 1.234.567). */
export function fmtCash(n) {
  return Math.round(n || 0).toLocaleString("de-DE");
}

/** Pro Tick ein Stück mehr Power. Original-Chrome lädt mit ~0.75/Frame bei
 *  ~60 Hz; bei unserem 30-Hz-Tick entspricht das 1.5/Tick → volle Ladung in
 *  ~67 Ticks (~2.2 s). Power 100 = Auto-Fire. */
const POWER_GAIN_PER_TICK = 1.5;

export class Hud {
  constructor(match, assets = null) {
    this.match = match;
    this.assets = assets;
    this.power = 0;
    this.charging = false;
  }

  startCharging() {
    if (!this.match.isAcceptingInput()) return;
    this.charging = true;
    this.power = 0;
    // Einmaliger Power-Alert (Original: GameState.shotPowerAlertDisplayed)
    if (!localStorage.getItem("ishoot.tip.power")) {
      try { localStorage.setItem("ishoot.tip.power", "1"); } catch {}
      this._showPowerTip = 90;   // 3 s sichtbar
    }
  }

  /** @returns die geladene Power (oder 0, wenn nichts geladen war). */
  releaseCharge() {
    if (!this.charging) return 0;
    const p = this.power;
    this.charging = false;
    this.power = 0;
    return p;
  }

  tick() {
    if (this.charging) {
      this.power += POWER_GAIN_PER_TICK;
      if (this.power >= 100) {
        // Vollladung → automatisch feuern (Original-Verhalten).
        this.power = 100;
        const p = this.releaseCharge();
        this.match.fire(p);
      }
    }
  }

  render(ctx) {
    const m = this.match;
    const cur = m.currentTank();

    ctx.save();
    ctx.font = "10px ui-monospace, Menlo, monospace";
    ctx.textBaseline = "alphabetic";

    // Cheat mode: draw the exact predicted trajectory (wind + angle).
    if (settings.cheat) this._drawTrajectory(ctx);

    // Oberer Streifen kompakt in 8px; unten wird wieder auf 10px gesetzt.
    ctx.font = "8px ui-monospace, Menlo, monospace";

    // -- Top-Center: Wind
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(WIDTH / 2 - 28, 2, 56, 12);
    ctx.fillStyle = "#fff";
    ctx.fillText(t("hud.wind", { v: m.wind.toFixed(1) }), WIDTH / 2, 10);
    this._drawWindArrow(ctx, WIDTH / 2, 20, m.wind);

    // Linke Kante des Waffennamen-Felds (unten rechts) — für die Platzierung
    // der zentrierten Runde/Turn-Anzeige weiter unten. Default: kein Feld.
    let weaponBoxLeft = WIDTH;

    if (cur) {
      // -- Top-Left: Aktiver Spieler (Name, HP/Cash, Fuel-Balken)
      ctx.textAlign = "start";
      const boxW = 128;
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(2, 2, boxW, 33);
      const c = cur.color;
      ctx.fillStyle = `rgb(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0})`;
      ctx.fillText(cur.name, 5, 10);
      ctx.fillStyle = "#fff";
      ctx.fillText(`${t("hud.hp")} ${cur.health.toFixed(0)}   $${fmtCash(cur.cash)}`, 5, 20);

      // Fuel-Balken (analog zur HP-Bar über den Tanks).
      const maxFuel = m.rules.fuel ?? 0;
      ctx.fillStyle = "#fff";
      ctx.fillText(t("hud.fuel"), 5, 30);
      const fbX = 28, fbY = 25, fbW = 74, fbH = 5;
      ctx.fillStyle = "rgba(255,255,255,.18)";
      ctx.fillRect(fbX, fbY, fbW, fbH);
      if (maxFuel > 0) {
        const fr = Math.max(0, Math.min(1, cur.fuel / maxFuel));
        ctx.fillStyle = fr > 0.4 ? "#4fb6e6" : fr > 0.15 ? "#e6c44a" : "#e64a4a";
        ctx.fillRect(fbX, fbY, fbW * fr, fbH);
      }
      ctx.textAlign = "end";
      ctx.fillStyle = "#cfe8f5";
      ctx.fillText(String(cur.fuel | 0), 2 + boxW - 4, 30);
      ctx.textAlign = "start";

      // -- Top-Right: Aim
      const angleDeg = Math.round(cur.angle * 180 / Math.PI);
      ctx.textAlign = "end";
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(WIDTH - 62, 2, 60, 12);
      ctx.fillStyle = "#fff";
      ctx.fillText(`${t("hud.aim", { deg: angleDeg })} ${cur.facingLeft ? "◀" : "▶"}`, WIDTH - 5, 10);

      // Ab hier wieder normale 10px-Schrift (Waffenfeld unten rechts).
      ctx.font = "10px ui-monospace, Menlo, monospace";

      // -- Selected Weapon: [Sprite] | Name  Munition — dynamische Breite,
      //    rechtsbündig, Bild vertikal zentriert. Bei ∞ kein "×".
      const wkey = cur.selectedWeaponKey();
      if (wkey) {
        const cfg = m.rules.weapons[wkey];
        const inv = cur.selectedWeaponEntry();
        const ammoText = inv?.count === -1 ? "∞" : `×${inv?.count}`;
        const label = (cfg && cfg.name) ? cfg.name : wkey;
        const text = `${label}  ${ammoText}`;
        const img = cfg?.image ? this.assets?.images?.get(cfg.image) : null;

        const PAD = 6, GAP = 5, BOXH = 16;
        let imgW = 0, imgH = 0;
        if (img) { imgW = Math.min(img.width, 20); imgH = img.height * (imgW / img.width); }
        const sep = img ? "|" : "";
        const sepW = img ? ctx.measureText(sep).width + GAP * 2 : 0;
        const textW = ctx.measureText(text).width;
        const boxW = PAD + imgW + sepW + textW + PAD;
        const boxX = WIDTH - 2 - boxW;
        weaponBoxLeft = boxX;
        const boxY = HEIGHT - 2 - BOXH;
        const cy = boxY + BOXH / 2;

        ctx.fillStyle = "rgba(0,0,0,.55)";
        ctx.fillRect(boxX, boxY, boxW, BOXH);

        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        let cx = boxX + PAD;
        if (img) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, cx, cy - imgH / 2, imgW, imgH);
          cx += imgW + GAP;
          ctx.fillStyle = "#888";
          ctx.fillText(sep, cx, cy);
          cx += ctx.measureText(sep).width + GAP;
        }
        ctx.fillStyle = "#fff";
        ctx.fillText(text, cx, cy);
        ctx.textBaseline = "alphabetic";
      }
    }

    // -- Power-Tip (Original: einmaliger Hint beim ersten Schuss)
    if (this._showPowerTip > 0) {
      this._showPowerTip--;
      ctx.fillStyle = "rgba(0,0,0,.75)";
      ctx.fillRect(WIDTH / 2 - 130, HEIGHT - 78, 260, 28);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffd06b";
      ctx.fillText(t("hud.powerTip1"), WIDTH / 2, HEIGHT - 66);
      ctx.fillStyle = "#aaa";
      ctx.fillText(t("hud.powerTip2"), WIDTH / 2, HEIGHT - 56);
    }

    // -- Power-Bar links unten (Zahl zentriert unter der Bar)
    if (this.charging || this.power > 0) {
      const barW = 12, barH = 56;
      const barX = 8;
      const barY = HEIGHT - 16 - barH;        // Platz für die Zahl darunter
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
      const ratio = Math.max(0, Math.min(1, this.power / 100));
      ctx.fillStyle = ratio < 0.5 ? "#5ec46d" : ratio < 0.85 ? "#e6c44a" : "#e64a4a";
      const fillH = barH * ratio;
      ctx.fillRect(barX, barY + barH - fillH, barW, fillH);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#fff";
      ctx.fillText(`${this.power.toFixed(0)}`, barX + barW / 2, barY + barH + 3);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }

    // -- Round/Turn Info: grundsätzlich mittig. Würde der zentrierte Text das
    //    rechte Waffennamen-Feld überlappen, rückt er so weit nach links, dass
    //    er gerade davor passt (aber nicht über den linken Rand hinaus).
    {
      ctx.font = "9px ui-monospace, Menlo, monospace";
      const rtText = t("hud.round", { r: m.round, t: m.totalRounds, n: m.turn });
      const rtW = ctx.measureText(rtText).width;
      const padX = 5, boxH = 13;
      const half = rtW / 2 + padX;
      let cx = WIDTH / 2;
      // Mittig, weicht aber nach links aus, falls das Feld das Waffennamen-Feld
      // berühren würde (nicht über den linken Rand hinaus).
      if (cx + half > weaponBoxLeft - 4) cx = (weaponBoxLeft - 4) - half;
      cx = Math.max(half + 2, cx);
      const boxY = HEIGHT - 2 - boxH;
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(cx - rtW / 2 - padX, boxY, rtW + padX * 2, boxH);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.fillText(rtText, cx, boxY + boxH / 2 + 0.5);
      ctx.textBaseline = "alphabetic";
    }

    // -- Round-Over Overlay (Zwischenrunde)
    if (m.state === "roundover") {
      ctx.fillStyle = "rgba(0,0,0,.6)";
      ctx.fillRect(0, HEIGHT / 2 - 30, WIDTH, 60);
      ctx.textAlign = "center";
      ctx.font = "14px ui-monospace, Menlo, monospace";
      ctx.fillStyle = "#ffd06b";
      const w = m._roundWinner;
      ctx.fillText(w ? t("hud.roundWin", { r: m.round, w: w.name }) : t("hud.roundEnd", { r: m.round }), WIDTH / 2, HEIGHT / 2);
      ctx.fillStyle = "#fff";
      ctx.font = "10px ui-monospace, Menlo, monospace";
      // Punktestand
      const score = m.tanks.map((t) => `${t.name}: ${t.wins}`).join("   ");
      ctx.fillText(score, WIDTH / 2, HEIGHT / 2 + 16);
    }

    // -- Game-Over Overlay
    if (m.state === "gameover") {
      ctx.fillStyle = "rgba(0,0,0,.7)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.textAlign = "center";
      ctx.font = "16px ui-monospace, Menlo, monospace";
      ctx.fillStyle = "#fff";
      const msg = m.winner ? t("hud.matchWin", { name: m.winner.name }) : t("hud.allDefeated");
      ctx.fillText(msg, WIDTH / 2, HEIGHT / 2 - 10);
      ctx.font = "10px ui-monospace, Menlo, monospace";
      ctx.fillStyle = "#fff";
      const score = m.tanks.map((t) => `${t.name}: ${t.wins}W ${t.kills}K`).join("   ");
      ctx.fillText(score, WIDTH / 2, HEIGHT / 2 + 12);
      ctx.fillStyle = "#bbb";
      ctx.fillText(t("hud.gameOverHint"), WIDTH / 2, HEIGHT / 2 + 30);
    }

    ctx.restore();
  }

  /** Cheat mode: predicted shot path using the exact weapon physics
   *  (semi-implicit Euler with wind + gravity). Updates live while charging. */
  _drawTrajectory(ctx) {
    const m = this.match;
    const cur = m.currentTank?.();
    if (!cur || cur.isDead() || cur.controller !== 0 || m.state !== "aim") return;
    const power = this.charging ? this.power : 60;
    if (power <= 0) return;
    const tip = cur.barrelTip();
    const dir = cur.facingLeft ? -1 : 1;
    let x = tip.x, y = tip.y;
    let xv = dir * Math.cos(cur.angle) * power * POWER_SCALE;
    let yv = -Math.sin(cur.angle) * power * POWER_SCALE;
    const g = m.rules.gravity * GRAVITY_FACTOR;
    const w = m.wind * WIND_FACTOR;
    ctx.save();
    ctx.fillStyle = "rgba(140,255,170,.9)";
    for (let i = 0; i < 400; i++) {
      x += xv; y += yv; xv += w; yv += g;
      if (x < -20 || x > m.width + 20 || y > m.height + 20) break;
      if (y >= 0 && m.dirtField.isSolid(x, y)) break;
      if (i % 4 === 0) ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    }
    ctx.restore();
  }

  _drawWindArrow(ctx, cx, cy, wind) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,200,.85)";
    ctx.lineWidth = 1.2;
    const dir = Math.sign(wind);
    const len = Math.min(34, Math.abs(wind) * 0.7);
    if (len < 0.5) {
      ctx.beginPath();
      ctx.moveTo(cx - 3, cy);
      ctx.lineTo(cx + 3, cy);
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(cx - dir * len, cy);
    ctx.lineTo(cx + dir * len, cy);
    ctx.lineTo(cx + dir * (len - 3), cy - 2);
    ctx.moveTo(cx + dir * len, cy);
    ctx.lineTo(cx + dir * (len - 3), cy + 2);
    ctx.stroke();
    ctx.restore();
  }
}

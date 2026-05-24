// Title-Screen — wird vor dem Setup-Menü angezeigt. Hat einen drehenden
// Tank links und Buttons rechts (Neues Spiel / Laden / Bestenliste / Hilfe).

import { drawSprite, tintSprite } from "../engine/render.js";
import { t } from "../i18n/index.js";

const W = 480, H = 320;

const TANK_DEMO_STYLES = [
  { body: "M1A2.png",     barrel: "M1A2-barrel.png",     color: { r: 0.7, g: 0.4, b: 1.0 } },
  { body: "Crusader.png", barrel: "Crusader-barrel.png", color: { r: 0.3, g: 1.0, b: 0.6 } },
  { body: "Panzer.png",   barrel: "Panzer-barrel.png",   color: { r: 1.0, g: 0.7, b: 0.3 } },
];

export class Title {
  constructor({ assets, onNewGame, onLoad, onSettings, onShowProfiles, onShowHelp }) {
    this.assets = assets;
    this.onNewGame = onNewGame;
    this.onLoad = onLoad;
    this.onSettings = onSettings;
    this.onShowProfiles = onShowProfiles;
    this.onShowHelp = onShowHelp;
    this.el = document.getElementById("title");
    this.canvas = document.getElementById("title-canvas");
    this.ctx = this.canvas?.getContext("2d") ?? null;
    this._animFrame = 0;
    this._raf = 0;
    this._styleIndex = 0;
    this._styleTimer = 0;
    // Hintergrundbild (Castle-Bravo-Atompilz) laden
    this._bg = new Image();
    this._bgReady = false;
    this._bg.onload = () => { this._bgReady = true; };
    this._bg.src = "./assets/ui/background.jpg";
    document.getElementById("title-newgame").addEventListener("click", () => { this.hide(); this.onNewGame?.(); });
    document.getElementById("title-load").addEventListener("click", () => this.onLoad?.());
    document.getElementById("title-settings").addEventListener("click", () => this.onSettings?.());
    document.getElementById("title-profiles").addEventListener("click", () => this.onShowProfiles?.());
    document.getElementById("title-help").addEventListener("click", () => this.onShowHelp?.());

    // Keyboard menu navigation: arrows move focus between the buttons; Enter /
    // Space activate the focused button natively. Only active while the title
    // is visible, so it never interferes with in-game driving (← / →).
    this._buttons = [...document.querySelectorAll("#title-buttons button")];
    window.addEventListener("keydown", (e) => {
      if (this.el.hidden) return;
      const nav = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"];
      if (!nav.includes(e.key)) return;
      e.preventDefault();
      const btns = this._buttons;
      if (!btns.length) return;
      const i = btns.indexOf(document.activeElement);
      let next;
      if (e.key === "Home") next = 0;
      else if (e.key === "End") next = btns.length - 1;
      else if (e.key === "ArrowDown" || e.key === "ArrowRight") next = i < 0 ? 0 : (i + 1) % btns.length;
      else next = i < 0 ? 0 : (i - 1 + btns.length) % btns.length;
      btns[next]?.focus();
    });
  }

  show() {
    this.el.hidden = false;
    this._loop();
  }

  hide() {
    this.el.hidden = true;
    cancelAnimationFrame(this._raf);
  }

  _loop = () => {
    if (this.el.hidden) return;
    this._animFrame++;
    this._styleTimer++;
    if (this._styleTimer > 180) {
      this._styleTimer = 0;
      this._styleIndex = (this._styleIndex + 1) % TANK_DEMO_STYLES.length;
    }
    this._render();
    this._raf = requestAnimationFrame(this._loop);
  };

  _render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const cw = this.canvas.width, ch = this.canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    // Hintergrund: Castle-Bravo-Atompilz, cover-skaliert. Fallback Gradient.
    if (this._bgReady) {
      const iw = this._bg.width, ih = this._bg.height;
      const scale = Math.max(cw / iw, ch / ih);
      const dw = iw * scale, dh = ih * scale;
      ctx.drawImage(this._bg, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      // dezente Abdunkelung für Lesbarkeit der Buttons/Titel
      ctx.fillStyle = "rgba(0,0,0,.28)";
      ctx.fillRect(0, 0, cw, ch);
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, ch);
      grad.addColorStop(0, "#1a1438");
      grad.addColorStop(0.6, "#943c33");
      grad.addColorStop(1, "#f5a23a");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, cw, ch);
    }

    // Demo-Tank unten (über dem Bild, ohne Boden-Streifen damit das Foto sichtbar bleibt)
    const def = TANK_DEMO_STYLES[this._styleIndex];
    const body = this.assets.images.get(def.body);
    const barrel = this.assets.images.get(def.barrel);
    if (body && barrel) {
      const tinted = tintSprite(body, def.color.r, def.color.g, def.color.b);
      const tBarrel = tintSprite(barrel, def.color.r, def.color.g, def.color.b);
      const cx = cw / 2;
      const cy = ch - 24;
      const aimDeg = 30 + Math.sin(this._animFrame * 0.02) * 25;
      const aimRad = aimDeg * Math.PI / 180;
      drawSprite(ctx, tinted, cx, cy, { anchorX: 0.5, anchorY: 1, scaleX: 3, scaleY: 3 });
      ctx.save();
      ctx.translate(cx, cy - tinted.height * 3 * 0.6);
      ctx.rotate(Math.PI / 2 - aimRad);
      ctx.drawImage(tBarrel, -tBarrel.width * 3 / 2, -tBarrel.height * 3, tBarrel.width * 3, tBarrel.height * 3);
      ctx.restore();
    }

    // Titel-Text
    ctx.font = "bold 36px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowOffsetY = 2;
    ctx.fillText("iShoot", this.canvas.width / 2, 64);
    ctx.shadowColor = "transparent";
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = "#ffe5b3";
    ctx.fillText(t("title.tagline"), this.canvas.width / 2, 84);
  }
}

// Partikel/Effekte: Dirt-Clods nach Explosionen.
//
// Clods fliegen ballistisch durch die Luft und landen als 1px-Boden.

const GRAVITY_FACTOR = 0.0015;

export class DirtClod {
  constructor(x, y, xv, yv, color = [120, 80, 40]) {
    this.x = x;
    this.y = y;
    this.xv = xv;
    this.yv = yv;
    this.color = color;
    this.finished = false;
    this._frames = 0;
  }

  isFinished() { return this.finished; }

  advance(match) {
    this.x += this.xv;
    this.y += this.yv;
    this.yv += match.rules.gravity * GRAVITY_FACTOR;
    this._frames++;
    if (this._frames > 240) { this.finished = true; return; }
    if (this.y > match.height + 50 || this.x < -10 || this.x > match.width + 10) {
      this.finished = true;
      return;
    }
    if (match.dirtField.isSolid(this.x, this.y)) {
      // Auf Boden landen → Pixel platzieren
      const col = Math.round(this.x * match.dirtField.pixelWidthOverLogicalWidth);
      match.dirtField.addClod(col, this.color[0], this.color[1], this.color[2]);
      this.finished = true;
    }
  }

  render(ctx) {
    if (this.finished) return;
    ctx.fillStyle = `rgb(${this.color[0]},${this.color[1]},${this.color[2]})`;
    ctx.fillRect(this.x | 0, this.y | 0, 1, 1);
  }
}

/**
 * Sprechblase über einem Tank — verblasst nach ~2.5 s.
 */
export class Quote {
  constructor(tank, text, lifetimeTicks = 75) {
    this.tank = tank;
    this.text = text;
    this.lifetime = lifetimeTicks;
    this.age = 0;
    this.finished = false;
  }
  isFinished() { return this.finished; }
  advance() {
    this.age++;
    if (this.age >= this.lifetime || this.tank.isDead()) this.finished = true;
  }
  render(ctx) {
    if (this.finished || this.tank.isDead()) return;
    const t = this.tank;
    const fadeIn  = Math.min(1, this.age / 5);
    const fadeOut = Math.min(1, (this.lifetime - this.age) / 10);
    const alpha = Math.max(0, Math.min(fadeIn, fadeOut));

    ctx.save();
    ctx.font = "9px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    // Wortumbruch: die Blase wird mehrzeilig, damit der weiße Hintergrund den
    // (je nach Sprache unterschiedlich langen) Text immer vollständig umschließt.
    const MAX_W = 150, PADX = 5, PADY = 3, LINE_H = 11;
    const lines = wrapText(ctx, this.text, MAX_W);
    let textW = 0;
    for (const ln of lines) textW = Math.max(textW, ctx.measureText(ln).width);
    const boxW = Math.ceil(textW + PADX * 2);
    const boxH = lines.length * LINE_H + PADY * 2;

    const tipX = t.x;                                  // Schwanz zeigt auf den Tank
    const bottom = t.y - t.height() - 16;              // Unterkante der Blase
    const top = bottom - boxH;
    // Mitte der Blase, am Bildrand eingeklemmt, damit sie nicht abgeschnitten wird.
    const cx = Math.max(boxW / 2 + 2, Math.min(478 - boxW / 2, tipX));

    // Hintergrund
    ctx.globalAlpha = alpha * 0.85;
    ctx.fillStyle = "#fff";
    ctx.fillRect(cx - boxW / 2, top, boxW, boxH);
    // Schwanz zur Tank-Spitze
    ctx.beginPath();
    ctx.moveTo(tipX - 3, bottom);
    ctx.lineTo(tipX, bottom + 3);
    ctx.lineTo(tipX + 3, bottom);
    ctx.closePath();
    ctx.fill();
    // Text (zeilenweise)
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#111";
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], cx, top + PADY + (i + 1) * LINE_H - 2);
    }
    ctx.restore();
  }
}

/** Bricht text an Wortgrenzen so um, dass keine Zeile breiter als maxW ist. */
function wrapText(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [String(text)];
  const lines = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? cur + " " + word : word;
    if (cur && ctx.measureText(test).width > maxW) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Schwebende Schadenszahl an der Trefferstelle, blendet nach oben aus. */
export class FloatingDamage {
  constructor(x, y, amount) {
    this.x = x;
    this.y = y;
    this.amount = Math.round(amount);
    this.age = 0;
    this.lifetime = 45;
    this.finished = false;
  }
  isFinished() { return this.finished; }
  advance() {
    this.age++;
    this.y -= 0.5;                       // schwebt nach oben
    if (this.age >= this.lifetime) this.finished = true;
  }
  render(ctx) {
    if (this.finished) return;
    const alpha = Math.max(0, 1 - this.age / this.lifetime);
    ctx.save();
    ctx.font = "bold 11px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    // Farbe je nach Schadenshöhe
    const col = this.amount >= 40 ? "255,90,70" : this.amount >= 15 ? "255,180,70" : "255,230,140";
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
    ctx.strokeText(`-${this.amount}`, this.x, this.y);
    ctx.fillStyle = `rgba(${col},${alpha})`;
    ctx.fillText(`-${this.amount}`, this.x, this.y);
    ctx.restore();
  }
}

/** Spawnt N Clods explosionsförmig aus (x,y). */
export function spawnClods(match, x, y, count, color = [120, 80, 40], speed = 2.5) {
  if (!match.rules.dirtClods) return;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI;                  // 0..π (nach oben)
    const s = speed * (0.5 + Math.random() * 0.8);
    const sign = Math.random() < 0.5 ? -1 : 1;
    const xv = Math.cos(a) * s * sign;
    const yv = -Math.abs(Math.sin(a) * s) - 0.5;
    match.effects.push(new DirtClod(x, y, xv, yv, color));
  }
}

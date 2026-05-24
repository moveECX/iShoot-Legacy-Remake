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
    const x = t.x;
    const y = t.y - t.height() - 26;
    const fadeIn  = Math.min(1, this.age / 5);
    const fadeOut = Math.min(1, (this.lifetime - this.age) / 10);
    const alpha = Math.max(0, Math.min(fadeIn, fadeOut));

    ctx.save();
    ctx.font = "9px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const w = Math.min(160, ctx.measureText(this.text).width + 8);
    const h = 13;
    // Hintergrund
    ctx.globalAlpha = alpha * 0.85;
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - w / 2, y - h, w, h);
    // Schwanz zur Tank-Spitze
    ctx.beginPath();
    ctx.moveTo(x - 3, y);
    ctx.lineTo(x, y + 3);
    ctx.lineTo(x + 3, y);
    ctx.closePath();
    ctx.fill();
    // Text
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#111";
    ctx.fillText(this.text, x, y - 3);
    ctx.restore();
  }
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

// Tank: Position, Aim, Health, Sprite (Body + Barrel mit Tank-Farbe getintet),
// Hang-Ausrichtung, Fahren, Schaden, freier Fall nach Boden-Wegsprengen.

import { tintSprite } from "../engine/render.js";

const STYLE_SPRITES = [
  { body: "M1A2.png",     barrel: "M1A2-barrel.png" },
  { body: "Crusader.png", barrel: "Crusader-barrel.png" },
  { body: "Panzer.png",   barrel: "Panzer-barrel.png" },
];

const DRIVE_STEP = 1;        // Pixel pro Tick
const MAX_CLIMB_NORMAL = 1.5;
const MAX_CLIMB_STEEP  = 4;  // wenn rules.steepDriving=true
const FALL_GRAVITY = 0.3;
const FALL_KILL_Y = 380;

export class Tank {
  constructor({ name, x, y, color, style = 0, controller = 0 }) {
    this.name = name;
    this.x = x;
    this.y = y;
    /** Tank-Farbe als floats in [0,1] */
    this.color = color || { r: 0.7, g: 0.7, b: 0.7 };
    this.style = style;
    /** 0 = human, >0 = CPU difficulty */
    this.controller = controller;
    this.health = 100;
    this.maxHealth = 100;
    this.angle = Math.PI / 4;          // 45° default
    this.bodyAngle = 0;                // wird aus DirtField berechnet
    this.facingLeft = false;
    this.fuel = 0;
    this.cash = 0;
    this.cashAtTurnStart = 0;
    this.kills = 0;
    this.deaths = 0;
    this.wins = 0;
    /** [{ key, count }] — count=-1 für unbegrenzt */
    this.weapons = [];
    this.selectedWeapon = 0;
    /** Sprüche (gesetzt von der Persönlichkeit) */
    this.shotQuotes = [];
    this.killQuotes = [];
    this.deathQuotes = [];
    /** Per-Frame-Flag, damit eine einzelne Submunition nicht zweimal trifft */
    this.hitThisFrame = false;
    this.falling = false;
    this.fallVelocity = 0;
    this.fellFromY = 0;
    this._tintedBody = null;
    this._tintedBarrel = null;
  }

  /** Lädt + tintet die Sprite-Variante für diesen Tank. Einmal vor dem Spiel. */
  setSprites(assets) {
    const def = STYLE_SPRITES[this.style] ?? STYLE_SPRITES[0];
    const body = assets.getImage(def.body);
    const barrel = assets.getImage(def.barrel);
    this._tintedBody = tintSprite(body, this.color.r, this.color.g, this.color.b);
    this._tintedBarrel = tintSprite(barrel, this.color.r, this.color.g, this.color.b);
  }

  width()  { return this._tintedBody?.width  ?? 28; }
  height() { return this._tintedBody?.height ?? 10; }

  /** Logische Bounding-Box des Tank-Körpers. Anchor: bottom-center bei (x,y). */
  getBounds() {
    const w = this.width(), h = this.height();
    return { x: this.x - w / 2, y: this.y - h, w, h };
  }

  isSolidAt(lx, ly) {
    const b = this.getBounds();
    return lx >= b.x && lx < b.x + b.w && ly >= b.y && ly < b.y + b.h;
  }

  /** Position, an der ein Geschoss aus dem Rohr austritt.
   *  Berücksichtigt den Hangwinkel (bodyAngle), damit das Geschoss auch
   *  bei stehendem Tank auf einer Steigung an der gerenderten Rohrspitze
   *  entsteht. */
  barrelTip() {
    const barrelLen = this._tintedBarrel?.height ?? 11;
    // Pivot in Body-lokalen Koords, dann via bodyAngle in Weltkoords drehen.
    const pivotLocalX = 0;
    const pivotLocalY = -this.height() * 0.6;
    const bodyRot = this.facingLeft ? -this.bodyAngle : this.bodyAngle;
    const cosB = Math.cos(bodyRot), sinB = Math.sin(bodyRot);
    const pivotX = this.x + pivotLocalX * cosB - pivotLocalY * sinB;
    const pivotY = this.y + pivotLocalX * sinB + pivotLocalY * cosB;
    // Aim-Vektor (aim ist Weltkoord, NICHT body-relativ — wie im Original)
    const dx = Math.cos(this.angle) * barrelLen * (this.facingLeft ? -1 : 1);
    const dy = -Math.sin(this.angle) * barrelLen;
    return { x: pivotX + dx, y: pivotY + dy };
  }

  /** Aim auf einen Punkt — nie unterhalb horizontal. */
  aimAt(lx, ly) {
    const dx = lx - this.x;
    const baseY = this.y - this.height() * 0.6;
    const dy = baseY - ly;
    const absDx = Math.abs(dx);
    if (absDx < 0.001 && dy <= 0) return;
    let a = Math.atan2(Math.max(0, dy), Math.max(absDx, 0.001));
    if (a > Math.PI / 2) a = Math.PI / 2;
    this.angle = a;
    if (Math.abs(dx) > 0.001) this.facingLeft = dx < 0;
  }

  /** Setzt Position + Hangwinkel anhand des aktuellen DirtField-Geländes.
   *  Y kommt aus getGroundLevelForX (gleiche Quelle wie der Fall-Check in
   *  Match.tick) — sonst oszilliert der Tank zwischen Regressions-Höhe und
   *  echter Bodenhöhe. Nur der WINKEL kommt aus der Hang-Regression. */
  adjustToTerrain(dirtField) {
    if (this.falling) return;
    const { angle } = dirtField.computeHeightAndAngle(this.x);
    this.y = dirtField.getGroundLevelForX(this.x);
    this.bodyAngle = angle * Math.PI / 180;
  }

  /** Tank fällt frei, weil der Boden unter ihm weggesprengt wurde.
   *  noDamage=true unterdrückt Fallschaden für diesen Fall (z.B. der
   *  initiale Spawn-Drop zu Rundenbeginn soll nie schaden). */
  startFall(noDamage = false) {
    if (this.falling) return;
    this.falling = true;
    this.fallVelocity = 0;
    this.fellFromY = this.y;
    this._suppressFallDamage = noDamage;
  }

  updateFalling(dirtField, rules = null) {
    if (!this.falling) return;
    this.fallVelocity += FALL_GRAVITY;
    this.y += this.fallVelocity;
    const ground = dirtField.getGroundLevelForX(this.x);
    if (this.y >= ground) {
      const fallDist = this.y - this.fellFromY;
      this.y = ground;
      this.falling = false;
      this.fallVelocity = 0;
      // Fallschaden — über Regel an/aus + Faktor steuerbar. Der initiale
      // Spawn-Drop (_suppressFallDamage) verursacht nie Schaden.
      const fdEnabled = rules ? rules.fallDamage !== false : true;
      const fdFactor = rules && typeof rules.fallDamageFactor === "number"
        ? rules.fallDamageFactor : 0.5;
      if (fdEnabled && !this._suppressFallDamage && fallDist > 60) {
        this.health = Math.max(0, this.health - Math.round((fallDist - 60) * fdFactor));
      }
      this._suppressFallDamage = false;
      this.adjustToTerrain(dirtField);
    } else if (this.y > FALL_KILL_Y) {
      this.health = 0;          // aus dem Spielfeld gefallen
    }
  }

  /** dir = -1 oder +1. Liefert true wenn bewegt. rules.steepDriving lockert
   *  die Maximal-Steigung. */
  drive(dir, dirtField, others, rules = null) {
    if (this.fuel < 1 || this.falling || this.isDead()) return false;
    const newX = this.x + dir * DRIVE_STEP;
    if (newX < 10 || newX > dirtField.pixelWidth - 10) return false;
    const { height, angle } = dirtField.computeHeightAndAngle(newX);
    const maxClimb = rules?.steepDriving ? MAX_CLIMB_STEEP : MAX_CLIMB_NORMAL;
    if (this.y - height > maxClimb) return false;

    const w = this.width(), h = this.height();
    const newBox = { x: newX - w / 2, y: height - h, w, h };
    for (const o of others) {
      if (o === this || o.isDead()) continue;
      const ob = o.getBounds();
      if (newBox.x < ob.x + ob.w && newBox.x + newBox.w > ob.x &&
          newBox.y < ob.y + ob.h && newBox.y + newBox.h > ob.y) {
        return false;
      }
    }
    this.x = newX;
    this.y = height;
    this.bodyAngle = angle * Math.PI / 180;
    this.facingLeft = dir < 0;
    this.fuel = Math.max(0, this.fuel - 1);
    return true;
  }

  /** Schaden anwenden. fromTank = Schütze, rules = aktives Ruleset (für Cash). */
  applyDamage(damage, fromTank, rules) {
    if (this.health <= 0) return;
    if (fromTank && fromTank !== this) {
      const actual = Math.min(this.health, damage);
      const cap = fromTank.cashAtTurnStart + rules.maxCashPerRound;
      fromTank.cash = Math.min(fromTank.cash + actual * rules.cashPerDamage, cap);
    }
    this.health = Math.max(0, this.health - damage);
    if (this.health <= 0) {
      this.deaths++;
      if (fromTank && fromTank !== this) {
        fromTank.kills++;
        const cap = fromTank.cashAtTurnStart + rules.maxCashPerRound;
        fromTank.cash = Math.min(fromTank.cash + rules.cashPerKill, cap);
      }
    }
  }

  isDead() { return this.health <= 0; }

  // -- Inventar -------------------------------------------------------------

  selectedWeaponEntry() { return this.weapons[this.selectedWeapon]; }
  selectedWeaponKey() { return this.selectedWeaponEntry()?.key; }

  consumeWeapon() {
    const inv = this.selectedWeaponEntry();
    if (!inv || inv.count === -1) return;
    if (inv.count > 0) inv.count--;
    if (inv.count === 0) {
      this.weapons.splice(this.selectedWeapon, 1);
      if (this.weapons.length === 0) this.selectedWeapon = 0;
      else if (this.selectedWeapon >= this.weapons.length) {
        this.selectedWeapon = this.weapons.length - 1;
      }
    }
    this.checkWeapon();
  }

  /** Stellt sicher, dass der Tank mindestens die Standard-Mortar (∞) hat. */
  checkWeapon() {
    const hasInfinite = this.weapons.some((w) => w.count === -1);
    if (!hasInfinite) {
      this.weapons.unshift({ key: "miniMortar", count: -1 });
      if (this.selectedWeapon < 0 || this.selectedWeapon >= this.weapons.length) {
        this.selectedWeapon = 0;
      }
    }
  }

  nextWeapon() {
    if (this.weapons.length === 0) return;
    this.selectedWeapon = (this.selectedWeapon + 1) % this.weapons.length;
  }
  previousWeapon() {
    if (this.weapons.length === 0) return;
    this.selectedWeapon = (this.selectedWeapon - 1 + this.weapons.length) % this.weapons.length;
  }

  // -- Render ---------------------------------------------------------------

  render(ctx) {
    if (!this._tintedBody || !this._tintedBarrel) return;

    // Body: Anchor bottom-center, gedreht um Hangwinkel.
    // Reihenfolge: erst spiegeln, dann rotieren (sonst dreht der Body
    // bei facingLeft in die falsche Richtung).  Bei gespiegelten Body
    // muss auch das Vorzeichen des Hangwinkels invertiert werden.
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.facingLeft) ctx.scale(-1, 1);
    ctx.rotate(this.facingLeft ? -this.bodyAngle : this.bodyAngle);
    ctx.drawImage(this._tintedBody, -this._tintedBody.width / 2, -this._tintedBody.height);
    ctx.restore();

    // Barrel: vertikal gezeichnet, Anchor bottom-center am Pivot.
    // Rotation: bei aim=π/2 (gerade nach oben) bleibt das Sprite unrotiert,
    // bei aim=0 (horizontal) dreht es um ±90°.
    const pivotY = this.y - this.height() * 0.6;
    const renderAngle = this.facingLeft
      ? (this.angle - Math.PI / 2)
      : (Math.PI / 2 - this.angle);
    ctx.save();
    ctx.translate(this.x, pivotY);
    ctx.rotate(renderAngle);
    ctx.drawImage(this._tintedBarrel,
      -this._tintedBarrel.width / 2,
      -this._tintedBarrel.height);
    ctx.restore();
  }

  /** Aim-Indikator (Pfeil-Sprite) über dem aktiven Spieler. */
  renderAimIndicator(ctx, arrowImg) {
    if (!arrowImg) return;
    const baseY = this.y - this.height() * 0.6;
    const dist = 22;
    const dirX = (this.facingLeft ? -1 : 1) * Math.cos(this.angle);
    const dirY = -Math.sin(this.angle);
    const tipX = this.x + dirX * dist;
    const tipY = baseY + dirY * dist;
    ctx.save();
    ctx.translate(tipX, tipY);
    ctx.rotate(Math.atan2(dirY, dirX));
    ctx.globalAlpha = 0.85;
    ctx.drawImage(arrowImg, -arrowImg.width / 2, -arrowImg.height / 2);
    ctx.restore();
  }

  /** Name + Health-Bar zeichnen — separat, damit sie immer über allem liegen. */
  renderUI(ctx, isCurrent) {
    const nameTop = this.y - this.height() - 13;

    // Name — klein gehalten; Hintergrundbox passt sich der Textbreite an.
    ctx.font = "6px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const nameW = ctx.measureText(this.name).width;
    if (isCurrent) {
      ctx.fillStyle = "rgba(0,0,0,.6)";
      ctx.fillRect(this.x - nameW / 2 - 2, nameTop - 1, nameW + 4, 8);
    }
    ctx.fillStyle = isCurrent ? "#ffd06b" : "#fff";
    ctx.fillText(this.name, this.x, nameTop + 5);
    ctx.textAlign = "start";

    // Health
    const barW = 26, barH = 3;
    const barX = this.x - barW / 2, barY = nameTop + 8;
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
    const ratio = Math.max(0, this.health / this.maxHealth);
    ctx.fillStyle = ratio > 0.5 ? "#5ec46d" : ratio > 0.25 ? "#e6c44a" : "#e64a4a";
    ctx.fillRect(barX, barY, barW * ratio, barH);
  }
}

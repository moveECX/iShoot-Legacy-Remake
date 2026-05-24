// Waffen-Hierarchie + Factory.
//
// Koordinaten-Convention:
//   tank.angle = 0   → horizontal nach rechts
//   tank.angle = π/2 → senkrecht nach oben

import { spawnClods, FloatingDamage } from "./effects.js";

export const POWER_SCALE     = 0.07;
export const GRAVITY_FACTOR  = 0.0015;
export const WIND_FACTOR     = 0.0015;
const EXPLOSION_FRAMES       = 20;
const NUKE_EXPLOSION_FRAMES  = 50;
const NUKE_WHITEOUT_FRAMES   = 60;
const SMOKE_TRAIL_MAX        = 10;

/** Erzeugt eine Waffe aus der Waffen-Konfiguration. `rules` braucht es,
 *  damit Submunition über ihren Key nachgeladen werden kann. */
export function createWeapon(cfg, source, rules) {
  // "random" (Micro Bomblet, Jackpot, Hand Of God Stage 2 …): wählt EINE der
  // gelisteten Submunitionen zufällig aus und erzeugt diese. So bekommt z.B.
  // der Micro Bomblet seine zufällige Farbe (und damit Explosionstextur).
  if (cfg.type === "random") {
    const subs = cfg.submunitions || (cfg.submunition ? [cfg.submunition] : []);
    if (rules && subs.length) {
      const pick = subs[(Math.random() * subs.length) | 0];
      const subCfg = rules.weapons[pick];
      if (subCfg) return createWeapon({ ...subCfg, _key: pick }, source, rules);
    }
  }
  const opts = buildWeaponOpts(cfg, source);
  switch (cfg.type) {
    case "clusterBomb":  return new ClusterBomb({ ...opts, cfg, rules });
    case "groundBurst":  return new GroundBurst({ ...opts, cfg, rules });
    case "machineGun":   return new MachineGunWeapon({ ...opts, cfg, rules });
    case "nuke":         return new NukeWeapon(opts);
    case "penetrator":   return new KineticWeapon(opts);
    case "roller":       return new RollerWeapon(opts);
    case "skylance":     return new SkylanceWeapon(opts);
    case "shell":
    default:             return new ShellWeapon(opts);
  }
}

function buildWeaponOpts(cfg, source) {
  const blast = +cfg.blastRadius || 8;
  // WICHTIG: ?? statt || — sonst wird damage=0 (dirtBall/excavator/greatWall)
  // fälschlich zu 20.
  const dmg = cfg.damage != null ? +cfg.damage : 20;
  return {
    source,
    name: cfg.name || cfg._key || "weapon",
    blastRadius: blast,
    maxDamage: dmg,
    minDamage: dmg * 0.25,        // Original: 25% Rand-Mindestschaden
    maxDamageRadius: blast * 0.5,
    scorchWidth: Math.max(1, blast * 0.5),
    smokeEnabled: cfg.smokeEnabled !== false,
    launchSoundName: cfg.launchSound,
    explosionSoundName: cfg.explosionSound,
    explosionTexture: cfg.explosionTexture,
    imageName: cfg.image || null,
    // createDirt=true → die Waffe BAUT Terrain statt es zu zerstören
    // (Dirt Ball, Portable Mountain, Great Wall).
    createDirt: cfg.createDirt === true,
    dirtClods: +cfg.dirtClods || 0,
    dirtColor: cfg.dirtRed !== undefined
      ? [+cfg.dirtRed, +cfg.dirtGreen, +cfg.dirtBlue]
      : null,
  };
}

// ===========================================================================
// ShellWeapon — Standard-Granate. Basisklasse aller normalen Flug-Waffen.
// ===========================================================================
export class ShellWeapon {
  constructor(opts) {
    Object.assign(this, opts);
    this.x = 0; this.y = 0;
    this.xv = 0; this.yv = 0;
    this.angle = 0;
    this.power = 0;
    this.facingLeft = false;
    this.exploding = false;
    this.currentRadius = 0;
    this.finished = false;
    this._frame = 0;
    this._fade = 0;
    this._growSteps = EXPLOSION_FRAMES;   // Frames für 0.5R→R (Nuke überschreibt)
    /** Rauchspur-Punkte: { x, y } — jüngste am Ende */
    this._trail = [];
    /** Tank, den das Geschoss DIREKT getroffen hat — bekommt garantiert
     *  Schaden in _detonate, unabhängig vom Blast-Radius. */
    this._directHitTank = null;
  }

  fireFrom(x, y, angle, power, facingLeft) {
    this.x = x; this.y = y;
    this.angle = angle; this.power = power; this.facingLeft = facingLeft;
    const dir = facingLeft ? -1 : 1;
    this.xv = dir * Math.cos(angle) * power * POWER_SCALE;
    this.yv = -Math.sin(angle) * power * POWER_SCALE;
  }

  isFinished() { return this.finished; }

  advance(match) {
    if (this.finished) return;
    if (this.exploding) {
      // Krater wächst Hand-in-Hand mit der Feuerkugel: pro Frame wird das
      // Terrain bis zum aktuellen Radius abgetragen (Original-Verhalten:
      // halber Krater sofort beim Aufprall, dann hoch auf vollen Radius).
      if (this.currentRadius < this.blastRadius) {
        this.currentRadius = Math.min(
          this.blastRadius,
          this.currentRadius + this.blastRadius / this._growSteps,
        );
        this._carveTerrain(match, this.currentRadius);
      } else {
        // Nachglühen ein paar Frames, dann fertig.
        this._fade++;
        if (this._fade > 5) this.finished = true;
      }
      return;
    }
    this._flightStep(match);
  }

  _flightStep(match) {
    const prevX = this.x;
    const prevY = this.y;
    this.x += this.xv;
    this.y += this.yv;
    this.xv += match.wind * WIND_FACTOR;
    this.yv += match.rules.gravity * GRAVITY_FACTOR;
    this._frame++;
    if (this.smokeEnabled && this._frame % 2 === 0) {
      this._trail.push({ x: this.x, y: this.y });
      if (this._trail.length > SMOKE_TRAIL_MAX) this._trail.shift();
    }

    if (this.y > match.height + 50 || this.x < -100 || this.x > match.width + 100) {
      this.finished = true;
      return;
    }

    // --- Continuous Collision: Sub-Step über das letzte Tick-Segment.
    // Schnelle Geschosse (5+ px/Tick) können sonst schmale Tank-Bodies
    // überspringen, weil isSolidAt nur den Endpunkt prüft.
    const dx = this.x - prevX;
    const dy = this.y - prevY;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / 2));   // alle 2 px ein Sample
    for (let s = 1; s <= steps; s++) {
      const k = s / steps;
      const sx = prevX + dx * k;
      const sy = prevY + dy * k;
      if (match.dirtField.isSolid(sx, sy)) {
        this.x = sx; this.y = sy;
        this._onImpact(match, "ground");
        return;
      }
      for (const t of match.tanks) {
        if (t === this.source || t.hitThisFrame || t.isDead()) continue;
        if (t.isSolidAt(sx, sy)) {
          this.x = sx; this.y = sy;
          t.hitThisFrame = true;
          this._directHitTank = t;
          this._onImpact(match, "tank");
          return;
        }
      }
    }
  }

  /** Was passiert beim Aufprall — Subklassen können das überschreiben. */
  _onImpact(match) {
    this._beginExplosion(match);
  }

  _beginExplosion(match) {
    if (this.exploding) return;
    this.exploding = true;
    // Original: currentRadius startet bei blastRadius/2 → halber Krater
    // sofort beim Aufprall, wächst dann hoch.
    this.currentRadius = this.blastRadius * 0.5;
    if (this.explosionSoundName) match.playSfx?.(this.explosionSoundName, "explosion");
    // Schaden + Effekte sofort beim Aufprall (responsiv, Hand-in-Hand mit
    // dem ersten Krater). Das Graben selbst läuft progressiv in advance().
    this._detonate(match);
    this._carveTerrain(match, this.currentRadius);
  }

  /** Trägt Terrain ab (oder häuft an bei createDirt) bis zum gegebenen Radius. */
  _carveTerrain(match, radius) {
    if (this.createDirt) {
      match.dirtField.createCircle(this.x, this.y, radius);
    } else {
      match.dirtField.destroyCircle(this.x, this.y, radius, this.scorchWidth);
    }
  }

  /** Einmalige Aufprall-Effekte: Shake, Dirt-Clods, Tank-Fall, Schaden. */
  _detonate(match) {
    match.shake = Math.max(match.shake || 0, Math.min(6, this.blastRadius * 0.3));

    if (this.createDirt) return;   // Erd-Waffen: kein Schaden/keine Clods

    if (this.dirtClods > 0 && match.rules.dirtClods) {
      const col = this.dirtColor
        ? this.dirtColor.map((c) => Math.round(c * 255))
        : _sampleGroundColor(match.dirtField, this.x, this.y);
      spawnClods(match, this.x, this.y, this.dirtClods, col, this.blastRadius * 0.25 + 1);
    }
    // Tanks im Destruction-Bereich → falling
    for (const t of match.tanks) {
      if (t.isDead()) continue;
      const dx = t.x - this.x;
      if (Math.abs(dx) < this.blastRadius + t.width() * 0.5) {
        const b = t.getBounds();
        if (b.y < this.y + this.blastRadius && b.y + b.h > this.y - this.blastRadius) {
          t.startFall();
        }
      }
    }
    // Schaden
    const damagedSet = new Set();
    const applyDamageWithKillCheck = (target, dmg) => {
      const rounded = Math.round(dmg);
      if (rounded <= 0) return;
      const wasAlive = !target.isDead();
      target.applyDamage(dmg, this.source, match.rules);
      // Floating Damage-Zahl über dem getroffenen Tank
      match.effects.push(new FloatingDamage(target.x, target.y - target.height(), rounded));
      if (wasAlive && target.isDead()) {
        match.onTankKilled?.(target, this.source, this.name);
      }
    };
    if (this._directHitTank && !this._directHitTank.isDead()) {
      // _damageAt(0) = voller Schaden für normale Waffen; bei Penetrator
      // speed-basiert (Override).
      applyDamageWithKillCheck(this._directHitTank, this._damageAt(0));
      damagedSet.add(this._directHitTank);
    }
    for (const t of match.tanks) {
      if (t.isDead() || damagedSet.has(t)) continue;
      const b = t.getBounds();
      const dx = Math.max(0, b.x - this.x, this.x - (b.x + b.w));
      const dy = Math.max(0, b.y - this.y, this.y - (b.y + b.h));
      const dist = Math.hypot(dx, dy);
      if (dist > this.blastRadius) continue;
      applyDamageWithKillCheck(t, this._damageAt(dist));
    }
  }

  _damageAt(dist) {
    if (dist <= this.maxDamageRadius) return this.maxDamage;
    const u = (dist - this.maxDamageRadius) /
              Math.max(0.0001, this.blastRadius - this.maxDamageRadius);
    return this.maxDamage + (this.minDamage - this.maxDamage) * u;
  }

  render(ctx, assets) {
    if (this.exploding) {
      this._renderExplosion(ctx, assets);
      return;
    }
    // Smoke-Trail mit Smoke1/2/3-Sprites (zyklisch)
    if (this.smokeEnabled && this._trail.length > 0 && assets) {
      const imgs = [
        assets.images?.get("Smoke1.png"),
        assets.images?.get("Smoke2.png"),
        assets.images?.get("Smoke3.png"),
      ].filter(Boolean);
      if (imgs.length > 0) {
        for (let i = 0; i < this._trail.length; i++) {
          const p = this._trail[i];
          const img = imgs[i % imgs.length];
          const alpha = 0.15 + (i / this._trail.length) * 0.5;
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.drawImage(img, p.x - img.width / 2, p.y - img.height / 2);
          ctx.restore();
        }
      }
    }
    // Geschoss-Sprite, rotiert in Flugrichtung. Originale Sprites zeigen
    // nach rechts. Fallback (kein Sprite verfügbar): kleiner Punkt.
    const img = this.imageName ? assets?.images?.get(this.imageName) : null;
    if (img) {
      const angle = Math.atan2(this.yv, this.xv);
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(angle);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
    } else {
      ctx.fillStyle = "#222";
      ctx.fillRect((this.x | 0) - 1, (this.y | 0) - 1, 3, 3);
    }
  }

  _renderExplosion(ctx) {
    // Prozedural als radialer Gradient. Farbschema je explosionTexture aus der
    // Konfiguration. Damit es zum Pixel-Look des restlichen Spiels passt, wird die
    // Explosion klein (Offscreen) gezeichnet und mit Nearest-Neighbor hoch-
    // skaliert → blockige "Pixel" statt smoothem Verlauf.
    const r0 = this.currentRadius;
    if (r0 <= 0) return;
    // Voll sichtbar während des Wachstums, blendet erst in der Fade-Phase aus.
    const growing = r0 < this.blastRadius;
    const alpha = growing ? 1 : Math.max(0, 1 - this._fade / 6);
    if (alpha <= 0) return;
    const pal = EXPLOSION_PALETTES[this.explosionTexture] || EXPLOSION_PALETTES.default;

    // Die Feuerkugel wird ~15 % größer gezeichnet als der Krater-/Blast-Radius.
    const r = r0 * 1.15;
    const BLOCK = 2;                                   // logische px je Explosions-"Pixel"
    const small = Math.max(3, Math.round((r * 2) / BLOCK));
    const oc = _exploCanvas(small);
    const octx = oc ? oc.getContext("2d") : null;

    // Gezeichnet wird ins Offscreen (klein) oder – als Fallback – direkt.
    const t = octx || ctx;
    const cx = octx ? small / 2 : this.x;
    const cy = octx ? small / 2 : this.y;
    const rr = octx ? small / 2 : r;
    if (octx) octx.clearRect(0, 0, small, small);
    else ctx.save();

    // Deckender farbiger Körper: über den Großteil des Radius GLEICHMÄSSIG
    // satte Hauptfarbe (glow1), innen nur leicht heller (glow0). Erst die
    // äußeren ~20 % blenden zum dunkleren Rand aus.
    const g = t.createRadialGradient(cx, cy, 0, cx, cy, rr);
    g.addColorStop(0,    `rgba(${pal.glow0},${alpha})`);
    g.addColorStop(0.25, `rgba(${pal.glow1},${alpha})`);
    g.addColorStop(0.8,  `rgba(${pal.glow1},${alpha})`);
    g.addColorStop(0.95, `rgba(${pal.glow2},${alpha})`);
    g.addColorStop(1,    `rgba(${pal.glow2},0)`);
    t.fillStyle = g;
    t.beginPath();
    t.arc(cx, cy, rr, 0, Math.PI * 2);
    t.fill();

    // Kleiner, dezenter heißer Kern (additiv).
    t.globalCompositeOperation = "lighter";
    const cr = rr * 0.3;
    const c = t.createRadialGradient(cx, cy, 0, cx, cy, cr);
    c.addColorStop(0, `rgba(${pal.core0},${alpha * 0.6})`);
    c.addColorStop(1, `rgba(${pal.core1},0)`);
    t.fillStyle = c;
    t.beginPath();
    t.arc(cx, cy, cr, 0, Math.PI * 2);
    t.fill();
    t.globalCompositeOperation = "source-over";

    if (octx) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      const dest = small * BLOCK;
      ctx.drawImage(oc, this.x - dest / 2, this.y - dest / 2, dest, dest);
      ctx.restore();
    } else {
      ctx.restore();
    }
  }
}

// Wiederverwendetes Offscreen-Canvas für die pixelige Explosions-Darstellung.
let _exploCv = null;
function _exploCanvas(size) {
  if (!_exploCv) {
    if (typeof OffscreenCanvas !== "undefined") _exploCv = new OffscreenCanvas(size, size);
    else if (typeof document !== "undefined") _exploCv = document.createElement("canvas");
    else return null;
  }
  if (_exploCv.width !== size || _exploCv.height !== size) {
    _exploCv.width = size; _exploCv.height = size;
  }
  return _exploCv;
}

// Farbpaletten pro Explosion-Textur (RGB-Tripel als String für rgba()).
const EXPLOSION_PALETTES = {
  default:                 { glow0: "255,170,60",  glow1: "220,90,30",   glow2: "120,30,10",  core0: "255,245,200", core1: "255,150,40" },
  "Explosion.png":         { glow0: "255,170,60",  glow1: "220,90,30",   glow2: "120,30,10",  core0: "255,245,200", core1: "255,150,40" },
  "Explosion-Nuclear.png": { glow0: "220,235,255", glow1: "150,190,255", glow2: "80,120,220", core0: "255,255,255", core1: "200,220,255" },
  "Explosion-Blue.png":    { glow0: "120,180,255", glow1: "60,120,230",  glow2: "20,50,160",  core0: "220,240,255", core1: "120,180,255" },
  "Explosion-Green.png":   { glow0: "150,255,120", glow1: "70,200,60",   glow2: "20,110,20",  core0: "235,255,210", core1: "150,255,120" },
  "Explosion-Purple.png":  { glow0: "210,130,255", glow1: "160,70,220",  glow2: "80,20,140",  core0: "245,220,255", core1: "210,130,255" },
  "Explosion-Yellow.png":  { glow0: "255,240,120", glow1: "230,200,40",  glow2: "150,110,10", core0: "255,255,220", core1: "255,240,120" },
};

/** Sampling der Boden-Pixel-Farbe in der Nähe eines Impact-Punkts. */
function _sampleGroundColor(dirtField, x, y) {
  const px = Math.max(0, Math.min(dirtField.pixelWidth - 1,
    Math.round(x * dirtField.pixelWidthOverLogicalWidth)));
  // Suche ersten soliden Pixel unter (x,y)
  const yStart = Math.max(0, Math.round(y * dirtField.pixelHeightOverLogicalHeight));
  for (let row = yStart; row < dirtField.pixelHeight; row++) {
    const i = (row * dirtField.pixelWidth + px) * 4;
    if (dirtField.dirt[i + 3] > 199) {
      return [dirtField.dirt[i], dirtField.dirt[i + 1], dirtField.dirt[i + 2]];
    }
  }
  return [120, 80, 40];
}

// ===========================================================================
// ClusterBomb — explodiert am Apex (oder per delayFuse) und spawnt Submunition.
// ===========================================================================
class ClusterBomb extends ShellWeapon {
  constructor({ cfg, rules, ...opts }) {
    super(opts);
    this.cfg = cfg;
    this.rules = rules;
    this.apexFuse = cfg.apexFuse !== false;          // default: true
    this.delayFuse = +cfg.delayFuse || 15;
    this.burstPowerX = +cfg.burstPowerX || 30;
    this.burstPowerY = +cfg.burstPowerY || 3;
    this.count = +cfg.count || 5;
    this.submunitionKey = cfg.submunition;
    this.burst = false;
  }

  advance(match) {
    if (this.finished || this.burst) {
      this.finished = true;
      return;
    }
    if (this.apexFuse && this.yv >= 0 && this._frame > 2) {
      this._doBurst(match);
      return;
    }
    if (!this.apexFuse && this._frame >= this.delayFuse) {
      this._doBurst(match);
      return;
    }
    this._flightStep(match);
  }

  _onImpact(match) { this._doBurst(match); }

  _doBurst(match) {
    if (this.burst) return;
    this.burst = true;
    this.finished = true;
    const subCfg = this.rules.weapons[this.submunitionKey];
    if (!subCfg) return;
    for (let i = 0; i < this.count; i++) {
      const sub = createWeapon({ ...subCfg, _key: this.submunitionKey }, this.source, this.rules);
      sub.x = this.x;
      sub.y = this.y;
      sub.xv = this.xv + (Math.random() * 2 - 1) * this.burstPowerX * POWER_SCALE * 0.35;
      sub.yv = this.yv + (Math.random() * 2 - 1) * this.burstPowerY * POWER_SCALE * 0.35;
      match.weapons.push(sub);
    }
  }

  render(ctx, assets) {
    if (this.burst) return;
    super.render(ctx, assets);
  }
}

// ===========================================================================
// GroundBurst — beim Aufprall N Submunitions nach oben werfen.
// ===========================================================================
class GroundBurst extends ShellWeapon {
  constructor({ cfg, rules, ...opts }) {
    super(opts);
    this.cfg = cfg;
    this.rules = rules;
    this.count = +cfg.count || 5;
    this.burstPower = +cfg.burstPower || 40;
    this.submunitionKey = cfg.submunition;
    this.burst = false;
  }

  _onImpact(match) { this._doBurst(match); }

  _doBurst(match) {
    if (this.burst || this.exploding) return;
    const subCfg = this.rules.weapons[this.submunitionKey];
    if (!subCfg) {
      // Keine Submunition → normale Explosion (progressiver Krater).
      this._beginExplosion(match);
      return;
    }
    this.burst = true;
    this.finished = true;
    for (let i = 0; i < this.count; i++) {
      const sub = createWeapon({ ...subCfg, _key: this.submunitionKey }, this.source, this.rules);
      sub.x = this.x;
      sub.y = this.y - 6;
      const a = (i / Math.max(1, this.count - 1)) * Math.PI;   // 0..π
      const s = this.burstPower * POWER_SCALE * (0.6 + Math.random() * 0.4);
      sub.xv = Math.cos(a) * s * (i % 2 ? 1 : -1);
      sub.yv = -Math.abs(Math.sin(a) * s) - 1;
      match.weapons.push(sub);
    }
  }

  render(ctx, assets) {
    if (this.burst) return;
    super.render(ctx, assets);
  }
}

// ===========================================================================
// NukeWeapon — größere Explosion über 50 Frames + globaler Whiteout-Effekt.
// ===========================================================================
class NukeWeapon extends ShellWeapon {
  _beginExplosion(match) {
    this._growSteps = NUKE_EXPLOSION_FRAMES;   // langsamer wachsende Explosion
    match.whiteoutFrames = Math.max(match.whiteoutFrames || 0, NUKE_WHITEOUT_FRAMES);
    super._beginExplosion(match);
    match.shake = Math.max(match.shake || 0, 8);
  }
  // advance() von ShellWeapon (progressives Carven Hand-in-Hand)
}

// ===========================================================================
// KineticWeapon — Penetrator: Damage skaliert mit Aufprall-Geschwindigkeit.
// ===========================================================================
class KineticWeapon extends ShellWeapon {
  constructor(opts) {
    super(opts);
    this._impactSpeed = 0;
  }

  _onImpact(match, where) {
    // Aufprall-Geschwindigkeit merken (Original: sqrt(vx²+vy²)).
    this._impactSpeed = Math.hypot(this.xv, this.yv);
    super._onImpact(match, where);
  }

  /** Penetrator: Schaden ∝ Aufprallgeschwindigkeit, OHNE Distanz-Falloff
   *  (Original: damage = speed * factor * maxDamage, direkter Durchschlag).
   *  Referenz-Speed ~7 px/Tick (volle Power, 45°) ≈ maxDamage. */
  _damageAt() {
    const speedFactor = Math.min(2.5, Math.max(0.15, this._impactSpeed / 7));
    return this.maxDamage * speedFactor;
  }
}

// ===========================================================================
// RollerWeapon — rollt nach Aufprall den Hang hinunter, explodiert dann.
// ===========================================================================
class RollerWeapon extends ShellWeapon {
  constructor(opts) {
    super(opts);
    this.rolling = false;
    this.rollFrames = 0;
    this.rollMaxFrames = 130;    // ~4 Sekunden roll
  }

  _onImpact(match, where) {
    if (where === "ground" && !this.rolling) {
      this.rolling = true;
      this.rollFrames = 0;
      this.y = match.dirtField.getGroundLevelForX(this.x) - 1;
      this.yv = 0;
      // Mehr horizontalen Schwung behalten (kinetische Energie). Mindest-
      // Rollgeschwindigkeit, damit der Roller auch flach spürbar weiterrollt.
      this.xv *= 0.85;
      const minRoll = 1.1;
      if (Math.abs(this.xv) < minRoll) {
        this.xv = (this.xv >= 0 ? 1 : -1) * minRoll;
      }
      return;
    }
    super._onImpact(match, where);
  }

  advance(match) {
    if (this.finished) return;
    if (this.exploding) return super.advance(match);
    if (this.rolling) {
      const { angle } = match.dirtField.computeHeightAndAngle(this.x);
      const slopeRad = angle * Math.PI / 180;
      this.xv += Math.tan(slopeRad) * 0.9;   // stärkere Hangbeschleunigung
      this.xv *= 0.985;      // weniger Reibung → rollt weiter
      this.x += this.xv;
      this.y = match.dirtField.getGroundLevelForX(this.x) - 1;
      this._rollAngle = (this._rollAngle || 0) + this.xv * 0.15;   // Roll-Rotation
      // Tank-Treffer beim Rollen — auch den Schützen (Friendly Fire), aber
      // erst nach ein paar Frames, damit der Roller nicht sofort am eigenen
      // Tank explodiert.
      for (const t of match.tanks) {
        if (t.hitThisFrame || t.isDead()) continue;
        if (t === this.source && this.rollFrames < 8) continue;
        if (t.isSolidAt(this.x, this.y + 1)) {
          t.hitThisFrame = true;
          this.rolling = false;
          this._beginExplosion(match);
          return;
        }
      }
      this.rollFrames++;
      if (this.rollFrames > this.rollMaxFrames || Math.abs(this.xv) < 0.03) {
        this.rolling = false;
        this._beginExplosion(match);
      }
      return;
    }
    this._flightStep(match);
  }

  render(ctx, assets) {
    if (this.exploding) return this._renderExplosion(ctx);
    if (this.rolling) {
      const img = assets?.images?.get("Roller.png");
      if (img) {
        ctx.save();
        ctx.translate(this.x, this.y - img.height / 2);
        ctx.rotate(this._rollAngle || 0);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        ctx.restore();
        return;
      }
    }
    super.render(ctx, assets);
  }
}

// ===========================================================================
// SkylanceWeapon — vertikaler Strahl: zerstört eine Säule durchs Terrain.
// ===========================================================================
class SkylanceWeapon extends ShellWeapon {
  // Skylance ist ein einmaliger Säulen-Effekt (kein wachsender Krater).
  _beginExplosion(match) {
    if (this.exploding) return;
    this.exploding = true;
    this.finished = true;        // Effekt sofort, keine Wachstumsanimation
    if (this.explosionSoundName) match.playSfx?.(this.explosionSoundName, "explosion");

    if (this.createDirt) {
      // Great Wall: errichtet eine vertikale Säule (baut Terrain auf).
      match.dirtField.createWall(this.x, Math.max(4, this.blastRadius));
      match.shake = Math.max(match.shake || 0, 3);
      return;
    }
    // Energie-Strahl: zerstört eine Säule + Schaden im Umkreis.
    match.dirtField.destroyWall(this.x, this.blastRadius, this.scorchWidth);
    match.shake = Math.max(match.shake || 0, 4);
    for (const t of match.tanks) {
      if (t.isDead()) continue;
      const dist = Math.abs(t.x - this.x);
      if (dist >= this.blastRadius) continue;
      const wasAlive = !t.isDead();
      t.applyDamage(this._damageAt(dist), this.source, match.rules);
      if (wasAlive && t.isDead()) match.onTankKilled?.(t, this.source, this.name);
      t.startFall();
    }
  }
}

// ===========================================================================
// MachineGunWeapon (CompoundWeapon) — kein Flugobjekt; spawnt zeitversetzt
// Sub-Shells aus dem Rohr.
// ===========================================================================
class MachineGunWeapon {
  constructor({ cfg, rules, source, name, launchSoundName }) {
    this.source = source;
    this.name = name;
    this.cfg = cfg;
    this.rules = rules;
    this.launchSoundName = launchSoundName;
    this.groups = +cfg.groups || 10;
    this.shotsPerGroup = +cfg.shotsPerGroup || 1;
    this.delayBetweenGroups = +cfg.delayBetweenGroups || 6;
    this.angleVariance = (+cfg.angleVariance || 5) * Math.PI / 180;
    this.powerVariance = +cfg.powerVariance || 3;
    this.munitionKey = cfg.submunition || cfg.munition;
    this.frameCount = 0;
    this.shotsFired = 0;
    this.totalShots = this.groups * this.shotsPerGroup;
    this.finished = false;
  }

  fireFrom(x, y, angle, power, facingLeft) {
    this.x = x; this.y = y;
    this.angle = angle; this.power = power; this.facingLeft = facingLeft;
  }

  isFinished() { return this.finished; }

  advance(match) {
    if (this.finished) return;
    if (this.shotsFired >= this.totalShots) {
      this.finished = true;
      return;
    }
    if (this.frameCount % this.delayBetweenGroups === 0) {
      for (let i = 0; i < this.shotsPerGroup; i++) {
        if (this.shotsFired >= this.totalShots) break;
        const subCfg = this.munitionKey ? this.rules.weapons[this.munitionKey] : null;
        if (!subCfg) { this.finished = true; return; }
        const sub = createWeapon({ ...subCfg, _key: this.munitionKey }, this.source, this.rules);
        const dAng = (Math.random() * 2 - 1) * this.angleVariance;
        const dPow = (Math.random() * 2 - 1) * this.powerVariance;
        sub.fireFrom(this.x, this.y, this.angle + dAng, this.power + dPow, this.facingLeft);
        match.weapons.push(sub);
        if (this.launchSoundName) match.playSfx?.(this.launchSoundName);
        this.shotsFired++;
      }
    }
    this.frameCount++;
  }

  render() { /* unsichtbar — sub-shells werden separat gerendert */ }
}

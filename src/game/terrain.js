// DirtField — Pixel-genaues, zerstörbares Terrain.
//
// Speicher:
//   dirt        — RGBA Uint8ClampedArray, eine Reihe Pixel pro Bildzeile
//   scanHeight  — Int16Array, ein Eintrag pro Spalte.
//                 Wert = höchster Pixel-Reihen-Index in dieser Spalte, der
//                 noch "instabil" sein könnte (Falling-Dirt-Hinweis).
//                 -1 bedeutet: Spalte ist final / ruht.
//
// Konvention: Y-Achse zeigt nach unten (Pixel-Index 0 = oberster Pixel).

const ALPHA_SOLID_THRESHOLD = 199;   // isSolid: alpha > 199 (aus isSolidAtX:y:)
const EXPLOSION_FILL_RGBA = [0, 0, 0, 0];  // gelöschte Pixel sind voll transparent

const clampByte = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

export class DirtField {
  /**
   * @param {number} pixelWidth     Pixel-Auflösung X (z.B. 480)
   * @param {number} pixelHeight    Pixel-Auflösung Y (z.B. 320)
   * @param {number} logicalX       linker Rand in logischen Einheiten
   * @param {number} logicalY       oberer Rand
   * @param {number} logicalWidth   Breite in logischen Einheiten
   * @param {number} logicalHeight  Höhe in logischen Einheiten
   */
  constructor(pixelWidth, pixelHeight, logicalX, logicalY, logicalWidth, logicalHeight) {
    this.pixelWidth = pixelWidth;
    this.pixelHeight = pixelHeight;
    this.logicalX = logicalX;
    this.logicalY = logicalY;
    this.logicalWidth = logicalWidth;
    this.logicalHeight = logicalHeight;
    this.pixelWidthOverLogicalWidth = pixelWidth / logicalWidth;
    this.pixelHeightOverLogicalHeight = pixelHeight / logicalHeight;
    this.dirt = new Uint8ClampedArray(pixelWidth * pixelHeight * 4);
    this.imageData = new ImageData(this.dirt, pixelWidth, pixelHeight);
    this.scanHeight = new Int16Array(pixelWidth);
    this.scanHeight.fill(-1);
    this.ready = true;
    this._fullDirty = true;
    // Offscreen-Canvas mit Alpha. Wir können NICHT direkt mit putImageData
    // auf das Hauptcanvas (alpha:false) rendern — das schreibt RGBA roh
    // rein, transparente Pixel werden schwarz. Stattdessen halten wir hier
    // ein alpha-fähiges Backbuffer und ziehen es per drawImage über den
    // Sky — drawImage macht source-over, also durchsichtig wo nötig.
    const make = (typeof OffscreenCanvas !== "undefined")
      ? (w, h) => new OffscreenCanvas(w, h)
      : (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });
    this._offscreen = make(pixelWidth, pixelHeight);
    this._offctx = this._offscreen.getContext("2d");
  }

  // ---- Setup ---------------------------------------------------------------

  /** Setzt das Terrain auf eine PNG (skaliert auf pixelWidth/pixelHeight). */
  loadFromImage(img) {
    const oc = (typeof OffscreenCanvas !== "undefined")
      ? new OffscreenCanvas(this.pixelWidth, this.pixelHeight)
      : Object.assign(document.createElement("canvas"),
          { width: this.pixelWidth, height: this.pixelHeight });
    const ctx = oc.getContext("2d");
    ctx.clearRect(0, 0, this.pixelWidth, this.pixelHeight);
    ctx.drawImage(img, 0, 0, this.pixelWidth, this.pixelHeight);
    const data = ctx.getImageData(0, 0, this.pixelWidth, this.pixelHeight).data;
    this.dirt.set(data);
    this.scanHeight.fill(-1);
    this.ready = true;
    this._fullDirty = true;
  }

  /**
   * Erzeugt eine prozedurale Hügelkette per kubischer Bézier-Spline und
   * füllt den Boden darunter mit der gegebenen Erd-Textur (modulo-getiled).
   *
   * Kubische Bézier mit 2..7 Segmenten, Endpunkte zufällig in [H/5, H*0.6],
   * Reflect-Kontrollpunkt-Trick für sanfte Übergänge.
   */
  createSplineLandscape(fillDirtImage) {
    const W = this.pixelWidth, H = this.pixelHeight;
    const randInt = (n) => Math.floor(Math.random() * n);
    const randFloat = () => Math.random();
    const sampleY = () => randInt(Math.floor(H * 0.4)) + Math.floor(H / 5);

    // 1) Spline-Mask in Offscreen-Canvas zeichnen
    const make = (w, h) => (typeof OffscreenCanvas !== "undefined")
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const mask = make(W, H);
    const mctx = mask.getContext("2d");
    mctx.clearRect(0, 0, W, H);
    mctx.fillStyle = "rgba(0,0,0,1)";
    mctx.beginPath();

    let y0 = sampleY();
    mctx.moveTo(0, 0);
    mctx.lineTo(0, y0);

    let yPrev = y0;
    let yPrevPrev = y0;
    let xPrev = 0;
    let yNext = sampleY();
    const segs = randInt(6) + 2;   // 2..7 Segmente

    for (let i = 0; i < segs; i++) {
      const xNext = (i === segs - 1) ? W : (xPrev + Math.floor(W / segs));
      // cp1.x = xPrev + (xNext - xPrev) * 0.33, cp1.y = 2*yPrev - yPrevPrev
      const cp1x = xPrev + (xNext - xPrev) * 0.33;
      const cp1y = 2 * yPrev - yPrevPrev;
      const rawCp2y = yPrev + (randFloat() - 0.4) * H / 10;
      const cp2y = Math.min(H * 0.5, Math.max(0, rawCp2y));
      const cp2x = xPrev + (xNext - xPrev) * 0.66;
      mctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, xNext, yNext);
      yPrevPrev = yPrev;
      yPrev = yNext;
      xPrev = xNext;
      yNext = sampleY();
    }
    mctx.lineTo(W, 0);
    mctx.closePath();
    mctx.fill();

    const maskData = mctx.getImageData(0, 0, W, H).data;

    // 2) fillDirt-Textur in eigenen Buffer rendern
    const fdW = fillDirtImage.width | 0;
    const fdH = fillDirtImage.height | 0;
    const fdCanvas = make(fdW, fdH);
    const fdCtx = fdCanvas.getContext("2d");
    fdCtx.drawImage(fillDirtImage, 0, 0);
    const fillData = fdCtx.getImageData(0, 0, fdW, fdH).data;

    // 3) dirt befüllen
    const d = this.dirt;
    d.fill(0);

    for (let col = 0; col < W; col++) {
      // suche oberste Reihe mit Mask-Alpha != 0
      let topRow = 0;
      for (; topRow < H; topRow++) {
        if (maskData[(topRow * W + col) * 4 + 3] !== 0) break;
      }
      let row = Math.max(topRow, H >> 2);
      let fdRowCounter = 0;
      while (row < H) {
        fdRowCounter += fdW;
        const texelIdx = (col % fdW) + (fdRowCounter - fdW);
        const fi = (texelIdx % (fdW * fdH)) * 4;
        const di = (row * W + col) * 4;
        const a = maskData[di + 3] / 255;
        d[di]     = (fillData[fi]     * a) | 0;
        d[di + 1] = (fillData[fi + 1] * a) | 0;
        d[di + 2] = (fillData[fi + 2] * a) | 0;
        d[di + 3] = maskData[di + 3];
        row++;
      }
    }

    this.scanHeight.fill(-1);
    this.ready = true;
    this._fullDirty = true;
  }

  // ---- Pixel-/Logik-Konvertierung -----------------------------------------

  _toPixelX(lx) { return Math.floor((lx - this.logicalX) * this.pixelWidthOverLogicalWidth); }
  _toPixelY(ly) { return Math.floor((ly - this.logicalY) * this.pixelHeightOverLogicalHeight); }
  _toLogicalY(py) { return this.logicalY + py / this.pixelHeightOverLogicalHeight; }

  // ---- Queries -------------------------------------------------------------

  /** Ist diese (logische) Position im Boden? */
  isSolid(lx, ly) {
    const py = this._toPixelY(ly);
    if (py < 0) return false;
    if (py >= this.pixelHeight) return true;     // unter dem Spielfeld
    const px = this._toPixelX(lx);
    if (px < 0 || px >= this.pixelWidth) return false;
    return this.dirt[(py * this.pixelWidth + px) * 4 + 3] > ALPHA_SOLID_THRESHOLD;
  }

  /**
   * Y-Index des obersten Bodens in dieser Pixel-Spalte (oder pixelHeight,
   * wenn die Spalte komplett leer ist).
   */
  getGroundLevelForColumn(col) {
    if (col < 0 || col >= this.pixelWidth) return this.pixelHeight;
    const w = this.pixelWidth;
    const d = this.dirt;
    for (let row = 0; row < this.pixelHeight; row++) {
      if (d[(row * w + col) * 4 + 3] > ALPHA_SOLID_THRESHOLD) return row;
    }
    return this.pixelHeight;
  }

  /** Wie getGroundLevelForColumn, aber in logischen Y. */
  getGroundLevelForX(lx) {
    return this._toLogicalY(this.getGroundLevelForColumn(this._toPixelX(lx)));
  }

  /**
   * Lokale Geländehöhe + Hangwinkel via linearer Regression über
   * ~20 Pixelspalten um lx. Zurück: { height, angle } in logischen
   * Einheiten bzw. Grad.
   */
  computeHeightAndAngle(lx) {
    const px = this._toPixelX(lx);
    const start = Math.max(0, px - 10);
    const end = Math.min(this.pixelWidth - 1, px + 10);
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let col = start; col <= end; col += 2) {
      const h = this.getGroundLevelForColumn(col);
      n++;
      sx  += col;
      sy  += h;
      sxx += col * col;
      sxy += col * h;
    }
    if (n < 2) return { height: this._toLogicalY(this.pixelHeight), angle: 0 };
    const denom = sxx - (sx * sx) / n;
    const slope = denom === 0 ? 0 : (sxy - (sx * sy) / n) / denom;
    const intercept = (sy - sx * slope) / n;
    const heightPx = px * slope + intercept;
    // angle = atan(slope) * 0.5 in Bogenmaß  →  Grad
    const angleDeg = (Math.atan(slope) * 0.5) * 180 / Math.PI;
    return { height: this._toLogicalY(heightPx), angle: angleDeg };
  }

  // ---- Modifikation --------------------------------------------------------

  /**
   * Explosion: Kreis um (lx, ly) mit Radius lr, zusätzlich ein Scorch-Ring
   * mit Breite lsw (Pixel zwischen lr und lr+lsw werden RGB-halbiert).
   */
  destroyCircle(lx, ly, lr, lsw) {
    const px = this._toPixelX(lx);
    const py = this._toPixelY(ly);
    const rPix = Math.max(1, lr * this.pixelWidthOverLogicalWidth);
    const sPix = Math.max(rPix, (lr + lsw) * this.pixelWidthOverLogicalWidth);

    const minX = Math.max(0, Math.floor(px - sPix));
    const maxX = Math.min(this.pixelWidth - 1, Math.ceil(px + sPix));
    const minY = Math.max(0, Math.floor(py - sPix));
    const maxY = Math.min(this.pixelHeight - 1, Math.ceil(py + sPix));

    const rPix2 = rPix * rPix;
    const sPix2 = sPix * sPix;
    const w = this.pixelWidth;
    const d = this.dirt;
    const sh = this.scanHeight;

    for (let col = minX; col <= maxX; col++) {
      const dx = col - px;
      const dx2 = dx * dx;
      let sawSolid = false;
      for (let row = maxY; row >= minY; row--) {
        const dy = row - py;
        const dist2 = dx2 + dy * dy;
        if (dist2 < rPix2) {
          if (!sawSolid) {
            if (sh[col] <= row) sh[col] = row;
            sawSolid = true;
          }
          const i = (row * w + col) * 4;
          d[i] = EXPLOSION_FILL_RGBA[0];
          d[i + 1] = EXPLOSION_FILL_RGBA[1];
          d[i + 2] = EXPLOSION_FILL_RGBA[2];
          d[i + 3] = EXPLOSION_FILL_RGBA[3];
        } else if (dist2 < sPix2) {
          if (!sawSolid) {
            if (sh[col] <= row) sh[col] = row;
            sawSolid = true;
          }
          const i = (row * w + col) * 4;
          d[i]     = d[i]     >> 1;
          d[i + 1] = d[i + 1] >> 1;
          d[i + 2] = d[i + 2] >> 1;
        }
      }
    }
    this._fullDirty = true;
  }

  /**
   * Errichtet eine vertikale Erd-Säule am X (Great Wall). Original: füllt
   * die volle Spaltenhöhe (vom Boden bis oben), aber nur Luft-Pixel (solides
   * Terrain bleibt). Textur vom Boden gesampelt.
   */
  createWall(lx, halfWidthLogical) {
    const px = this._toPixelX(lx);
    const wPix = Math.max(1, halfWidthLogical * this.pixelWidthOverLogicalWidth);
    const minX = Math.max(0, Math.floor(px - wPix));
    const maxX = Math.min(this.pixelWidth - 1, Math.ceil(px + wPix));
    const w = this.pixelWidth;
    const d = this.dirt;
    const sh = this.scanHeight;
    for (let col = minX; col <= maxX; col++) {
      const ground = this.getGroundLevelForColumn(col);
      const base = this._sampleGroundColorNear(col, Math.min(ground, this.pixelHeight - 1));
      let topFilled = this.pixelHeight;
      for (let row = 0; row < this.pixelHeight; row++) {
        const i = (row * w + col) * 4;
        if (d[i + 3] > ALPHA_SOLID_THRESHOLD) continue;   // solides Terrain bleibt
        const v = (Math.random() * 50 - 25) | 0;
        d[i]     = clampByte(base[0] + v + (Math.random() * 16 - 8));
        d[i + 1] = clampByte(base[1] + v + (Math.random() * 16 - 8));
        d[i + 2] = clampByte(base[2] + v + (Math.random() * 16 - 8));
        d[i + 3] = 255;
        if (row < topFilled) topFilled = row;
      }
      if (sh[col] <= this.pixelHeight - 1) sh[col] = this.pixelHeight - 1;
    }
    this._fullDirty = true;
  }

  /**
   * Eine ein-Pixel-Säule zerstören (für Penetrator/Excavator-artige Effekte).
   * Vorerst als Rechteck-Variante implementiert.
   */
  destroyWall(lx, lr, lsw) {
    const px = this._toPixelX(lx);
    const rPix = Math.max(1, lr * this.pixelWidthOverLogicalWidth);
    const sPix = Math.max(rPix, (lr + lsw) * this.pixelWidthOverLogicalWidth);
    const minX = Math.max(0, Math.floor(px - sPix));
    const maxX = Math.min(this.pixelWidth - 1, Math.ceil(px + sPix));
    const w = this.pixelWidth;
    const d = this.dirt;
    const sh = this.scanHeight;
    for (let col = minX; col <= maxX; col++) {
      const dx = Math.abs(col - px);
      const isFull = dx < rPix;
      const isScorch = !isFull && dx < sPix;
      let sawSolid = false;
      for (let row = this.pixelHeight - 1; row >= 0; row--) {
        const i = (row * w + col) * 4;
        if (isFull) {
          if (!sawSolid && d[i + 3] > 0) { if (sh[col] <= row) sh[col] = row; sawSolid = true; }
          d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
        } else if (isScorch) {
          if (!sawSolid && d[i + 3] > 0) { if (sh[col] <= row) sh[col] = row; sawSolid = true; }
          d[i]     = d[i]     >> 1;
          d[i + 1] = d[i + 1] >> 1;
          d[i + 2] = d[i + 2] >> 1;
        }
      }
    }
    this._fullDirty = true;
  }

  /**
   * Erde HINZUFÜGEN (Dirt Ball / Portable Mountain). Überschreibt KEIN
   * solides Terrain — füllt nur Luft-Pixel (alpha < SOLID). Die Farbe wird
   * vom Boden am Aufschlag gesampelt (+ Helligkeits-Variation), damit der
   * Hügel zur Umgebung passt statt einheitlich braun zu sein.
   */
  createCircle(lx, ly, lr) {
    const px = this._toPixelX(lx);
    const py = this._toPixelY(ly);
    const rPix = Math.max(1, lr * this.pixelWidthOverLogicalWidth);
    const minX = Math.max(0, Math.floor(px - rPix));
    const maxX = Math.min(this.pixelWidth - 1, Math.ceil(px + rPix));
    const minY = Math.max(0, Math.floor(py - rPix));
    const maxY = Math.min(this.pixelHeight - 1, Math.ceil(py + rPix));
    const rPix2 = rPix * rPix;
    const w = this.pixelWidth;
    const d = this.dirt;
    const sh = this.scanHeight;
    const base = this._sampleGroundColorNear(px, py);
    for (let col = minX; col <= maxX; col++) {
      const dx = col - px;
      const dx2 = dx * dx;
      let placed = false;
      for (let row = minY; row <= maxY; row++) {
        const dy = row - py;
        if (dx2 + dy * dy >= rPix2) continue;
        const i = (row * w + col) * 4;
        if (d[i + 3] > ALPHA_SOLID_THRESHOLD) continue;   // solides Terrain bleibt
        // Mehr Textur-Varianz: uniforme Helligkeit ±28 + per-Kanal-Jitter ±9
        const v = (Math.random() * 56 - 28) | 0;
        d[i]     = clampByte(base[0] + v + (Math.random() * 18 - 9));
        d[i + 1] = clampByte(base[1] + v + (Math.random() * 18 - 9));
        d[i + 2] = clampByte(base[2] + v + (Math.random() * 18 - 9));
        d[i + 3] = 255;
        placed = true;
      }
      if (placed && sh[col] <= maxY) sh[col] = maxY;
    }
    this._fullDirty = true;
  }

  /** Durchschnittsfarbe des Bodens nahe (px,py) — für passende Erd-Textur. */
  _sampleGroundColorNear(px, py) {
    const w = this.pixelWidth;
    const d = this.dirt;
    let r = 0, g = 0, b = 0, n = 0;
    const cx = Math.max(0, Math.min(w - 1, px));
    for (let dy = 0; dy < 80 && py + dy < this.pixelHeight; dy++) {
      const i = ((py + dy) * w + cx) * 4;
      if (d[i + 3] > ALPHA_SOLID_THRESHOLD) {
        r += d[i]; g += d[i + 1]; b += d[i + 2];
        if (++n >= 12) break;
      }
    }
    if (n === 0) return [110, 75, 45];
    return [(r / n) | 0, (g / n) | 0, (b / n) | 0];
  }

  /**
   * Ein-Pixel-Klumpen Erde am niedrigsten Punkt um col platzieren
   * (rollt in Mulden).
   */
  addClod(col, r, g, b) {
    if (col < 1 || col >= this.pixelWidth - 1) return;
    const hL = this.getGroundLevelForColumn(col - 1);
    const hM = this.getGroundLevelForColumn(col);
    const hR = this.getGroundLevelForColumn(col + 1);
    let placeCol = col;
    let placeRow;
    if (hM > hL && hR >= hL) { placeRow = hL - 1; placeCol = col - 1; }
    else if (hM > hR && hL >= hR) { placeRow = hR - 1; placeCol = col + 1; }
    else { placeRow = hM - 1; }
    if (placeRow < 0) return;
    const i = (placeRow * this.pixelWidth + placeCol) * 4;
    this.dirt[i]     = r;
    this.dirt[i + 1] = g;
    this.dirt[i + 2] = b;
    this.dirt[i + 3] = 255;
    if (this.scanHeight[placeCol] <= placeRow) this.scanHeight[placeCol] = placeRow;
    this._fullDirty = true;
  }

  // ---- Falling-Dirt-Physik -------------------------------------------------

  /**
   * Falling-Dirt-Physik. Führt mehrere 1-Pixel-Fallschritte pro Tick aus,
   * damit der Fall bei höherer Render-Auflösung nicht zäh wirkt (1 Pixel
   * von 640 pro Frame wäre extrem langsam). Nur EIN putImageData am Ende.
   * Setzt this.ready = false solange noch was fällt.
   */
  advance() {
    const steps = Math.max(2, Math.round(this.pixelHeightOverLogicalHeight * 2.5));
    let dirty = false;
    for (let s = 0; s < steps; s++) {
      const moved = this._fallStep();
      if (moved) dirty = true;
      if (this.ready) break;   // alles zur Ruhe gekommen
    }
    if (dirty) this._fullDirty = true;
  }

  /** Ein einzelner Fall-Durchlauf (1 Reihe). Liefert true, wenn etwas fiel. */
  _fallStep() {
    this.ready = true;
    const w = this.pixelWidth;
    const d = this.dirt;
    const sh = this.scanHeight;
    let anyMoved = false;

    for (let col = 0; col < w; col++) {
      const scanY = sh[col];
      if (scanY < 0) continue;   // settled
      let colMoved = false;
      let belowWasAir = 0;

      for (let dy = 0; dy <= scanY; dy++) {
        const row = scanY - dy;
        if (row < 0) break;
        const i = (row * w + col) * 4;
        const isAir = d[i + 3] === 0 ? 1 : 0;
        if (((1 - isAir) & belowWasAir) !== 0) {
          const dst = ((row + 1) * w + col) * 4;
          d[dst]     = d[i];
          d[dst + 1] = d[i + 1];
          d[dst + 2] = d[i + 2];
          d[dst + 3] = d[i + 3];
          d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
          colMoved = true;
          belowWasAir = 1;
        } else {
          belowWasAir = isAir;
        }
      }

      if (colMoved) { this.ready = false; anyMoved = true; }
      else sh[col] = -1;
    }
    return anyMoved;
  }

  // ---- Render --------------------------------------------------------------

  /** Zeichne in einen 2D-Context. Position via logicalX/Y. */
  render(ctx) {
    if (this._fullDirty) {
      // Pixel-Buffer ins Offscreen-Canvas spiegeln (das hat einen
      // ECHTEN Alpha-Channel, anders als unser Hauptcanvas).
      this._offctx.putImageData(this.imageData, 0, 0);
      this._fullDirty = false;
    }
    // drawImage respektiert source-alpha → transparente Pixel des
    // Terrains lassen den darunter gezeichneten Sky durchscheinen.
    // Explizite Zielgröße = logische Fläche: der Offscreen kann eine höhere
    // Pixelauflösung haben (RENDER_SCALE) als die logische Welt — drawImage
    // mappt sauber zurück, der ctx-Scale macht die Vergrößerung.
    ctx.drawImage(this._offscreen,
      0, 0, this.pixelWidth, this.pixelHeight,
      this.logicalX, this.logicalY, this.logicalWidth, this.logicalHeight);
  }
}

// Schnelle Unit-Tests für DirtField. Läuft in Node mit:
//   node web/test/terrain.test.mjs
//
// Wir mocken ImageData/OffscreenCanvas auf das Minimum, das DirtField braucht.

import assert from "node:assert/strict";

globalThis.ImageData = class {
  constructor(data, w, h) { this.data = data; this.width = w; this.height = h; }
};
// OffscreenCanvas brauchen wir, da DirtField im Konstruktor einen erzeugt.
// Mock: minimaler getContext("2d") mit no-op putImageData/drawImage.
globalThis.OffscreenCanvas = class {
  constructor(w, h) { this.width = w; this.height = h; }
  getContext() {
    return {
      putImageData: () => {},
      drawImage: () => {},
      fillRect: () => {},
      clearRect: () => {},
    };
  }
};

const { DirtField } = await import("../src/game/terrain.js");

// Hilfsfunktion: ein 10x10 Feld mit "Bodenhalbe": untere 5 Reihen voll, obere leer.
function makeHalfFilledField() {
  const f = new DirtField(10, 10, 0, 0, 10, 10);
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const i = (row * 10 + col) * 4;
      if (row >= 5) {
        f.dirt[i]   = 120;
        f.dirt[i+1] = 80;
        f.dirt[i+2] = 40;
        f.dirt[i+3] = 255;
      }
    }
  }
  return f;
}

// 1) isSolid
{
  const f = makeHalfFilledField();
  assert.equal(f.isSolid(5, 7), true, "Boden bei (5,7) muss solid sein");
  assert.equal(f.isSolid(5, 2), false, "Luft bei (5,2) darf nicht solid sein");
  assert.equal(f.isSolid(5, -1), false, "über dem Feld nicht solid");
  assert.equal(f.isSolid(5, 99), true, "unter dem Feld immer solid");
  assert.equal(f.isSolid(-1, 7), false, "links vom Feld nicht solid");
  console.log("ok  isSolid");
}

// 2) getGroundLevelForColumn
{
  const f = makeHalfFilledField();
  assert.equal(f.getGroundLevelForColumn(5), 5, "Boden beginnt bei row 5");
  assert.equal(f.getGroundLevelForColumn(0), 5);
  assert.equal(f.getGroundLevelForColumn(9), 5);
  console.log("ok  getGroundLevelForColumn");
}

// 3) computeHeightAndAngle auf ebenem Boden ⇒ Winkel ≈ 0
{
  const f = makeHalfFilledField();
  const { height, angle } = f.computeHeightAndAngle(5);
  assert.ok(Math.abs(angle) < 0.001, `Ebener Boden, Winkel sollte 0 sein, ist ${angle}`);
  assert.equal(Math.round(height), 5, "Höhe ≈ 5 (Pixel-Reihe 5)");
  console.log("ok  computeHeightAndAngle (eben)");
}

// 4) computeHeightAndAngle auf Hang: Boden sinkt nach rechts ab
{
  const f = new DirtField(20, 20, 0, 0, 20, 20);
  for (let col = 0; col < 20; col++) {
    const groundRow = 5 + Math.floor(col / 2);   // sinkt 1 Reihe pro 2 Spalten
    for (let row = groundRow; row < 20; row++) {
      const i = (row * 20 + col) * 4;
      f.dirt[i+3] = 255;
    }
  }
  const { angle } = f.computeHeightAndAngle(10);
  assert.ok(angle > 5 && angle < 25, `Hang sollte +Winkel geben, ist ${angle.toFixed(2)}°`);
  console.log("ok  computeHeightAndAngle (Hang +)", angle.toFixed(2) + "°");
}

// 5) destroyCircle: Pixel im Radius werden 0, scanHeight wird gesetzt
{
  const f = makeHalfFilledField();
  f.destroyCircle(5, 7, 2, 0);     // radius 2, kein scorch
  assert.equal(f.isSolid(5, 7), false, "Zentrum muss zerstört sein");
  assert.equal(f.isSolid(5, 4), false, "über dem Boden weiterhin Luft");
  assert.equal(f.isSolid(5, 8), false, "Pixel direkt unter Zentrum (dist=1) auch weg");
  assert.equal(f.isSolid(5, 9), true,  "Pixel am Rand (dist=2 = radius) bleibt — `dist < radius` strikt");
  // scanHeight sollte für betroffene Spalten >= 0 sein
  const sh = f.scanHeight[5];
  assert.ok(sh >= 0, `scanHeight an Spalte 5 muss aktiv sein, ist ${sh}`);
  console.log("ok  destroyCircle (Kern weg, scanHeight aktiv)");
}

// 6) Falling-Dirt: Erde über einem Loch fällt um 1 Reihe pro Tick
{
  const f = new DirtField(3, 8, 0, 0, 3, 8);
  // Spalte 1: row 3 voll, row 4 leer, row 5-7 voll  →  row 3 sollte fallen
  for (let row = 3; row < 8; row++) {
    if (row === 4) continue;
    const i = (row * 3 + 1) * 4;
    f.dirt[i] = 100; f.dirt[i+1] = 100; f.dirt[i+2] = 100; f.dirt[i+3] = 255;
  }
  f.scanHeight[1] = 5;     // wir markieren, dass Spalte instabil ist
  f.advance();
  // Nach einem Tick: row 3 ist leer, row 4 ist gefüllt
  assert.equal(f.dirt[(3*3+1)*4+3], 0,   "row 3 muss leer sein nach Fall");
  assert.equal(f.dirt[(4*3+1)*4+3], 255, "row 4 muss jetzt gefüllt sein");
  console.log("ok  advance (Pixel fällt 1 Reihe)");
}

// 7) Falling-Dirt-Kaskade: zwei gestapelte Pixel über Loch sollten beide fallen
{
  const f = new DirtField(3, 8, 0, 0, 3, 8);
  // Spalte 1: row 2 voll, row 3 voll, row 4 leer, row 5-7 voll
  for (const row of [2, 3, 5, 6, 7]) {
    const i = (row * 3 + 1) * 4;
    f.dirt[i+3] = 255;
  }
  f.scanHeight[1] = 5;
  f.advance();
  // Beide oberen Pixel sollten um 1 nach unten verschoben sein:
  // Ergebnis: row 2 leer, row 3 voll, row 4 voll, row 5-7 voll
  assert.equal(f.dirt[(2*3+1)*4+3], 0,   "row 2 muss leer sein");
  assert.equal(f.dirt[(3*3+1)*4+3], 255, "row 3 weiterhin voll");
  assert.equal(f.dirt[(4*3+1)*4+3], 255, "row 4 muss jetzt gefüllt sein");
  console.log("ok  advance (Kaskade — Stack rutscht 1 Pixel)");
}

// 8) ready-Flag: false während großem Fall, true wenn alles ruht
{
  // Hohe Spalte mit großer Luftlücke, damit ein advance() (mehrere interne
  // Schritte) NICHT sofort fertig ist.
  const H = 40;
  const f = new DirtField(3, H, 0, 0, 3, H);
  f.dirt[(2 * 3 + 1) * 4 + 3] = 255;       // ein Pixel ganz oben (row 2)
  f.dirt[((H - 1) * 3 + 1) * 4 + 3] = 255; // Boden ganz unten
  // scanHeight = tiefster instabiler Punkt (knapp über Boden); die Fall-
  // Logik scannt von dort aufwärts.
  f.scanHeight[1] = H - 2;
  f.advance();
  assert.equal(f.ready, false, "großer Fall: nach einem advance noch nicht fertig");
  // Genug Ticks, bis alles ruht
  for (let i = 0; i < H; i++) f.advance();
  assert.equal(f.ready, true, "nach Beruhigung muss ready=true sein");
  assert.equal(f.scanHeight[1], -1, "Spalte muss als settled markiert sein");
  // Pixel ist bis kurz über den Boden gefallen
  assert.equal(f.dirt[((H - 2) * 3 + 1) * 4 + 3], 255, "Pixel liegt auf dem Boden auf");
  console.log("ok  ready-Flag + Spalte-settled (Mehrschritt-Fall)");
}

// 9) createCircle: füllt Luft-Pixel (additiv), überschreibt KEIN solides Terrain
{
  const f = makeHalfFilledField();
  // Boden bei row 5 hat Farbe (120,80,40). Merke einen soliden Pixel.
  const solidIdx = (6 * 10 + 5) * 4;
  const beforeR = f.dirt[solidIdx];
  f.createCircle(5, 2, 2);                 // Luft-Bereich oben füllen
  assert.equal(f.isSolid(5, 2), true, "neuer Luft-Pixel wird solid");
  // Solides Terrain darunter bleibt unverändert (additiv, nicht überschrieben)
  assert.equal(f.dirt[solidIdx], beforeR, "vorhandenes Terrain bleibt erhalten");
  console.log("ok  createCircle (additiv, Terrain bleibt)");
}

console.log("\n→ alle Tests bestanden");

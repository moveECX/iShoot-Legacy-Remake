// Save/Resume — Original-Pendant: GameState.saveWithName: / loadWithName: aus
// dem iOS-Build (NSKeyedArchiver in NSUserDefaults). Im Web-Remake sichern
// wir den Match-Snapshot komprimiert in localStorage.
//
// Schema-Version inkrementieren, sobald sich das Layout inkompatibel ändert.
//
// Was wird gespeichert:
//   - Match-Kopfdaten (round/turn/cursor/wind/state/winner/whiteoutFrames/shake)
//   - rulesetName + Landscape/Sky-Namen (Rules + Assets werden beim Load neu aufgelöst)
//   - Pro Tank: alle Spielzustands-Felder (siehe TANK_FIELDS); _tintedBody/_tintedBarrel
//     werden NICHT serialisiert und auf restoreMatch() neu via setSprites() erzeugt.
//   - DirtField: pixelWidth/Height, logical-Box, scanHeight, dirt (RLE + deflate-raw, base64).
//
// Async, weil die CompressionStream-API Stream-basiert ist.

import { DirtField } from "./terrain.js";
import { Tank } from "./tank.js";
import { Match } from "./match.js";

const SCHEMA_VERSION = 1;
const STORAGE_PREFIX = "ishoot.save.v1.";
const INDEX_KEY = "ishoot.save.v1.index";
export const SLOT_COUNT = 3;

const TANK_FIELDS = [
  "name", "x", "y", "color", "style", "controller",
  "health", "maxHealth", "angle", "bodyAngle", "facingLeft",
  "fuel", "cash", "cashAtTurnStart", "kills", "deaths", "wins",
  "weapons", "selectedWeapon", "falling", "fallVelocity", "fellFromY",
  "shotQuotes", "killQuotes", "deathQuotes",
];

// ---------------------------------------------------------------------------
// Komprimierung
// ---------------------------------------------------------------------------

/**
 * RLE über RGBA-Pixel: schreibt [count, r, g, b, a]-Tupel als Uint8-Stream.
 * count ist auf 255 begrenzt (längere Runs werden gesplittet). Spart bei
 * iShoot-Maps massiv, weil der Sky-Bereich alpha=0 und der Boden große
 * Flächen ähnlicher Farben hat.
 *
 * Worst case (jeder Pixel anders): 5/4 = 1.25× — danach übernimmt deflate.
 */
function rleEncodePixels(rgba) {
  // Obergrenze grosszügig schätzen, dann am Ende slicen.
  const out = new Uint8Array(rgba.length + (rgba.length / 4) | 0);
  let oi = 0;
  let i = 0;
  const n = rgba.length;
  while (i < n) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];
    let count = 1;
    let j = i + 4;
    while (j < n && count < 255
        && rgba[j] === r && rgba[j + 1] === g
        && rgba[j + 2] === b && rgba[j + 3] === a) {
      count++; j += 4;
    }
    out[oi++] = count;
    out[oi++] = r; out[oi++] = g; out[oi++] = b; out[oi++] = a;
    i = j;
  }
  return out.subarray(0, oi);
}

function rleDecodePixels(rle, pixelCount) {
  const out = new Uint8ClampedArray(pixelCount * 4);
  let oi = 0;
  for (let i = 0; i < rle.length; i += 5) {
    const count = rle[i];
    const r = rle[i + 1], g = rle[i + 2], b = rle[i + 3], a = rle[i + 4];
    for (let k = 0; k < count; k++) {
      out[oi++] = r; out[oi++] = g; out[oi++] = b; out[oi++] = a;
    }
  }
  return out;
}

async function deflateRaw(bytes) {
  const cs = new CompressionStream("deflate-raw");
  const blob = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).blob();
  return new Uint8Array(await blob.arrayBuffer());
}

async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const blob = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).blob();
  return new Uint8Array(await blob.arrayBuffer());
}

function bytesToBase64(bytes) {
  // String.fromCharCode auf grossen Arrays ist stack-empfindlich → chunked.
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

async function encodeDirt(dirtField) {
  const rle = rleEncodePixels(dirtField.dirt);
  const compressed = await deflateRaw(rle);
  return {
    pixelWidth: dirtField.pixelWidth,
    pixelHeight: dirtField.pixelHeight,
    logicalX: dirtField.logicalX,
    logicalY: dirtField.logicalY,
    logicalWidth: dirtField.logicalWidth,
    logicalHeight: dirtField.logicalHeight,
    scanHeight: Array.from(dirtField.scanHeight),
    rleB64: bytesToBase64(compressed),
  };
}

async function decodeDirt(d) {
  const field = new DirtField(
    d.pixelWidth, d.pixelHeight,
    d.logicalX, d.logicalY, d.logicalWidth, d.logicalHeight,
  );
  const rle = await inflateRaw(base64ToBytes(d.rleB64));
  const pixels = rleDecodePixels(rle, d.pixelWidth * d.pixelHeight);
  field.dirt.set(pixels);
  field.scanHeight.set(d.scanHeight);
  field.ready = true;
  field._fullDirty = true;
  return field;
}

function encodeTank(tank) {
  const out = {};
  for (const k of TANK_FIELDS) out[k] = tank[k];
  // Inventar tief kopieren — sonst teilt sich der Restore die Referenzen
  // mit dem laufenden Match.
  out.weapons = tank.weapons.map((w) => ({ ...w }));
  return out;
}

function decodeTank(data, assets) {
  const t = new Tank({
    name: data.name, x: data.x, y: data.y,
    color: data.color, style: data.style, controller: data.controller,
  });
  for (const k of TANK_FIELDS) if (k in data) t[k] = data[k];
  t.weapons = data.weapons.map((w) => ({ ...w }));
  if (assets) t.setSprites(assets);
  return t;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Snapshot des Matches in Slot `slot` (0-basiert) speichern.
 * `meta` darf Anzeigedaten enthalten (z.B. landscapeName/skyName aus main.js).
 */
export async function saveGame(match, slot, meta = {}) {
  if (slot < 0 || slot >= SLOT_COUNT) throw new Error(`bad slot ${slot}`);
  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    savedAt: Date.now(),
    rulesetName: match.rules?.rulesetName ?? null,
    landscapeName: meta.landscapeName ?? null,
    skyName: meta.skyName ?? null,
    match: {
      width: match.width,
      height: match.height,
      round: match.round,
      turn: match.turn,
      currentPlayerIndex: match.currentPlayerIndex,
      wind: match.wind,
      state: match.state === "gameover" ? "aim" : match.state, // wir laden nie ein abgeschlossenes Match in nicht-spielbarem State
      winner: match.winner ? match.tanks.indexOf(match.winner) : -1,
      whiteoutFrames: match.whiteoutFrames,
      shake: match.shake,
    },
    tanks: match.tanks.map(encodeTank),
    dirt: await encodeDirt(match.dirtField),
  };
  const json = JSON.stringify(snapshot);
  try {
    localStorage.setItem(STORAGE_PREFIX + slot, json);
  } catch (e) {
    throw new Error(`localStorage voll? (${json.length} bytes): ${e.message}`);
  }
  updateIndex(slot, {
    savedAt: snapshot.savedAt,
    rulesetName: snapshot.rulesetName,
    landscapeName: snapshot.landscapeName,
    round: snapshot.match.round,
    turn: snapshot.match.turn,
    players: snapshot.tanks.map((t) => ({ name: t.name, dead: t.health <= 0 })),
    bytes: json.length,
  });
  return { bytes: json.length };
}

/**
 * Slot lesen, Match + DirtField rekonstruieren. Caller ist verantwortlich
 * für: Sky/Landscape-Bild via `assets.loadImage(skyName)` ggf. neu zu laden
 * (das DirtField *ist* schon wiederhergestellt, aber Sky-Bild liegt auf
 * dem Canvas-Background).
 *
 * @param {number}  slot
 * @param {object}  ctx   { data, assets } — data: GameData, assets: Assets
 * @returns {Promise<{match: Match, snapshot: object}>}
 */
export async function loadGame(slot, { data, assets }) {
  const json = localStorage.getItem(STORAGE_PREFIX + slot);
  if (!json) throw new Error(`slot ${slot} leer`);
  const snap = JSON.parse(json);
  if (snap.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`schema v${snap.schemaVersion} ≠ v${SCHEMA_VERSION}`);
  }
  const rules = data.ruleSet(snap.rulesetName);
  const dirtField = await decodeDirt(snap.dirt);
  const tanks = snap.tanks.map((t) => decodeTank(t, assets));

  // Match-Constructor ruft _initRound() auf — das würde Tanks neu plazieren.
  // Trick: Mit leerem Tanks-Array konstruieren, dann State drüberbügeln.
  const match = new Match({
    dirtField,
    tanks: [], // _initRound macht ohne Tanks nichts kaputt
    rules,
    width: snap.match.width,
    height: snap.match.height,
  });
  match.tanks = tanks;
  match.round = snap.match.round;
  match.turn = snap.match.turn;
  match.currentPlayerIndex = snap.match.currentPlayerIndex;
  match.wind = snap.match.wind;
  match.state = snap.match.state;
  match.winner = snap.match.winner >= 0 ? tanks[snap.match.winner] : null;
  match.whiteoutFrames = snap.match.whiteoutFrames;
  match.shake = snap.match.shake;
  return { match, snapshot: snap };
}

/** Slot-Übersicht für den Save/Load-Picker. */
export function listSaves() {
  const idx = readIndex();
  const out = [];
  for (let i = 0; i < SLOT_COUNT; i++) out.push({ slot: i, ...(idx[i] ?? null) });
  return out;
}

export function deleteSave(slot) {
  localStorage.removeItem(STORAGE_PREFIX + slot);
  const idx = readIndex();
  delete idx[slot];
  localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
}

export function hasSave(slot) {
  return localStorage.getItem(STORAGE_PREFIX + slot) !== null;
}

// ---------------------------------------------------------------------------
// Index — kleine Metadaten-Datei, damit listSaves() nicht jedes Save parsen muss
// ---------------------------------------------------------------------------

function readIndex() {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) || "{}");
  } catch {
    return {};
  }
}

function updateIndex(slot, entry) {
  const idx = readIndex();
  idx[slot] = entry;
  localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
}

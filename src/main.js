// Bootstrap: Menü → Match.

import { Assets } from "./engine/assets.js";
import { GameData } from "./game/data.js";
import { createLoop } from "./engine/loop.js";
import { bindInput } from "./engine/input.js";
import { DirtField } from "./game/terrain.js";
import { Tank } from "./game/tank.js";
import { Match } from "./game/match.js";
import { Hud } from "./ui/hud.js";
import { Shop } from "./ui/shop.js";
import { Menu } from "./ui/menu.js";
import { Title } from "./ui/title.js";
import { Pause } from "./ui/pause.js";
import { RuleEditor } from "./ui/rule_editor.js";
import { WeaponEditor } from "./ui/weapon_editor.js";
import { Profiles } from "./game/profile.js";
import { saveGame, loadGame, listSaves, deleteSave, SLOT_COUNT } from "./game/save.js";
import { settings, loadSettings, actionForKey, SettingsUI } from "./ui/settings.js";

loadSettings();   // füllt `settings` aus localStorage, bevor wir renderScale lesen

// LOGISCHE Welt (Gameplay-Koordinaten) — bleibt immer 480×320, damit alle
// Physik-/AI-Konstanten unverändert gelten.
const W = 480, H = 320;

/** Render-Skalierung: interne Pixel-Auflösung = LOGICAL × renderScale. */
let renderScale = settings.renderScale;

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d", { alpha: false });
const statusEl = document.getElementById("status");
const infoEl = document.getElementById("info");

function applyCanvasResolution() {
  canvas.width = W * renderScale;
  canvas.height = H * renderScale;
  ctx.imageSmoothingEnabled = false;   // pixel-scharfe Sprites
}
applyCanvasResolution();

const assets = new Assets();
const data = new GameData();
// DirtField bei interner Pixel-Auflösung, aber logischer Welt 480×320.
let dirtField = new DirtField(W * renderScale, H * renderScale, 0, 0, W, H);

let match = null;
let hud = null;
let shop = null;
let menu = null;
let title = null;
let pause = null;
let ruleEditor = null;
let weaponEditor = null;
let settingsUI = null;
const profiles = new Profiles();
let skyImage = null;
let paused = false;
let showHitboxes = false;        // Debug: Tank-Bounding-Boxes anzeigen (Taste H)
const driveKeys = { left: false, right: false };

// Geladene Sprite-Kategorien — Tanks + alle Geschosse + Explosions-Texturen
// + Effekte (Smoke). Macht ~50 PNGs, in Summe ein paar 100 KB.
const REQUIRED_CATEGORIES = [
  "sprite_tank",
  "sprite_projectile",
  "sprite_explosion",
  "sprite_effect",
];

// Diese SFX werden im Hintergrund vorgeladen — decken die häufigsten
// Waffen ab. Weitere lädt assets.playSfx bei Bedarf nach.
const PRELOAD_SFX = [
  "Explosion Short 02.wav",   // launchSound (most common)
  "Explosion Small 03.wav",   // shell explosion
  "Fireball.wav",             // rocket launch
  "Rocket.wav",               // rocket explosion
  "Grenade.wav",              // cluster bomb
  "Atomic Blast 02.wav",      // nuke
  "Explosion Short 01.wav",
  "Explosion Small 01.wav",
  "Explosion Small 02.wav",
];

let bgMusic = null;

const DEFAULT_INVENTORY = [
  { key: "miniMortar",      count: -1 },
  { key: "mortar",          count: 5 },
  { key: "megaMortar",      count: 3 },
  { key: "miniClusterBomb", count: 2 },
  { key: "roller",          count: 2 },
  { key: "shotgun",         count: 2 },
  { key: "tacticalNuke",    count: 1 },
];

async function init() {
  statusEl.textContent = "loading…";
  await Promise.all([assets.loadIndex(), data.load()]);
  await assets.loadImagesByCategory(...REQUIRED_CATEGORIES);
  statusEl.textContent = "menu";

  // UI-Layer erstellen
  menu = new Menu(data, (cfg) => startNewMatch(cfg));
  ruleEditor = new RuleEditor(data, (overrides) => {
    const cur = menu.getRuleOverrides() || {};
    menu.setRuleOverrides({ ...cur, ...(overrides || {}) });
  });
  weaponEditor = new WeaponEditor(data, assets, (overrides) => {
    const cur = menu.getRuleOverrides() || {};
    menu.setRuleOverrides({ ...cur, ...(overrides || {}) });
  });
  menu.setRuleEditorHook(() => ruleEditor.open(menu.modeSel.value, menu.getRuleOverrides() || {}));
  menu.setWeaponEditorHook(() => weaponEditor.open(menu.modeSel.value, menu.getRuleOverrides() || {}));
  settingsUI = new SettingsUI(() => {
    renderScale = settings.renderScale;     // greift beim nächsten Match
    refreshAudioSettings();
  });
  title = new Title({
    assets,
    onNewGame: () => menu.show(),
    onLoad:    () => openLoadDialog(),
    onSettings: () => settingsUI.open(),
    onShowProfiles: () => showProfilesPanel(),
    onShowHelp: () => window.open("./assets/manual/index.html", "_blank"),
  });
  pause = new Pause({
    onResume: () => { paused = false; statusEl.textContent = "ready"; },
    onSave:   (slot) => doSave(slot),
    onLoad:   (slot) => doLoad(slot),
    onQuit:   () => returnToTitle(),
    listSaves: () => listSaves(),
  });
  // "Laden..."-Button im Setup → wie auf Title-Screen
  document.getElementById("menu-load")?.addEventListener("click", () => openLoadDialog());

  title.show();

  bindInput(canvas, {
    onPointerDown: (e) => {
      if (!match || e.button !== 0) return;
      if (match.state === "gameover") return;
      const cur = match.currentTank();
      if (cur?.controller > 0) return;   // CPU spielt
      // Tap-to-Aim: gleicher Klick zielt UND startet Charge (Original-Verhalten)
      if (match.isAcceptingInput() && cur) cur.aimAt(e.x, e.y);
      hud.startCharging();
    },
    onPointerMove: (e) => {
      if (match?.isAcceptingInput() && match.currentTank()?.controller === 0) {
        match.currentTank().aimAt(e.x, e.y);
      }
    },
    onPointerUp: (e) => {
      if (!match || e.button !== 0) return;
      const power = hud.releaseCharge();
      if (power > 5 && match.currentTank()?.controller === 0) match.fire(power);
    },
    onKeyDown: (e) => {
      // Debug: Hitboxen ein/aus (feste Taste, unabhängig von Keybindings)
      if (e.code === "KeyH" && !isBlockingModalOpen()) { showHitboxes = !showHitboxes; return; }
      // Vollbild-Modale (Title/Menu/Settings/Editoren) schlucken Spiel-Tasten.
      if (isBlockingModalOpen()) return;
      const action = actionForKey(e.code);
      // Modal-Sperren: Shop blockt außer Shop-Toggle + Pause; Pause blockt außer Pause
      if (shop?.isOpen && action !== "shop" && action !== "pause") return;
      if (pause?.isOpen && action !== "pause") return;

      if (action === "newMap") { e.preventDefault(); openMenu(); }
      else if (e.code === "Space") { e.preventDefault(); paused = !paused; statusEl.textContent = paused ? "PAUSED" : "ready"; }
      else if (action === "driveLeft")  driveKeys.left = true;
      else if (action === "driveRight") driveKeys.right = true;
      else if (action === "prevWeapon") {
        const cur = match?.currentTank();
        if (cur?.controller === 0) cur.previousWeapon();
      }
      else if (action === "nextWeapon") {
        const cur = match?.currentTank();
        if (cur?.controller === 0) cur.nextWeapon();
      }
      else if (action === "shop") shop?.toggle();
      else if (action === "pause") {
        if (shop?.isOpen) shop.close();
        else if (pause?.isOpen) pause.close();
        else if (match && match.state !== "gameover") {
          paused = true;
          statusEl.textContent = "PAUSED";
          pause.open();
        }
      }
    },
    onKeyUp: (e) => {
      const action = actionForKey(e.code);
      if (action === "driveLeft")  driveKeys.left = false;
      else if (action === "driveRight") driveKeys.right = false;
    },
  }, { width: W, height: H });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  createLoop({ onTick: tick, onRender: render }).start();
}

/** True, wenn ein Vollbild-Overlay offen ist, das Spiel-Tastatureingaben sperren soll. */
function isBlockingModalOpen() {
  for (const id of ["title", "menu", "settings", "ruleeditor", "weaponeditor"]) {
    const el = document.getElementById(id);
    if (el && !el.hidden) return true;
  }
  return false;
}

function openMenu() {
  match = null;
  hud = null;
  shop = null;
  skyImage = null;
  dirtField.dirt.fill(0);
  dirtField.scanHeight.fill(-1);
  dirtField._fullDirty = true;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  menu.show();
}

function returnToTitle() {
  paused = false;
  match = null;
  hud = null;
  shop = null;
  skyImage = null;
  dirtField.dirt.fill(0);
  dirtField.scanHeight.fill(-1);
  dirtField._fullDirty = true;
  title.show();
  statusEl.textContent = "title";
}

/** Rule-Editor-Overrides anwenden. Kommt aus rule_editor.js, kann null sein. */
function applyRuleOverrides(rules, overrides) {
  if (!overrides) return rules;
  return { ...rules, ...overrides };
}

/** Lädt entweder das PNG-Landscape oder generiert eine Spline-Landschaft,
 *  je nachdem ob `rules.splineLandscapeFrequency` zuschlägt. Wenn kein
 *  Landscape-Bild vorliegt (Load-Fehler), wird immer Spline generiert. */
function loadLandscapeIntoDirtField(landImg, landscapeName, rules) {
  const splineChance = (rules.splineLandscapeFrequency ?? 0) / 100;
  const wantSpline = !landImg || Math.random() < splineChance;
  if (wantSpline) {
    const groundImg = assets.images.get(data.pickRandomGroundTile());
    if (groundImg) {
      dirtField.createSplineLandscape(groundImg);
      return;
    }
  }
  if (landImg) dirtField.loadFromImage(landImg);
}

// ---- Match-Lifecycle-Callbacks ---------------------------------------------

function onMatchOver(m) {
  // Stats aller Tanks persistieren — Sieger bekommt match-win-Flag.
  for (const t of m.tanks) {
    profiles.recordMatch(t, t === m.winner);
  }
}

function onRoundOver(m) {
  // Nach kurzer Pause Karte neu laden + beginNewRound.
  setTimeout(() => {
    if (!match || match.state !== "roundover") return;
    const pick = data.pickRandomLandscape();
    Promise.all([
      assets.loadImage(pick.landscape).catch(() => null),
      assets.loadImage(pick.sky).catch(() => null),
    ]).then(([land, sky]) => {
      loadLandscapeIntoDirtField(land, pick.landscape, m.rules);
      skyImage = sky;   // null = einfarbiger Hintergrund, kein Crash
      m.currentLandscapeName = pick.landscape;
      m.currentSkyName = pick.sky;
      m.beginNewRound();
    });
  }, 2000);
}

// ---- Save/Load -------------------------------------------------------------

async function doSave(slot) {
  if (!match) return;
  try {
    await saveGame(match, slot, {
      landscapeName: match.currentLandscapeName,
      skyName: match.currentSkyName,
    });
    statusEl.textContent = `gespeichert · Slot ${slot + 1}`;
  } catch (e) {
    console.error(e);
    statusEl.textContent = `Save-Fehler: ${e.message}`;
  }
}

async function doLoad(slot) {
  try {
    const { match: m, snapshot } = await loadGame(slot, { data, assets });
    // Sky neu laden
    if (snapshot.skyName) skyImage = await assets.loadImage(snapshot.skyName);
    // Geladenes DirtField direkt übernehmen (hat die im Save gespeicherte
    // Pixel-Auflösung) und Canvas/renderScale daran anpassen.
    dirtField = m.dirtField;
    dirtField._fullDirty = true;
    const inferredScale = Math.round(dirtField.pixelWidth / W);
    if ([1, 2, 3].includes(inferredScale)) {
      renderScale = inferredScale;
      applyCanvasResolution();
    }
    for (const t of m.tanks) t.setSprites(assets);
    match = m;
    match.playSfx = (name) => { if (settings.soundOn) assets.playSfx(name); };
    match.onMatchOver = () => onMatchOver(match);
    match.onRoundOver = () => onRoundOver(match);
    hud = new Hud(match, assets);
    shop = new Shop(match);
    pause.bindMatch(match);
    paused = false;
    title.hide();
    menu.hide();
    statusEl.textContent = "ready";
  } catch (e) {
    console.error(e);
    statusEl.textContent = `Load-Fehler: ${e.message}`;
  }
}

function openLoadDialog() {
  const saves = listSaves();
  const lines = saves.map((s) =>
    s.savedAt
      ? `${s.slot + 1}: ${s.rulesetName ?? "?"} R${s.round ?? 0}  ${new Date(s.savedAt).toLocaleString()}`
      : `${s.slot + 1}: (leer)`,
  );
  const raw = prompt("Slot wählen:\n" + lines.join("\n"), "1");
  if (!raw) return;
  const slot = parseInt(raw, 10) - 1;
  if (Number.isFinite(slot) && saves[slot]?.savedAt) doLoad(slot);
}

function showProfilesPanel() {
  const list = profiles.all();
  if (list.length === 0) { alert("Noch keine Stats — spiel eine Runde."); return; }
  const lines = list.map((p) => {
    const [name] = p.key.split("|");
    return `${name.padEnd(14)}  ${p.wins}W ${p.kills}K ${p.deaths}D  (${p.matchesPlayed} Matches)`;
  });
  alert("Bestenliste:\n" + lines.join("\n"));
}

function startBackgroundMusic() {
  if (bgMusic) { refreshAudioSettings(); return; }
  const idx = (Math.random() * 4) | 0;
  try {
    const audio = new Audio(assets.pathOf(`Music${idx}.mp3`));
    audio.loop = true;
    audio.volume = settings.musicVolume;
    audio.muted = !settings.musicOn;
    if (settings.musicOn) audio.play().catch(() => {});
    bgMusic = audio;
  } catch {
    /* Pfad evtl. nicht gemappt — Musik ist optional */
  }
}

/** Audio-Settings auf laufende Musik anwenden (nach Settings-Änderung). */
function refreshAudioSettings() {
  if (bgMusic) {
    bgMusic.volume = settings.musicVolume;
    bgMusic.muted = !settings.musicOn;
    if (settings.musicOn && bgMusic.paused) bgMusic.play().catch(() => {});
    if (!settings.musicOn && !bgMusic.paused) bgMusic.pause();
  }
}

function tick() {
  if (paused || !match || !hud) return;
  if (match.isAcceptingInput() && !hud.charging) {
    const t = match.currentTank();
    if (t?.controller === 0) {
      if (driveKeys.left)  t.drive(-1, dirtField, match.tanks, match.rules);
      if (driveKeys.right) t.drive(+1, dirtField, match.tanks, match.rules);
    }
  }
  hud.tick();
  match.tick();

  // FastForward NUR während der CPU am Zug ist — entscheidend ist der
  // aktuelle Spieler, nicht weapon.source (die Death-Explosion eines
  // CPU-Opfers hätte sonst bei einem Menschen-Schuss FF getriggert →
  // "alles nach der Explosion im Zeitraffer"-Bug).
  if (match.rules.fastForward) {
    const cur = match.currentTank();
    const cpuTurn = cur && cur.controller > 0
      && match.state !== "gameover" && match.state !== "roundover";
    if (cpuTurn) {
      for (let i = 0; i < 3 && match.state !== "gameover" && match.state !== "roundover"; i++) {
        match.tick();
      }
    }
  }
}

function render() {
  // Alles in LOGISCHEN Koordinaten zeichnen; ctx.scale macht die
  // Vergrößerung auf die interne Render-Auflösung. imageSmoothingEnabled
  // bleibt false → pixel-scharfe Sprites.
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.scale(renderScale, renderScale);

  if (skyImage) ctx.drawImage(skyImage, 0, 0, W, H);
  else { ctx.fillStyle = "#001"; ctx.fillRect(0, 0, W, H); }

  const shakeActive = !!(match && match.shake > 0);
  if (shakeActive) {
    const dx = (Math.random() * 2 - 1) * match.shake;
    const dy = (Math.random() * 2 - 1) * match.shake;
    ctx.save();
    ctx.translate(dx, dy);
  }

  dirtField.render(ctx);
  if (match) match.render(ctx, assets);
  if (shakeActive) ctx.restore();

  // Debug: Hitboxen (Tank-Bounding-Boxes + Barrel-Spitze)
  if (match && showHitboxes) {
    ctx.lineWidth = 0.5;
    for (const t of match.tanks) {
      if (t.isDead()) continue;
      const b = t.getBounds();
      ctx.strokeStyle = "rgba(0,255,200,.85)";
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      const tip = t.barrelTip();
      ctx.fillStyle = "rgba(255,60,60,.9)";
      ctx.fillRect(tip.x - 1, tip.y - 1, 2, 2);
    }
  }

  // Whiteout (über allem, vor HUD)
  if (match && match.whiteoutFrames > 0) {
    const k = match.whiteoutFrames / 60;
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, k * 1.5)})`;
    ctx.fillRect(0, 0, W, H);
  }

  if (hud) hud.render(ctx);
  ctx.restore();
}

function startNewMatch(cfg) {
  const rules = applyRuleOverrides(data.ruleSet(cfg.mode), cfg.ruleOverrides);
  const pick = data.pickRandomLandscape();
  infoEl.textContent = `${pick.landscape} / ${pick.sky}`;
  startBackgroundMusic();
  Promise.all(PRELOAD_SFX.map((n) => assets.loadAudio(n).catch(() => null)));
  Promise.all([
    assets.loadImage(pick.landscape).catch(() => null),
    assets.loadImage(pick.sky).catch(() => null),
  ])
    .then(([land, sky]) => {
      if (land) loadLandscapeIntoDirtField(land, pick.landscape, rules);
      skyImage = sky;
      const n = cfg.players.length;
      const spacing = W / (n + 1);
      const tanks = cfg.players.map((p, i) => {
        const t = new Tank({
          name: p.name,
          x: Math.round((i + 1) * spacing),
          y: 200,
          color: p.color,
          style: p.style,
          controller: p.controller,
        });
        t.setSprites(assets);
        for (const w of DEFAULT_INVENTORY) {
          if (rules.weapons[w.key]) t.weapons.push({ ...w });
        }
        t.cash = rules.startingCash ?? 0;
        t.cashAtTurnStart = t.cash;
        t.shotQuotes  = p.shotQuotes  ?? [];
        t.killQuotes  = p.killQuotes  ?? [];
        t.deathQuotes = p.deathQuotes ?? [];
        t.spazWeapons = p.spazWeapons ?? null;
        return t;
      });
      match = new Match({
        dirtField, tanks, rules,
        width: W, height: H,
        rounds: cfg.rounds ?? 3,
      });
      match.playSfx = (name) => { if (settings.soundOn) assets.playSfx(name); };
      match.onMatchOver = () => onMatchOver(match);
      match.onRoundOver = () => onRoundOver(match);
      match.currentLandscapeName = pick.landscape;
      match.currentSkyName = pick.sky;
      hud = new Hud(match, assets);
      shop = new Shop(match);
      pause.bindMatch(match);
      statusEl.textContent = "ready";
    })
    .catch((e) => {
      console.error(e);
      statusEl.textContent = `error: ${e.message}`;
    });
}

init().catch((e) => {
  console.error(e);
  statusEl.textContent = `error: ${e.message}`;
});

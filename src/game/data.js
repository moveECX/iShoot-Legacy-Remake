// Lädt die exportierten JSON-Daten und macht sie für die
// Spiel-Engine konsumierbar. Die zentrale Aufgabe: pro Waffe die
// WeaponDefaults-Werte (z.B. "shell.damage": 20) als Fallback unter die
// Waffen-eigenen Werte aus Rules.json mergen — genau wie das Original
// es zur Laufzeit macht, nur einmal beim Boot.

const DATA = "./data";

async function fetchJson(name) {
  const r = await fetch(`${DATA}/${name}`);
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  return r.json();
}

/** Numerische Werte, die als String getypt sind, zu Number machen. */
function coerceNumbers(obj) {
  if (Array.isArray(obj)) return obj.map(coerceNumbers);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = coerceNumbers(v);
    return out;
  }
  if (typeof obj === "string") {
    // exakte Number-Strings ("-1", "20", "0.5") konvertieren, sonst belassen
    if (/^-?\d+(?:\.\d+)?$/.test(obj)) return Number(obj);
  }
  return obj;
}

/** Aus "shell.damage" -> { type: "shell", key: "damage" }. */
function splitDefaultKey(s) {
  const i = s.indexOf(".");
  if (i < 0) return null;
  return { type: s.slice(0, i), key: s.slice(i + 1) };
}

export class GameData {
  constructor() {
    this.rules = null;            // Array von Rule-Sets
    this.tanks = null;            // KI-Tank-Liste
    this.weaponDefaults = null;   // flach: { "shell.damage": 20, ... }
    this.landscapes = null;       // { Landscapes: { name -> [skySet,...] }, Skies: [[..]] }
    this.ruleEditor = null;       // UI-Schema für den Rule-/Waffen-Editor
  }

  async load() {
    const [rules, tanks, defs, landscapes, ruleEditor] = await Promise.all([
      fetchJson("Rules.json"),
      fetchJson("Tanks.json"),
      fetchJson("WeaponDefaults.json"),
      fetchJson("Landscapes.json"),
      fetchJson("RuleEditor.json"),
    ]);
    this.rules = coerceNumbers(rules);
    this.tanks = coerceNumbers(tanks);
    this.weaponDefaults = coerceNumbers(defs);
    this.landscapes = landscapes;
    this.ruleEditor = coerceNumbers(ruleEditor);
    // Felder, die das Original nicht hatte, mit Defaults
    // ergänzen, damit Editor + Engine konsistent sind.
    for (const rs of this.rules) {
      if (rs.fallDamage === undefined) rs.fallDamage = true;
      if (rs.fastForward === undefined) rs.fastForward = true;
      if (rs.fastForwardSpeed === undefined) rs.fastForwardSpeed = 3;
    }
    this._addAllWeaponsRuleSet();
    this._mergeDefaults();
    return this;
  }

  /** Synthetischer Modus "Alle Waffen": Default-Einstellungen + Vereinigung
   *  ALLER Waffen aus allen Original-Rule-Sets (Default 37 + Remixed-exklusive
   *  28 = 65). So sind sämtliche Originalwaffen in einem Spiel zugänglich. */
  _addAllWeaponsRuleSet() {
    const base = this.rules.find((r) => r.rulesetName === "Default Rules") || this.rules[0];
    const allWeapons = {};
    for (const rs of this.rules) {
      for (const [k, w] of Object.entries(rs.weapons || {})) {
        if (!allWeapons[k]) allWeapons[k] = w;   // erste Definition gewinnt
      }
    }
    const merged = { ...base, rulesetName: "All Weapons", weapons: allWeapons };
    this.rules.push(merged);
  }

  /** Findet die "weapons"-Sektion im RuleEditor-Schema (rekursiv). */
  weaponEditorSchema() {
    function walk(items) {
      for (const it of items) {
        if (it.type === "weapons") return it;
        if (it.type === "submenu") {
          const r = walk(it.contents || []);
          if (r) return r;
        }
      }
      return null;
    }
    return walk(this.ruleEditor || []) || { types: {}, sounds: [] };
  }

  _mergeDefaults() {
    // Per Type Defaults aufbauen: { shell: { damage: 20, ... }, machineGun: {...} }
    const byType = {};
    for (const [flatKey, value] of Object.entries(this.weaponDefaults)) {
      const split = splitDefaultKey(flatKey);
      if (!split) continue;
      (byType[split.type] ||= {})[split.key] = value;
    }
    for (const rs of this.rules) {
      for (const [wkey, weapon] of Object.entries(rs.weapons || {})) {
        const td = byType[weapon.type];
        if (!td) continue;
        // Defaults gelten nur, wo die Waffe keinen eigenen Wert hat
        for (const [k, v] of Object.entries(td)) {
          if (!(k in weapon)) weapon[k] = v;
        }
      }
    }
  }

  /** Liefert ein Rule-Set per name (z.B. "Default Rules") oder Index. */
  ruleSet(nameOrIndex = 0) {
    if (typeof nameOrIndex === "number") return this.rules[nameOrIndex];
    return this.rules.find((r) => r.rulesetName === nameOrIndex) ?? this.rules[0];
  }

  /** Random landscape name + ein erlaubter Sky-Name. Bonus-Maps werden
   *  ebenfalls in den Pool aufgenommen, obwohl sie nicht in den Daten
   *  stehen (Original referenziert sie hardcoded im Code). */
  pickRandomLandscape() {
    const pool = { ...this.landscapes.Landscapes };
    // 3 Bonus-Maps mit defaultmäßig dem Standard-Wolken-Set (0).
    if (!pool["Capitol.png"])       pool["Capitol.png"] = [0];
    if (!pool["White House.png"])   pool["White House.png"] = [0];
    if (!pool["Mount Rushmore.png"]) pool["Mount Rushmore.png"] = [0, 3];
    const names = Object.keys(pool);
    const lname = names[Math.floor(Math.random() * names.length)];
    const allowed = pool[lname]
      .map((v) => typeof v === "string" ? parseInt(v, 10) : v)
      .filter((v) => Number.isFinite(v));
    const setIdx = allowed[Math.floor(Math.random() * allowed.length)];
    const skySet = this.landscapes.Skies[setIdx];
    const sname = skySet[Math.floor(Math.random() * skySet.length)];
    return { landscape: lname, sky: sname, skySetIndex: setIdx };
  }

  /** Zufälliger Sky (für Spline-Landschaft, die kein Landscape-PNG hat). */
  pickRandomSky() {
    const setIdx = Math.floor(Math.random() * this.landscapes.Skies.length);
    const skySet = this.landscapes.Skies[setIdx];
    return { sky: skySet[Math.floor(Math.random() * skySet.length)], skySetIndex: setIdx };
  }

  /** Zufälliger Ground-Tile-Name (Ground1..5). */
  pickRandomGroundTile() {
    const idx = 1 + Math.floor(Math.random() * 5);
    return `Ground${idx}.png`;
  }
}

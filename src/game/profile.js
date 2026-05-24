// Player-Profile mit kumulativen Stats (Wins/Kills/Deaths) in localStorage.
// Profile-Identität: Name + Style + Color zusammen als Key, damit "Alex mit
// blauem M1A2" eigene Stats hat, unabhängig von einem zweiten "Alex mit
// rotem Crusader".

const STORAGE_KEY = "ishoot.profiles.v1";

export class Profiles {
  constructor() {
    this.map = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? new Map(Object.entries(JSON.parse(raw))) : new Map();
    } catch {
      return new Map();
    }
  }

  _persist() {
    try {
      const obj = Object.fromEntries(this.map);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (e) {
      console.warn("Profile-Persistierung fehlgeschlagen:", e);
    }
  }

  /** Stabile Profil-ID aus Tank-Eigenschaften. */
  static keyFor(tank) {
    const c = tank.color || { r: 0, g: 0, b: 0 };
    const hex = (v) => Math.max(0, Math.min(255, (v * 255) | 0)).toString(16).padStart(2, "0");
    return `${tank.name}|${tank.style}|${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
  }

  /** Stats lesen — gibt 0-Defaults zurück wenn unbekannt. */
  get(tank) {
    const k = Profiles.keyFor(tank);
    return this.map.get(k) || { matchesPlayed: 0, wins: 0, kills: 0, deaths: 0, lastSeen: 0 };
  }

  /** Match-Ergebnis eintragen — wird aus main.onMatchOver() gerufen. */
  recordMatch(tank, didWin) {
    const k = Profiles.keyFor(tank);
    const cur = this.map.get(k) || { matchesPlayed: 0, wins: 0, kills: 0, deaths: 0, lastSeen: 0 };
    cur.matchesPlayed += 1;
    cur.wins += didWin ? 1 : 0;
    cur.kills += tank.kills | 0;
    cur.deaths += tank.deaths | 0;
    cur.lastSeen = Date.now();
    this.map.set(k, cur);
    this._persist();
  }

  /** Alle Profile als Array (für eine "Bestenliste"-Anzeige). */
  all() {
    return [...this.map.entries()]
      .map(([key, stats]) => ({ key, ...stats }))
      .sort((a, b) => b.wins - a.wins || b.kills - a.kills);
  }

  clear() {
    this.map.clear();
    localStorage.removeItem(STORAGE_KEY);
  }
}

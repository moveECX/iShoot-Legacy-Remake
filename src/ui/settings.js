// Settings: render resolution, key/mouse bindings, audio, language, cheat.
// Persisted in localStorage. Render scale takes effect on the next match.

import { LANG_NAMES, getLang, setLang, t } from "../i18n/index.js";

const STORAGE_KEY = "ishoot.settings.v1";

export const DEFAULT_KEYS = {
  driveLeft:  "ArrowLeft",
  driveRight: "ArrowRight",
  prevWeapon: "KeyQ",
  nextWeapon: "KeyE",
  shop:       "KeyS",
  pause:      "Escape",
  newMap:     "KeyR",
};

/** Global settings object — read directly by main.js. */
export const settings = {
  renderScale: 2,
  soundOn: true,
  musicOn: true,
  musicVolume: 0.25,
  cheat: false,
  keys: { ...DEFAULT_KEYS },
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if ([1, 2, 3].includes(s.renderScale)) settings.renderScale = s.renderScale;
      if (typeof s.soundOn === "boolean") settings.soundOn = s.soundOn;
      if (typeof s.musicOn === "boolean") settings.musicOn = s.musicOn;
      if (typeof s.musicVolume === "number") settings.musicVolume = s.musicVolume;
      if (typeof s.cheat === "boolean") settings.cheat = s.cheat;
      settings.keys = { ...DEFAULT_KEYS, ...(s.keys || {}) };
    }
  } catch { /* defaults */ }
  // renderScale auch mit dem alten Key spiegeln (main.js liest den initial)
  try { localStorage.setItem("ishoot.renderScale", String(settings.renderScale)); } catch {}
  return settings;
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    localStorage.setItem("ishoot.renderScale", String(settings.renderScale));
  } catch (e) { console.warn("settings save failed", e); }
}

/** Liefert die Aktion zu einem KeyboardEvent.code (oder null). */
export function actionForKey(code) {
  for (const [action, key] of Object.entries(settings.keys)) {
    if (key === code) return action;
  }
  return null;
}

export class SettingsUI {
  /** @param onApply  Callback nachdem Settings übernommen wurden (z.B. Audio refresh) */
  constructor(onApply) {
    this.onApply = onApply;
    this.el = document.getElementById("settings");
    this.scaleSel = document.getElementById("settings-scale");
    this.soundCb = document.getElementById("settings-sound");
    this.musicCb = document.getElementById("settings-music");
    this.volSlider = document.getElementById("settings-volume");
    this.keyList = document.getElementById("settings-keys");
    this.langSel = document.getElementById("settings-language");
    this.cheatCb = document.getElementById("settings-cheat");
    this._rebinding = null;   // action currently being rebound

    // Language dropdown (native names) — switches the UI language live.
    if (this.langSel) {
      for (const [code, name] of Object.entries(LANG_NAMES)) {
        const o = document.createElement("option");
        o.value = code; o.textContent = name;
        this.langSel.appendChild(o);
      }
      this.langSel.addEventListener("change", () => { setLang(this.langSel.value); this._renderKeys(); });
    }

    document.getElementById("settings-close").addEventListener("click", () => this.close());
    document.getElementById("settings-apply").addEventListener("click", () => this._apply());
    document.getElementById("settings-reset-keys").addEventListener("click", () => {
      settings.keys = { ...DEFAULT_KEYS };
      this._renderKeys();
    });

    // Globaler Keydown-Catcher fürs Rebinding
    window.addEventListener("keydown", (e) => {
      if (this._rebinding && !this.el.hidden) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code !== "Escape") settings.keys[this._rebinding] = e.code;
        this._rebinding = null;
        this._renderKeys();
      }
    }, true);
  }

  open() {
    this.scaleSel.value = String(settings.renderScale);
    this.soundCb.checked = settings.soundOn;
    this.musicCb.checked = settings.musicOn;
    this.volSlider.value = String(Math.round(settings.musicVolume * 100));
    if (this.langSel) this.langSel.value = getLang();
    if (this.cheatCb) this.cheatCb.checked = settings.cheat;
    this._renderKeys();
    this.el.hidden = false;
  }

  close() { this._rebinding = null; this.el.hidden = true; }

  _renderKeys() {
    this.keyList.innerHTML = "";
    for (const action of Object.keys(DEFAULT_KEYS)) {
      const row = document.createElement("div");
      row.className = "settings-keyrow";
      const isRebinding = this._rebinding === action;
      row.innerHTML = `
        <span class="settings-keylabel">${t("keys." + action)}</span>
        <button class="settings-keybtn${isRebinding ? " settings-keybtn--active" : ""}">
          ${isRebinding ? t("settings.pressKey") : prettyKey(settings.keys[action])}
        </button>
      `;
      row.querySelector("button").addEventListener("click", () => {
        this._rebinding = action;
        this._renderKeys();
      });
      this.keyList.appendChild(row);
    }
  }

  _apply() {
    settings.renderScale = parseInt(this.scaleSel.value, 10) || 2;
    settings.soundOn = this.soundCb.checked;
    settings.musicOn = this.musicCb.checked;
    settings.musicVolume = Math.max(0, Math.min(1, (+this.volSlider.value || 0) / 100));
    if (this.cheatCb) settings.cheat = this.cheatCb.checked;
    persist();
    this.onApply?.(settings);
    this.close();
  }
}

function prettyKey(code) {
  if (!code) return "—";
  return code
    .replace(/^Key/, "")
    .replace(/^Digit/, "")
    .replace("ArrowLeft", "←").replace("ArrowRight", "→")
    .replace("ArrowUp", "↑").replace("ArrowDown", "↓")
    .replace("Escape", "Esc").replace("Space", t("key.space"));
}

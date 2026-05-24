// Setup menu before a match.
// Per player slot: controller (human/CPU + difficulty) + personality
// (10 predefined personalities or a "Custom" slot with name/style/colour).

import { t, onLangChange } from "../i18n/index.js";

const CONTROLLERS = ["off", "human", "ai-easy", "ai-medium", "ai-hard"];
const CONTROLLER_I18N = {
  off: "controller.off", human: "controller.human",
  "ai-easy": "controller.aiEasy", "ai-medium": "controller.aiMedium", "ai-hard": "controller.aiHard",
};
const CONTROLLER_TIP_I18N = {
  off: "controller.tip.off", human: "controller.tip.human",
  "ai-easy": "controller.tip.aiEasy", "ai-medium": "controller.tip.aiMedium", "ai-hard": "controller.tip.aiHard",
};

const CONTROLLER_INDEX = {
  human: 0, "ai-easy": 1, "ai-medium": 2, "ai-hard": 3,
};

const STYLES = [
  { id: 0, label: "M1A2" },
  { id: 1, label: "Crusader" },
  { id: 2, label: "Panzer" },
];

const DEFAULT_COLORS = [
  { r: 0.40, g: 0.70, b: 1.00 },
  { r: 1.00, g: 0.50, b: 0.40 },
  { r: 0.50, g: 1.00, b: 0.50 },
  { r: 1.00, g: 0.90, b: 0.40 },
];

export class Menu {
  /**
   * @param {object} data    GameData (data.tanks für Persönlichkeiten)
   * @param {(cfg: {mode:string, players:Array, rounds:number, ruleOverrides?:object})=>void} onStart
   */
  constructor(data, onStart) {
    this.data = data;
    this.onStart = onStart;
    this.el = document.getElementById("menu");
    this.modeSel = document.getElementById("menu-mode");
    this.roundsInput = document.getElementById("menu-rounds");
    this.playersEl = document.getElementById("menu-players");
    this.startBtn = document.getElementById("menu-start");
    this.editRulesBtn = document.getElementById("menu-edit-rules");
    this.editWeaponsBtn = document.getElementById("menu-edit-weapons");
    this._ruleOverrides = null;
    this._populate();
    onLangChange(() => this._populate());
    this.startBtn.addEventListener("click", () => this._submit());
    this.editRulesBtn?.addEventListener("click", () => this._editorHook?.());
    this.editWeaponsBtn?.addEventListener("click", () => this._weaponEditorHook?.());
  }

  show() { this.el.hidden = false; }
  hide() { this.el.hidden = true; }

  /** Wird vom Rule-Editor/Weapon-Editor aufgerufen, wenn der User
   *  "Übernehmen" drückt. */
  setRuleOverrides(overrides) { this._ruleOverrides = overrides; }
  getRuleOverrides() { return this._ruleOverrides; }

  _populate() {
    // Modi
    this.modeSel.innerHTML = "";
    for (const rs of this.data.rules) {
      const o = document.createElement("option");
      o.value = rs.rulesetName;
      o.textContent = rs.rulesetName;
      this.modeSel.appendChild(o);
    }
    this.modeSel.value = "Default Rules";
    if (this.roundsInput) this.roundsInput.value = "3";

    // Spieler-Slots
    this.playersEl.innerHTML = "";
    const personalityNames = ["", ...this.data.tanks.map((t) => t.name)];
    const defaults = this._defaultPlayerConfigs();
    for (let i = 0; i < 4; i++) {
      const d = defaults[i];
      const row = document.createElement("div");
      row.className = "menu-player";
      row.innerHTML = `
        <span class="menu-slot">P${i + 1}</span>
        <input type="text" class="menu-name" maxlength="14" value="${escapeHtml(d.name)}">
        <select class="menu-controller" title="${escapeHtml(t(CONTROLLER_TIP_I18N[d.controller]))}">
          ${CONTROLLERS
            .map((v) => `<option value="${v}"${v === d.controller ? " selected" : ""} title="${escapeHtml(t(CONTROLLER_TIP_I18N[v]))}">${escapeHtml(t(CONTROLLER_I18N[v]))}</option>`)
            .join("")}
        </select>
        <select class="menu-personality" title="${escapeHtml(t("menu.personalityTitle"))}">
          ${personalityNames
            .map((n) => `<option value="${escapeHtml(n)}"${n === d.personality ? " selected" : ""}>${n ? escapeHtml(n) : escapeHtml(t("menu.customPersonality"))}</option>`)
            .join("")}
        </select>
        <select class="menu-style">
          ${STYLES.map((s) => `<option value="${s.id}"${s.id === d.style ? " selected" : ""}>${s.label}</option>`)
            .join("")}
        </select>
        <input type="color" class="menu-color" value="${rgbToHex(d.color)}">
      `;
      this.playersEl.appendChild(row);

      // Wenn Persönlichkeit gewählt → Name/Style/Farbe auf die vordefinierten
      // Werte ziehen und die Custom-Felder ausgrauen.
      const persSel = row.querySelector(".menu-personality");
      const nameInp = row.querySelector(".menu-name");
      const styleSel = row.querySelector(".menu-style");
      const colorInp = row.querySelector(".menu-color");
      const syncPersonality = () => {
        const persName = persSel.value;
        if (!persName) {
          nameInp.disabled = false; styleSel.disabled = false; colorInp.disabled = false;
          return;
        }
        const p = this.data.tanks.find((t) => t.name === persName);
        if (!p) return;
        nameInp.value = p.name;
        styleSel.value = String(p.style);
        colorInp.value = rgbToHex({ r: p.red, g: p.green, b: p.blue });
        nameInp.disabled = true; styleSel.disabled = true; colorInp.disabled = true;
      };
      persSel.addEventListener("change", syncPersonality);
      syncPersonality();

      // Controller-Tooltip live aktualisieren
      const ctrlSel = row.querySelector(".menu-controller");
      ctrlSel.addEventListener("change", () => {
        ctrlSel.title = t(CONTROLLER_TIP_I18N[ctrlSel.value]);
      });
    }
  }

  _defaultPlayerConfigs() {
    // Slot 1 = menschlich, Custom; Slots 2-4 = CPUs mit zufälligen Persönlichkeiten.
    const personalities = [...this.data.tanks];
    const shuffled = personalities.sort(() => Math.random() - 0.5);
    return [
      { name: t("player.default", { n: 1 }), controller: "human", personality: "", style: 0, color: DEFAULT_COLORS[0] },
      { name: shuffled[0]?.name ?? "Robotank", controller: "ai-medium", personality: shuffled[0]?.name ?? "", style: 0, color: DEFAULT_COLORS[1] },
      { name: "—", controller: "off", personality: "", style: 1, color: DEFAULT_COLORS[2] },
      { name: "—", controller: "off", personality: "", style: 2, color: DEFAULT_COLORS[3] },
    ];
  }

  _submit() {
    const mode = this.modeSel.value;
    const rounds = Math.max(1, Math.min(20, +this.roundsInput?.value || 3));
    const players = [];
    for (const [i, row] of [...this.playersEl.children].entries()) {
      const ctrlVal = row.querySelector(".menu-controller").value;
      if (ctrlVal === "off") continue;
      const persName = row.querySelector(".menu-personality").value;
      const personality = persName ? this.data.tanks.find((t) => t.name === persName) : null;
      // Spazbot-Effekt: zufällige Waffenwahl bei 25% der Schüsse.
      // Original-Spielwiese, datengetrieben über Persönlichkeitsname.
      const spazWeapons = personality?.name === "Spazbot"
        ? ["clusterBomb", "doomBringer", "shivaBomb", "meltdown", "tacticalNuke",
           "nuke", "planetBuster", "megaRoller", "greatWall"]
        : null;
      players.push({
        name: row.querySelector(".menu-name").value.trim() || t("player.default", { n: i + 1 }),
        controller: CONTROLLER_INDEX[ctrlVal],
        style: +row.querySelector(".menu-style").value,
        color: hexToRgb(row.querySelector(".menu-color").value),
        shotQuotes:  personality?.shotPhrases  ?? [],
        killQuotes:  personality?.killPhrases  ?? [],
        deathQuotes: personality?.deathPhrases ?? [],
        spazWeapons,
      });
    }
    if (players.length < 2) {
      alert(t("menu.need2players"));
      return;
    }
    this.hide();
    this.onStart({ mode, players, rounds, ruleOverrides: this._ruleOverrides });
  }

  setRuleEditorHook(fn) { this._editorHook = fn; }
  setWeaponEditorHook(fn) { this._weaponEditorHook = fn; }
}

function rgbToHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, (v * 255) | 0)).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

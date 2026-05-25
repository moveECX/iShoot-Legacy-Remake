// Rule-Editor: HTML-Modal mit Slidern/Inputs für alle Top-Level-Werte
// des aktiven Rule-Sets. Liefert beim Schließen ein Override-Objekt,
// das main.applyRuleOverrides auf die Standard-Werte legt.

import { t, onLangChange } from "../i18n/index.js";

const FIELDS = [
  { key: "gravity",                 label: "Gravity",                  min: 0,   max: 400, step: 1,   type: "int" },
  { key: "maxWind",                 label: "Max-Wind",                 min: 0,   max: 200, step: 1,   type: "int" },
  { key: "tankHealth",              label: "Tank-HP",                  min: 1,   max: 500, step: 1,   type: "int" },
  { key: "fuel",                    label: "Fuel pro Runde",           min: 0,   max: 800, step: 10,  type: "int" },
  { key: "startingCash",            label: "Start-Cash",               min: 0,   max: 100000, step: 500, type: "int" },
  { key: "cashPerRoundIncrease",    label: "Cash pro Runde",           min: 0,   max: 20000,  step: 100, type: "int" },
  { key: "cashPerKill",             label: "Cash pro Kill",            min: 0,   max: 10000,  step: 50,  type: "int" },
  { key: "cashPerDamage",           label: "Cash pro Damage-Pkt.",     min: 0,   max: 500,    step: 5,   type: "int" },
  { key: "maxCashPerRound",         label: "Max Cash pro Runde",       min: 0,   max: 500000, step: 1000,type: "int" },
  { key: "splineLandscapeFrequency",label: "Spline-Landschaft %",      min: 0,   max: 100, step: 1,   type: "int" },
  { key: "fallDamage",              label: "Fallschaden",               type: "bool" },
  { key: "talkingCPUs",             label: "Sprechende CPUs",           type: "bool" },
  { key: "weaponSmoke",             label: "Waffen-Rauch",              type: "bool" },
  { key: "fallingDirt",             label: "Falling-Dirt-Physik",       type: "bool" },
  { key: "dirtClods",               label: "Erd-Partikel",              type: "bool" },
  { key: "steepDriving",            label: "Steile Hänge fahrbar",      type: "bool" },
  { key: "fastForward",             label: "Fast-Forward bei CPU",      type: "bool" },
  { key: "fastForwardSpeed",        label: "Fast-Forward Speed",        min: 1, max: 8, step: 1, type: "int" },
];

export class RuleEditor {
  constructor(data, onApply) {
    this.data = data;
    this.onApply = onApply;
    this.el = document.getElementById("ruleeditor");
    this.list = document.getElementById("ruleeditor-list");
    this.modeLabel = document.getElementById("ruleeditor-mode");
    document.getElementById("ruleeditor-close").addEventListener("click", () => this.close());
    document.getElementById("ruleeditor-reset").addEventListener("click", () => this._reset());
    document.getElementById("ruleeditor-apply").addEventListener("click", () => this._apply());
    this.activeMode = "Default Rules";
    this._inputs = new Map();
    onLangChange(() => { if (!this.el.hidden) this.open(this.activeMode, this._lastOverrides || {}); });
  }

  open(modeName, currentOverrides = {}) {
    this.activeMode = modeName;
    this._lastOverrides = currentOverrides;
    const base = this.data.ruleSet(modeName);
    this.modeLabel.textContent = base.rulesetName;
    this.list.innerHTML = "";
    this._inputs.clear();
    for (const f of FIELDS) {
      const baseVal = base[f.key];
      const curVal = currentOverrides[f.key] !== undefined ? currentOverrides[f.key] : baseVal;
      const row = document.createElement("div");
      row.className = "rule-row";
      // Hover-Tooltip mit ausführlicher Erklärung der Regel (falls vorhanden).
      const tipKey = "ruleTip." + f.key;
      const tip = t(tipKey);
      if (tip && tip !== tipKey) row.title = tip;
      if (f.type === "bool") {
        row.innerHTML = `
          <label>${t("rule." + f.key)}</label>
          <label class="rule-toggle">
            <input type="checkbox" ${curVal ? "checked" : ""}>
            <span>${baseVal ? t("common.on") : t("common.off")} (${t("common.default")})</span>
          </label>
        `;
        this._inputs.set(f.key, { input: row.querySelector("input"), field: f, base: baseVal });
      } else {
        row.innerHTML = `
          <label>${t("rule." + f.key)}</label>
          <div class="rule-numeric">
            <input type="number" min="${f.min}" max="${f.max}" step="${f.step}" value="${curVal}">
            <span class="rule-default">${t("rules.def", { v: baseVal })}</span>
          </div>
        `;
        this._inputs.set(f.key, { input: row.querySelector("input"), field: f, base: baseVal });
      }
      this.list.appendChild(row);
    }
    this.el.hidden = false;
  }

  close() { this.el.hidden = true; }

  _reset() {
    for (const [, { input, field, base }] of this._inputs) {
      if (field.type === "bool") input.checked = !!base;
      else input.value = base;
    }
  }

  _apply() {
    const overrides = {};
    for (const [k, { input, field, base }] of this._inputs) {
      let val;
      if (field.type === "bool") val = input.checked;
      else val = field.type === "int" ? (+input.value | 0) : +input.value;
      if (val !== base) overrides[k] = val;
    }
    this.onApply(Object.keys(overrides).length ? overrides : null);
    this.close();
  }
}

/** Wendet die Editor-Overrides auf ein Rule-Set an. Erzeugt eine flache
 *  Kopie — die `weapons`-Liste bleibt referenziell gleich (sparsam). */
export function applyRuleOverrides(rules, overrides) {
  if (!overrides) return rules;
  return { ...rules, ...overrides };
}

// Pause-Menü während des Matches. Wird per Esc oder Pause-Knopf geöffnet.
// Buttons: Resume, Save, Load, Quit-to-Title.

import { t, onLangChange } from "../i18n/index.js";

export class Pause {
  /**
   * @param {object} hooks
   *   onResume(): wird beim Resume-Klick aufgerufen
   *   onSave(slot): wird beim Save-Klick mit dem ausgewählten Slot aufgerufen
   *   onLoad(slot): wird beim Load-Klick mit dem ausgewählten Slot aufgerufen
   *   onQuit(): wird beim Quit-to-Title-Klick aufgerufen
   *   listSaves(): liefert Save-Übersicht (gleicher Return wie save.js#listSaves)
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.el = document.getElementById("pause");
    this.list = document.getElementById("pause-savelist");
    this._match = null;
    this.isOpen = false;
    document.getElementById("pause-resume").addEventListener("click", () => this.close());
    document.getElementById("pause-quit").addEventListener("click", () => {
      this.close();
      hooks.onQuit?.();
    });
    onLangChange(() => { if (this.isOpen) this._renderSaveList(); });
  }

  bindMatch(match) { this._match = match; }

  open() {
    if (!this._match || this._match.state === "gameover") return;
    this.isOpen = true;
    this.el.hidden = false;
    this._renderSaveList();
  }

  close() {
    this.isOpen = false;
    this.el.hidden = true;
    this.hooks.onResume?.();
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  _renderSaveList() {
    if (!this.list) return;
    this.list.innerHTML = "";
    const saves = this.hooks.listSaves?.() ?? [];
    for (const slot of saves) {
      const row = document.createElement("div");
      row.className = "pause-saverow";
      const label = slot.savedAt
        ? `${slot.rulesetName ?? "?"} · R${slot.round ?? 0} · ${new Date(slot.savedAt).toLocaleString()}`
        : t("common.empty");
      row.innerHTML = `
        <span class="pause-slot">${escapeHtml(t("pause.slot", { n: slot.slot + 1 }))}</span>
        <span class="pause-slotlabel">${escapeHtml(label)}</span>
        <button data-act="save">${escapeHtml(t("pause.save"))}</button>
        <button data-act="load" ${slot.savedAt ? "" : "disabled"}>${escapeHtml(t("pause.load"))}</button>
      `;
      row.querySelector('[data-act="save"]').addEventListener("click", async () => {
        await this.hooks.onSave?.(slot.slot);
        this._renderSaveList();
      });
      row.querySelector('[data-act="load"]').addEventListener("click", async () => {
        if (!slot.savedAt) return;
        this.close();
        await this.hooks.onLoad?.(slot.slot);
      });
      this.list.appendChild(row);
    }
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

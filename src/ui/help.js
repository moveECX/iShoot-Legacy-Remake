// In-app help overlay (same CRT styling as the rest of the UI). Opened from
// the title screen; its content is rendered from i18n keys so it follows the
// selected language and updates live on language change.
import { t, onLangChange } from "../i18n/index.js";

export class Help {
  /** @param hooks { onBack?: () => void } */
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.el = document.getElementById("help");
    this.body = document.getElementById("help-body");
    document.getElementById("help-close").addEventListener("click", () => this.close());
    document.getElementById("help-back").addEventListener("click", () => {
      this.close();
      this.hooks.onBack?.();
    });
    onLangChange(() => { if (!this.el.hidden) this._render(); });
  }

  open() { this._render(); this.el.hidden = false; }
  close() { this.el.hidden = true; }
  get isOpen() { return !this.el.hidden; }

  _render() {
    const controls = [
      [t("kbd.mouse"), t("help.aim")],
      [t("kbd.clickHold"), t("help.power")],
      ["← / →", t("help.drive")],
      ["Q / E", t("help.weapon")],
      ["S", t("help.shop")],
      ["Esc", t("help.pause")],
      ["H", t("help.hitboxes")],
    ];
    const rows = controls
      .map(([k, a]) => `<span class="k">${esc(k)}</span><span class="a">${esc(a)}</span>`)
      .join("");
    this.body.innerHTML = `
      <h4>${esc(t("helpPage.s1.title"))}</h4>
      <p>${esc(t("helpPage.s1.body"))}</p>
      <h4>${esc(t("helpPage.s2.title"))}</h4>
      <div id="help-controls">${rows}</div>
      <h4>${esc(t("helpPage.s3.title"))}</h4>
      <p>${esc(t("helpPage.s3.body"))}</p>
      <h4>${esc(t("helpPage.s4.title"))}</h4>
      <p>${esc(t("helpPage.s4.body"))}</p>
      <p id="help-tip">${esc(t("helpPage.tip"))}</p>
    `;
  }
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// HTML-Overlay-Shop. Während "aim" mit der S-Taste oder per Button öffnen.

import { fmtCash } from "./hud.js";
import { t, tDesc, onLangChange } from "../i18n/index.js";
import { settings } from "./settings.js";

export class Shop {
  /**
   * @param {object} match
   * @param {{onChange?: ()=>void}} hooks
   */
  constructor(match, hooks = {}) {
    this.match = match;
    this.hooks = hooks;
    this.el = document.getElementById("shop");
    this.titleEl = document.getElementById("shop-title");
    this.cashEl = document.getElementById("shop-cash");
    this.listEl = document.getElementById("shop-list");
    document.getElementById("shop-close").addEventListener("click", () => this.close());
    document.getElementById("shop-done").addEventListener("click", () => this.close());
    onLangChange(() => { if (this.isOpen) this.render(); });
    this.isOpen = false;
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  open() {
    const m = this.match;
    if (!m || m.state !== "aim") return;
    const cur = m.currentTank();
    if (!cur || cur.controller > 0) return;          // KI shoppt nicht
    this.isOpen = true;
    this.el.hidden = false;
    this.render();
  }

  close() {
    this.isOpen = false;
    this.el.hidden = true;
    this.hooks.onChange?.();
  }

  render() {
    const m = this.match;
    const tank = m.currentTank();
    if (!tank) return;
    this.titleEl.textContent = t("shop.title", { name: tank.name });
    this.cashEl.textContent = `$${fmtCash(tank.cash)}`;
    this.listEl.innerHTML = "";
    const rules = m.rules;
    // Sortieren nach Preis aufsteigend, nur kaufbare Waffen (price > 0)
    const entries = Object.entries(rules.weapons)
      .filter(([, w]) => +w.price > 0)
      .sort((a, b) => +a[1].price - +b[1].price);

    for (const [key, cfg] of entries) {
      const price = +cfg.price;
      const sellPrice = Math.floor(price * 0.5);
      const owned = tank.weapons.find((w) => w.key === key);
      const ownedCount = owned ? owned.count : 0;
      const canBuy = settings.cheat || tank.cash >= price;
      const canSell = ownedCount > 0 && ownedCount !== -1;

      const row = document.createElement("div");
      row.className = "shop-row";
      row.innerHTML = `
        <span class="shop-name">${cfg.name || key}</span>
        <span class="shop-type">${cfg.type ?? ""}</span>
        <span class="shop-price">$${fmtCash(price)}</span>
        <span class="shop-owned">×${ownedCount}</span>
        <span class="shop-actions">
          <button class="shop-buy"  ${canBuy ? "" : "disabled"}>${t("shop.buy")}</button>
          <button class="shop-sell" ${canSell ? "" : "disabled"} title="${t("shop.sellFor", { price: fmtCash(sellPrice) })}">${t("shop.sell")}</button>
        </span>
      `;
      if (cfg.description) row.title = tDesc(cfg.description);
      row.querySelector(".shop-buy").addEventListener("click", (e) => { e.stopPropagation(); this.buy(key); });
      row.querySelector(".shop-sell").addEventListener("click", (e) => { e.stopPropagation(); this.sell(key); });
      this.listEl.appendChild(row);
    }
  }

  buy(key) {
    const tank = this.match.currentTank();
    const cfg = this.match.rules.weapons[key];
    if (!tank || !cfg) return;
    if (!settings.cheat) {
      if (tank.cash < +cfg.price) return;
      tank.cash -= +cfg.price;
    }
    const existing = tank.weapons.find((w) => w.key === key);
    if (existing) existing.count++;
    else tank.weapons.push({ key, count: 1 });
    this.render();
  }

  sell(key) {
    const tank = this.match.currentTank();
    const cfg = this.match.rules.weapons[key];
    if (!tank || !cfg) return;
    const idx = tank.weapons.findIndex((w) => w.key === key);
    if (idx < 0) return;
    const entry = tank.weapons[idx];
    if (entry.count === -1 || entry.count <= 0) return;     // ∞-Slots nicht verkaufbar
    tank.cash += Math.floor((+cfg.price) * 0.5);
    entry.count--;
    if (entry.count === 0) {
      tank.weapons.splice(idx, 1);
      if (tank.selectedWeapon >= tank.weapons.length) {
        tank.selectedWeapon = Math.max(0, tank.weapons.length - 1);
      }
    }
    this.render();
  }
}

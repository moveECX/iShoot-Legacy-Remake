// Waffen-Editor — 1:1-Nachbau des Original-RuleEditors (type="weapons").
//
// Das UI-Schema (welche Felder pro Waffentyp editierbar sind, plus Listen
// verfügbarer Sounds) kommt direkt aus data/RuleEditor.json. So sehen wir
// genau das, was der Originalentwickler editieren konnte.

import { t, onLangChange } from "../i18n/index.js";

export class WeaponEditor {
  constructor(data, assets, onApply) {
    this.data = data;
    this.assets = assets;
    this.onApply = onApply;
    this.el = document.getElementById("weaponeditor");
    this.listEl = document.getElementById("weaponeditor-list");
    this.formEl = document.getElementById("weaponeditor-form");
    this.modeLabel = document.getElementById("weaponeditor-mode");
    document.getElementById("weaponeditor-close").addEventListener("click", () => this.close());
    document.getElementById("weaponeditor-apply").addEventListener("click", () => this._apply());
    document.getElementById("weaponeditor-reset").addEventListener("click", () => this._reset());
    document.getElementById("weaponeditor-new").addEventListener("click", () => this._newWeapon());

    this._activeMode = "Default Rules";
    this._schema = data.weaponEditorSchema();      // { types, sounds }
    this._weapons = null;                          // tiefe Kopie zum Edit
    this._selectedKey = null;
    onLangChange(() => { if (!this.el.hidden) { this._renderList(); this._renderForm(); } });
  }

  /** @param modeName  Rule-Set-Name, dessen weapons editiert werden
   *  @param currentOverrides  ggf. bereits gesetzte Overrides vom Rule-Editor */
  open(modeName, currentOverrides = {}) {
    this._activeMode = modeName;
    const base = this.data.ruleSet(modeName);
    const startFrom = currentOverrides.weapons ?? base.weapons;
    this._weapons = JSON.parse(JSON.stringify(startFrom));
    this._selectedKey = Object.keys(this._weapons).sort()[0] ?? null;
    if (this.modeLabel) this.modeLabel.textContent = base.rulesetName;
    this._renderList();
    this._renderForm();
    this.el.hidden = false;
  }

  close() { this.el.hidden = true; }

  // -------------------------------------------------------------------------

  _renderList() {
    this.listEl.innerHTML = "";
    const entries = Object.entries(this._weapons).sort(([a], [b]) => a.localeCompare(b));
    for (const [key, w] of entries) {
      const row = document.createElement("div");
      row.className = "weditor-row" + (key === this._selectedKey ? " weditor-row--sel" : "");
      row.innerHTML = `
        <span class="weditor-name">${escapeHtml(w.name || key)}</span>
        <span class="weditor-type">${escapeHtml(w.type || "?")}</span>
        <span class="weditor-price">${+w.price === -1 ? "∞" : "$" + (+w.price || 0)}</span>
      `;
      row.addEventListener("click", () => {
        this._selectedKey = key;
        this._renderList();
        this._renderForm();
      });
      this.listEl.appendChild(row);
    }
  }

  _renderForm() {
    this.formEl.innerHTML = "";
    if (!this._selectedKey || !this._weapons[this._selectedKey]) return;
    const w = this._weapons[this._selectedKey];
    const fields = this._schema.types[w.type] || [];

    // Header mit Key + Delete-Button
    const head = document.createElement("div");
    head.className = "weditor-formhead";
    head.innerHTML = `
      <span class="weditor-formkey">${escapeHtml(this._selectedKey)}</span>
      <span class="weditor-formtype">${escapeHtml(w.type)}</span>
      <button class="weditor-delete">${escapeHtml(t("weaponEditor.delete"))}</button>
    `;
    head.querySelector(".weditor-delete").addEventListener("click", () => this._deleteWeapon());
    this.formEl.appendChild(head);

    for (const field of fields) {
      const row = this._buildFieldRow(field, w);
      if (row) this.formEl.appendChild(row);
    }
  }

  _buildFieldRow(field, w) {
    const row = document.createElement("div");
    row.className = "weditor-field";
    const label = document.createElement("label");
    const fk = "field." + field.key;
    const fl = t(fk);
    label.textContent = (fl === fk) ? field.name : fl;   // fall back to schema label
    row.appendChild(label);

    const inputWrap = document.createElement("div");
    inputWrap.className = "weditor-input";
    const value = w[field.key];

    switch (field.type) {
      case "string":
        inputWrap.appendChild(this._textInput(value, (v) => w[field.key] = v));
        break;
      case "textArea":
        inputWrap.appendChild(this._textArea(value, (v) => w[field.key] = v));
        break;
      case "int":
        inputWrap.appendChild(this._intInput(value, field.min, field.max, (v) => w[field.key] = v));
        break;
      case "boolean":
        inputWrap.appendChild(this._checkbox(value, (v) => w[field.key] = v));
        break;
      case "price":
        inputWrap.appendChild(this._priceInput(value, (v) => w[field.key] = v));
        break;
      case "sound": {
        // Sound-Dropdown + ▶-Preview-Button (lazy laden, dann abspielen).
        // Beide Sound-Felder (launchSound/explosionSound) teilen sich denselben
        // Button — unterscheiden müssen wir nicht, der gewählte Name reicht.
        const btn = this._soundPreviewBtn(value);
        inputWrap.appendChild(this._dropdown(this._schema.sounds || [], value, true,
          (v) => { w[field.key] = v || undefined; btn.update(v); }));
        inputWrap.appendChild(btn);
        break;
      }
      case "weaponSprite": {
        // Sprite-Dropdown + Vorschau-Canvas daneben.
        const preview = this._spritePreview(value);
        inputWrap.appendChild(this._dropdown(this.assets.namesByCategory("sprite_projectile"),
          value, true, (v) => { w[field.key] = v || undefined; preview.update(v); }));
        inputWrap.appendChild(preview);
        break;
      }
      case "explosionTexture": {
        // Explosions-Dropdown + Vorschau-Canvas daneben.
        const preview = this._spritePreview(value);
        inputWrap.appendChild(this._dropdown(this.assets.namesByCategory("sprite_explosion"),
          value, true, (v) => { w[field.key] = v || undefined; preview.update(v); }));
        inputWrap.appendChild(preview);
        break;
      }
      case "submunition": {
        // Submunitions-Dropdown + "✎ bearbeiten"-Button (springt zur Waffe).
        const editBtn = this._subEditBtn(value);
        inputWrap.appendChild(this._dropdown(
          Object.keys(this._weapons).filter((k) => k !== this._selectedKey).sort(),
          value, true, (v) => { w[field.key] = v || undefined; editBtn.update(v); }));
        inputWrap.appendChild(editBtn);
        break;
      }
      case "submunitions": {
        // Liste mehrerer Submunitionen (z.B. "random": Micro Bomblet wählt
        // eine der gelisteten Farben zufällig). Pro Eintrag Dropdown + ✕,
        // plus "+ hinzufügen".
        inputWrap.appendChild(this._submunitionsList(w, field.key));
        break;
      }
      default:
        const span = document.createElement("span");
        span.textContent = t("weaponEditor.unknownType", { type: field.type });
        span.style.color = "#888";
        inputWrap.appendChild(span);
    }
    row.appendChild(inputWrap);
    return row;
  }

  _textInput(value, onChange) {
    const i = document.createElement("input");
    i.type = "text";
    i.value = value ?? "";
    i.addEventListener("input", () => { onChange(i.value); this._refreshListEntry(); });
    return i;
  }
  _textArea(value, onChange) {
    const t = document.createElement("textarea");
    t.value = value ?? "";
    t.rows = 2;
    t.addEventListener("input", () => onChange(t.value));
    return t;
  }
  _intInput(value, min, max, onChange) {
    const i = document.createElement("input");
    i.type = "number";
    if (min !== undefined) i.min = String(min);
    if (max !== undefined) i.max = String(max);
    i.value = value ?? 0;
    i.addEventListener("input", () => onChange(+i.value));
    return i;
  }
  _checkbox(value, onChange) {
    const i = document.createElement("input");
    i.type = "checkbox";
    i.checked = !!value;
    i.addEventListener("change", () => onChange(i.checked));
    return i;
  }
  _priceInput(value, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "weditor-price-wrap";
    const inf = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = +value === -1;
    inf.appendChild(cb);
    inf.appendChild(document.createTextNode(" ∞"));
    const num = document.createElement("input");
    num.type = "number"; num.min = "0";
    num.value = +value === -1 ? "" : (value ?? 0);
    num.disabled = +value === -1;
    cb.addEventListener("change", () => {
      if (cb.checked) { onChange(-1); num.disabled = true; num.value = ""; }
      else { num.disabled = false; const v = +num.value || 0; onChange(v); this._refreshListEntry(); }
    });
    num.addEventListener("input", () => { onChange(+num.value); this._refreshListEntry(); });
    wrap.appendChild(inf);
    wrap.appendChild(num);
    return wrap;
  }
  _dropdown(options, current, allowEmpty, onChange) {
    const sel = document.createElement("select");
    const items = allowEmpty ? ["", ...options] : options;
    for (const o of items) {
      const opt = document.createElement("option");
      opt.value = o;
      opt.textContent = o || t("common.none");
      if (o === current) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }

  /** Kleines Vorschau-Canvas für Sprites/Explosionen. Liefert ein Element mit
   *  zusätzlicher .update(name)-Methode, damit das Dropdown live umzeichnen kann. */
  _spritePreview(name) {
    const cv = document.createElement("canvas");
    cv.className = "weditor-preview";
    cv.width = 48;
    cv.height = 24;
    cv.style.imageRendering = "pixelated";
    cv.update = (n) => this._drawPreview(cv, n);
    cv.update(name);
    return cv;
  }

  /** Zeichnet das Bild zu name scharf hochskaliert und zentriert ins Canvas. */
  _drawPreview(cv, name) {
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    const img = name ? this.assets.images.get(name) : null;
    if (!img || !img.width || !img.height) return;
    // Seitenverhältnis wahren, in 48×24 einpassen, pixelig hochskalieren.
    ctx.imageSmoothingEnabled = false;
    const scale = Math.min(cv.width / img.width, cv.height / img.height);
    const dw = Math.max(1, Math.round(img.width * scale));
    const dh = Math.max(1, Math.round(img.height * scale));
    const dx = Math.floor((cv.width - dw) / 2);
    const dy = Math.floor((cv.height - dh) / 2);
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  /** ▶-Button neben Sound-Dropdowns: lädt Sound lazy und spielt ihn ab.
   *  Liefert Element mit .update(name) zum Aktivieren/Deaktivieren. */
  _soundPreviewBtn(name) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "weditor-sound-btn";
    btn.textContent = "▶";
    btn._sound = name || "";
    btn.update = (n) => { btn._sound = n || ""; btn.disabled = !btn._sound; };
    btn.addEventListener("click", async () => {
      if (!btn._sound) return;
      try {
        await this.assets.loadAudio(btn._sound);
        this.assets.playSfx(btn._sound);
      } catch (e) {
        // Sound nicht ladbar/dekodierbar — leise ignorieren, nicht crashen.
      }
    });
    btn.update(name);
    return btn;
  }

  /** "✎ bearbeiten"-Button neben Submunitions-Dropdown: springt zur gewählten
   *  Waffe. Liefert Element mit .update(name) zum Aktivieren/Deaktivieren. */
  _subEditBtn(name) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "weditor-subedit-btn";
    btn.textContent = t("weaponEditor.editSub");
    btn._sub = name || "";
    btn.update = (n) => { btn._sub = n || ""; btn.disabled = !btn._sub || !this._weapons[btn._sub]; };
    btn.addEventListener("click", () => {
      if (!btn._sub || !this._weapons[btn._sub]) return;
      this._selectedKey = btn._sub;
      this._renderList();
      this._renderForm();
    });
    btn.update(name);
    return btn;
  }

  /** Editor für ein Array von Submunitions-Keys (Typ "submunitions", z.B. der
   *  random-Typ). Jede Zeile: Waffen-Dropdown + ✕-Entfernen; darunter ein
   *  "+ hinzufügen". Mutiert w[key] direkt. */
  _submunitionsList(w, key) {
    const wrap = document.createElement("div");
    wrap.className = "weditor-sublist";
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "3px";
    if (!Array.isArray(w[key])) w[key] = w[key] ? [w[key]] : [];
    const opts = Object.keys(this._weapons).filter((k) => k !== this._selectedKey).sort();

    const rebuild = () => {
      wrap.innerHTML = "";
      w[key].forEach((sub, idx) => {
        const rowEl = document.createElement("div");
        rowEl.style.display = "flex";
        rowEl.style.gap = "4px";
        rowEl.style.alignItems = "center";
        const sel = this._dropdown(opts, sub, true, (v) => {
          if (v) w[key][idx] = v;
          else { w[key].splice(idx, 1); rebuild(); }
        });
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "weditor-subrm";
        rm.textContent = "✕";
        rm.title = t("weaponEditor.remove");
        rm.addEventListener("click", () => { w[key].splice(idx, 1); rebuild(); });
        rowEl.appendChild(sel);
        rowEl.appendChild(rm);
        wrap.appendChild(rowEl);
      });
      const add = document.createElement("button");
      add.type = "button";
      add.className = "weditor-subadd";
      add.textContent = t("weaponEditor.add");
      add.addEventListener("click", () => { w[key].push(opts[0] || ""); rebuild(); });
      wrap.appendChild(add);
    };
    rebuild();
    return wrap;
  }

  _refreshListEntry() {
    // Liste rerendern, damit Name/Price links aktualisiert werden
    this._renderList();
  }

  _newWeapon() {
    const types = Object.keys(this._schema.types);
    if (types.length === 0) return;
    const typ = prompt(t("weaponEditor.promptType", { types: types.join(", ") }), types[0]);
    if (!typ || !this._schema.types[typ]) return;
    let key = prompt(t("weaponEditor.promptKey"), t("weaponEditor.newKeyDefault"));
    if (!key) return;
    key = key.trim();
    if (!key || this._weapons[key]) {
      alert(t("weaponEditor.keyTaken"));
      return;
    }
    // Sensible defaults per type:
    const defaults = { name: key, type: typ, price: 1000 };
    if (typ === "shell" || typ === "nuke" || typ === "penetrator" || typ === "roller" || typ === "skylance") {
      defaults.damage = 20; defaults.blastRadius = 8;
    } else if (typ === "clusterBomb") {
      defaults.count = 5; defaults.apexFuse = true; defaults.burstPowerX = 30; defaults.burstPowerY = 3;
    } else if (typ === "groundBurst") {
      defaults.count = 5; defaults.burstPower = 40;
    } else if (typ === "machineGun") {
      defaults.groups = 10; defaults.shotsPerGroup = 1; defaults.delayBetweenGroups = 6;
      defaults.angleVariance = 5; defaults.powerVariance = 3;
    }
    this._weapons[key] = defaults;
    this._selectedKey = key;
    this._renderList();
    this._renderForm();
  }

  _deleteWeapon() {
    if (!this._selectedKey) return;
    if (!confirm(t("weaponEditor.confirmDelete", { key: this._selectedKey }))) return;
    delete this._weapons[this._selectedKey];
    const keys = Object.keys(this._weapons).sort();
    this._selectedKey = keys[0] ?? null;
    this._renderList();
    this._renderForm();
  }

  _reset() {
    if (!confirm(t("weaponEditor.confirmReset"))) return;
    const base = this.data.ruleSet(this._activeMode);
    this._weapons = JSON.parse(JSON.stringify(base.weapons));
    this._selectedKey = Object.keys(this._weapons).sort()[0] ?? null;
    this._renderList();
    this._renderForm();
  }

  _apply() {
    this.onApply({ weapons: this._weapons });
    this.close();
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

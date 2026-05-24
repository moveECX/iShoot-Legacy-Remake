// Asset-Loader. Liest data/AssetIndex.json (Name → Pfad/Kategorie) und
// dekodiert alle Bilder. Audio wird lazy geladen, damit der erste Start
// nicht von 18 MB WAV/MP3 blockiert wird.

const DATA_URL = "./data/AssetIndex.json";

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${url}`));
    // PNG-Filenamen können Spaces / Apostrophe enthalten ("Banff 1.png",
    // "Giant's Causeway.png") — encodeURI fängt das ab.
    img.src = encodeURI(url);
  });
}

export class Assets {
  constructor() {
    this.index = null;          // name -> { category, path }
    this.images = new Map();    // name -> HTMLImageElement
    this.audio = new Map();     // name -> AudioBuffer (later)
    this._audioCtx = null;
  }

  /** Liest den Index. Muss vor allen anderen Methoden aufgerufen werden. */
  async loadIndex() {
    const r = await fetch(DATA_URL);
    if (!r.ok) throw new Error(`AssetIndex fetch failed: ${r.status}`);
    this.index = await r.json();
    return this.index;
  }

  /** Lädt alle Assets einer Kategorie parallel als Bilder. */
  async loadImagesByCategory(...categories) {
    const names = Object.entries(this.index)
      .filter(([, meta]) => categories.includes(meta.category))
      .map(([name]) => name);
    await Promise.all(names.map((n) => this.loadImage(n)));
    return names;
  }

  async loadImage(name) {
    if (this.images.has(name)) return this.images.get(name);
    const meta = this.index[name];
    if (!meta) throw new Error(`unknown asset: ${name}`);
    const img = await loadImage(`./${meta.path}`);
    this.images.set(name, img);
    return img;
  }

  /** Holt ein bereits geladenes Bild. Wirft, falls noch nicht geladen. */
  getImage(name) {
    const img = this.images.get(name);
    if (!img) throw new Error(`image not loaded: ${name}`);
    return img;
  }

  /** Pfad eines beliebigen Assets (auch ungeladen). */
  pathOf(name) {
    const meta = this.index[name];
    if (!meta) throw new Error(`unknown asset: ${name}`);
    return `./${meta.path}`;
  }

  /** Liste aller Asset-Namen einer Kategorie. */
  namesByCategory(category) {
    return Object.entries(this.index)
      .filter(([, m]) => m.category === category)
      .map(([n]) => n);
  }

  // -- Audio (für später) --------------------------------------------------

  _ensureAudioCtx() {
    if (!this._audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this._audioCtx = new Ctor();
    }
    return this._audioCtx;
  }

  /** Public access to the (lazily created) Web Audio context — shared by the
   *  SFX player and the procedural drive/tread sound. */
  getAudioContext() { return this._ensureAudioCtx(); }

  async loadAudio(name) {
    if (this.audio.has(name)) return this.audio.get(name);
    const ctx = this._ensureAudioCtx();
    const r = await fetch(this.pathOf(name));
    const buf = await r.arrayBuffer();
    const decoded = await ctx.decodeAudioData(buf);
    this.audio.set(name, decoded);
    return decoded;
  }

  playSfx(name, { volume = 1 } = {}) {
    const buf = this.audio.get(name);
    if (!buf) return;
    const ctx = this._ensureAudioCtx();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(ctx.destination);
    src.start();
  }
}

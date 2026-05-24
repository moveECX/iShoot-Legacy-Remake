// Procedural tank-tread / engine sound (Web Audio, no asset file needed).
// A low engine rumble plus a rhythmic tremolo that reads as moving treads.
// Gated by setActive(): ramps in while a tank drives, out when it stops.

export class TreadSound {
  constructor(ctx) {
    this.ctx = ctx;
    this._nodes = null;
    this._on = false;
  }

  _build() {
    const ctx = this.ctx;
    // Engine rumble: low sawtooth through a lowpass.
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 56;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 230; lp.Q.value = 0.7;

    // Tread "clank" rhythm: a square LFO modulating a tremolo gain.
    const trem = ctx.createGain(); trem.gain.value = 0.55;
    const lfo = ctx.createOscillator(); lfo.type = "square"; lfo.frequency.value = 11;
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.45;
    lfo.connect(lfoDepth).connect(trem.gain);

    // Master gate (starts silent; setActive ramps it).
    const master = ctx.createGain(); master.gain.value = 0;
    osc.connect(lp).connect(trem).connect(master).connect(ctx.destination);
    osc.start(); lfo.start();
    this._nodes = { osc, lfo, master };
  }

  /** @param on driving? @param volume 0..1 (tied to the "other sounds" slider) */
  setActive(on, volume = 0.5) {
    if (!this.ctx) return;
    if (on && !this._nodes) this._build();
    if (!this._nodes) return;
    const now = this.ctx.currentTime;
    const g = this._nodes.master.gain;
    const target = on ? Math.max(0, Math.min(1, volume)) * 0.45 : 0;  // keep it subtle
    g.cancelScheduledValues(now);
    g.setTargetAtTime(target, now, 0.05);
    this._on = on;
  }
}

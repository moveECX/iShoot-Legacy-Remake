// Game-Loop. Festes 30 Hz Logik-Tick (das Original lief auf iPhone 1/3G/3GS
// mit ca. 30 FPS, alle Physik-Konstanten sind pro Frame geeicht). Render via
// requestAnimationFrame interpoliert nicht — wir
// rendern, was nach dem letzten Tick stand. Reicht für die Optik, weil das
// Original auch keine Interpolation hatte.

export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;

export function createLoop({ onTick, onRender }) {
  let raf = 0;
  let last = 0;
  let acc = 0;
  let running = false;

  function frame(t) {
    if (!running) return;
    if (last === 0) last = t;
    const dt = Math.min(250, t - last);          // Tab-Switch-Schutz
    last = t;
    acc += dt;
    // Bei Lag: nicht alles aufholen wollen, aber auch nicht das gesamte
    // Restguthaben verwerfen — das ließ Explosionen springen, wenn der
    // Browser kurz blockierte. Stattdessen sanft auf max. 4 Ticks
    // Rückstand cappen.
    if (acc > TICK_MS * 4) acc = TICK_MS * 4;
    let ticks = 0;
    while (acc >= TICK_MS && ticks < 4) {
      onTick();
      acc -= TICK_MS;
      ticks++;
    }
    onRender();
    raf = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      acc = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    get running() { return running; },
  };
}

// Kompakter Input-Wrapper. Übersetzt Pointer/Tastatur-Events relativ zum
// Canvas in logische Koordinaten (Canvas-native Pixel = logische Einheiten
// in unserem 480x320-Setup).

export function bindInput(canvas, handlers = {}, logical = { width: 480, height: 320 }) {
  const {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onKeyDown,
    onKeyUp,
  } = handlers;

  function toLogical(ev) {
    const r = canvas.getBoundingClientRect();
    // Direkt von CSS-Pixeln auf LOGISCHE Spielkoordinaten (480×320) mappen —
    // unabhängig von der internen Render-Auflösung des Canvas.
    return {
      x: (ev.clientX - r.left) / r.width * logical.width,
      y: (ev.clientY - r.top) / r.height * logical.height,
    };
  }

  if (onPointerDown) canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    onPointerDown({ ...toLogical(e), button: e.button, native: e });
  });
  if (onPointerMove) canvas.addEventListener("pointermove", (e) => {
    onPointerMove({ ...toLogical(e), buttons: e.buttons, native: e });
  });
  if (onPointerUp) canvas.addEventListener("pointerup", (e) => {
    canvas.releasePointerCapture?.(e.pointerId);
    onPointerUp({ ...toLogical(e), button: e.button, native: e });
  });

  if (onKeyDown) window.addEventListener("keydown", (e) => onKeyDown(e));
  if (onKeyUp) window.addEventListener("keyup", (e) => onKeyUp(e));
}

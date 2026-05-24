// Sprite-Render-Hilfen.

/**
 * Zeichnet ein Image relativ zu (x,y) mit Anchor-Punkt, Rotation und Flip.
 * anchorX/Y in [0,1]: 0=links/oben, 1=rechts/unten, 0.5=Mitte.
 */
export function drawSprite(ctx, img, x, y, opts = {}) {
  const {
    anchorX = 0.5,
    anchorY = 0.5,
    angle = 0,
    scaleX = 1,
    scaleY = 1,
    alpha = 1,
  } = opts;
  ctx.save();
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);
  ctx.drawImage(img, -img.width * anchorX, -img.height * anchorY);
  ctx.restore();
}

/**
 * Erzeugt eine eingefärbte Variante des Sprites (RGB-Multiply, Alpha bleibt
 * erhalten). r/g/b in [0,1].  Liefert ein zeichenbares Canvas/Image-Bitmap.
 */
export function tintSprite(img, r, g, b) {
  const w = img.width, h = img.height;
  const C = (typeof OffscreenCanvas !== "undefined")
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = C.getContext("2d");
  ctx.drawImage(img, 0, 0);
  // RGB multiplizieren
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`;
  ctx.fillRect(0, 0, w, h);
  // Alpha-Maske wiederherstellen
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(img, 0, 0);
  // WICHTIG: width/height NICHT (re-)setzen — das setzt den Canvas zurück
  // und macht alles Getintete unsichtbar.
  return C;
}

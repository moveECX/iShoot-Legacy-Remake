// Lightweight i18n. UI strings are keyed (t); weapon descriptions and CPU
// quotes are looked up by their English source string (tDesc / tQuote), so the
// data files stay in English and only the display is translated.
import en from "./en.js";
import de from "./de.js";
import fr from "./fr.js";
import it from "./it.js";
import es from "./es.js";
import ru from "./ru.js";
import tr from "./tr.js";
import pt from "./pt.js";

const LANGS = { en, de, fr, it, es, ru, tr, pt };

// Native names for the language dropdown (always shown in their own script).
export const LANG_NAMES = {
  en: "English", de: "Deutsch", fr: "Français", it: "Italiano",
  es: "Español", ru: "Русский", tr: "Türkçe", pt: "Português",
};

const STORE_KEY = "ishoot.lang";
let current = "en";

export function initLang() {
  let saved = null;
  try { saved = localStorage.getItem(STORE_KEY); } catch {}
  current = LANGS[saved] ? saved : "en";
  return current;
}

export function getLang() { return current; }

export function setLang(l) {
  if (!LANGS[l] || l === current) return;
  current = l;
  try { localStorage.setItem(STORE_KEY, l); } catch {}
  applyTranslations();
  window.dispatchEvent(new CustomEvent("ishoot:langchange"));
}

/** UI string by key, with {placeholder} substitution. Falls back to English,
 *  then to the raw key. */
export function t(key, params) {
  const d = LANGS[current];
  let s = (d.ui && d.ui[key] != null) ? d.ui[key]
        : (en.ui[key] != null ? en.ui[key] : key);
  if (params) {
    for (const k in params) s = s.split("{" + k + "}").join(String(params[k]));
  }
  return s;
}

/** Weapon description, looked up by its English source (fallback: source). */
export function tDesc(src) {
  const d = LANGS[current];
  return (src && d.desc && d.desc[src]) || src || "";
}

/** CPU quote, looked up by its English source (fallback: source). */
export function tQuote(src) {
  const d = LANGS[current];
  return (src && d.quote && d.quote[src]) || src || "";
}

/** Apply translations to static markup: [data-i18n] sets textContent,
 *  [data-i18n-title] sets the title attribute. */
export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
}

/** Subscribe to language changes (re-render dynamic components). */
export function onLangChange(fn) {
  window.addEventListener("ishoot:langchange", fn);
}

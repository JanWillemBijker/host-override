// Lichte vertaallaag (NL/EN). De Nederlandse tekst is de sleutel; de Engelse vertaling staat in strings.en.js.
import { EN } from "./strings.en.js";

let lang = "nl";

export function resolveLang(pref) {
  if (pref === "nl" || pref === "en") return pref;
  return String(navigator.language || "en").toLowerCase().startsWith("nl") ? "nl" : "en";
}
export const getLang = () => lang;

export function t(nl, vars) {
  let s = lang === "en" ? (EN[nl] ?? nl) : nl;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
  return s;
}

// Vertaalt de statische HTML: tekstknopen, placeholder/title/aria-label en elementen met data-th (HTML met opmaak).
export function applyDom(root = document.body) {
  if (lang === "nl") return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (w.nextNode()) nodes.push(w.currentNode);
  for (const n of nodes) {
    const key = n.nodeValue.trim();
    if (key && EN[key] && !n.parentElement.closest("[data-th]")) n.nodeValue = n.nodeValue.replace(key, EN[key]);
  }
  root.querySelectorAll("[data-th]").forEach((el) => {
    const key = el.innerHTML.trim();
    if (EN[key]) el.innerHTML = EN[key]; // eigen, statische tekst uit het pakket
  });
  root.querySelectorAll("[placeholder],[title],[aria-label]").forEach((el) => {
    for (const a of ["placeholder", "title", "aria-label"]) {
      const v = el.getAttribute(a);
      if (v && EN[v]) el.setAttribute(a, EN[v]);
    }
  });
  const title = document.title.trim();
  if (EN[title]) document.title = EN[title];
}

export async function initI18n() {
  let pref = "auto";
  try { pref = (await chrome.storage.local.get("lang")).lang || "auto"; } catch { /* geen opslag */ }
  lang = resolveLang(pref);
  document.documentElement.lang = lang;
  applyDom(document.body);
  return pref;
}

// Indicator in de pagina ("TEST · 1.2.3.4") als de site niet van het live IP komt.
// Instellingen staan in chrome.storage.local onder "indicator"; de hoofdschakelaar is "pageBadge" (al sinds 1.5).

export const COLORS = ["#c2410c", "#c92a2a", "#6741d9", "#1971c2", "#2b8a3e", "#1c1c1e"];
export const DEFAULT_TEXT = "TEST · {ip}";
export const INDICATOR_DEFAULTS = {
  onRule: true, onHosts: true, onDiffers: false,
  style: "badge", // badge | bar | frame
  corner: "bl", // tl | tr | bl | br (badge en het label van de rand)
  edge: "top", // top | bottom (balk)
  color: COLORS[0], text: DEFAULT_TEXT, size: "m", opacity: 92,
  hideHover: false, dismiss: true, showIp: true,
};
const pick = (v, list, def) => (list.includes(v) ? v : def);

// Alles uit de opslag opnieuw controleren: dit gaat (via de achtergrond) de pagina in.
export function normIndicator(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const d = INDICATOR_DEFAULTS;
  const bool = (k) => (typeof r[k] === "boolean" ? r[k] : d[k]);
  const op = Math.round(Number(r.opacity));
  return {
    onRule: bool("onRule"), onHosts: bool("onHosts"), onDiffers: bool("onDiffers"),
    style: pick(r.style, ["badge", "bar", "frame"], d.style),
    corner: pick(r.corner, ["tl", "tr", "bl", "br"], d.corner),
    edge: pick(r.edge, ["top", "bottom"], d.edge),
    color: typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color.toLowerCase() : d.color,
    text: typeof r.text === "string" ? r.text.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 80) : d.text,
    size: pick(r.size, ["s", "m", "l"], d.size),
    opacity: Number.isFinite(op) ? Math.min(100, Math.max(30, op)) : d.opacity,
    hideHover: bool("hideHover"), dismiss: bool("dismiss"), showIp: bool("showIp"),
  };
}

// Leesbare tekstkleur (wit of bijna zwart) op de gekozen achtergrond.
export function textColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? "#ffffff" : "#111111";
}

// "TEST · {ip}" -> "TEST · 1.2.3.4". Zonder IP verdwijnen {ip} en losse scheidingstekens eromheen.
export function renderLabel(tpl, { ip = "", host = "", source = "" }, showIp = true) {
  let s = (tpl && tpl.trim() ? tpl : DEFAULT_TEXT).replace(/\{(ip|host|source)\}/g, (_, k) =>
    k === "ip" ? (showIp ? ip : "") : k === "host" ? host : source);
  s = s.replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s{2,}/g, " ").trim();
  s = s.replace(/^[\s·|:,-]+|[\s·|:,-]+$/g, "").replace(/([·|,-])(\s*[·|,-])+/g, "$1").trim();
  return (s || "TEST").slice(0, 80);
}

// Wordt via chrome.scripting.executeScript in de pagina (geïsoleerde wereld, alleen het hoofdframe) gezet,
// en in de popup gebruikt voor de live-voorbeeldweergave (preview = container-element).
// Moet daarom volledig op zichzelf staan: geen verwijzingen naar iets buiten deze functie.
// - Elke keer een nieuw host-element met een gesloten shadow root; alleen textContent, geen HTML.
// - Inline stijlen met !important op het host-element, maximale z-index, geen id/class/attributen.
// - Balk en rand laten klikken door (pointer-events: none); alleen badge/label/sluitknop zijn klikbaar
//   als "klik om te verbergen" aan staat. Respecteert prefers-reduced-motion.
// - De verwijzing naar het element staat in de geïsoleerde wereld; de pagina ziet alleen dat het bestaat.
export function drawIndicator(cfg, preview) {
  const KEY = "__hostOverrideIndicator";
  const scope = preview || globalThis;
  try { scope[KEY]?.cleanup(); } catch { /* al weg */ }
  scope[KEY] = null;
  if (!cfg || cfg.remove) return;
  const mount = preview || document.documentElement;
  if (!mount) return;
  const imp = (el, props) => { for (const [k, v] of Object.entries(props)) el.style.setProperty(k, String(v), "important"); };
  const SIZES = { s: [11, 3, 8, 18, 3], m: [12.5, 4, 10, 24, 5], l: [15, 6, 13, 32, 8] }; // font, padY, padX, balkhoogte, rand
  const [font, padY, padX, barH, border] = SIZES[cfg.size] || SIZES.m;
  const reduced = !preview && typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const op = Math.min(1, Math.max(0.3, (Number(cfg.opacity) || 92) / 100));
  const pos = preview ? "absolute" : "fixed";

  const host = document.createElement("div");
  imp(host, { all: "initial", position: pos, inset: "0", display: "block", "pointer-events": "none",
    "z-index": "2147483647", margin: "0", padding: "0", border: "0", background: "transparent", overflow: "visible" });
  const root = host.attachShadow({ mode: "closed" });
  const wrap = document.createElement("div");
  imp(wrap, { position: "absolute", inset: "0", "pointer-events": "none", opacity: op,
    transition: reduced ? "none" : "opacity .15s ease", "font-family": "system-ui, -apple-system, 'Segoe UI', sans-serif" });
  root.append(wrap);

  const textStyle = { "font-size": font + "px", "font-weight": "650", "line-height": "1.2", color: cfg.fg, "white-space": "nowrap",
    "letter-spacing": ".01em", "font-family": "inherit", "box-sizing": "border-box", margin: "0", "text-align": "left" };
  const clickable = !!cfg.dismiss;
  const hoverEls = [];

  const corner = cfg.corner || "bl";
  const vert = corner[0] === "t" ? "top" : "bottom", horiz = corner[1] === "l" ? "left" : "right";

  function label(offset, radius) {
    const s = document.createElement("span");
    s.textContent = cfg.text;
    if (cfg.title) s.title = cfg.title;
    imp(s, { ...textStyle, position: "absolute", [vert]: offset + "px", [horiz]: offset + "px", background: cfg.color,
      padding: `${padY}px ${padX}px`, "border-radius": radius, "box-shadow": "0 1px 6px rgba(0,0,0,.35)",
      "pointer-events": clickable ? "auto" : "none", cursor: clickable ? "pointer" : "default", "max-width": "calc(100% - 20px)",
      overflow: "hidden", "text-overflow": "ellipsis" });
    if (clickable) s.addEventListener("click", dismiss);
    hoverEls.push(s);
    return s;
  }

  if (cfg.style === "bar") {
    const bar = document.createElement("div");
    const edge = cfg.edge === "bottom" ? "bottom" : "top";
    imp(bar, { ...textStyle, position: "absolute", left: "0", right: "0", [edge]: "0", height: barH + "px", background: cfg.color,
      display: "flex", "align-items": "center", "justify-content": "center", padding: "0 28px", "pointer-events": "none",
      overflow: "hidden", "box-shadow": edge === "top" ? "0 1px 4px rgba(0,0,0,.25)" : "0 -1px 4px rgba(0,0,0,.25)" });
    const t = document.createElement("span");
    t.textContent = cfg.text;
    if (cfg.title) bar.title = cfg.title;
    imp(t, { overflow: "hidden", "text-overflow": "ellipsis", "pointer-events": "none" });
    bar.append(t);
    if (clickable) {
      const x = document.createElement("button");
      x.textContent = "×";
      x.title = cfg.closeLabel || "";
      x.setAttribute("aria-label", cfg.closeLabel || "Close");
      imp(x, { all: "initial", position: "absolute", right: "4px", top: "50%", transform: "translateY(-50%)", width: barH - 4 + "px",
        height: barH - 4 + "px", "border-radius": "4px", color: cfg.fg, font: `700 ${font + 3}px/1 system-ui, sans-serif`,
        "text-align": "center", cursor: "pointer", "pointer-events": "auto", background: "transparent" });
      x.addEventListener("click", dismiss);
      bar.append(x);
    }
    hoverEls.push(bar);
    wrap.append(bar);
  } else if (cfg.style === "frame") {
    const f = document.createElement("div");
    imp(f, { position: "absolute", inset: "0", border: `${border}px solid ${cfg.color}`, "box-sizing": "border-box", "pointer-events": "none" });
    wrap.append(f, label(0, vert === "top" ? (horiz === "left" ? "0 0 8px 0" : "0 0 0 8px") : (horiz === "left" ? "0 8px 0 0" : "8px 0 0 0")));
  } else {
    wrap.append(label(10, "999px"));
  }

  // Muis erover: indicator wordt bijna onzichtbaar. Werkt ook voor elementen die klikken doorlaten,
  // omdat de positie van de muis (in de geïsoleerde wereld) met de rechthoek wordt vergeleken.
  let raf = 0, faded = false;
  const target = preview || document;
  function onMove(e) {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const over = hoverEls.some((el) => {
        const r = el.getBoundingClientRect();
        return e.clientX >= r.left - 6 && e.clientX <= r.right + 6 && e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6;
      });
      if (over !== faded) { faded = over; wrap.style.setProperty("opacity", String(over ? 0.12 : op), "important"); }
    });
  }
  if (cfg.hideHover) target.addEventListener("mousemove", onMove, { passive: true, capture: true });

  function cleanup() {
    if (cfg.hideHover) target.removeEventListener("mousemove", onMove, { capture: true });
    if (raf) cancelAnimationFrame(raf);
    host.remove();
  }
  function dismiss(e) {
    e.preventDefault();
    e.stopPropagation();
    if (preview) return; // in het voorbeeld niet echt verbergen
    cleanup();
    scope[KEY] = null;
    try { chrome.runtime.sendMessage({ type: "ho-dismiss" }); } catch { /* extensie herladen */ }
  }
  scope[KEY] = { cleanup };
  mount.append(host);
}

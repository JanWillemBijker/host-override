import {
  activeRules, matchRule, isHost, isIp, formatHosts, parseHosts,
  OS_LABELS, detectOS, buildChromeCommand, buildSetupCommand, reloadIfAffected, helperFetch, STATE_KEYS,
} from "./common.js";
import {
  normState, allRules, isTarget, isTargetHost, cleanText, groupName, groupOf, setGroupEnabled, newGroupId, mergeParsed,
  DEFAULT_GROUP, GROUP_COLORS, NOTE_MAX, NAME_MAX,
} from "./model.js";
import { initI18n, t } from "./i18n.js";
import { classify, dohLookup, hostsLookup, hostsOverview } from "./detect.js";
import { COLORS, INDICATOR_DEFAULTS, normIndicator, renderLabel, textColor, drawIndicator } from "./indicator.js";

const langPref = await initI18n();
const { checkDomain } = await import("./dns.js");

const $ = (id) => document.getElementById(id);
const ALL_SITES = { origins: ["<all_urls>"] };
let tab = null; // {id, url, host} van de actieve http(s)-tab
let os = detectOS();

// Zijpaneel of popup?
let sideMode = new URLSearchParams(location.search).get("mode") === "side";
try {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] });
  if (ctx.some((c) => c.documentUrl === location.href)) sideMode = true;
} catch { /* oudere Chrome */ }
document.body.classList.toggle("side", sideMode);

// Regels + groepen (genormaliseerd, ook voor een oude opslag zonder groepen) plus popup-instellingen.
async function load() {
  const raw = await chrome.storage.local.get([...STATE_KEYS, "autoReload", "pageBadge", "lastIp", "sideDefault", "collapsed", "lastGroup"]);
  return {
    ...normState(raw), autoReload: raw.autoReload !== false, pageBadge: raw.pageBadge !== false, lastIp: raw.lastIp || "",
    sideDefault: raw.sideDefault === true, collapsed: Array.isArray(raw.collapsed) ? raw.collapsed : [], lastGroup: raw.lastGroup || "",
  };
}

// Elke wijziging loopt hierlangs: bewaren, proxy bijwerken, en de huidige tab herladen als die erdoor verandert.
async function update(patch) {
  const old = await load();
  await chrome.storage.local.set(patch);
  const cur = await load();
  await chrome.runtime.sendMessage("status"); // wacht tot de proxy-regel bijgewerkt is
  if (cur.autoReload && tab) await reloadIfAffected(tab, old, cur);
  render();
}

async function copy(text, btn, label) {
  await navigator.clipboard.writeText(text);
  if (!btn) return;
  const old = btn.textContent;
  btn.textContent = label || t("Gekopieerd");
  setTimeout(() => (btn.textContent = old), 1600);
}

function setStatus(kind, text) {
  $("status").className = "status " + kind;
  $("statusText").textContent = text;
}
function showHelp(text) {
  $("help").hidden = !text;
  $("help").textContent = text || "";
}

// --- Helper-installatie vanuit de extensie zelf ---
const readFile = (p) => fetch(chrome.runtime.getURL(p)).then((r) => r.text());

let helperKind = null, helperOpen = false;
function showHelperCard(kind) {
  helperKind = kind;
  $("helperBar").hidden = !kind;
  $("helper").hidden = !kind || !helperOpen;
  $("status").hidden = !!kind;
  if (!kind) return;
  const win = os === "win" || os === "winps";
  $("termName").textContent = win ? "PowerShell" : "Terminal";
  $("pasteKey").textContent = os === "mac" ? "Cmd+V" : "Ctrl+V";
  if (kind === "missing") {
    $("hbarText").textContent = t("Helper niet gekoppeld");
    $("hbarBtn").textContent = helperOpen ? t("Sluiten") : t("Koppel helper");
    $("helperTitle").textContent = t("Eenmalig: installeer de helper");
    $("helperText").textContent = t("Chrome kan zelf geen IP-adressen koppelen. Een klein lokaal programma (helper) doet dat. Het draait alleen op je eigen computer.");
  } else if (kind === "setup") {
    $("hbarText").textContent = t("Helper moet opnieuw worden ingesteld");
    $("hbarBtn").textContent = helperOpen ? t("Sluiten") : t("Stel helper in");
    $("helperTitle").textContent = t("Helper moet opnieuw worden ingesteld");
    $("helperText").textContent = t("De helper herkent deze extensie niet (de geheime sleutel ontbreekt of klopt niet). Plak het setup-commando hieronder nog één keer. Blijft deze melding, dan gebruikt een ander programma poort 8899.");
  } else {
    $("hbarText").textContent = t("Helper-update beschikbaar");
    $("hbarBtn").textContent = helperOpen ? t("Sluiten") : t("Update helper");
    $("helperTitle").textContent = t("Helper-update beschikbaar");
    $("helperText").textContent = t("Deze versie van de extensie beveiligt de helper met een geheime sleutel. Kopieer het setup-commando hieronder en plak het nog één keer in je terminal. Tot dan staan je regels op pauze.");
  }
  $("hbarBtn").setAttribute("aria-expanded", String(helperOpen));
}
$("hbarBtn").onclick = () => { helperOpen = !helperOpen; showHelperCard(helperKind); };

// --- Status ---
async function refreshStatus(state) {
  setStatus("", t("Controleren..."));
  let s;
  try { s = await chrome.runtime.sendMessage("status"); } catch (e) { s = { error: String(e) }; }
  if (!s || (s.error && s.reachable === undefined)) {
    setStatus("bad", t("Achtergrondscript reageert niet"));
    showHelp(t("Herlaad de extensie via chrome://extensions. Details: {d}", { d: s?.error || t("geen antwoord") }));
    return;
  }
  showHelp("");
  showHelperCard(!s.reachable ? "missing" : s.outdated ? "outdated" : s.setup ? "setup" : null);
  if (!s.reachable) { setStatus("bad", t("Helper draait niet")); return; }
  if (s.outdated || s.setup) return;
  if (s.blocked) {
    setStatus("bad", t("Een andere extensie beheert de proxy"));
    showHelp(t("Zet de andere proxy- of VPN-extensie uit via chrome://extensions."));
  } else if (!state.enabled) setStatus("", t("Uit: alles gaat direct naar de live site"));
  else if (s.active === 0) setStatus("", t("Geen actieve regels"));
  else setStatus("ok", s.active === 1 ? t("Actief voor 1 regel") : t("Actief voor {n} regels", { n: s.active }));
}

// --- Huidige site ---
async function getTab() {
  const [x] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (x?.url && /^https?:/.test(x.url)) return { id: x.id, url: x.url, host: new URL(x.url).hostname };
  return null;
}

// Treffers uit het hosts-bestand voor de huidige site (via de helper, lokaal). null = onbekend.
let siteHosts = { host: null, v: null, done: false };
let siteSeen = null; // verbonden IP van de huidige site (voor de melding na "Opzoeken")
async function fetchSiteHosts(host) {
  if (siteHosts.host === host && siteHosts.done) return;
  siteHosts = { host, v: null, done: false };
  const v = await hostsLookup(host);
  if (siteHosts.host !== host) return;
  siteHosts = { host, v, done: true };
  render(false);
}

async function renderSite(state) {
  $("site").hidden = !tab;
  if (!tab) return;
  $("siteHost").textContent = tab.host;
  const rule = matchRule(activeRules(state), tab.host);
  const key = `tab:${tab.id}`, liveKey = `live:${tab.host}`, dohKey = `doh:${tab.host}`;
  const store = await chrome.storage.session.get([key, liveKey, dohKey]);
  const rec = store[key]?.host === tab.host ? store[key] : null;
  // Met een regel loopt het verkeer via de lokale helper (127.0.0.1): dat is niet het IP van de server.
  const seen = rec?.ip && !(rule && rec.ip === "127.0.0.1") ? rec.ip : null;
  siteSeen = seen;
  const doh = store[dohKey]?.exp > Date.now() ? store[dohKey] : null;
  if (!rule && siteHosts.host !== tab.host) fetchSiteHosts(tab.host);
  const hosts = siteHosts.host === tab.host && siteHosts.done ? siteHosts.v : rec?.result?.entries?.length ? rec.result.entries : null;
  const r = classify({ ip: seen, rule, hosts, doh });
  if (r.source === "live" && store[liveKey] !== r.ip) await chrome.storage.session.set({ [liveKey]: r.ip });
  const granted = await chrome.permissions.contains(ALL_SITES);

  const pill = $("siteKind");
  const resIp = rule && isTargetHost(rule.ip) ? resolved.get(rule.ip)?.ips?.[0] : null;
  const ruleGroup = rule ? groupOf(state, rule.group) : null;
  const P = {
    rule: [t("Override naar {ip}", { ip: r.ip }), "override"],
    hosts: [t("Hosts-bestand: {ip}", { ip: r.ip }), "hosts"],
    differs: r.near ? [t("Wijkt licht af"), "near"] : [t("Wijkt af van DNS"), "differs"],
    live: [t("Live"), "live"],
    unknown: [t("Geen regel"), "neutral"],
  }[r.source];
  pill.textContent = P[0];
  pill.className = "pill " + P[1];
  pill.style.background = r.source === "rule" && ruleGroup ? ruleGroup.color : "";

  // Verbonden: het IP waar Chrome mee praat. Live IP: wat publieke DNS zegt.
  $("connIp").textContent = rule ? t("{ip} (via de helper)", { ip: resIp ? `${rule.ip} → ${resIp}` : rule.ip }) : seen || (granted ? t("Ververs de pagina") : "-");
  const pub = doh?.status === "ok" ? doh.ips : null;
  const live = pub ? pub[0] : store[liveKey] || null;
  $("liveIp").textContent = pub ? (pub.length > 1 ? `${pub[0]} +${pub.length - 1}` : pub[0]) : doh ? t("niet in publieke DNS") : live || "-";
  $("liveIp").title = pub ? pub.join(", ") : "";
  $("copyIp").hidden = !live;
  $("copyIp").onclick = () => copy(live, $("copyIp"));
  $("lookupBtn").hidden = !!doh;

  // Uitleg: zeker (regel, hosts-bestand) of een vermoeden (wijkt af van publieke DNS).
  const note = $("srcNote");
  let text = "";
  if (r.source === "rule") {
    text = t("Bron: Host Override-regel in groep \"{g}\". Alleen dit Chrome-profiel; incognito toont de live site.", { g: gname(ruleGroup, state) });
    if (rule.note) text += " " + t("Notitie: {n}", { n: rule.note });
  }
  else if (r.source === "hosts") {
    text = t("Staat in je hosts-bestand: {ip}. Deze computer gebruikt niet het live IP, ook niet in incognito of andere browsers.", { ip: r.ip });
    if (r.mismatch && r.connected) text += " " + t("Chrome is wel verbonden met {ip} (proxy of VPN?).", { ip: r.connected });
  } else if (r.source === "differs") {
    const pubList = r.publicIps.slice(0, 3).join(", ");
    if (!r.publicIps.length) text = t("{host} staat niet in publieke DNS, maar Chrome is verbonden met {ip}: lokale DNS, VPN of hosts-bestand.", { host: tab.host, ip: r.connected });
    else if (r.near) text = t("Verbonden met {ip}; publieke DNS geeft {pub}. Zelfde netwerkblok, dus waarschijnlijk een CDN of geo-DNS.", { ip: r.connected, pub: pubList });
    else text = t("Wijkt af van publieke DNS: verbonden met {ip}, publieke DNS geeft {pub}. Mogelijk hosts-bestand, lokale DNS, VPN of proxy (of een CDN die per regio antwoordt).", { ip: r.connected, pub: pubList });
    if (hosts === null) text += " " + t("Koppel de helper om je hosts-bestand zeker te controleren.");
  } else if (r.source === "live") text = t("Komt overeen met publieke DNS.");
  note.hidden = !text;
  note.textContent = text;
  note.className = "srcNote " + r.source;
  note.style.borderLeftColor = r.source === "rule" && ruleGroup ? ruleGroup.color : "";

  $("permBtn").hidden = granted;
  $("useBtn").hidden = !!rule || !!allRules(state).find((x) => x.host === tab.host);
  $("useBtn").onclick = () => {
    $("host").value = tab.host;
    $("ip").value = state.lastIp || "";
    $("ip").focus();
  };
}

$("permBtn").onclick = async () => {
  // Toestemming vragen mag alleen vanuit een klik. Daarna de pagina herladen, zodat het IP bekend wordt.
  if (await chrome.permissions.request(ALL_SITES)) {
    if (tab) await chrome.tabs.reload(tab.id);
    render();
  }
};

// Alleen op klik: de hostnaam gaat naar Cloudflare DNS (A en AAAA). Daarna vergelijken met het verbonden IP.
$("lookupBtn").onclick = async () => {
  if (!tab) return;
  $("dnsOut").textContent = t("Zoeken...");
  try {
    const d = await dohLookup(tab.host, { cache: false });
    $("dnsOut").textContent = d.status === "ok" || siteSeen ? "" : t("Geen DNS-record gevonden.");
    try { await chrome.runtime.sendMessage({ type: "ho-reevaluate", tabId: tab.id }); } catch { /* achtergrond slaapt */ }
    render(false);
  } catch {
    $("dnsOut").textContent = t("Opzoeken mislukt (offline?).");
  }
};

$("incoBtn").onclick = async () => {
  if (!tab) return;
  try {
    await chrome.windows.create({ url: tab.url, incognito: true });
  } catch {
    await copy(tab.url, $("incoBtn"), t("URL gekopieerd"));
    $("dnsOut").textContent = t("Kon incognito niet openen. De URL staat op je klembord: plak hem in een incognito-venster.");
  }
};

// --- Regels en groepen ---
// Veilige DOM-bouwer: regels, notities en groepsnamen komen alleen als tekst in de popup.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el[k] = v;
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const gname = (g, st) => groupName(g, st, t);
let editGroup = null; // id van de groep waarvan de instellingen open staan
let editRule = null; // host van de regel waarvan notitie/groep open staat
let resolved = new Map(); // doel-hostnaam -> { ips, error, until }

function errMsg(text) { $("err").textContent = text || ""; }

async function mutateRules(fn, extra = {}) {
  const s = await load();
  update({ rules: fn(s.rules.map((r) => ({ ...r }))), ...extra });
}
async function mutateGroups(fn, extra = {}) {
  const s = await load();
  update({ groups: fn(s.groups.map((g) => ({ ...g })), s), ...extra });
}

function ruleRow(r, state) {
  const own = !r.readOnly;
  const row = h("div", { class: "rule" + (r.enabled === false ? " off" : "") + (own ? "" : " ro") });
  const cb = h("input", { type: "checkbox", title: t("Regel aan of uit"), "aria-label": t("Regel aan of uit") + ": " + r.host });
  cb.checked = r.enabled !== false;
  cb.disabled = !own;
  cb.onchange = () => mutateRules((rules) => rules.map((x) => (x.host === r.host ? { ...x, enabled: cb.checked } : x)));

  const cell = h("div", { class: "hostcell" }, h("span", { class: "host" }, r.host));
  if (r.note) cell.append(h("span", { class: "rnote", title: r.note }, r.note));
  if (isTargetHost(r.ip)) {
    const res = resolved.get(r.ip);
    cell.append(h("span", { class: "rres" + (res?.error ? " bad" : "") },
      res ? (res.ips?.length ? "→ " + res.ips.slice(0, 2).join(", ") : t("niet gevonden ({e})", { e: res.error || "?" })) : t("IP opzoeken...")));
  }

  let target;
  if (own) {
    target = h("input", { type: "text", spellcheck: "false", title: t("IP of hostnaam aanpassen"), "aria-label": t("IP of hostnaam aanpassen") + ": " + r.host });
    target.value = r.ip;
    target.onchange = () => {
      const v = target.value.trim().toLowerCase();
      if (!isTarget(v)) { target.value = r.ip; errMsg(t("Ongeldig IP-adres of hostnaam.")); return; }
      errMsg("");
      mutateRules((rules) => rules.map((x) => (x.host === r.host ? { ...x, ip: isIp(target.value.trim()) ? target.value.trim() : v } : x)));
    };
  } else target = h("code", { class: "rotarget", title: t("Uit een abonnement: alleen lezen") }, r.ip);

  const more = h("button", { class: "del more", title: t("Notitie en groep"), "aria-label": t("Notitie en groep") + ": " + r.host,
    "aria-expanded": String(editRule === r.host), hidden: !own }, "⋯");
  more.onclick = () => { editRule = editRule === r.host ? null : r.host; render(false); };
  const del = h("button", { class: "del", title: t("Verwijderen"), "aria-label": t("Verwijderen") + ": " + r.host, hidden: !own }, "×");
  del.onclick = () => mutateRules((rules) => rules.filter((x) => x.host !== r.host));
  row.append(cb, cell, target, more, del);
  if (!own || editRule !== r.host) return [row];

  // Notitie en groep (verplaatsen) onder de regel.
  const note = h("input", { type: "text", maxlength: String(NOTE_MAX), placeholder: t("Notitie (optioneel)"), "aria-label": t("Notitie") });
  note.value = r.note || "";
  const sel = groupSelect(state, r.group, t("Groep"));
  const save = h("button", { class: "secondary", type: "button" }, t("Opslaan"));
  const done = () => {
    editRule = null;
    mutateRules((rules) => rules.map((x) => {
      if (x.host !== r.host) return x;
      const n = { ...x, group: sel.value };
      const v = cleanText(note.value, NOTE_MAX);
      if (v) n.note = v; else delete n.note;
      return n;
    }));
  };
  save.onclick = done;
  note.onkeydown = (e) => { if (e.key === "Enter") done(); if (e.key === "Escape") { editRule = null; render(false); } };
  const ed = h("div", { class: "ruleEdit" }, note, sel, save);
  setTimeout(() => note.focus(), 0);
  return [row, ed];
}

function groupSelect(state, value, label) {
  const sel = h("select", { "aria-label": label });
  for (const g of state.groups.filter((x) => !x.sub)) sel.append(h("option", { value: g.id }, gname(g, state)));
  sel.value = value && state.groups.some((g) => g.id === value && !g.sub) ? value : DEFAULT_GROUP;
  return sel;
}

function groupEditor(g, state) {
  const box = h("div", { class: "geditor", id: "ged-" + g.id });
  const name = h("input", { type: "text", maxlength: String(NAME_MAX), placeholder: gname(g, state), "aria-label": t("Naam van de groep") });
  name.value = g.name;
  name.onchange = () => mutateGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, name: cleanText(name.value, NAME_MAX) } : x)));
  const sw = h("div", { class: "swatches", role: "radiogroup", "aria-label": t("Kleur van de groep") });
  for (const c of GROUP_COLORS) {
    const b = h("button", { type: "button", class: "swatch", role: "radio", "aria-checked": String(c === g.color), "aria-label": c, title: c, style: `background:${c}` });
    b.onclick = () => mutateGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, color: c } : x)));
    sw.append(b);
  }
  const custom = h("input", { type: "color", title: t("Eigen kleur"), "aria-label": t("Eigen kleur") });
  custom.value = g.color;
  custom.onchange = () => mutateGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, color: custom.value.toLowerCase() } : x)));
  sw.append(custom);
  box.append(h("label", { class: "field" }, t("Naam"), name), h("div", { class: "field" }, h("span", {}, t("Kleur")), sw));
  for (const extra of groupEditorExtras) { const n = extra(g, state); if (n) box.append(n); }
  const row = h("div", { class: "row wrap" });
  if (!g.sub && g.id !== DEFAULT_GROUP) {
    const del = h("button", { type: "button", class: "secondary danger" }, t("Groep verwijderen"));
    del.onclick = () => {
      editGroup = null;
      mutateGroups((gs) => gs.filter((x) => x.id !== g.id), { rules: state.rules.map((r) => (r.group === g.id ? { ...r, group: DEFAULT_GROUP } : r)) });
    };
    row.append(del);
    row.append(h("span", { class: "small" }, t("De regels gaan naar \"{g}\".", { g: gname(state.groups[0], state) })));
  }
  if (row.childElementCount) box.append(row);
  return box;
}
// Uitbreidingen van de groepsinstellingen (headers, abonnement) haken hier in.
const groupEditorExtras = [];

function renderGroups(state, q) {
  const box = $("groups");
  box.textContent = "";
  const all = allRules(state);
  const collapsed = new Set(state.collapsed);
  for (const g of state.groups) {
    const rules = all.filter((r) => r.group === g.id);
    const shown = q ? rules.filter((r) => r.host.includes(q) || r.ip.includes(q) || (r.note || "").toLowerCase().includes(q)) : rules;
    if (q && !shown.length) continue;
    const open = !!q || !collapsed.has(g.id);
    const on = g.enabled;
    const sec = h("section", { class: "group" + (on ? "" : " goff"), style: `--gc:${g.color}` });
    const listId = "gl-" + g.id;
    const tags = [];
    if (g.sub) tags.push(h("span", { class: "gtag" }, t("abonnement")));
    if (g.noCache) tags.push(h("span", { class: "gtag" }, t("geen cache")));
    if (g.auth?.user) tags.push(h("span", { class: "gtag" }, t("Basic-auth")));
    if (g.headers?.length) tags.push(h("span", { class: "gtag" }, t("{n} header(s)", { n: g.headers.length })));
    const toggle = h("button", { class: "gtoggle", "aria-expanded": String(open), "aria-controls": listId, title: open ? t("Inklappen") : t("Uitklappen") },
      h("span", { class: "gchev", "aria-hidden": "true" }, "▸"), h("span", { class: "gdot", "aria-hidden": "true" }),
      h("span", { class: "gname" }, gname(g, state)), h("span", { class: "gcount" }, String(rules.length)), tags);
    toggle.onclick = async () => {
      const set = new Set((await load()).collapsed);
      set.has(g.id) ? set.delete(g.id) : set.add(g.id);
      await chrome.storage.local.set({ collapsed: [...set] });
      render(false);
    };
    const sw = h("label", { class: "switch sm", title: t("Groep aan of uit") }, h("input", { type: "checkbox", "aria-label": t("Groep {g} aan of uit", { g: gname(g, state) }) }), h("span", { class: "slider" }));
    const swIn = sw.querySelector("input");
    swIn.checked = on;
    swIn.onchange = async () => {
      const s = await load();
      const next = setGroupEnabled(s, g.id, swIn.checked);
      update(swIn.checked ? { groups: next.groups, enabled: true } : { groups: next.groups });
    };
    const gear = h("button", { class: "icon", title: t("Groep instellen"), "aria-label": t("Groep {g} instellen", { g: gname(g, state) }), "aria-expanded": String(editGroup === g.id) });
    gear.append(gearIcon());
    gear.onclick = () => { editGroup = editGroup === g.id ? null : g.id; render(false); };
    sec.append(h("div", { class: "ghead" }, toggle, sw, gear));
    if (editGroup === g.id) sec.append(groupEditor(g, state));
    const list = h("div", { class: "grules", id: listId, hidden: !open });
    for (const r of shown) list.append(...ruleRow(r, state));
    if (!rules.length) list.append(h("p", { class: "gempty" }, g.sub ? t("Deze lijst bevat (nog) geen regels.") : t("Leeg. Kies deze groep bij Toevoegen of verplaats een regel hierheen (⋯).")));
    sec.append(list);
    box.append(sec);
  }
  resolveTargets(all);
}

function gearIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "14"); svg.setAttribute("height", "14"); svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("fill", "currentColor");
  p.setAttribute("d", "M2 4h7.3a2 2 0 0 1 3.4 0H14v1.5h-1.3a2 2 0 0 1-3.4 0H2zm0 6.5h1.3a2 2 0 0 1 3.4 0H14V12H6.7a2 2 0 0 1-3.4 0H2z");
  svg.append(p);
  return svg;
}

// Doelen die een hostnaam zijn: de helper zoekt het IP op (systeem-resolver), zodat je ziet waar het heen gaat.
let resolving = false;
async function resolveTargets(all) {
  const names = [...new Set(all.map((r) => r.ip).filter(isTargetHost))].filter((n) => !(resolved.get(n)?.until > Date.now())).slice(0, 50);
  if (!names.length || resolving) return;
  resolving = true;
  try {
    const res = await helperFetch("/__resolve", { body: { names } });
    const j = await res.json().catch(() => ({}));
    for (const n of names) {
      const r = j.results?.[n];
      resolved.set(n, res.ok && r ? { ips: (r.ips || []).filter(isIp), error: r.error || null, until: Date.now() + 30000 }
        : { ips: [], error: res.status === 404 || res.status === 400 ? t("helper bijwerken") : j.error || `status ${res.status}`, until: Date.now() + 15000 });
    }
  } catch (e) {
    for (const n of names) resolved.set(n, { ips: [], error: helperErr(e.message), until: Date.now() + 15000 });
  } finally { resolving = false; }
  render(false);
}
function helperErr(code) {
  return { "helper-missing": t("helper draait niet"), "helper-outdated": t("helper-update nodig"), "helper-setup": t("helper moet opnieuw worden ingesteld"), setup: t("helper moet opnieuw worden ingesteld") }[code] || code;
}

function fillAddGroup(state) {
  const sel = $("addGroup");
  const keep = sel.value || state.lastGroup;
  sel.replaceChildren(...groupSelect(state, keep, "").children);
  sel.value = state.groups.some((g) => g.id === keep && !g.sub) ? keep : DEFAULT_GROUP;
  sel.hidden = state.groups.filter((g) => !g.sub).length < 2;
}

async function render(refresh = true) {
  const state = await load();
  $("master").checked = state.enabled;
  $("autoReload").checked = state.autoReload;
  $("sideDefault").checked = state.sideDefault;
  $("exclusive").checked = state.exclusiveGroups;
  const total = allRules(state).length;
  $("empty").hidden = total > 0;
  $("bulk").hidden = state.rules.length < 2;
  $("filter").hidden = total < 7;
  const q = $("filter").hidden ? "" : $("filter").value.trim().toLowerCase();
  renderGroups(state, q);
  fillAddGroup(state);
  await renderSite(state);
  if (!$("viewMore").hidden) {
    renderIndicator();
    renderCommand(activeRules({ ...state, enabled: true }));
    if (document.activeElement !== $("hostsText")) $("hostsText").value = formatHosts(state.rules, state.groups.filter((g) => !g.sub));
  }
  for (const fn of renderHooks) fn(state);
  if (refresh) refreshStatus(state);
}
const renderHooks = [];

$("master").onchange = () => update({ enabled: $("master").checked });
$("filter").oninput = () => render(false);
$("autoReload").onchange = () => chrome.storage.local.set({ autoReload: $("autoReload").checked });
$("sideDefault").onchange = () => chrome.storage.local.set({ sideDefault: $("sideDefault").checked });
$("exclusive").onchange = async () => {
  const on = $("exclusive").checked;
  const s = await load();
  // Aanzetten met meerdere actieve groepen: alleen de eerste actieve blijft aan.
  let groups = s.groups;
  if (on) { const first = groups.find((g) => g.enabled); groups = groups.map((g) => ({ ...g, enabled: g === first })); }
  update({ exclusiveGroups: on, groups });
};

$("newGroup").onclick = async () => {
  const s = await load();
  const id = newGroupId(s.groups);
  const color = GROUP_COLORS[s.groups.length % GROUP_COLORS.length];
  const name = t("Groep {n}", { n: s.groups.filter((g) => !g.sub).length + 1 });
  editGroup = id;
  $("addGroup").value = id;
  await chrome.storage.local.set({ lastGroup: id });
  update({ groups: [...s.groups, { id, name, color, enabled: !s.exclusiveGroups, noCache: false, auth: null, headers: [] }] });
  setTimeout(() => document.querySelector(`#ged-${id} input`)?.select(), 50);
};
$("addGroup").onchange = () => chrome.storage.local.set({ lastGroup: $("addGroup").value });

$("add").onsubmit = async (e) => {
  e.preventDefault();
  const host = $("host").value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:?#].*$/, "");
  const raw = $("ip").value.trim();
  const ip = isIp(raw) ? raw : raw.toLowerCase();
  if (!isHost(host)) { errMsg(t("Ongeldig domein.")); return; }
  if (!isTarget(ip)) { errMsg(t("Ongeldig IP-adres of hostnaam.")); return; }
  if (ip === host) { errMsg(t("Het doel kan niet het domein zelf zijn.")); return; }
  errMsg("");
  const s = await load();
  const group = $("addGroup").hidden ? DEFAULT_GROUP : $("addGroup").value;
  const next = s.rules.filter((r) => r.host !== host);
  const rule = { host, ip, enabled: true, group };
  const note = cleanText($("note").value, NOTE_MAX);
  if (note) rule.note = note;
  next.push(rule);
  $("host").value = ""; $("ip").value = ""; $("note").value = "";
  // Toevoegen aan een groep die uit staat: groep aanzetten (met "één groep tegelijk" gaan de andere uit).
  const g = s.groups.find((x) => x.id === group);
  const groups = g && !g.enabled ? setGroupEnabled(s, group, true).groups : s.groups;
  update({ rules: next, groups, enabled: true, lastIp: ip });
};

$("bulkBtn").onclick = async () => {
  const raw = $("bulkIp").value.trim();
  const ip = isIp(raw) ? raw : raw.toLowerCase();
  if (!isTarget(ip)) { errMsg(t("Ongeldig IP-adres of hostnaam.")); return; }
  errMsg("");
  $("bulkIp").value = "";
  mutateRules((rules) => rules.map((r) => ({ ...r, ip })));
};

// --- Chrome-commando ---
for (const [value, label] of Object.entries(OS_LABELS)) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  $("os").append(o);
}
function renderCommand(rules) {
  $("os").value = os;
  $("cmdWhere").textContent = os === "win" ? t("de opdrachtprompt (cmd)") : os === "winps" ? "PowerShell" : "Terminal";
  const cmd = buildChromeCommand(rules, os);
  $("cmdText").value = cmd || t("Er zijn nog geen actieve regels. Voeg eerst een domein en IP toe.");
  $("copyCmd").disabled = !cmd;
  $("openWin").disabled = !cmd;
}
$("os").onchange = async () => { os = $("os").value; renderCommand(activeRules({ ...(await load()), enabled: true })); };
$("openWin").onclick = async () => {
  const active = activeRules({ ...(await load()), enabled: true }).map(({ host, ip }) => ({ host, ip }));
  const btn = $("openWin");
  try {
    // Alleen origin + pad: de query (kan tokens bevatten) hoort niet in de opdrachtregel van Chrome.
    const u = tab?.url ? new URL(tab.url) : null;
    const res = await helperFetch("/__launch", { body: { rules: active, url: u ? u.origin + u.pathname : undefined } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `status ${res.status}`);
    $("moreErr").textContent = "";
    btn.textContent = t("Geopend");
    setTimeout(() => (btn.textContent = t("Open testvenster")), 2000);
  } catch (e) {
    const msg = { "helper-missing": t("helper draait niet"), "helper-outdated": t("helper-update nodig"), "helper-setup": t("helper moet opnieuw worden ingesteld"), setup: t("helper moet opnieuw worden ingesteld") }[e.message] || e.message;
    $("moreErr").textContent = t("Openen mislukt ({e}). Gebruik \"Kopieer commando\".", { e: msg });
  }
};
$("copyCmd").onclick = () => copy($("cmdText").value, $("copyCmd"), t("Gekopieerd, plak in je terminal"));

// --- Delen ---
$("copyHosts").onclick = () => copy($("hostsText").value, $("copyHosts"));
$("applyHosts").onclick = async () => {
  const parsed = parseHosts($("hostsText").value);
  if (!parsed.rules.length) { $("moreErr").textContent = t("Geen geldige regels gevonden."); return; }
  const s = await load();
  const { state: next, added, changed } = mergeParsed(s, parsed, s.lastGroup || DEFAULT_GROUP);
  $("moreErr").textContent = "";
  $("shareMsg").textContent = t("{a} nieuw, {c} gewijzigd.", { a: added, c: changed }) + (parsed.skipped ? " " + t("{n} regel(s) overgeslagen.", { n: parsed.skipped }) : "");
  update({ rules: next.rules, groups: next.groups, enabled: true });
};

// --- Indicator in de pagina ---
const POS = {
  badge: [["bl", "Linksonder"], ["br", "Rechtsonder"], ["tl", "Linksboven"], ["tr", "Rechtsboven"]],
  bar: [["top", "Boven"], ["bottom", "Onder"]],
};
const COLOR_NAMES = { "#c2410c": "Oranje", "#c92a2a": "Rood", "#6741d9": "Paars", "#1971c2": "Blauw", "#2b8a3e": "Groen", "#1c1c1e": "Zwart" };
let ind = { ...INDICATOR_DEFAULTS };

async function renderIndicator() {
  const st = await chrome.storage.local.get(["pageBadge", "indicator"]);
  const master = st.pageBadge !== false;
  ind = normIndicator(st.indicator);
  const granted = await chrome.permissions.contains(ALL_SITES);
  $("pageBadge").checked = master;
  $("indPerm").hidden = granted || !master;
  $("indOpts").classList.toggle("off", !master);
  $("indOnRule").checked = ind.onRule;
  $("indOnHosts").checked = ind.onHosts;
  $("indOnDiffers").checked = ind.onDiffers;
  $("indStyle").value = ind.style;
  const posList = ind.style === "bar" ? POS.bar : POS.badge;
  $("indPos").replaceChildren(...posList.map(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = t(l); return o; }));
  $("indPos").value = ind.style === "bar" ? ind.edge : ind.corner;
  $("indSize").value = ind.size;
  $("indOpacity").value = String(ind.opacity);
  $("indOpacityVal").textContent = ind.opacity + "%";
  if (document.activeElement !== $("indText")) $("indText").value = ind.text;
  $("indShowIp").checked = ind.showIp;
  $("indHideHover").checked = ind.hideHover;
  $("indDismiss").checked = ind.dismiss;
  $("indGroupColor").checked = ind.groupColor;
  const sw = $("indColors");
  if (!sw.childElementCount) {
    for (const c of COLORS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.dataset.color = c;
      b.style.background = c;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", t(COLOR_NAMES[c]));
      b.title = t(COLOR_NAMES[c]);
      b.onclick = () => saveIndicator({ color: c });
      sw.append(b);
    }
    const custom = document.createElement("input");
    custom.type = "color";
    custom.id = "indCustom";
    custom.title = t("Eigen kleur");
    custom.setAttribute("aria-label", t("Eigen kleur"));
    custom.oninput = () => previewIndicator({ ...ind, color: custom.value });
    custom.onchange = () => saveIndicator({ color: custom.value });
    sw.append(custom);
  }
  for (const b of sw.querySelectorAll(".swatch")) b.setAttribute("aria-checked", String(b.dataset.color === ind.color));
  $("indCustom").value = ind.color;
  previewIndicator(ind);
}

function previewIndicator(cfg) {
  const ip = "203.0.113.10";
  drawIndicator({
    ...cfg, fg: textColor(cfg.color),
    text: renderLabel(cfg.text, { ip, host: tab?.host || t("voorbeeld.nl"), source: "Host Override", group: t("Klant X – staging") }, cfg.showIp),
  }, $("indPreview"));
}

async function saveIndicator(patch) {
  ind = normIndicator({ ...ind, ...patch });
  await chrome.storage.local.set({ indicator: ind }); // de achtergrond werkt open tabs direct bij
  renderIndicator();
}
$("pageBadge").onchange = async () => { await chrome.storage.local.set({ pageBadge: $("pageBadge").checked }); renderIndicator(); };
for (const [id, k] of [["indOnRule", "onRule"], ["indOnHosts", "onHosts"], ["indOnDiffers", "onDiffers"], ["indShowIp", "showIp"], ["indHideHover", "hideHover"], ["indDismiss", "dismiss"], ["indGroupColor", "groupColor"]]) {
  $(id).onchange = () => saveIndicator({ [k]: $(id).checked });
}
$("indStyle").onchange = () => saveIndicator({ style: $("indStyle").value });
$("indPos").onchange = () => saveIndicator(ind.style === "bar" ? { edge: $("indPos").value } : { corner: $("indPos").value });
$("indSize").onchange = () => saveIndicator({ size: $("indSize").value });
$("indOpacity").oninput = () => { $("indOpacityVal").textContent = $("indOpacity").value + "%"; previewIndicator({ ...ind, opacity: Number($("indOpacity").value) }); };
$("indOpacity").onchange = () => saveIndicator({ opacity: Number($("indOpacity").value) });
let textTimer = 0;
$("indText").oninput = () => {
  previewIndicator({ ...ind, text: $("indText").value });
  clearTimeout(textTimer);
  textTimer = setTimeout(() => saveIndicator({ text: $("indText").value }), 400);
};
$("indPermBtn").onclick = async () => {
  if (await chrome.permissions.request(ALL_SITES)) {
    if (tab) await chrome.tabs.reload(tab.id);
    renderIndicator();
  }
};

// --- Hosts-bestand (alleen lezen, via de helper) ---
let hostsData = null;
function hostsRules() {
  if (!hostsData) return [];
  const out = [];
  for (const e of hostsData.entries) for (const n of e.names) if (isHost(n) && isIp(e.ip)) out.push({ host: n, ip: e.ip });
  return out;
}
function renderHostsList() {
  const list = $("hostsList");
  list.textContent = "";
  if (!hostsData) return;
  const only = $("hostsOnly").checked;
  const rows = only ? hostsData.entries : [...hostsData.entries, ...hostsData.blockedSample];
  for (const e of rows) {
    const r = document.createElement("div");
    r.className = "hrow";
    const ip = document.createElement("span");
    ip.className = "mono";
    ip.textContent = e.ip;
    if (e.kind !== "override") {
      const k = document.createElement("span");
      k.className = "k";
      k.textContent = e.kind === "blocked" ? t("blokkade") : t("lokaal");
      ip.append(k);
    }
    const names = document.createElement("span");
    names.className = "names";
    names.textContent = e.names.join(" ");
    r.append(ip, names);
    list.append(r);
  }
  if (!only && hostsData.blocked > hostsData.blockedSample.reduce((a, l) => a + l.names.length, 0)) {
    const more = document.createElement("div");
    more.className = "small";
    more.textContent = t("…en meer geblokkeerde namen ({n} in totaal).", { n: hostsData.blocked });
    list.append(more);
  }
}
async function loadHostsFile() {
  $("hostsMsg").textContent = "";
  $("hostsMeta").textContent = t("Laden...");
  try {
    hostsData = await hostsOverview();
  } catch (e) {
    hostsData = null;
    const msg = { "helper-missing": t("De helper draait niet."), "helper-outdated": t("De helper moet worden bijgewerkt."), "helper-setup": t("Helper moet opnieuw worden ingesteld") }[e.message] || e.message;
    $("hostsMeta").textContent = t("Het hosts-bestand wordt gelezen door de helper. {e}", { e: msg });
  }
  if (hostsData) {
    const d = hostsData;
    const n = d.entries.reduce((a, l) => a + l.names.length, 0);
    let meta = !d.exists ? t("Geen hosts-bestand gevonden ({path}).", { path: d.path })
      : (n ? t("{path}: {n} naam/namen met een eigen IP.", { path: d.path, n }) : t("{path}: geen overrides.", { path: d.path }));
    if (d.blocked) meta += " " + t("{n} geblokkeerd (0.0.0.0 e.d.).", { n: d.blocked });
    if (d.truncated) meta += " " + t("Bestand groter dan {mb} MB: alleen het begin is gelezen.", { mb: Math.round(d.max / 1048576) });
    if (d.entriesTruncated) meta += " " + t("Alleen de eerste 1000 regels getoond.");
    $("hostsMeta").textContent = meta;
  }
  const has = hostsRules().length > 0;
  $("hostsCopy").disabled = !has;
  $("hostsImport").disabled = !has;
  $("hostsOnly").parentElement.hidden = !hostsData?.blocked;
  renderHostsList();
}
$("hostsOnly").onchange = renderHostsList;
$("hostsLoad").onclick = loadHostsFile;
$("hostsCopy").onclick = () => copy(formatHosts(hostsRules()), $("hostsCopy"));
$("hostsImport").onclick = async () => {
  const incoming = hostsRules();
  const s = await load();
  const rules = s.rules;
  const have = new Set(rules.map((r) => r.host));
  const add = incoming.filter((r) => !have.has(r.host)).map((r) => ({ ...r, enabled: true, group: s.lastGroup && s.groups.some((g) => g.id === s.lastGroup && !g.sub) ? s.lastGroup : DEFAULT_GROUP, note: t("uit hosts-bestand") }));
  $("hostsMsg").textContent = add.length
    ? t("{n} regel(s) toegevoegd aan Host Override. Je hosts-bestand blijft ongewijzigd.", { n: add.length })
    : t("Alles staat al in Host Override.");
  if (add.length) update({ rules: [...rules, ...add], enabled: true });
};

// --- Taal ---
$("langSel").value = langPref;
$("langSel").onchange = async () => {
  await chrome.storage.local.set({ lang: $("langSel").value });
  location.reload();
};

// --- Tabs: Regels / DNS-check / Meer ---
const VIEWS = { rules: ["tabRules", "viewRules"], dns: ["tabDns", "viewDns"], more: ["tabMore", "viewMore"] };
let dnsStarted = false, lastDnsHost = null;
function autoDns() {
  if (!tab) return;
  if (sideMode ? lastDnsHost !== tab.host : !dnsStarted) {
    dnsStarted = true;
    lastDnsHost = tab.host;
    checkDomain(tab.host, true);
  }
}
function showView(name) {
  for (const [key, [tabId, viewId]] of Object.entries(VIEWS)) {
    const on = key === name;
    $(viewId).hidden = !on;
    $(tabId).classList.toggle("active", on);
    $(tabId).setAttribute("aria-selected", String(on));
    $(tabId).tabIndex = on ? 0 : -1;
  }
  if (name === "more") { render(false); loadHostsFile(); }
  if (name === "dns") { if (tab) autoDns(); else $("dDomain").focus(); }
}
for (const [key, [tabId]] of Object.entries(VIEWS)) $(tabId).onclick = () => showView(key);
// Pijltjestoetsen wisselen tussen tabs (toegankelijkheid).
document.querySelector(".tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const keys = Object.keys(VIEWS);
  const cur = keys.findIndex((k) => $(VIEWS[k][0]).getAttribute("aria-selected") === "true");
  const next = keys[(cur + (e.key === "ArrowRight" ? 1 : keys.length - 1)) % keys.length];
  showView(next);
  $(VIEWS[next][0]).focus();
});
$("dnsPageBtn").onclick = () => { showView("dns"); if (tab) { dnsStarted = true; lastDnsHost = tab.host; checkDomain(tab.host, true); } };

// --- Zijpaneel ---
$("sideBtn").hidden = sideMode || !chrome.sidePanel;
$("sideBtn").onclick = async () => {
  try {
    const w = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: w.id });
    window.close();
  } catch (e) {
    showHelp(t("Zijpaneel openen mislukt: {e}", { e: String(e.message || e) }));
  }
};
if (sideMode) {
  // In het zijpaneel volgt de extensie de actieve tab, zodat je snel achter elkaar sites kunt controleren.
  const follow = async () => {
    const nt = await getTab();
    const changed = nt?.host !== tab?.host;
    tab = nt;
    if (changed) { render(true); if (!$("viewDns").hidden) autoDns(); } else render(false);
  };
  chrome.tabs.onActivated.addListener(follow);
  chrome.tabs.onUpdated.addListener((_id, info, t2) => { if (t2.active && (info.url || info.status === "complete")) follow(); });
  chrome.windows.onFocusChanged?.addListener(follow);
}

// --- Helper ---
$("copySetup").onclick = async () => copy(await buildSetupCommand(os, readFile), $("copySetup"), t("Gekopieerd, plak het nu"));
$("recheck").onclick = () => render();

tab = await getTab();
render();

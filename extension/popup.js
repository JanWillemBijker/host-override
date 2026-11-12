import {
  activeRules, matchRule, isHost, isIp, formatHosts, parseHosts,
  OS_LABELS, detectOS, buildChromeCommand, buildSetupCommand, reloadIfAffected, helperFetch,
} from "./common.js";
import { initI18n, t } from "./i18n.js";

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

async function load() {
  const { enabled = false, rules = [], autoReload = true, pageBadge = true, lastIp = "", sideDefault = false } =
    await chrome.storage.local.get(["enabled", "rules", "autoReload", "pageBadge", "lastIp", "sideDefault"]);
  return { enabled, rules, autoReload, pageBadge, lastIp, sideDefault };
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

async function renderSite(state) {
  $("site").hidden = !tab;
  if (!tab) return;
  $("siteHost").textContent = tab.host;
  const rule = matchRule(activeRules(state), tab.host);
  const key = `tab:${tab.id}`, liveKey = `live:${tab.host}`;
  const store = await chrome.storage.session.get([key, liveKey]);
  const rec = store[key];
  const seen = rec && rec.host === tab.host && rec.ip && rec.ip !== "127.0.0.1" ? rec.ip : null;
  // Het door Chrome gezien IP is alleen "live" als er geen override actief is.
  if (!rule && seen && store[liveKey] !== seen) await chrome.storage.session.set({ [liveKey]: seen });
  const live = (!rule && seen) || store[liveKey] || null;
  const granted = await chrome.permissions.contains(ALL_SITES);

  const pill = $("siteKind");
  if (rule) { pill.textContent = t("Override naar {ip}", { ip: rule.ip }); pill.className = "pill override"; }
  else { pill.textContent = t("Live"); pill.className = "pill live"; }

  $("liveIp").textContent = live || (granted && !rule ? t("Ververs de pagina") : "-");
  $("copyIp").hidden = !live;
  $("copyIp").onclick = () => copy(live, $("copyIp"));
  $("lookupBtn").hidden = !!live;
  $("permBtn").hidden = granted;
  $("useBtn").hidden = !!rule || !!state.rules.find((r) => r.host === tab.host);
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

async function dnsLookup(host) {
  const ask = async (type) => {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: "application/dns-json" } });
    const j = await r.json();
    return (j.Answer || []).filter((a) => a.type === (type === "A" ? 1 : 28)).map((a) => a.data);
  };
  let ips = await ask("A");
  if (!ips.length) ips = await ask("AAAA");
  return ips;
}

$("lookupBtn").onclick = async () => {
  if (!tab) return;
  $("dnsOut").textContent = t("Zoeken...");
  try {
    const ips = await dnsLookup(tab.host);
    if (!ips.length) { $("dnsOut").textContent = t("Geen DNS-record gevonden."); return; }
    await chrome.storage.session.set({ [`live:${tab.host}`]: ips[0] });
    $("dnsOut").textContent = ips.length > 1 ? t("Live IP's: {ips}", { ips: ips.slice(0, 4).join(", ") }) : "";
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

// --- Regels ---
async function render(refresh = true) {
  const state = await load();
  $("master").checked = state.enabled;
  $("autoReload").checked = state.autoReload;
  $("pageBadge").checked = state.pageBadge;
  $("sideDefault").checked = state.sideDefault;
  $("empty").hidden = state.rules.length > 0;
  $("bulk").hidden = state.rules.length < 2;
  $("filter").hidden = state.rules.length < 7;
  const q = $("filter").hidden ? "" : $("filter").value.trim().toLowerCase();
  const list = $("rules");
  list.textContent = "";
  state.rules.forEach((r, i) => {
    if (q && !(r.host.toLowerCase().includes(q) || r.ip.includes(q))) return;
    const row = document.createElement("div");
    row.className = "rule" + (r.enabled === false ? " off" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = r.enabled !== false;
    cb.title = t("Regel aan of uit");
    cb.setAttribute("aria-label", t("Regel aan of uit"));
    cb.onchange = async () => {
      const s = await load();
      s.rules[i].enabled = cb.checked;
      update({ rules: s.rules });
    };

    const host = document.createElement("span");
    host.className = "host";
    host.textContent = r.host;

    const ip = document.createElement("input");
    ip.type = "text";
    ip.value = r.ip;
    ip.spellcheck = false;
    ip.title = t("IP aanpassen");
    ip.setAttribute("aria-label", t("IP aanpassen"));
    ip.onchange = async () => {
      const v = ip.value.trim();
      if (!isIp(v)) { ip.value = r.ip; $("err").textContent = t("Ongeldig IP-adres."); return; }
      $("err").textContent = "";
      const s = await load();
      s.rules[i].ip = v;
      update({ rules: s.rules });
    };

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "×";
    del.title = t("Verwijderen");
    del.setAttribute("aria-label", t("Verwijderen"));
    del.onclick = async () => {
      const s = await load();
      s.rules.splice(i, 1);
      update({ rules: s.rules });
    };

    row.append(cb, host, ip, del);
    list.append(row);
  });
  await renderSite(state);
  if (!$("viewMore").hidden) {
    renderCommand(state.rules);
    if (document.activeElement !== $("hostsText")) $("hostsText").value = formatHosts(state.rules);
  }
  if (refresh) refreshStatus(state);
}

$("master").onchange = () => update({ enabled: $("master").checked });
$("filter").oninput = () => render(false);
$("autoReload").onchange = () => chrome.storage.local.set({ autoReload: $("autoReload").checked });
$("pageBadge").onchange = () => chrome.storage.local.set({ pageBadge: $("pageBadge").checked });
$("sideDefault").onchange = () => chrome.storage.local.set({ sideDefault: $("sideDefault").checked });

$("add").onsubmit = async (e) => {
  e.preventDefault();
  const host = $("host").value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:?#].*$/, "");
  const ip = $("ip").value.trim();
  if (!isHost(host)) { $("err").textContent = t("Ongeldig domein."); return; }
  if (!isIp(ip)) { $("err").textContent = t("Ongeldig IP-adres."); return; }
  $("err").textContent = "";
  const { rules } = await load();
  const next = rules.filter((r) => r.host !== host);
  next.push({ host, ip, enabled: true });
  $("host").value = "";
  $("ip").value = "";
  update({ rules: next, enabled: true, lastIp: ip });
};

$("bulkBtn").onclick = async () => {
  const ip = $("bulkIp").value.trim();
  if (!isIp(ip)) { $("err").textContent = t("Ongeldig IP-adres."); return; }
  $("err").textContent = "";
  const { rules } = await load();
  $("bulkIp").value = "";
  update({ rules: rules.map((r) => ({ ...r, ip })) });
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
$("os").onchange = async () => { os = $("os").value; renderCommand((await load()).rules); };
$("openWin").onclick = async () => {
  const { rules } = await load();
  const active = rules.filter((r) => r.enabled !== false).map(({ host, ip }) => ({ host, ip }));
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
  const { rules: incoming, skipped } = parseHosts($("hostsText").value);
  if (!incoming.length) { $("moreErr").textContent = t("Geen geldige regels gevonden."); return; }
  const { rules } = await load();
  const map = new Map(rules.map((r) => [r.host, r]));
  incoming.forEach((r) => map.set(r.host, r));
  $("moreErr").textContent = skipped ? t("{n} regel(s) overgeslagen.", { n: skipped }) : "";
  update({ rules: [...map.values()], enabled: true });
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
  if (name === "more") render(false);
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

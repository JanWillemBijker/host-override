import { PORT, EXPECTED_HELPER, isHost, activeRules, matchRule, reloadIfAffected, getSecret, helperStatus, helperFetch, loadState, STATE_KEYS } from "./common.js";
import { groupOf, groupName, activeGroups, normState, isTargetHost, isIp, buildDnrRules } from "./model.js";
import { classify, triggers, dohLookup, hostsLookup } from "./detect.js";
import { normIndicator, renderLabel, textColor, drawIndicator } from "./indicator.js";
import { t, setLang, resolveLang } from "./i18n.js";

const PROXY = `127.0.0.1:${PORT}`;
// Reageert er op poort 8899 iets dat zich niet als onze helper kan bewijzen (oude helper, verkeerd geheim
// of een ander programma), dan gaan de domeinen op de lijst naar een poort waar niets luistert: liever een
// foutmelding dan stilletjes een verkeerde server of je verkeer bij een vreemd programma.
const BLACKHOLE = "127.0.0.1:1";

const getState = loadState;

// Migratie vanaf 1.7: losse regels krijgen een standaardgroep. Eenmalig terugschrijven zodat popup,
// sync en export dezelfde vorm zien.
async function migrate() {
  const raw = await chrome.storage.local.get(STATE_KEYS);
  if (Array.isArray(raw.groups) && raw.rules?.every((r) => r && typeof r.group === "string")) return;
  const s = normState(raw);
  await chrome.storage.local.set({ rules: s.rules, groups: s.groups });
}

// `rules` is al gevalideerd (activeRules -> validRules): alleen [a-z0-9.-] en "*." komen in het script,
// en JSON.stringify zorgt dat het altijd een geldige string-array blijft.
function buildPac(rules, proxy = PROXY) {
  const patterns = JSON.stringify(rules.filter((r) => isHost(r.host)).map((r) => r.host.toLowerCase()));
  return `function FindProxyForURL(url, host) {
  host = host.toLowerCase();
  var p = ${patterns};
  for (var i = 0; i < p.length; i++) {
    var x = p[i];
    if (x.indexOf("*.") === 0) {
      var base = x.substring(2);
      if (host === base || (host.length > base.length && host.substring(host.length - base.length - 1) === "." + base)) return "PROXY ${proxy}";
    } else if (host === x) return "PROXY ${proxy}";
  }
  return "DIRECT";
}`;
}

// Alleen naar een helper die zich met het geheim heeft bewezen (helperFetch controleert dat eerst).
async function pushToProxy(rules) {
  try {
    const res = await helperFetch("/__rules", { body: rules.map(({ host, ip }) => ({ host, ip })) });
    return res.ok;
  } catch {
    return false;
  }
}

// Verzoek-headers per groep (geen cache, Basic-auth, eigen headers) via declarativeNetRequest.
// Alleen voor actieve regels van groepen die aan staan; Chrome past ze alleen toe op hosts waarvoor
// de extensie toegang heeft (declarativeNetRequestWithHostAccess).
let headersKey = "";
async function applyHeaders(state) {
  if (!chrome.declarativeNetRequest) return;
  const add = buildDnrRules(state);
  const key = JSON.stringify(add);
  if (key === headersKey) return;
  try {
    const old = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map((r) => r.id), addRules: add });
    headersKey = key;
  } catch (e) { console.warn("Headers niet ingesteld:", e); }
}

// Zet de proxy-regel voor het gewone profiel en stuur de IP-koppelingen naar de helper.
async function apply() {
  const state = await getState();
  await applyHeaders(state);
  const rules = activeRules(state);
  const info = await helperStatus();
  if (rules.length === 0) {
    await chrome.proxy.settings.clear({ scope: "regular" });
    await chrome.action.setBadgeText({ text: "" });
    return { info, ok: true, active: 0 };
  }
  // Niet bereikbaar: gewone PAC (er luistert niets, dus er lekt niets; na een herstart werkt het direct weer).
  const untrusted = info.reachable && !info.verified;
  await chrome.proxy.settings.set({
    value: { mode: "pac_script", pacScript: { data: buildPac(rules, untrusted ? BLACKHOLE : PROXY) } },
    scope: "regular",
  });
  const ok = info.verified && await pushToProxy(rules);
  // Eén actieve groep: badge in de kleur van die groep. Meerdere: de vaste accentkleur.
  const groups = activeGroups(state);
  const color = groups.length === 1 ? groups[0].color : "#c2410c";
  await chrome.action.setBadgeBackgroundColor({ color: ok ? color : "#c92a2a" });
  await chrome.action.setBadgeText({ text: ok ? String(rules.length) : "!" });
  return { info, ok, active: rules.length };
}

async function status() {
  const { levelOfControl } = await chrome.proxy.settings.get({ incognito: false });
  const { info, ok, active } = await apply();
  const outdated = info.reachable && info.version < EXPECTED_HELPER;
  return {
    active,
    reachable: info.reachable,
    ok: info.verified && ok,
    outdated,
    // Helper draait (juiste versie) maar kent ons geheim niet: geen/kapotte config, oud geheim of ander programma.
    setup: info.reachable && !outdated && !info.verified,
    blocked: levelOfControl === "controlled_by_other_extensions",
    error: info.error,
    features: info.features || [],
    pushFailed: active > 0 && info.verified && !ok,
  };
}

// Zijpaneel: met "altijd als zijpaneel" opent een klik op het icoon het zijpaneel in plaats van de popup.
async function applyPanel() {
  try {
    const { sideDefault = false } = await chrome.storage.local.get("sideDefault");
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: sideDefault });
    await chrome.action.setPopup({ popup: sideDefault ? "" : "popup.html" });
  } catch { /* zijpaneel niet beschikbaar in deze Chrome-versie */ }
}
applyPanel();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.enabled || changes.rules || changes.groups || changes.subs)) apply();
  if (area === "local" && changes.sideDefault) applyPanel();
  if (area === "local" && (changes.indicator || changes.pageBadge || changes.lang)) repaintAll();
});

// ---------- Huidige site: live of niet? ----------
// Optioneel (alleen na toestemming voor alle sites): IP van de hoofdpagina per tab bewaren, bepalen of dat
// het live IP is (Host Override-regel, hosts-bestand via de helper, of afwijkend van publieke DNS) en dat
// tonen met de badge op het icoon en, als ingesteld, een indicator in de pagina zelf.
const ALL_SITES = { origins: ["<all_urls>"] };
const BADGE = { rule: ["TEST", "#c2410c"], hosts: ["HOST", "#6741d9"], differs: ["DNS?", "#9c4a00"] };

async function indicatorSettings() {
  const { pageBadge = true, indicator, lang } = await chrome.storage.local.get(["pageBadge", "indicator", "lang"]);
  setLang(resolveLang(lang));
  return { master: pageBadge, ind: normIndicator(indicator) };
}

// Hosts-bestand-treffers kort onthouden: bij doorklikken binnen een site niet steeds de helper vragen.
const hostsMemo = new Map();
async function hostsFor(host) {
  const m = hostsMemo.get(host);
  if (m && m.until > Date.now()) return m.v;
  const v = await hostsLookup(host);
  hostsMemo.set(host, { v, until: Date.now() + 5000 });
  if (hostsMemo.size > 200) hostsMemo.delete(hostsMemo.keys().next().value);
  return v;
}

// Doel als hostnaam: de helper zoekt het IP op (systeem-resolver, ~60 s cache). Hier kort onthouden.
const resolveMemo = new Map();
async function resolvedIp(name) {
  const m = resolveMemo.get(name);
  if (m && m.until > Date.now()) return m.v;
  let v = null;
  try {
    const res = await helperFetch("/__resolve", { body: { names: [name] } });
    if (res.ok) { const ip = (await res.json())?.results?.[name]?.ips?.[0]; if (isIp(ip)) v = ip; }
  } catch { /* helper niet beschikbaar */ }
  resolveMemo.set(name, { v, until: Date.now() + 30000 });
  if (resolveMemo.size > 100) resolveMemo.delete(resolveMemo.keys().next().value);
  return v;
}

function sourceName(source) {
  return { rule: "Host Override", hosts: t("hosts-bestand"), differs: t("afwijkende DNS") }[source] || "";
}

async function setTabBadge(tabId, source, color) {
  try {
    const b = BADGE[source];
    if (b) {
      await chrome.action.setBadgeBackgroundColor({ color: color || b[1], tabId });
      await chrome.action.setBadgeText({ text: b[0], tabId });
    } else {
      // null: terug naar de algemene badge (aantal regels). Oudere Chrome-versies kennen null niet: dan leeg.
      await chrome.action.setBadgeText({ text: null, tabId }).catch(() => chrome.action.setBadgeText({ text: "", tabId }));
    }
  } catch { /* tab bestaat niet meer */ }
}

// Indicator tekenen of weghalen. Alleen in het hoofdframe van http(s)-pagina's waar we toegang hebben.
async function paintIndicator(tabId, rec) {
  if (!rec || !(await chrome.permissions.contains(ALL_SITES))) return;
  const { master, ind } = await indicatorSettings();
  const { [`dismissed:${tabId}`]: dismissed } = await chrome.storage.session.get(`dismissed:${tabId}`);
  const show = master && dismissed !== rec.host && triggers(rec.result, ind);
  if (!show && !rec.painted) return; // niets te tekenen en niets weg te halen
  let cfg = { remove: true };
  if (show) {
    const r = rec.result;
    const source = sourceName(r.source);
    const color = r.source === "rule" && ind.groupColor && rec.groupColor ? rec.groupColor : ind.color;
    const ip = rec.resolved ? `${r.ip} (${rec.resolved})` : r.ip || "";
    cfg = {
      style: ind.style, corner: ind.corner, edge: ind.edge, size: ind.size, opacity: ind.opacity,
      hideHover: ind.hideHover, dismiss: ind.dismiss, color, fg: textColor(color),
      text: renderLabel(ind.text, { ip: rec.resolved || r.ip || "", host: rec.host, source, group: rec.group || "" }, ind.showIp),
      title: (r.source === "rule" ? (rec.group ? `${rec.group} · ` : "") + t("Host Override: deze pagina komt van je testserver ({ip}).", { ip })
        : r.source === "hosts" ? t("Host Override: {host} staat in je hosts-bestand ({ip}).", { host: rec.host, ip: r.ip })
        : t("Host Override: het IP van deze pagina ({ip}) wijkt af van publieke DNS.", { ip: r.ip || "?" })) +
        (ind.dismiss ? " " + t("Klik om te verbergen voor deze tab.") : ""),
      closeLabel: t("Verbergen voor deze tab"),
    };
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: drawIndicator, args: [cfg, null] });
    rec.painted = show;
    await chrome.storage.session.set({ [`tab:${tabId}`]: rec });
  } catch { /* pagina niet toegankelijk (chrome://, Web Store, PDF-viewer) */ }
}

async function evaluate(tabId, host, ip) {
  const state = await getState();
  const rule = matchRule(activeRules(state), host);
  let hosts = null, doh = null;
  if (!rule) {
    hosts = await hostsFor(host); // lokaal, alleen als de helper zich heeft bewezen
    const hostsHit = hosts && hosts.some((e) => e.kind !== "blocked");
    const { master, ind } = await indicatorSettings();
    // Publieke DNS alleen automatisch als de gebruiker "wijkt af van publieke DNS" heeft aangezet
    // (dan gaat elke bezochte hostnaam naar Cloudflare; dat staat bij de instelling).
    if (!hostsHit && ip && master && ind.onDiffers) {
      try { doh = await dohLookup(host); } catch { doh = null; }
    } else if (!hostsHit && ip) {
      const c = (await chrome.storage.session.get(`doh:${host}`))[`doh:${host}`];
      if (c && c.exp > Date.now()) doh = c; // eerder op klik opgezocht
    }
  }
  const result = classify({ ip, rule, hosts, doh });
  const rec = { host, ip: ip || null, result, at: Date.now() };
  if (rule) {
    const g = groupOf(state, rule.group);
    rec.group = groupName(g, state, t);
    rec.groupColor = g?.color || null;
    if (isTargetHost(rule.ip)) rec.resolved = await resolvedIp(rule.ip);
  }
  await chrome.storage.session.set({ [`tab:${tabId}`]: rec });
  await setTabBadge(tabId, result.source === "differs" && result.near ? null : result.source, rec.groupColor);
  await paintIndicator(tabId, rec);
}

async function onCompleted(d) {
  if (d.tabId < 0 || d.frameId !== 0) return;
  let host;
  try { host = new URL(d.url).hostname; } catch { return; }
  const { [`dismissed:${d.tabId}`]: dismissed } = await chrome.storage.session.get(`dismissed:${d.tabId}`);
  if (dismissed && dismissed !== host) await chrome.storage.session.remove(`dismissed:${d.tabId}`);
  await evaluate(d.tabId, host, d.ip || null);
}

// Instellingen van de indicator gewijzigd: open tabs direct bijwerken (zelfde uitkomst, nieuwe stijl).
async function repaintAll() {
  const all = await chrome.storage.session.get(null);
  for (const [k, rec] of Object.entries(all)) {
    if (!k.startsWith("tab:")) continue;
    const tabId = Number(k.slice(4));
    await setTabBadge(tabId, rec.result?.source === "differs" && rec.result.near ? null : rec.result?.source, rec.groupColor);
    await paintIndicator(tabId, rec);
  }
}

function registerWebRequest() {
  try {
    if (!chrome.webRequest.onCompleted.hasListener(onCompleted)) {
      chrome.webRequest.onCompleted.addListener(onCompleted, { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] });
    }
  } catch (e) {
    console.warn("webRequest nog niet beschikbaar:", e);
  }
}
registerWebRequest();
chrome.permissions.onAdded.addListener(registerWebRequest);
chrome.tabs.onRemoved.addListener((id) => chrome.storage.session.remove([`tab:${id}`, `dismissed:${id}`]));

function startAlarm() {
  chrome.alarms.create("resync", { periodInMinutes: 1 });
}
chrome.runtime.onStartup.addListener(async () => { startAlarm(); await migrate(); apply(); });
chrome.runtime.onInstalled.addListener(async (details) => {
  await getSecret(); // geheim voor de helper alvast aanmaken
  await migrate();
  startAlarm();
  apply();
  if (details.reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});
// Houdt de helper in sync als die later (opnieuw) wordt gestart.
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "resync") apply(); });

// Sneltoets: aan/uit. De sneltoets geeft tijdelijk toegang tot de actieve tab (voor het herladen).
chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== "toggle") return;
  const old = await getState();
  await chrome.storage.local.set({ enabled: !old.enabled });
  await apply();
  const { autoReload = true } = await chrome.storage.local.get("autoReload");
  if (autoReload) await reloadIfAffected(tab, old, await getState());
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg === "status") { status().then(sendResponse, (e) => sendResponse({ error: String(e) })); return true; }
  // Klik op de indicator: verbergen voor deze tab (tot de tab naar een andere site gaat of sluit).
  if (msg?.type === "ho-dismiss" && sender.tab?.id >= 0 && sender.frameId === 0 && /^https?:/.test(sender.url || "")) {
    const tabId = sender.tab.id, host = new URL(sender.url).hostname;
    chrome.storage.session.get(`tab:${tabId}`).then(async ({ [`tab:${tabId}`]: rec }) => {
      await chrome.storage.session.set({ [`dismissed:${tabId}`]: host });
      if (rec) { rec.painted = false; await chrome.storage.session.set({ [`tab:${tabId}`]: rec }); }
    });
  }
  // Popup: opnieuw beoordelen na "Opzoeken" (publieke DNS) of als de helper net gekoppeld is.
  if (msg?.type === "ho-reevaluate" && !sender.tab && Number.isInteger(msg.tabId)) {
    chrome.storage.session.get(`tab:${msg.tabId}`).then(async ({ [`tab:${msg.tabId}`]: rec }) => {
      if (rec) { hostsMemo.delete(rec.host); await evaluate(msg.tabId, rec.host, rec.ip); }
      sendResponse(true);
    });
    return true;
  }
});

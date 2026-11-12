import { PORT, EXPECTED_HELPER, isHost, activeRules, matchRule, reloadIfAffected } from "./common.js";

const PROXY = `127.0.0.1:${PORT}`;
const BASE = `http://${PROXY}`;

async function getState() {
  const { enabled = false, rules = [] } = await chrome.storage.local.get(["enabled", "rules"]);
  return { enabled, rules };
}

// `rules` is al gevalideerd (activeRules -> validRules): alleen [a-z0-9.-] en "*." komen in het script,
// en JSON.stringify zorgt dat het altijd een geldige string-array blijft.
function buildPac(rules) {
  const patterns = JSON.stringify(rules.filter((r) => isHost(r.host)).map((r) => r.host.toLowerCase()));
  return `function FindProxyForURL(url, host) {
  host = host.toLowerCase();
  var p = ${patterns};
  for (var i = 0; i < p.length; i++) {
    var x = p[i];
    if (x.indexOf("*.") === 0) {
      var base = x.substring(2);
      if (host === base || (host.length > base.length && host.substring(host.length - base.length - 1) === "." + base)) return "PROXY ${PROXY}";
    } else if (host === x) return "PROXY ${PROXY}";
  }
  return "DIRECT";
}`;
}

async function pushToProxy(rules) {
  try {
    const res = await fetch(`${BASE}/__rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Host-Override": "1" },
      body: JSON.stringify(rules.map(({ host, ip }) => ({ host, ip }))),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function helperInfo() {
  try {
    const res = await fetch(`${BASE}/__status`);
    const json = await res.json().catch(() => null);
    return { reachable: true, version: json?.helper ?? 1 };
  } catch (e) {
    return { reachable: false, version: 0, error: String(e) };
  }
}

// Zet de proxy-regel voor het gewone profiel en stuur de IP-koppelingen naar de helper.
async function apply() {
  const rules = activeRules(await getState());
  if (rules.length === 0) {
    await chrome.proxy.settings.clear({ scope: "regular" });
    await chrome.action.setBadgeText({ text: "" });
    return { ok: true, active: 0 };
  }
  await chrome.proxy.settings.set({
    value: { mode: "pac_script", pacScript: { data: buildPac(rules) } },
    scope: "regular",
  });
  const ok = await pushToProxy(rules);
  await chrome.action.setBadgeBackgroundColor({ color: ok ? "#c2410c" : "#c92a2a" });
  await chrome.action.setBadgeText({ text: ok ? String(rules.length) : "!" });
  return { ok, active: rules.length };
}

async function status() {
  const { levelOfControl } = await chrome.proxy.settings.get({ incognito: false });
  const [info, res] = await Promise.all([helperInfo(), apply()]);
  return {
    active: res.active,
    reachable: info.reachable,
    ok: info.reachable && res.ok,
    outdated: info.reachable && info.version < EXPECTED_HELPER,
    blocked: levelOfControl === "controlled_by_other_extensions",
    error: info.error,
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
  if (area === "local" && (changes.enabled || changes.rules)) apply();
  if (area === "local" && changes.sideDefault) applyPanel();
});

// Optioneel (alleen na toestemming voor alle sites): IP van de hoofdpagina per tab bewaren
// en tabs met een override markeren met TEST.
// Klein TEST-label onderin de pagina zelf, zodat je nooit vergeet dat je op de testserver zit.
function pill(ip, title) {
  const ID = "host-override-pill";
  if (document.getElementById(ID)) { document.getElementById(ID).shadowRoot.querySelector("span").textContent = "TEST " + ip; return; }
  const host = document.createElement("div");
  host.id = ID;
  const root = host.attachShadow({ mode: "closed" });
  const s = document.createElement("span");
  s.textContent = "TEST " + ip;
  s.title = title;
  s.style.cssText = "all:initial;position:fixed;left:10px;bottom:10px;z-index:2147483647;background:#c2410c;color:#fff;font:600 12px system-ui,sans-serif;padding:4px 10px;border-radius:12px;box-shadow:0 1px 6px rgba(0,0,0,.35);cursor:pointer;opacity:.92";
  s.onclick = () => host.remove();
  root.append(s);
  document.documentElement.append(host);
}

async function onCompleted(d) {
  if (d.tabId < 0) return;
  const host = new URL(d.url).hostname;
  await chrome.storage.session.set({ [`tab:${d.tabId}`]: { host, ip: d.ip || null } });
  const rule = matchRule(activeRules(await getState()), host);
  if (rule) {
    chrome.action.setBadgeBackgroundColor({ color: "#c2410c", tabId: d.tabId });
    chrome.action.setBadgeText({ text: "TEST", tabId: d.tabId });
    const { pageBadge = true } = await chrome.storage.local.get("pageBadge");
    if (pageBadge) {
      try { await chrome.scripting.executeScript({ target: { tabId: d.tabId }, func: pill, args: [rule.ip, chrome.i18n.getMessage("pillTitle")] }); } catch { /* pagina niet toegankelijk */ }
    }
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
chrome.tabs.onRemoved.addListener((id) => chrome.storage.session.remove(`tab:${id}`));

function startAlarm() {
  chrome.alarms.create("resync", { periodInMinutes: 1 });
}
chrome.runtime.onStartup.addListener(() => { startAlarm(); apply(); });
chrome.runtime.onInstalled.addListener((details) => {
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg === "status") { status().then(sendResponse, (e) => sendResponse({ error: String(e) })); return true; }
});

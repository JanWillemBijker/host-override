// Gegevensmodel van Host Override: regels, groepen (omgevingen), notities, doelen (IP of hostnaam),
// abonnementen, het hosts-formaat (export/import) en de verzoek-headers per groep.
// Puur: geen chrome.* en geen DOM, zodat alles ook in Node te testen is (tests/run.mjs).

// ---------- Strikte validatie ----------
// Deze waarden komen in de PAC-regel, de helper, declarativeNetRequest en (gekopieerde) shell-commando's.
// Hostnaam: labels van 1-63 tekens (a-z, 0-9, -), niet beginnend of eindigend met -, totaal max 253.
// Optioneel "*." vooraan voor domein + alle subdomeinen.
const LABEL = "(?!-)[a-z0-9-]{1,63}(?<!-)";
const HOST_RE = new RegExp(`^(\\*\\.)?${LABEL}(\\.${LABEL})*$`, "i");
const V4_PART = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const V4_RE = new RegExp(`^${V4_PART}(\\.${V4_PART}){3}$`);

export const isHost = (h) => typeof h === "string" && h.length <= 255 && HOST_RE.test(h);

export function isIp(ip) {
  if (typeof ip !== "string" || ip.length > 45) return false;
  if (V4_RE.test(ip)) return true;
  // IPv6: alleen hex, dubbele punten en (voor ::ffff:1.2.3.4) punten; daarna door de URL-parser laten controleren.
  if (!ip.includes(":") || !/^[0-9a-f:.]+$/i.test(ip)) return false;
  try { return new URL(`http://[${ip}]/`).hostname.length > 2; } catch { return false; }
}

// Doel als hostnaam (bijvoorbeeld server123.hostingpartij.nl): geen wildcard, max 253 tekens, minstens één punt
// (of precies "localhost"), en het laatste label bevat een letter (zodat "999.1.1.1" of "10.0.0" nooit als
// hostnaam doorgaat en een losse regel tekst als "rommel regel" geen regel wordt).
export function isTargetHost(v) {
  if (typeof v !== "string" || v.length > 253 || v.startsWith("*.") || !HOST_RE.test(v)) return false;
  if (!v.includes(".") && v.toLowerCase() !== "localhost") return false;
  return /[a-z]/i.test(v.slice(v.lastIndexOf(".") + 1));
}
export const isTarget = (v) => isIp(v) || isTargetHost(v);
export const targetKind = (v) => (isIp(v) ? "ip" : isTargetHost(v) ? "host" : null);

// Vrije tekst (notities, groepsnamen): geen stuurtekens, ingekort.
export function cleanText(s, max) {
  return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max) : "";
}
export const NOTE_MAX = 120;
export const NAME_MAX = 60;

// ---------- Groepen ----------
export const DEFAULT_GROUP = "default";
export const GROUP_COLORS = ["#c2410c", "#1971c2", "#2b8a3e", "#6741d9", "#c92a2a", "#0c8599", "#a61e4d", "#5c5f66"];
const GROUP_ID_RE = /^[a-z0-9_-]{1,40}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
export const isColor = (c) => typeof c === "string" && COLOR_RE.test(c);

// ---------- Verzoek-headers per groep ----------
// Naam: een HTTP-token. Geblokkeerd: hop-by-hop- en verboden headers, plus wat via de eigen velden gaat
// (Authorization via Basic-auth) of de site stuk kan maken (Cookie overschrijft alle cookies).
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9a-z-]{1,64}$/i;
const BLOCKED_HEADERS = new Set(["host", "connection", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding",
  "upgrade", "content-length", "expect", "cookie", "cookie2", "origin", "referer", "date", "via", "authorization",
  "accept-charset", "accept-encoding", "access-control-request-headers", "access-control-request-method", "dnt",
  "x-host-override", "x-host-override-token"]);
export function headerProblem(name, value) {
  if (typeof name !== "string" || !HEADER_NAME_RE.test(name)) return "name";
  const n = name.toLowerCase();
  if (BLOCKED_HEADERS.has(n) || n.startsWith("sec-") || n.startsWith("proxy-")) return "blocked";
  if (typeof value !== "string" || value.length > 1024 || /[\u0000-\u0008\u000a-\u001f\u007f]/.test(value)) return "value";
  return null;
}
export const MAX_HEADERS = 10;

// Basic-auth: gebruikersnaam zonder ":" (scheidingsteken), beide zonder stuurtekens, max 200 tekens.
export function authProblem(user, pass) {
  if (typeof user !== "string" || typeof pass !== "string") return "type";
  if (!user || user.length > 200 || user.includes(":") || /[\u0000-\u001f\u007f]/.test(user)) return "user";
  if (pass.length > 200 || /[\u0000-\u001f\u007f]/.test(pass)) return "pass";
  return null;
}

export function normGroup(g, i = 0) {
  const r = g && typeof g === "object" ? g : {};
  const out = {
    id: typeof r.id === "string" && GROUP_ID_RE.test(r.id) ? r.id : i === 0 ? DEFAULT_GROUP : `g${i}`,
    name: cleanText(r.name, NAME_MAX),
    color: isColor(r.color) ? r.color.toLowerCase() : r.id === DEFAULT_GROUP ? GROUP_COLORS[0] : GROUP_COLORS[i % GROUP_COLORS.length],
    enabled: r.enabled !== false,
    noCache: r.noCache === true,
    auth: null,
    headers: [],
  };
  if (r.auth && typeof r.auth === "object" && !authProblem(r.auth.user, r.auth.pass ?? "")) out.auth = { user: r.auth.user, pass: r.auth.pass ?? "" };
  if (Array.isArray(r.headers)) {
    for (const h of r.headers) {
      if (out.headers.length >= MAX_HEADERS) break;
      const name = typeof h?.name === "string" ? h.name.trim() : "";
      const value = typeof h?.value === "string" ? h.value.trim() : "";
      if (!headerProblem(name, value)) out.headers.push({ name, value });
    }
  }
  if (typeof r.sub === "string" && GROUP_ID_RE.test(r.sub)) out.sub = r.sub;
  // Eén doel voor de hele groep (IP of hostnaam): alle eigen regels in de groep gaan daarheen. Niet bij abonnementen.
  else if (isTarget(r.target)) out.target = isIp(r.target) ? r.target : r.target.toLowerCase();
  return out;
}

export const newGroupId = (groups, rnd = Math.random) => {
  let id;
  do id = "g" + Math.floor(rnd() * 36 ** 6).toString(36); while (groups.some((g) => g.id === id));
  return id;
};

export function normRule(r, groupIds) {
  if (!r || !isHost(r.host) || !isTarget(r.ip)) return null;
  const out = { host: r.host.toLowerCase(), ip: isIp(r.ip) ? r.ip : r.ip.toLowerCase(), enabled: r.enabled !== false };
  out.group = groupIds && groupIds.has(r.group) ? r.group : DEFAULT_GROUP;
  const note = cleanText(r.note, NOTE_MAX);
  if (note) out.note = note;
  return out;
}

// ---------- Abonnementen (alleen-lezen regellijsten op een https-URL) ----------
export const SUB_MAX_BYTES = 256 * 1024;
export const SUB_MAX_RULES = 2000;
export const SUB_INTERVALS = [0, 60, 1440]; // minuten; 0 = alleen handmatig
export function subUrlProblem(u) {
  let url;
  try { url = new URL(u); } catch { return "url"; }
  if (url.protocol !== "https:") return "https";
  if (url.username || url.password) return "credentials";
  if (!isHost(url.hostname) || url.hostname.startsWith("*.")) return "host";
  if (u.length > 2000) return "url";
  return null;
}
// Toestemming die nodig is om de lijst op te halen: alleen die ene origin.
export const subOrigin = (u) => `https://${new URL(u).host}/*`;

export function normSub(s, i = 0) {
  if (!s || typeof s !== "object" || subUrlProblem(s.url)) return null;
  const id = typeof s.id === "string" && GROUP_ID_RE.test(s.id) ? s.id : `s${i}`;
  return {
    id,
    url: new URL(s.url).href,
    interval: SUB_INTERVALS.includes(s.interval) ? s.interval : 1440,
    lastFetch: Number.isFinite(s.lastFetch) ? s.lastFetch : 0,
    lastOk: Number.isFinite(s.lastOk) ? s.lastOk : 0,
    error: typeof s.error === "string" ? s.error.slice(0, 200) : "",
    skipped: Number.isInteger(s.skipped) && s.skipped >= 0 ? s.skipped : 0,
    rules: (Array.isArray(s.rules) ? s.rules : []).slice(0, SUB_MAX_RULES).map((r) => normRule(r)).filter(Boolean)
      .map(({ host, ip, enabled, note }) => (note ? { host, ip, enabled, note } : { host, ip, enabled })),
  };
}
export const subGroupId = (subId) => `sub-${subId}`.slice(0, 40);

// ---------- Toestand normaliseren (en migreren vanaf 1.7: losse regels -> standaardgroep) ----------
// in: ruwe opslag { enabled, rules, groups, subs, exclusiveGroups }; uit: schone toestand.
export function normState(raw = {}) {
  const groups = [];
  const seen = new Set();
  (Array.isArray(raw.groups) ? raw.groups : []).forEach((g, i) => {
    const n = normGroup(g, i);
    if (!seen.has(n.id)) { seen.add(n.id); groups.push(n); }
  });
  if (!seen.has(DEFAULT_GROUP)) { groups.unshift(normGroup({ id: DEFAULT_GROUP }, 0)); seen.add(DEFAULT_GROUP); }
  const subs = [];
  (Array.isArray(raw.subs) ? raw.subs : []).forEach((s, i) => { const n = normSub(s, i); if (n && !subs.some((x) => x.id === n.id)) subs.push(n); });
  // Elk abonnement heeft een eigen groep; groepen van opgezegde abonnementen verdwijnen.
  for (const s of subs) {
    const gid = subGroupId(s.id);
    const g = groups.find((x) => x.id === gid);
    if (g) g.sub = s.id;
    else { groups.push(normGroup({ id: gid, sub: s.id, color: "#5c5f66" }, groups.length)); seen.add(gid); }
  }
  const live = groups.filter((g) => !g.sub || subs.some((s) => s.id === g.sub));
  const ownIds = new Set(live.filter((g) => !g.sub).map((g) => g.id));
  const rules = [];
  for (const r of Array.isArray(raw.rules) ? raw.rules : []) {
    const n = normRule(r, ownIds);
    if (n && !rules.some((x) => x.host === n.host)) rules.push(n);
  }
  return { enabled: raw.enabled === true, rules, groups: live, subs, exclusiveGroups: raw.exclusiveGroups === true, wwwPair: raw.wwwPair !== false };
}

export const groupOf = (state, id) => state.groups.find((g) => g.id === id) || state.groups.find((g) => g.id === DEFAULT_GROUP) || null;

// Alle regels (eigen + abonnementen), met groep. Eigen regels gaan voor: bij dezelfde host wint de eerste.
export function allRules(stateRaw) {
  const s = stateRaw && stateRaw.groups ? stateRaw : normState(stateRaw);
  const gt = new Map(s.groups.filter((g) => g.target && !g.sub).map((g) => [g.id, g.target]));
  // Groep met een eigen doel: de regel gaat naar dat doel; het eigen IP blijft bewaard (ownIp) voor als het groepsdoel weer weg gaat.
  const out = s.rules.map((r) => (gt.has(r.group) ? { ...r, ip: gt.get(r.group), ownIp: r.ip, viaGroup: true } : { ...r }));
  for (const sub of s.subs) {
    const gid = subGroupId(sub.id);
    for (const r of sub.rules) out.push({ ...r, group: gid, sub: sub.id, readOnly: true });
  }
  return out;
}

// Alleen geldige regels doorlaten (bescherming tegen beschadigde of handmatig aangepaste opslag).
export const validRules = (rules) =>
  (Array.isArray(rules) ? rules : []).filter((r) => r && isHost(r.host) && isTarget(r.ip));

// www en zonder www horen bij elkaar: "voorbeeld.nl" geldt ook voor "www.voorbeeld.nl" en andersom,
// tenzij die andere variant een eigen regel heeft (ook een uitgezette). Wildcards dekken beide al.
export function wwwTwin(host) {
  const h = String(host).toLowerCase();
  if (h.startsWith("*.") || isIp(h)) return null;
  if (h.startsWith("www.")) { const b = h.slice(4); return b.includes(".") && isHost(b) ? b : null; }
  const w = "www." + h;
  return h.includes(".") && isHost(w) ? w : null;
}
export function addWwwTwins(rules, all = rules) {
  const taken = new Set(all.map((r) => r.host));
  const out = [...rules];
  for (const r of rules) {
    const tw = wwwTwin(r.host);
    if (!tw || taken.has(tw)) continue;
    taken.add(tw);
    out.push({ ...r, host: tw, twinOf: r.host });
  }
  return out;
}

// Actief = hoofdschakelaar aan, groep aan, regel aan. Werkt ook met een oude toestand zonder groepen.
// De www-tweelingen komen achteraan, dus een expliciete regel of wildcard gaat altijd voor.
export function activeRules(stateRaw) {
  const s = stateRaw && stateRaw.groups && stateRaw.subs ? stateRaw : normState(stateRaw);
  if (!s.enabled) return [];
  const on = new Set(s.groups.filter((g) => g.enabled).map((g) => g.id));
  const all = validRules(allRules(s));
  const act = all.filter((r) => r.enabled !== false && on.has(r.group));
  return s.wwwPair === false ? act : addWwwTwins(act, all);
}

// Zelfde matchlogica als de PAC-regel en de proxy: exact, of "*.domein" voor domein + subdomeinen. Eerste treffer wint.
export function matchRule(rules, host) {
  const h = String(host).toLowerCase();
  for (const r of rules) {
    const p = r.host.toLowerCase();
    if (p.startsWith("*.")) {
      const base = p.slice(2);
      if (h === base || h.endsWith("." + base)) return r;
    } else if (h === p) return r;
  }
  return null;
}

// Groep aan/uit. Met "één groep tegelijk" gaan de andere groepen uit als er een aan gaat.
export function setGroupEnabled(state, id, on) {
  return {
    ...state,
    groups: state.groups.map((g) => (g.id === id ? { ...g, enabled: on } : state.exclusiveGroups && on ? { ...g, enabled: false } : g)),
  };
}

// Groepen met actieve regels (voor de badgekleur en de popup).
export function activeGroups(state) {
  const ids = new Set(activeRules(state).map((r) => r.group));
  return state.groups.filter((g) => ids.has(g.id));
}

// ---------- Hosts-formaat (delen, export, abonnementen) ----------
// 203.0.113.10 voorbeeld.nl          # notitie
// #off 203.0.113.10 api.voorbeeld.nl  (uitgezette regel)
// # group: Klant X – staging #1971c2  (alle regels hierna horen bij deze groep; "off" aan het eind = groep uit)
// # group: Klant Y #2b8a3e ip=10.0.0.5  (één doel voor de hele groep; de regels staan er ook met dat doel)
// server123.hostingpartij.nl shop.voorbeeld.nl   (doel als hostnaam)
export function formatHosts(rules, groups) {
  const lines = [];
  const line = (r, ip = r.ip) => `${r.enabled === false ? "#off " : ""}${ip} ${r.host}${r.note ? "  # " + cleanText(r.note, NOTE_MAX) : ""}`;
  if (!Array.isArray(groups)) return rules.map((r) => line(r)).join("\n");
  for (const g of groups) {
    const list = rules.filter((r) => (r.group || DEFAULT_GROUP) === g.id);
    if (!list.length) continue;
    if (lines.length) lines.push("");
    lines.push(`# group: ${g.name || (g.id === DEFAULT_GROUP ? "Default" : g.id)} ${g.color}${g.target ? " ip=" + g.target : ""}${g.enabled === false ? " off" : ""}`);
    lines.push(...list.map((r) => line(r, g.target || r.ip)));
  }
  return lines.join("\n");
}

export function parseGroupHeader(line) {
  const m = line.match(/^#\s*group\s*:\s*(.*)$/i);
  if (!m) return null;
  let rest = m[1].trim(), enabled = true, color = null, target = null;
  if (/\s+off$/i.test(rest)) { enabled = false; rest = rest.replace(/\s+off$/i, ""); }
  const tm = rest.match(/(?:^|\s)ip=(\S+)$/i);
  if (tm) {
    const v = isIp(tm[1]) ? tm[1] : tm[1].toLowerCase();
    if (isTarget(v)) target = v;
    rest = rest.slice(0, tm.index).trim();
  }
  const c = rest.match(/(?:^|\s)(#[0-9a-f]{6})$/i);
  if (c) { color = c[1].toLowerCase(); rest = rest.slice(0, c.index).trim(); }
  const name = cleanText(rest, NAME_MAX);
  if (!name) return null;
  const out = { name, color, enabled };
  if (target) out.target = target;
  return out;
}

// Uit: { rules: [{host, ip, enabled, note?, groupName?}], groups: [{name, color, enabled}], skipped }
export function parseHosts(text, { maxRules = 5000 } = {}) {
  const rules = [];
  const groups = [];
  let skipped = 0, cur = null;
  for (let line of String(text).replace(/^﻿/, "").split(/\r\n|\r|\n/)) {
    line = line.trim();
    if (!line) continue;
    const gh = parseGroupHeader(line);
    if (gh) {
      cur = groups.find((g) => g.name.toLowerCase() === gh.name.toLowerCase()) || (groups.push(gh), gh);
      continue;
    }
    let enabled = true;
    if (/^#off\s/i.test(line)) { enabled = false; line = line.slice(4).trim(); }
    else if (line.startsWith("#")) continue;
    let note = "";
    const ci = line.search(/\s#/);
    if (ci >= 0) { note = cleanText(line.slice(ci).replace(/^\s*#+/, ""), NOTE_MAX); line = line.slice(0, ci).trim(); }
    const [target, ...hosts] = line.split(/\s+/);
    const ip = isIp(target) ? target : target.toLowerCase();
    if (!isTarget(ip) || hosts.length === 0) { skipped++; continue; }
    for (const h of hosts) {
      const host = h.toLowerCase().replace(/\.$/, "");
      if (!isHost(host) || rules.length >= maxRules) { skipped++; continue; }
      const r = { host, ip, enabled };
      if (note) r.note = note;
      if (cur) r.groupName = cur.name;
      rules.push(r);
    }
  }
  return { rules, groups, skipped };
}

// Geparste regels (met groepsnamen) samenvoegen met de toestand: bestaande groepen op naam, anders nieuw.
// fallbackGroup: groep voor regels zonder "# group:"-kop. Bestaande regels voor dezelfde host worden vervangen.
export function mergeParsed(state, parsed, fallbackGroup = DEFAULT_GROUP, rnd = Math.random) {
  const groups = state.groups.map((g) => ({ ...g }));
  const byName = (name) => groups.find((g) => !g.sub && (g.name || "").toLowerCase() === name.toLowerCase());
  for (const pg of parsed.groups) {
    const ex = byName(pg.name);
    if (ex) { if (pg.target) ex.target = pg.target; continue; }
    if (pg.name.toLowerCase() === "default" && groups.some((g) => g.id === DEFAULT_GROUP)) continue;
    groups.push(normGroup({ id: newGroupId(groups, rnd), name: pg.name, color: pg.color || GROUP_COLORS[groups.length % GROUP_COLORS.length], enabled: pg.enabled, target: pg.target }, groups.length));
  }
  const gidFor = (name) => {
    if (!name) return groups.some((g) => g.id === fallbackGroup && !g.sub) ? fallbackGroup : DEFAULT_GROUP;
    const g = byName(name);
    return g ? g.id : DEFAULT_GROUP;
  };
  const map = new Map(state.rules.map((r) => [r.host, r]));
  let added = 0, changed = 0;
  for (const r of parsed.rules) {
    const next = { host: r.host, ip: r.ip, enabled: r.enabled !== false, group: gidFor(r.groupName) };
    if (r.note) next.note = r.note;
    const old = map.get(r.host);
    if (!old) added++;
    else if (old.ip !== next.ip || old.group !== next.group || (old.note || "") !== (next.note || "") || old.enabled !== next.enabled) changed++;
    map.set(r.host, next);
  }
  return { state: { ...state, groups, rules: [...map.values()] }, added, changed };
}

// ---------- Registreerbaar domein (bij benadering) ----------
// Geen volledige Public Suffix List in het pakket: een korte lijst veelvoorkomende tweedelige achtervoegsels
// en hostingdomeinen. Goed genoeg om "www.x.nl", "cdn.x.nl" en "x.nl" bij elkaar te zetten.
const MULTI_SUFFIX = new Set(("co.uk org.uk ac.uk gov.uk me.uk ltd.uk plc.uk net.uk sch.uk com.au net.au org.au edu.au gov.au " +
  "co.nz org.nz net.nz co.za org.za com.br net.br com.ar com.mx co.jp ne.jp or.jp ac.jp co.kr or.kr com.cn net.cn org.cn " +
  "com.tr com.sg com.hk co.in net.in org.in co.id com.my com.ph com.tw co.il com.pl com.ua co.at or.at com.es com.pt " +
  "com.gr com.ru co.th com.vn com.sa com.eg com.ng co.ke com.co com.pe com.cy " +
  "github.io gitlab.io netlify.app vercel.app herokuapp.com pages.dev workers.dev azurewebsites.net cloudfront.net " +
  "blogspot.com myshopify.com wpengine.com appspot.com firebaseapp.com web.app onrender.com fly.dev").split(" "));
export function regDomain(host) {
  const h = String(host || "").toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  if (!h || isIp(h)) return h;
  const p = h.split(".");
  if (p.length <= 2) return h;
  const two = p.slice(-2).join(".");
  return MULTI_SUFFIX.has(two) ? p.slice(-3).join(".") : two;
}

// ---------- declarativeNetRequest: headers per groep ----------
const ALL_TYPES = ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping",
  "csp_report", "media", "websocket", "webtransport", "webbundle", "other"];
export const DNR_MAX = 500;
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function basicAuthValue(user, pass) {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "Basic " + btoa(bin);
}
export function groupHeaders(g) {
  const list = [];
  if (g.noCache) list.push({ header: "cache-control", operation: "set", value: "no-cache" }, { header: "pragma", operation: "set", value: "no-cache" });
  if (g.auth && g.auth.user) list.push({ header: "authorization", operation: "set", value: basicAuthValue(g.auth.user, g.auth.pass || "") });
  for (const h of g.headers || []) list.push({ header: h.name.toLowerCase(), operation: "set", value: h.value });
  return list;
}
export const groupHasHeaders = (g) => !!g && (g.noCache || !!(g.auth && g.auth.user) || (g.headers || []).length > 0);

// Eén DNR-regel per (groep, host), alleen voor actieve regels van groepen met headers.
// Exacte host: regexFilter op precies die host (requestDomains zou ook subdomeinen raken).
// Wildcard: requestDomains (domein + subdomeinen), met uitzondering van hosts die door een andere regel worden afgehandeld.
export function buildDnrRules(state) {
  const active = activeRules(state);
  const out = [];
  for (const r of active) {
    const g = groupOf(state, r.group);
    if (!groupHasHeaders(g) || matchRule(active, r.host.replace(/^\*\./, "")) !== r && !r.host.startsWith("*.")) continue;
    const requestHeaders = groupHeaders(g);
    const condition = { resourceTypes: ALL_TYPES };
    if (r.host.startsWith("*.")) {
      const base = r.host.slice(2);
      // Wordt het kale domein door een andere regel afgehandeld, dan alleen de subdomeinen.
      if (matchRule(active, base) === r) condition.requestDomains = [base];
      else condition.regexFilter = `^[a-z]+://([a-z0-9-]+\\.)+${reEscape(base)}(:[0-9]+)?(/|$)`;
      const ex = active.filter((o) => o !== r).map((o) => o.host.replace(/^\*\./, ""))
        .filter((h) => h !== base && h.endsWith("." + base) && matchRule(active, h) !== r);
      if (ex.length) condition.excludedRequestDomains = [...new Set(ex)];
    } else {
      condition.regexFilter = `^[a-z]+://${reEscape(r.host)}(:[0-9]+)?(/|$)`;
    }
    out.push({ id: out.length + 1, priority: 1, action: { type: "modifyHeaders", requestHeaders }, condition });
    if (out.length >= DNR_MAX) break;
  }
  return out;
}

// Origins waarvoor de extensie toegang nodig heeft om headers te zetten (per groep).
export function groupOrigins(state, groupId) {
  const rules = allRules(state).filter((r) => r.group === groupId);
  const hosts = rules.map((r) => r.host);
  if (state.wwwPair !== false) for (const r of rules) { const tw = wwwTwin(r.host); if (tw) hosts.push(tw); }
  return [...new Set(hosts.map((h) => `*://${h}/*`))];
}

// Weergavenaam van een groep. t = vertaalfunctie (model.js zelf kent geen taal).
export function groupName(g, state, t = (x) => x) {
  if (!g) return "";
  if (g.name) return g.name;
  if (g.id === DEFAULT_GROUP) return t("Mijn regels");
  if (g.sub) {
    const s = state?.subs?.find((x) => x.id === g.sub);
    try { return s ? new URL(s.url).hostname : t("Abonnement"); } catch { return t("Abonnement"); }
  }
  return g.id;
}

// ---------- Verbindingen van een pagina beoordelen ----------
// rec: { page, total, hosts: { host: { n, err, cache, ips, types } } } (bijgehouden door de achtergrond)
// active: actieve regels; hostsHits: { host: [{ip, kind}] } uit het hosts-bestand (optioneel).
// Per host: kind "rule" | "hosts" | "live". stillLive = live, maar hetzelfde registreerbare domein als een
// host met een regel (www vs kaal, cdn.x, api.x): die vergeet je makkelijk. suggest = regel om het IP van over te nemen.
export function analyzeConnections(rec, active, hostsHits = {}) {
  const rows = Object.entries(rec?.hosts || {}).map(([host, e]) => {
    const rule = matchRule(active, host);
    const hits = (Object.hasOwn(hostsHits, host) ? hostsHits[host] : []).filter((x) => x.kind !== "blocked");
    return {
      host, n: e.n || 0, err: e.err || 0, cache: e.cache || 0, ips: e.ips || [], types: e.types || {},
      kind: rule ? "rule" : hits.length ? "hosts" : "live", rule, hostsIp: hits[0]?.ip || null, reg: regDomain(host),
      stillLive: false, suggest: null,
    };
  });
  const regs = new Map();
  // Voorkeur voor de regel van de pagina zelf, daarna de host met de meeste verzoeken (opslag sorteert sleutels).
  const ruled = rows.filter((r) => r.kind === "rule").sort((a, b) => (b.host === rec?.page) - (a.host === rec?.page) || b.n - a.n);
  for (const r of ruled) if (!regs.has(r.reg)) regs.set(r.reg, r.rule);
  for (const r of active) { const reg = regDomain(r.host); if (!regs.has(reg)) regs.set(reg, r); }
  for (const r of rows) {
    if (r.kind === "live" && !isIp(r.host) && regs.has(r.reg)) { r.stillLive = true; r.suggest = regs.get(r.reg); }
  }
  rows.sort((a, b) => (b.stillLive - a.stillLive) || (a.kind === "rule") - (b.kind === "rule") || b.n - a.n || a.host.localeCompare(b.host));
  const types = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.types)) types[k] = (types[k] || 0) + v;
  return {
    rows, types, total: rows.reduce((a, r) => a + r.n, 0), hosts: rows.length,
    viaRule: rows.filter((r) => r.kind === "rule").length, viaHosts: rows.filter((r) => r.kind === "hosts").length,
    stillLive: rows.filter((r) => r.stillLive).length,
  };
}

// ---------- Sync tussen je eigen Chrome-installaties (chrome.storage.sync) ----------
// Wat meegaat: eigen regels, groepen (zonder Basic-auth-wachtwoord), abonnementen (alleen URL en interval,
// niet de opgehaalde regels) en instellingen. Nooit het helper-geheim. Quota: ~100 KB totaal, 8 KB per item:
// de JSON gaat als base64 in stukken van 7000 tekens ("ho:c0", "ho:c1", ...) met "ho:meta" erbij.
export const SYNC_SETTINGS = ["indicator", "pageBadge", "autoReload", "lang", "exclusiveGroups", "dohProvider", "sideDefault", "wwwPair"];
export const SYNC_CHUNK = 7000;
export const SYNC_MAX = 90 * 1024; // marge onder de 102400 bytes van chrome.storage.sync
export function syncPayload(raw) {
  const s = normState(raw);
  const settings = {};
  for (const k of SYNC_SETTINGS) if (raw[k] !== undefined) settings[k] = raw[k];
  return {
    rules: s.rules,
    groups: s.groups.map((g) => ({ ...g, auth: g.auth ? { user: g.auth.user, pass: "" } : null })),
    subs: s.subs.map(({ id, url, interval }) => ({ id, url, interval })),
    settings,
  };
}
const b64 = (str) => { const bytes = new TextEncoder().encode(str); let bin = ""; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
export function hashStr(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); }
export function encodeSync(payload, { ts = Date.now(), dev = "" } = {}) {
  const data = b64(JSON.stringify(payload));
  const items = {};
  const n = Math.ceil(data.length / SYNC_CHUNK) || 1;
  for (let i = 0; i < n; i++) items[`ho:c${i}`] = data.slice(i * SYNC_CHUNK, (i + 1) * SYNC_CHUNK);
  const meta = { v: 1, ts, dev, n, hash: hashStr(data), bytes: data.length + n * 8 };
  return { meta, items, data };
}
// Geeft de payload terug, of null als de stukken (nog) niet compleet of niet consistent zijn.
export function decodeSync(all) {
  const meta = all?.["ho:meta"];
  if (!meta || meta.v !== 1 || !Number.isInteger(meta.n) || meta.n < 1 || meta.n > 20) return null;
  let data = "";
  for (let i = 0; i < meta.n; i++) { const c = all[`ho:c${i}`]; if (typeof c !== "string") return null; data += c; }
  if (hashStr(data) !== meta.hash) return null;
  try {
    const p = JSON.parse(unb64(data));
    return p && typeof p === "object" ? p : null;
  } catch { return null; }
}
// Gegevens uit sync toepassen op de lokale opslag. Lokaal blijven: wachtwoorden (zelfde groep en gebruiker),
// opgehaalde abonnementsregels (zelfde URL), de hoofdschakelaar en het helper-geheim.
// mode "replace": sync wint. mode "merge" (eerste keer aanzetten): samenvoegen, lokaal wint bij dezelfde host.
export function applySync(localRaw, payload, mode = "replace") {
  const local = normState(localRaw);
  const remote = normState({ rules: payload.rules, groups: payload.groups, subs: payload.subs });
  const keepPass = (g) => {
    const l = local.groups.find((x) => x.id === g.id);
    return l?.auth && g.auth && l.auth.user === g.auth.user ? { ...g, auth: { ...g.auth, pass: l.auth.pass } } : g;
  };
  let groups = remote.groups.map(keepPass);
  let rules = remote.rules;
  let subs = remote.subs.map((s) => { const l = local.subs.find((x) => x.url === s.url); return l ? { ...l, id: s.id, interval: s.interval } : s; });
  if (mode === "merge") {
    for (const g of local.groups) if (!groups.some((x) => x.id === g.id)) groups.push(g);
    const byHost = new Map(rules.map((r) => [r.host, r]));
    for (const r of local.rules) byHost.set(r.host, r);
    rules = [...byHost.values()];
    for (const s of local.subs) if (!subs.some((x) => x.url === s.url)) subs.push(s);
  }
  const out = { rules, groups, subs };
  const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
  for (const k of SYNC_SETTINGS) if (settings[k] !== undefined && (mode === "replace" || localRaw[k] === undefined)) out[k] = settings[k];
  const n = normState({ ...out, enabled: localRaw.enabled });
  return { ...out, rules: n.rules, groups: n.groups, subs: n.subs };
}

// ---------- Back-up (JSON) ----------
export const BACKUP_KIND = "host-override-backup";
export const BACKUP_SETTINGS = [...SYNC_SETTINGS, "recentDomains", "collapsed", "syncOn"];
export function buildBackup(raw, { includeSecrets = false, version = "" } = {}) {
  const s = normState(raw);
  const settings = {};
  for (const k of BACKUP_SETTINGS) if (raw[k] !== undefined) settings[k] = raw[k];
  const out = {
    kind: BACKUP_KIND, v: 1, version, exported: new Date().toISOString(),
    data: {
      enabled: s.enabled,
      rules: s.rules,
      groups: includeSecrets ? s.groups : s.groups.map((g) => ({ ...g, auth: g.auth ? { user: g.auth.user, pass: "" } : null })),
      subs: s.subs.map(({ id, url, interval }) => ({ id, url, interval })),
      settings,
    },
  };
  if (includeSecrets && /^[0-9a-f]{64}$/.test(raw.helperSecret || "")) out.secret = raw.helperSecret;
  return out;
}
// Controleert een back-up en maakt een voorbeeld van de wijzigingen. Gooit een fout met een code bij ongeldige invoer.
export function readBackup(text) {
  if (typeof text !== "string" || text.length > 5 * 1024 * 1024) throw new Error("too-big");
  let j;
  try { j = JSON.parse(text); } catch { throw new Error("not-json"); }
  if (!j || j.kind !== BACKUP_KIND || j.v !== 1 || !j.data || typeof j.data !== "object") throw new Error("not-backup");
  const d = j.data;
  const st = normState({ rules: d.rules, groups: d.groups, subs: d.subs, enabled: d.enabled });
  const settings = {};
  const src = d.settings && typeof d.settings === "object" ? d.settings : {};
  for (const k of BACKUP_SETTINGS) if (src[k] !== undefined) settings[k] = src[k];
  return { state: st, settings, secret: /^[0-9a-f]{64}$/.test(j.secret || "") ? j.secret : null, exported: typeof j.exported === "string" ? j.exported.slice(0, 40) : "" };
}
export function backupPreview(localRaw, b) {
  const local = normState(localRaw);
  const lm = new Map(local.rules.map((r) => [r.host, r]));
  let added = 0, changed = 0, same = 0;
  for (const r of b.state.rules) {
    const o = lm.get(r.host);
    if (!o) added++;
    else if (o.ip !== r.ip || o.group !== r.group || (o.note || "") !== (r.note || "") || o.enabled !== r.enabled) changed++;
    else same++;
  }
  return {
    rules: b.state.rules.length, added, changed, same, removed: local.rules.filter((r) => !b.state.rules.some((x) => x.host === r.host)).length,
    groups: b.state.groups.length, newGroups: b.state.groups.filter((g) => !local.groups.some((x) => x.id === g.id)).length,
    subs: b.state.subs.length, settings: Object.keys(b.settings).length, secret: !!b.secret,
  };
}
// mode "merge": back-up toevoegen (zelfde host: back-up wint, eigen extra regels blijven); "replace": alles vervangen.
export function applyBackup(localRaw, b, mode = "merge") {
  const local = normState(localRaw);
  if (mode === "replace") return { enabled: b.state.enabled, rules: b.state.rules, groups: b.state.groups, subs: b.state.subs, ...b.settings };
  const groups = [...local.groups];
  for (const g of b.state.groups) { const i = groups.findIndex((x) => x.id === g.id); if (i >= 0) groups[i] = { ...g, auth: g.auth?.pass ? g.auth : groups[i].auth || g.auth }; else groups.push(g); }
  const byHost = new Map(local.rules.map((r) => [r.host, r]));
  for (const r of b.state.rules) byHost.set(r.host, r);
  const subs = [...local.subs];
  for (const s of b.state.subs) if (!subs.some((x) => x.url === s.url)) subs.push(s);
  const n = normState({ rules: [...byHost.values()], groups, subs });
  return { rules: n.rules, groups: n.groups, subs: n.subs, ...b.settings };
}

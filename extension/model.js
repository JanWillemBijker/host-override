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

// Doel als hostnaam (bijvoorbeeld server123.hostingpartij.nl): geen wildcard, max 253 tekens, en het laatste
// label bevat een letter (zodat "999.1.1.1" of "10.0.0" nooit als hostnaam doorgaat).
export function isTargetHost(v) {
  if (typeof v !== "string" || v.length > 253 || v.startsWith("*.") || !HOST_RE.test(v)) return false;
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
  return { enabled: raw.enabled === true, rules, groups: live, subs, exclusiveGroups: raw.exclusiveGroups === true };
}

export const groupOf = (state, id) => state.groups.find((g) => g.id === id) || state.groups.find((g) => g.id === DEFAULT_GROUP) || null;

// Alle regels (eigen + abonnementen), met groep. Eigen regels gaan voor: bij dezelfde host wint de eerste.
export function allRules(stateRaw) {
  const s = stateRaw && stateRaw.groups ? stateRaw : normState(stateRaw);
  const out = s.rules.map((r) => ({ ...r }));
  for (const sub of s.subs) {
    const gid = subGroupId(sub.id);
    for (const r of sub.rules) out.push({ ...r, group: gid, sub: sub.id, readOnly: true });
  }
  return out;
}

// Alleen geldige regels doorlaten (bescherming tegen beschadigde of handmatig aangepaste opslag).
export const validRules = (rules) =>
  (Array.isArray(rules) ? rules : []).filter((r) => r && isHost(r.host) && isTarget(r.ip));

// Actief = hoofdschakelaar aan, groep aan, regel aan. Werkt ook met een oude toestand zonder groepen.
export function activeRules(stateRaw) {
  const s = stateRaw && stateRaw.groups && stateRaw.subs ? stateRaw : normState(stateRaw);
  if (!s.enabled) return [];
  const on = new Set(s.groups.filter((g) => g.enabled).map((g) => g.id));
  return validRules(allRules(s)).filter((r) => r.enabled !== false && on.has(r.group));
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
// server123.hostingpartij.nl shop.voorbeeld.nl   (doel als hostnaam)
export function formatHosts(rules, groups) {
  const lines = [];
  const line = (r) => `${r.enabled === false ? "#off " : ""}${r.ip} ${r.host}${r.note ? "  # " + cleanText(r.note, NOTE_MAX) : ""}`;
  if (!Array.isArray(groups)) return rules.map(line).join("\n");
  for (const g of groups) {
    const list = rules.filter((r) => (r.group || DEFAULT_GROUP) === g.id);
    if (!list.length) continue;
    if (lines.length) lines.push("");
    lines.push(`# group: ${g.name || (g.id === DEFAULT_GROUP ? "Default" : g.id)} ${g.color}${g.enabled === false ? " off" : ""}`);
    lines.push(...list.map(line));
  }
  return lines.join("\n");
}

export function parseGroupHeader(line) {
  const m = line.match(/^#\s*group\s*:\s*(.*)$/i);
  if (!m) return null;
  let rest = m[1].trim(), enabled = true, color = null;
  if (/\s+off$/i.test(rest)) { enabled = false; rest = rest.replace(/\s+off$/i, ""); }
  const c = rest.match(/(?:^|\s)(#[0-9a-f]{6})$/i);
  if (c) { color = c[1].toLowerCase(); rest = rest.slice(0, c.index).trim(); }
  const name = cleanText(rest, NAME_MAX);
  return name ? { name, color, enabled } : null;
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
    if (byName(pg.name) || (pg.name.toLowerCase() === "default" && groups.some((g) => g.id === DEFAULT_GROUP))) continue;
    groups.push(normGroup({ id: newGroupId(groups, rnd), name: pg.name, color: pg.color || GROUP_COLORS[groups.length % GROUP_COLORS.length], enabled: pg.enabled }, groups.length));
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
  return [...new Set(allRules(state).filter((r) => r.group === groupId).map((r) => `*://${r.host}/*`))];
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

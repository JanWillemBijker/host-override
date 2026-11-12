import { isHost, isIp, isTarget, isTargetHost, matchRule, activeRules, loadState, helperStatus, helperFetch, EXPECTED_HELPER } from "./common.js";
import { t } from "./i18n.js";

const RESOLVERS = [
  ["system", "Systeem (jouw computer)"], ["1.1.1.1", "Cloudflare 1.1.1.1"], ["8.8.8.8", "Google 8.8.8.8"],
  ["9.9.9.9", "Quad9 9.9.9.9"], ["208.67.222.222", "OpenDNS 208.67.222.222"],
];
const REC_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "CAA"];

const IDS = { summary: "dSummary", cRecords: "dRecords", cHosts: "dHosts", cNs: "dNs", cProp: "dProp", cSrv: "dSrv", cMail: "dMail",
  copyReport: "dCopy", domain: "dDomain", err: "dErr", banner: "dBanner", f: "dForm", resolver: "dResolver" };
const PANES = ["summary", "cRecords", "cHosts", "cNs", "cProp", "cSrv", "cMail"];
const SEC = { cRecords: "dRecords", cHosts: "dHosts", cNs: "dNs", cProp: "dProp", cSrv: "dSrv", cMail: "dMail" };
const $ = (id) => document.getElementById(IDS[id] || id);

// Veilige DOM-bouwer: DNS-data (bijvoorbeeld TXT-records) komt nooit als HTML in de pagina.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) (k === "class" ? (el.className = v) : el.setAttribute(k, v));
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
const badge = (level, text) => h("span", { class: "b " + level }, text);
const mono = (x) => h("span", { class: "mono" }, x);
const table = (head, rows) =>
  h("div", { class: "tablewrap" }, h("table", {}, h("thead", {}, h("tr", {}, head.map((x) => h("th", {}, x)))), h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, c)))))));
// Compacte rij: bovenaan titel + badges, daaronder details.
const rc = (top, ...details) => h("div", { class: "rc" }, h("div", { class: "t" }, top), details.filter(Boolean).map((x) => h("div", { class: "d" }, x)));

function ttl(s) {
  if (s == null) return "";
  if (s >= 86400) return `${Math.round(s / 86400)}d`;
  if (s >= 3600) return `${Math.round(s / 3600)}${t("u")}`;
  if (s >= 60) return `${Math.round(s / 60)}m`;
  return `${s}s`;
}

async function api(path, body) {
  let r;
  try { r = await helperFetch(path, { body }); } catch (e) { throw new Error(helperError(e.message)); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(helperError(j.error || `status ${r.status}`));
  return j;
}
function helperError(code) {
  const m = { "helper-missing": t("De helper draait niet."), "helper-outdated": t("De helper moet worden bijgewerkt."),
    "helper-setup": t("Helper moet opnieuw worden ingesteld"), setup: t("Helper moet opnieuw worden ingesteld") };
  return m[code] || code;
}
const dnsq = (name, type, server = "system", rd = true) => api("/__dns", { name, type, server, rd });
const attempt = async (p) => { try { return { ok: true, v: await p }; } catch (e) { return { ok: false, e: e.message }; } };

// ---------- Samenvatting ----------
let findings = [];
let generation = 0; // een nieuwe controle maakt oudere, nog lopende controles stil
const ICON = { bad: "✖", warn: "⚠", ok: "✔", info: "ℹ" };
function addF(level, text, sec) { findings.push({ level, text, sec }); renderSummary(); }
function renderSummary() {
  const order = { bad: 0, warn: 1, ok: 2, info: 3 };
  const sorted = [...findings].sort((a, b) => order[a.level] - order[b.level]);
  const n = (l) => findings.filter((f) => f.level === l).length;
  setBody("summary", h("ul", { class: "find" }, sorted.map((f) => h("li", { class: f.level }, h("span", { class: "i" }, ICON[f.level]), h("span", {}, f.text)))));
  setSub("summary", [n("bad") ? `✖ ${n("bad")}` : "", n("warn") ? `⚠ ${n("warn")}` : "", `✔ ${n("ok")}`].filter(Boolean).join("  "));
  paintDots();
}
function paintDots() {
  const worst = (sec) => {
    const l = findings.filter((f) => f.sec === sec).map((f) => f.level);
    return l.includes("bad") ? "bad" : l.includes("warn") ? "warn" : l.length ? "ok" : "";
  };
  for (const id of ["cRecords", "cHosts", "cNs", "cProp", "cSrv", "cMail"]) $(id).querySelector(".sdot").className = "sdot " + worst(SEC[id]);
  const all = findings.some((f) => f.level === "bad") ? "bad" : findings.some((f) => f.level === "warn") ? "warn" : findings.length ? "ok" : "";
  $("summary").querySelector(".sdot").className = "sdot " + all;
}

function setBody(id, ...nodes) {
  const b = $(id).querySelector(".body");
  b.textContent = "";
  b.append(...nodes.flat().filter(Boolean));
}
function setSub(id, text) { $(id).querySelector(".ssub").textContent = text || ""; }
const loading = (id) => { setBody(id, h("p", { class: "muted" }, t("Laden..."))); setSub(id, ""); };

const setKey = (list) => [...new Set(list)].sort().join(",");

// ---------- Hoofdroutine ----------
async function run(name, resolver) {
  const gen = ++generation;
  const live = () => gen === generation;
  const setBodyG = (...a) => live() && setBody(...a);
  const setSubG = (...a) => live() && setSub(...a);
  findings = [];
  for (const id of PANES) loading(id);
  paintDots();
  const state = await loadState();
  const testIp = $("dTestIp").value.trim();
  // Regels van groepen die aan staan (ook als de hoofdschakelaar uit staat: dan vergelijk je live met wat je zou testen).
  const ruleHit = matchRule(activeRules({ ...state, enabled: true }), name);
  let override = ruleHit || (isTarget(testIp) ? { ip: testIp } : null);
  // Doel is een hostnaam: eerst het IP opzoeken (zoals de helper dat voor de proxy doet).
  if (override && isTargetHost(override.ip)) {
    const r = await attempt(api("/__resolve", { names: [override.ip] }));
    const ip = r.ok ? r.v.results?.[override.ip]?.ips?.find(isIp) : null;
    override = ip ? { ...override, name: override.ip, ip } : null;
  }
  const sec = (s) => (l, x) => live() && addF(l, x, s);

  // 1. Records
  const recordsP = (async () => {
    const add = sec("dRecords");
    const results = await Promise.all(REC_TYPES.map((x) => attempt(dnsq(name, x, resolver))));
    const seen = new Set(), rows = [];
    let nx = false, failed = 0;
    results.forEach((r) => {
      if (!r.ok) { failed++; return; }
      if (r.v.rcode === "NXDOMAIN") nx = true;
      for (const a of r.v.answers) {
        const key = `${a.name}|${a.type}|${a.data}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ ...a });
      }
    });
    rows.sort((a, b) => REC_TYPES.indexOf(a.type) - REC_TYPES.indexOf(b.type));
    const kinds = new Set(rows.map((r) => r.type));
    if (failed === REC_TYPES.length) add("bad", t("Geen antwoord van de gekozen resolver."));
    else if (nx) add("bad", t("{name} bestaat niet (NXDOMAIN).", { name }));
    else if (!kinds.has("A") && !kinds.has("AAAA") && !kinds.has("CNAME")) add("warn", t("Geen A-, AAAA- of CNAME-record gevonden."));
    else add("ok", t("Records gevonden ({kinds}).", { kinds: [...kinds].filter((k) => ["A", "AAAA", "CNAME"].includes(k)).join(", ") }));
    const addr = rows.filter((r) => r.type === "A" || r.type === "AAAA").map((r) => r.data);
    const cname = rows.find((r) => r.type === "CNAME");
    setSubG("cRecords", nx ? "NXDOMAIN" : addr.length ? addr.slice(0, 2).join(", ") + (addr.length > 2 ? " …" : "") : cname ? `CNAME ${cname.data}` : "-");
    setBodyG("cRecords", rows.length
      ? rows.map((r) => rc([badge("", r.type), mono(r.data)], `${r.name !== name && r.name !== name + "." ? r.name + " · " : ""}TTL ${ttl(r.ttl) || "-"}`))
      : h("p", { class: "muted" }, nx ? t("NXDOMAIN: deze naam bestaat niet.") : t("Geen records gevonden.")));
    return rows;
  })();

  // 1b. Hosts-bestand (lokaal gelezen door de helper; alleen lezen)
  const hostsP = (async () => {
    const add = sec("dHosts");
    const r = await attempt(api("/__hosts", { names: [name] }));
    if (!r.ok) {
      setBodyG("cHosts", h("p", { class: "muted" }, t("Kon het hosts-bestand niet lezen: {e}", { e: r.e === "status 400" ? t("De helper moet worden bijgewerkt.") : r.e })));
      setSubG("cHosts", "-");
      return [];
    }
    const d = r.v, list = d.matches?.[name] || [];
    const notes = [];
    if (!d.exists) notes.push(h("p", { class: "muted" }, t("Geen hosts-bestand gevonden ({path}).", { path: d.path })));
    if (d.truncated) notes.push(h("p", { class: "muted" }, t("Bestand groter dan {mb} MB: alleen het begin is gelezen.", { mb: Math.round(d.max / 1048576) })));
    const usable = list.filter((e) => e.kind !== "blocked");
    if (usable.length) {
      add(ruleHit ? "info" : "warn", t("{name} staat in je hosts-bestand ({ips}): deze computer gebruikt niet het live IP, ook niet in incognito.", { name, ips: usable.map((e) => e.ip).join(", ") }));
      if (ruleHit) add("info", t("In dit Chrome-profiel gaat de Host Override-regel ({ip}) voor op het hosts-bestand.", { ip: ruleHit.ip }));
    } else if (list.length) add("warn", t("{name} wordt geblokkeerd in je hosts-bestand ({ips}).", { name, ips: list.map((e) => e.ip).join(", ") }));
    else if (d.exists) add("ok", t("{name} staat niet in je hosts-bestand.", { name }));
    setSubG("cHosts", list.length ? list.map((e) => e.ip).join(", ") : t("geen regels"));
    setBodyG("cHosts",
      list.length
        ? list.map((e) => rc([badge(e.kind === "blocked" ? "warn" : "hosts", e.kind === "blocked" ? t("blokkade") : e.kind === "loopback" ? t("lokaal") : t("override")), mono(e.ip)], `${d.path} · ${t("regel")} ${e.line}`))
        : h("p", { class: "muted" }, t("Geen regels voor {name} in {path}.", { name, path: d.path })),
      notes,
      h("p", { class: "small" }, t("Alleen gelezen, nooit aangepast. Bewerken kan alleen met beheerdersrechten.")));
    return usable;
  })();

  // 2. Delegatie en nameservers
  const traceP = attempt(api("/__trace", { name }));
  const nsP = (async () => {
    const add = sec("dNs");
    const tr = await traceP;
    if (!tr.ok) { setBodyG("cNs", h("p", {}, t("Trace mislukt: {e}", { e: tr.e }))); add("bad", t("Delegatie-trace mislukt: {e}", { e: tr.e })); return { zone: null }; }
    const { zone, parent, delegationNs, childNs, steps } = tr.v;
    if (steps.some((x) => x.rcode === "NXDOMAIN")) {
      setBodyG("cNs", h("p", { class: "muted" }, t("Niet van toepassing: de naam bestaat niet.")));
      setSubG("cNs", "-");
      return { zone: null, nx: true };
    }
    if (!zone || zone === ".") {
      setBodyG("cNs", h("p", { class: "muted" }, t("Geen zone gevonden voor deze naam.")));
      add("warn", t("Geen delegatie gevonden voor deze naam."));
      return { zone: null };
    }
    const names = [...new Set([...delegationNs, ...childNs])].sort();
    const missingChild = delegationNs.filter((n) => !childNs.includes(n));
    const missingParent = childNs.filter((n) => !delegationNs.includes(n));
    if (childNs.length && (missingChild.length || missingParent.length)) {
      add("warn", t("Delegatie wijkt af: registry ({parent}) en zone noemen niet dezelfde nameservers.", { parent }) +
        (missingChild.length ? " " + t("Alleen bij registry: {list}.", { list: missingChild.join(", ") }) : "") +
        (missingParent.length ? " " + t("Alleen in zone: {list}.", { list: missingParent.join(", ") }) : ""));
    } else if (childNs.length) add("ok", t("Delegatie klopt: registry en zone noemen dezelfde {n} nameservers.", { n: names.length }));
    if (names.length < 2) add("warn", t("Minder dan 2 nameservers (geen redundantie)."));

    const perNs = await Promise.all(names.map(async (ns) => {
      const a = await attempt(dnsq(ns, "A", resolver));
      const ips = a.ok ? a.v.answers.filter((x) => x.type === "A").map((x) => x.data) : [];
      if (!ips.length) return [{ ns, ip: null }];
      return Promise.all(ips.map(async (ip) => {
        const [soa, rec] = await Promise.all([attempt(dnsq(zone, "SOA", ip, false)), attempt(dnsq(name, "A", ip, false))]);
        return { ns, ip, soa, rec };
      }));
    }));
    const rows = perNs.flat();
    const serials = new Set();
    const authAnswers = [];
    const cards = rows.map((r) => {
      if (!r.ip) { add("bad", t("{ns}: geen IP-adres gevonden.", { ns: r.ns })); return rc([mono(r.ns), badge("bad", t("geen IP"))]); }
      if (!r.soa.ok) { add("bad", t("{ns} ({ip}) antwoordt niet: {e}.", { ns: r.ns, ip: r.ip, e: r.soa.e })); return rc([mono(r.ns), badge("bad", t("geen antwoord"))], `${r.ip} · ${r.soa.e}`); }
      const m = r.soa.v, soa = m.answers.find((x) => x.type === "SOA");
      if (soa) serials.add(soa.serial);
      const aRec = r.rec.ok ? r.rec.v.answers.filter((x) => x.type === "A").map((x) => x.data) : [];
      if (r.rec.ok && m.flags.aa) authAnswers.push(aRec);
      if (!m.flags.aa) add("warn", t("{ns} ({ip}) is niet authoritative voor {zone} ({rcode}).", { ns: r.ns, ip: r.ip, zone, rcode: m.rcode }));
      return rc([mono(r.ns), badge(m.rcode === "NOERROR" ? "ok" : "bad", m.rcode), m.flags.aa ? badge("ok", t("authoritative")) : badge("warn", t("niet authoritative"))],
        `${r.ip} · ${t("SOA-serial")} ${soa ? soa.serial : "-"} · ${m.ms} ms`, `A ${name}: ${aRec.join(", ") || "-"}`);
    });
    if (serials.size > 1) add("warn", t("SOA-serial verschilt tussen nameservers ({list}): zone is niet overal gelijk.", { list: [...serials].join(", ") }));
    else if (serials.size === 1) add("ok", t("Alle nameservers die antwoorden hebben dezelfde SOA-serial ({serial}).", { serial: [...serials][0] }));
    const answered = rows.filter((r) => r.soa?.ok && r.soa.v.flags.aa).length;
    if (answered) add("ok", t("{a} van {b} nameserver-adressen antwoorden als authoritative.", { a: answered, b: rows.length }));
    const aSets = new Set(authAnswers.map((a) => setKey(a)));
    if (aSets.size > 1) add("warn", t("Nameservers geven verschillende A-records voor {name}.", { name }));
    setSubG("cNs", t("{n} nameservers", { n: names.length }));

    setBodyG("cNs",
      h("p", { class: "small" }, t("Zone"), ": ", mono(zone), " · ", t("registry-nameservers"), " (", mono(parent || "."), "): ", mono(delegationNs.join(", ") || "-")),
      cards,
      h("details", {}, h("summary", {}, t("Trace vanaf de root")), h("ol", {}, steps.map((s) =>
        h("li", {}, s.error ? s.error : `${s.server} (${s.ip}) → ${s.final ? t("antwoord") : t("verwijst naar") + " " + s.zone}: ${(s.ns || []).join(", ")}${s.note ? " (" + s.note + ")" : ""}`)))));
    return { zone, authA: authAnswers[0] || null };
  })();

  // 3. Resolvers vergelijken
  const propP = (async () => {
    const add = sec("dProp");
    const [{ authA, nx }] = await Promise.all([nsP, recordsP]);
    if (nx) { setBodyG("cProp", h("p", { class: "muted" }, t("Niet van toepassing: de naam bestaat niet."))); setSubG("cProp", "-"); return; }
    const results = await Promise.all(RESOLVERS.map(async ([ip, label]) => [ip === "system" ? t(label) : label, await attempt(dnsq(name, "A", ip))]));
    const sets = results.map(([, r]) => (r.ok ? r.v.answers.filter((x) => x.type === "A").map((x) => x.data) : null));
    const reference = authA && authA.length ? authA : sets.find((s) => s && s.length) || [];
    let differs = 0, failed = 0;
    const out = results.map(([label, r], i) => {
      if (!r.ok) { failed++; return rc([label, badge("bad", t("geen antwoord"))]); }
      const a = r.v.answers.filter((x) => x.type === "A");
      const same = setKey(sets[i]) === setKey(reference);
      if (!same) differs++;
      return rc([label, same ? badge("ok", authA ? t("zelfde als nameserver") : t("gelijk")) : badge("warn", t("wijkt af"))],
        mono(sets[i].join(", ") || t("(geen A-record)")), `TTL ${ttl(a.length ? Math.min(...a.map((x) => x.ttl)) : null) || "-"} · ${r.v.ms} ms`);
    });
    if (failed) add("warn", t("{n} resolver(s) gaven geen antwoord.", { n: failed }));
    if (differs) add("warn", t("{n} resolver(s) geven een ander A-record dan {ref}: wijziging nog niet overal doorgevoerd (let op TTL), of geo/CDN-DNS.", { n: differs, ref: authA ? t("de nameservers") : t("de rest") }));
    else if (!failed) add("ok", t("Alle resolvers geven hetzelfde A-record."));
    setSubG("cProp", differs ? t("{n} wijkt af", { n: differs }) : failed ? t("{n} geen antwoord", { n: failed }) : t("alle gelijk"));
    setBodyG("cProp", out);
  })();

  // 4. E-mail (op zone-niveau)
  const mailP = (async () => {
    const add = sec("dMail");
    const { zone, nx } = await nsP;
    if (nx) { setBodyG("cMail", h("p", { class: "muted" }, t("Niet van toepassing: de naam bestaat niet."))); setSubG("cMail", "-"); return; }
    const z = zone || name;
    const [mx, txt, dmarc] = await Promise.all([attempt(dnsq(z, "MX", resolver)), attempt(dnsq(z, "TXT", resolver)), attempt(dnsq("_dmarc." + z, "TXT", resolver))]);
    const mxs = mx.ok ? mx.v.answers.filter((x) => x.type === "MX").sort((a, b) => a.pref - b.pref) : [];
    const spf = txt.ok ? txt.v.answers.filter((x) => x.type === "TXT" && /^v=spf1/i.test(x.data)) : [];
    const dm = dmarc.ok ? dmarc.v.answers.filter((x) => x.type === "TXT" && /^v=DMARC1/i.test(x.data)) : [];
    if (mxs.length) {
      if (spf.length === 0) add("warn", t("E-mail: MX aanwezig maar geen SPF-record op {z}.", { z }));
      else if (spf.length > 1) add("warn", t("E-mail: meerdere SPF-records op {z} (alleen één is toegestaan).", { z }));
      else add("ok", t("E-mail: SPF-record aanwezig."));
      if (!dm.length) add("warn", t("E-mail: geen DMARC-record (_dmarc.{z}).", { z }));
      else add("ok", t("E-mail: DMARC-record aanwezig."));
    } else add("info", t("E-mail: geen MX-records op {z} (domein ontvangt geen mail).", { z }));
    setSubG("cMail", mxs.length ? `${mxs.length} MX` : t("geen MX"));
    setBodyG("cMail",
      mxs.length ? table([t("Prioriteit"), t("Mailserver"), "TTL"], mxs.map((x) => [String(x.pref), mono(x.host), ttl(x.ttl)])) : h("p", { class: "muted" }, t("Geen MX-records.")),
      table([t("Check"), t("Waarde")], [
        ["SPF", spf.length ? mono(spf.map((x) => x.data).join("  |  ")) : badge(mxs.length ? "warn" : "", t("ontbreekt"))],
        ["DMARC", dm.length ? mono(dm.map((x) => x.data).join("  |  ")) : badge(mxs.length ? "warn" : "", t("ontbreekt"))],
      ]));
  })();

  // 5. Servers: live en test (HTTP, HTTPS, certificaat, reverse DNS)
  const srvP = (async () => {
    const add = sec("dSrv");
    const { authA } = await nsP;
    const rows = await recordsP;
    const hostsHits = await hostsP;
    const dnsIps = authA && authA.length ? authA : rows.filter((r) => r.type === "A").map((r) => r.data);
    const targets = [...new Set(dnsIps)].map((ip) => ({ ip, kind: "live" }));
    if (override && !targets.some((x) => x.ip === override.ip)) targets.push({ ip: override.ip, kind: "test" });
    else if (override) targets.find((x) => x.ip === override.ip).kind = "both";
    for (const e of hostsHits) if (!targets.some((x) => x.ip === e.ip)) targets.push({ ip: e.ip, kind: "hosts" });
    if (!targets.length) { setBodyG("cSrv", h("p", { class: "muted" }, t("Geen IP-adressen om te controleren."))); setSubG("cSrv", "-"); return; }

    const results = await Promise.all(targets.map(async (tg) => {
      const rev = tg.ip.split(".").reverse().join(".") + ".in-addr.arpa";
      const [ptr, chk] = await Promise.all([attempt(dnsq(rev, "PTR", resolver)), attempt(api("/__check", { host: name, ip: tg.ip }))]);
      return { ...tg, ptr: ptr.ok ? ptr.v.answers.filter((x) => x.type === "PTR").map((x) => x.data) : [], chk };
    }));
    const cards = [];
    for (const r of results) {
      const tag = r.kind === "hosts" ? badge("hosts", t("Hosts-bestand")) : r.kind === "test" ? badge("test", t("Test (override)")) : r.kind === "both" ? badge("test", t("Live en test (zelfde IP)")) : badge("live", t("Live (DNS)"));
      const label = `${r.kind === "hosts" ? t("Hosts-bestand") : r.kind === "test" ? t("Test") : r.kind === "both" ? t("Live/test") : t("Live")} ${r.ip}`;
      if (!r.chk.ok) { cards.push(rc([tag, mono(r.ip), badge("bad", t("mislukt"))], r.chk.e)); add("bad", t("{label}: controle mislukt ({e}).", { label, e: r.chk.e })); continue; }
      const { http, https } = r.chk.v;
      const httpTxt = http.ok ? `${http.status}${http.location ? " → " + http.location : ""}` : badge("bad", http.error);
      const httpsTxt = https.ok ? [`${https.status}${https.location ? " → " + https.location : ""}`, https.server ? ` · ${https.server}` : "", ` · ${https.ms} ms`].join("") : badge("bad", https.error);
      const c = https.tls;
      let certNode = "";
      if (c) {
        const level = !c.hostMatch || !c.authorized ? "bad" : c.daysLeft < 14 ? "warn" : "ok";
        certNode = h("span", {}, badge(level, !c.hostMatch ? t("ongeldig voor domein") : !c.authorized ? t("niet vertrouwd") : t("geldig")), ` ${t("tot")} ${c.to.slice(0, 10)} (${c.daysLeft} d) · ${c.issuer || "?"} · ${c.protocol || ""}`);
        if (!c.hostMatch) add("bad", t("{label}: certificaat is niet geldig voor {name} (SAN: {san}).", { label, name, san: c.san.slice(0, 4).join(", ") }));
        else if (!c.authorized) add("bad", t("{label}: certificaat niet vertrouwd ({e}).", { label, e: c.authError }));
        else if (c.daysLeft < 14) add("warn", t("{label}: certificaat verloopt over {n} dagen.", { label, n: c.daysLeft }));
        else add("ok", t("{label}: certificaat geldig tot {date}.", { label, date: c.to.slice(0, 10) }));
      }
      if (http.ok && http.status >= 500) add("bad", t("{label}: HTTP geeft {s}.", { label, s: http.status }));
      if (https.ok && https.status >= 500) add("bad", t("{label}: HTTPS geeft {s}.", { label, s: https.status }));
      if (!https.ok) add("warn", t("{label}: HTTPS niet bereikbaar ({e}).", { label, e: https.error }));
      cards.push(rc([tag, mono(r.ip)], h("span", {}, "Reverse DNS: ", r.ptr.join(", ") || "-"), h("span", {}, "HTTP: ", httpTxt), h("span", {}, "HTTPS: ", httpsTxt), certNode ? h("span", {}, t("Certificaat"), ": ", certNode) : null));
    }
    const liveR = results.find((r) => r.kind === "live" && r.chk.ok), testR = results.find((r) => r.kind === "test" && r.chk.ok);
    if (override && !testR && results.some((r) => r.kind === "both")) add("info", t("Het override-IP is gelijk aan het live IP: je ziet dezelfde server."));
    if (liveR && testR && liveR.chk.v.https.ok && testR.chk.v.https.ok && liveR.chk.v.https.status !== testR.chk.v.https.status) {
      add("info", t("HTTPS-status verschilt: live {a}, test {b}.", { a: liveR.chk.v.https.status, b: testR.chk.v.https.status }));
    }
    setSubG("cSrv", results.map((r) => r.ip).join(", "));
    const cmp = override
      ? (ruleHit ? t("Host Override stuurt {name} naar {ip}.", { name, ip: override.name ? `${override.name} (${override.ip})` : override.ip }) : t("Vergelijking met test-IP: {name} naar {ip}.", { name, ip: override.name ? `${override.name} (${override.ip})` : override.ip })) + " "
      : "";
    setBodyG("cSrv",
      h("p", { class: "muted" }, cmp + t("Rechtstreeks naar elk IP, met de juiste hostnaam en certificaatnaam (SNI).") + (override ? "" : " " + t("Vul hierboven een test-IP in om je testserver te vergelijken."))),
      cards);
  })();

  await Promise.all([recordsP, hostsP, nsP, propP, mailP, srvP]);
}

// ---------- Rapport kopiëren ----------
$("copyReport").onclick = async () => {
  const lines = [`DNS-check ${$("domain").value} (${new Date().toLocaleString()})`, `Resolver: ${$("resolver").selectedOptions[0].textContent}`, ""];
  document.querySelectorAll("#dResults details.sec").forEach((s) => {
    lines.push("== " + t(s.dataset.title) + " ==");
    s.querySelectorAll(".find li, .rc, tr").forEach((el) => {
      if (el.tagName === "LI") lines.push(`${el.firstChild.textContent} ${el.lastChild.textContent}`);
      else if (el.classList.contains("rc")) lines.push([...el.querySelectorAll(".t > *, .d")].map((x) => x.textContent).join(" | "));
      else lines.push([...el.children].map((c) => c.textContent).join(" | "));
    });
    lines.push("");
  });
  await navigator.clipboard.writeText(lines.join("\n"));
  const label = $("copyReport").textContent;
  $("copyReport").textContent = t("Gekopieerd");
  setTimeout(() => ($("copyReport").textContent = label), 1600);
};

// ---------- Start ----------
function normalize(input) {
  let v = input.trim().replace(/^[a-z]+:\/\//i, "").replace(/^\*\./, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  try { v = new URL("http://" + v).hostname; } catch { return null; }
  return isHost(v) ? v : null;
}

async function remember(name) {
  const { recentDomains = [] } = await chrome.storage.local.get("recentDomains");
  const next = [name, ...recentDomains.filter((x) => x !== name)].slice(0, 8);
  await chrome.storage.local.set({ recentDomains: next });
  fillRecent(next);
}
function fillRecent(list) { $("dRecent").replaceChildren(...list.map((v) => h("option", { value: v }))); }
chrome.storage.local.get("recentDomains").then(({ recentDomains = [] }) => fillRecent(recentDomains));

async function start() {
  const name = normalize($("domain").value);
  $("err").textContent = "";
  if (!name) { $("err").textContent = t("Vul een geldig domein in."); return; }
  $("domain").value = name;
  const tIp = $("dTestIp").value.trim();
  if (tIp && !isTarget(tIp.toLowerCase())) { $("err").textContent = t("Het test-IP is ongeldig."); return; }
  $("banner").hidden = true;
  $("dHint").hidden = true;
  const st = await helperStatus();
  if (!st.verified) {
    $("dResults").hidden = true;
    $("banner").hidden = false;
    $("banner").textContent = "";
    $("banner").append(
      h("strong", {}, !st.reachable ? t("De helper draait niet.") : st.version < EXPECTED_HELPER ? t("De helper moet worden bijgewerkt.") : t("Helper moet opnieuw worden ingesteld")),
      h("p", {}, t("Voor de DNS-check is de helper nodig (hij doet de DNS-vragen rechtstreeks, zoals dig). Koppel hem via het tabje Regels.") + " "),
      h("a", { href: "welcome.html", target: "_blank" }, t("Open de installatie-uitleg")));
    return;
  }
  remember(name);
  $("dResults").hidden = false;
  await run(name, $("resolver").value);
}

for (const [value, label] of RESOLVERS) $("resolver").append(h("option", { value }, value === "system" ? t(label) : label));
$("f").onsubmit = (e) => { e.preventDefault(); start(); };
$("dTestBtn").onclick = () => start();

// Door de popup gebruikt: vul het domein in en start (of vul alleen in).
export function checkDomain(domain, go = true) {
  if (domain) $("domain").value = domain;
  if (go && domain) start();
}

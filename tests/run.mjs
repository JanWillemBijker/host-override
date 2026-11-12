// Tests voor Host Override: hosts-bestand (helper), herkenning live/niet-live en de pagina-indicator.
//   node tests/run.mjs
// Start een eigen helper op een vrije poort met een tijdelijke HOME en een nep-hosts-bestand
// (HOST_OVERRIDE_HOSTS_FILE). Raakt een draaiende helper op 8899 en ~/.host-override niet aan.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(ROOT, "extension");
const require = createRequire(import.meta.url);
const tools = require(path.join(EXT, "helper", "dnstools.js"));
const { classify, normIp, sameNet, triggers } = await import(path.join(EXT, "detect.js"));
const { normIndicator, renderLabel, textColor, INDICATOR_DEFAULTS } = await import(path.join(EXT, "indicator.js"));
const M = await import(path.join(EXT, "model.js"));
const { fetchSubList } = await import(path.join(EXT, "subs.js"));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok  ", name); }
  catch (e) { failed++; console.log("  FAIL", name, "\n       ", e.message.split("\n").join("\n        ")); }
}

// ---------- 1. Parser ----------
console.log("Parser hosts-bestand");
const sample = [
  "﻿# Host Database",
  "127.0.0.1\tlocalhost",
  "255.255.255.255\tbroadcasthost",
  "::1             localhost ip6-localhost ip6-loopback",
  "ff02::1 ip6-allnodes",
  "10.0.0.5   Shop.Example.COM.   www.shop.example.com\t# staging",
  "  192.168.1.20 intranet.test #inline",
  "#10.9.9.9 disabled.example.com",
  "0.0.0.0 ads.tracker.example",
  ":: ads6.tracker.example",
  "2001:DB8:0:0::10 v6.example.com",
  "fe80::1%lo0 linklocal.test",
  "::ffff:203.0.113.7 mapped.example.com",
  "127.0.0.2 dev.local.test",
  "999.1.1.1 bad-ip.example.com",
  "10.0.0.6",
  "10.0.0.7 bad_ok_name.test -bad.example.com",
  "10.0.0.8 a.example.com a.example.com",
].join("\r\n");

await test("commentaar, tabs, CRLF, BOM, inline commentaar, meerdere namen", () => {
  const { lines } = tools.parseHostsText(sample);
  const shop = lines.find((l) => l.names.includes("shop.example.com"));
  assert.deepEqual(shop, { ip: "10.0.0.5", names: ["shop.example.com", "www.shop.example.com"], kind: "override", line: 6 });
  assert.ok(lines.some((l) => l.ip === "192.168.1.20" && l.names[0] === "intranet.test"));
  assert.ok(!lines.some((l) => l.names.includes("disabled.example.com")), "uitgecommentarieerde regel genegeerd");
});
await test("standaardregels (localhost, broadcasthost, ip6-*) genegeerd en geteld", () => {
  const r = tools.parseHostsText(sample);
  assert.ok(!r.lines.some((l) => l.names.some((n) => /localhost|broadcasthost|ip6-/.test(n))));
  assert.equal(r.defaults, 6);
});
await test("0.0.0.0 en :: zijn 'blocked', 127.0.0.2 is 'loopback'", () => {
  const { lines } = tools.parseHostsText(sample);
  assert.equal(lines.find((l) => l.names.includes("ads.tracker.example")).kind, "blocked");
  assert.equal(lines.find((l) => l.names.includes("ads6.tracker.example")).kind, "blocked");
  assert.equal(lines.find((l) => l.names.includes("dev.local.test")).kind, "loopback");
});
await test("IPv6 genormaliseerd, zone-index weg, IPv4-mapped wordt IPv4", () => {
  const { lines } = tools.parseHostsText(sample);
  assert.equal(lines.find((l) => l.names.includes("v6.example.com")).ip, "2001:db8::10");
  assert.equal(lines.find((l) => l.names.includes("linklocal.test")).ip, "fe80::1");
  assert.equal(lines.find((l) => l.names.includes("mapped.example.com")).ip, "203.0.113.7");
});
await test("ongeldige IP's/namen overgeslagen, dubbele namen ontdubbeld", () => {
  const r = tools.parseHostsText(sample);
  assert.ok(!r.lines.some((l) => l.names.includes("bad-ip.example.com")));
  const l7 = r.lines.find((l) => l.ip === "10.0.0.7");
  assert.deepEqual(l7.names, ["bad_ok_name.test"]);
  assert.deepEqual(r.lines.find((l) => l.ip === "10.0.0.8").names, ["a.example.com"]);
  assert.equal(r.invalid, 3); // 999.1.1.1, "10.0.0.6" zonder naam, -bad.example.com
});
await test("veel 127.0.0.1-namen = blokkeerlijst (loopback wordt blocked)", () => {
  const text = Array.from({ length: 60 }, (_, i) => `127.0.0.1 ad${i}.example`).join("\n") + "\n10.1.1.1 real.example";
  const { lines } = tools.parseHostsText(text);
  assert.ok(lines.filter((l) => l.ip === "127.0.0.1").every((l) => l.kind === "blocked"));
  assert.equal(lines.find((l) => l.ip === "10.1.1.1").kind, "override");
});
await test("normIp (extensie) en plainIp (helper) geven dezelfde vorm", () => {
  for (const ip of ["::FFFF:1.2.3.4", "2001:DB8:0:0::1", "1.2.3.4", "::1", "0:0:0:0:0:ffff:a00:1", "fe80::1"]) {
    assert.equal(normIp(ip), tools.plainIp(ip), ip);
  }
});

// ---------- 2. Beslissen: live of niet ----------
console.log("Herkenning live / niet-live");
const pub = (ips) => ({ status: "ok", ips });
await test("regel gaat voor alles (verbonden IP is de lokale helper)", () => {
  const r = classify({ ip: "127.0.0.1", rule: { host: "a.nl", ip: "10.0.0.1" }, hosts: [{ ip: "10.9.9.9", kind: "override" }] });
  assert.equal(r.source, "rule"); assert.equal(r.ip, "10.0.0.1"); assert.ok(r.certain);
});
await test("hosts-bestand is definitief", () => {
  const r = classify({ ip: "10.0.0.5", hosts: [{ ip: "10.0.0.5", kind: "override" }], doh: pub(["93.184.215.14"]) });
  assert.equal(r.source, "hosts"); assert.ok(r.certain); assert.equal(r.mismatch, false);
});
await test("hosts-treffer op 127.0.0.1 (lokale ontwikkeling) telt als hosts", () => {
  const r = classify({ ip: "127.0.0.1", hosts: [{ ip: "127.0.0.1", kind: "blocked" }] });
  assert.equal(r.source, "hosts");
});
await test("0.0.0.0-blokkade terwijl de pagina wel laadde: genegeerd", () => {
  const r = classify({ ip: "93.184.215.14", hosts: [{ ip: "0.0.0.0", kind: "blocked" }], doh: pub(["93.184.215.14"]) });
  assert.equal(r.source, "live");
});
await test("verbonden IP in A+AAAA-set = live (ook IPv6 en mapped)", () => {
  assert.equal(classify({ ip: "2606:2800:21f:cb07:6820:80da:af6b:8b2c", doh: pub(["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"]) }).source, "live");
  assert.equal(classify({ ip: "::ffff:93.184.215.14", doh: pub(["93.184.215.14"]) }).source, "live");
  assert.equal(classify({ ip: "104.16.1.1", doh: pub(["104.16.0.1", "104.16.1.1", "104.16.2.1"]) }).source, "live");
});
await test("afwijkend: zacht (niet certain); zelfde /24 of /48 = near (geen indicator)", () => {
  const far = classify({ ip: "10.0.0.5", doh: pub(["93.184.215.14"]) });
  assert.equal(far.source, "differs"); assert.equal(far.certain, false); assert.equal(far.near, false);
  const near = classify({ ip: "104.16.0.9", doh: pub(["104.16.0.8"]) });
  assert.equal(near.near, true);
  const ind = normIndicator({ onDiffers: true });
  assert.equal(triggers(far, ind), true);
  assert.equal(triggers(near, ind), false);
  assert.equal(triggers(far, normIndicator({})), false, "standaard uit");
  assert.ok(sameNet("2001:db8:1::1", "2001:db8:1:ff::2") && !sameNet("2001:db8:1::1", "2001:db8:2::1"));
  assert.ok(!sameNet("10.0.0.1", "::ffff:10.0.1.1"));
});
await test("niet in publieke DNS (NXDOMAIN) maar wel verbonden = afwijkend", () => {
  assert.equal(classify({ ip: "10.1.2.3", doh: { status: "nxdomain", ips: [] } }).source, "differs");
});
await test("zonder gegevens: onbekend (geen vals alarm)", () => {
  assert.equal(classify({ ip: "1.2.3.4" }).source, "unknown");
  assert.equal(classify({}).source, "unknown");
});

// ---------- 3. Indicator ----------
console.log("Indicator-instellingen en label");
await test("normIndicator: standaardwaarden en opschonen", () => {
  assert.deepEqual(normIndicator(undefined), INDICATOR_DEFAULTS);
  const n = normIndicator({ style: "evil", color: "red; background:url(x)", opacity: 5, text: "A\u0000B".padEnd(200, "x"), corner: "br", onRule: "yes" });
  assert.equal(n.style, "badge"); assert.equal(n.color, INDICATOR_DEFAULTS.color); assert.equal(n.opacity, 30);
  assert.equal(n.text.length, 80); assert.ok(!n.text.includes("\u0000")); assert.equal(n.corner, "br"); assert.equal(n.onRule, true);
});
await test("renderLabel: sjabloon, zonder IP geen losse scheidingstekens", () => {
  assert.equal(renderLabel("TEST · {ip}", { ip: "1.2.3.4" }), "TEST · 1.2.3.4");
  assert.equal(renderLabel("TEST · {ip}", { ip: "1.2.3.4" }, false), "TEST");
  assert.equal(renderLabel("{source}: {host} ({ip})", { ip: "1.2.3.4", host: "a.nl", source: "hosts" }, false), "hosts: a.nl");
  assert.equal(renderLabel("", { ip: "1.2.3.4" }), "TEST · 1.2.3.4");
  assert.equal(renderLabel("<b>{host}</b>", { host: "a.nl" }), "<b>a.nl</b>", "geen HTML-interpretatie: textContent in de pagina");
});
await test("textColor: wit op donker, donker op licht", () => {
  assert.equal(textColor("#c2410c"), "#ffffff");
  assert.equal(textColor("#ffe066"), "#111111");
});

// ---------- 3b. Model: groepen, notities, doelen, hosts-formaat ----------
console.log("Model: groepen, notities, doelen en hosts-formaat");
await test("migratie: losse regels (1.7) komen in de standaardgroep, ongeldige vallen weg", () => {
  const s = M.normState({ enabled: true, rules: [{ host: "A.nl", ip: "1.2.3.4" }, { host: "b.nl", ip: "999.1.1.1" }, { host: "c.nl", ip: "x;rm -rf" }, { host: "a.nl", ip: "5.6.7.8" }] });
  assert.equal(s.groups.length, 1); assert.equal(s.groups[0].id, "default");
  assert.deepEqual(s.rules, [{ host: "a.nl", ip: "1.2.3.4", enabled: true, group: "default" }]);
  assert.equal(M.activeRules({ enabled: true, rules: [{ host: "a.nl", ip: "1.2.3.4" }] }).length, 1, "oude toestand zonder groepen werkt");
});
await test("doel: IP of strikte hostnaam; geen wildcard, geen numerieke TLD, geen shell-tekens", () => {
  for (const ok of ["1.2.3.4", "2001:db8::1", "server123.hostingpartij.nl", "localhost", "a-b.example.co.uk"]) assert.ok(M.isTarget(ok), ok);
  for (const bad of ["*.x.nl", "999.1.1.1", "10.0.0", "rommel", "intranet", "a b.nl", "x.nl;id", "$(id).nl", "-a.nl", "a..nl", "", "x".repeat(254) + ".nl", "http://x.nl"]) assert.ok(!M.isTarget(bad), bad);
  assert.equal(M.targetKind("srv.x.nl"), "host"); assert.equal(M.targetKind("1.2.3.4"), "ip");
});
await test("groep uit = regels uit; hoofdschakelaar uit = alles uit; eerste treffer wint", () => {
  const s = M.normState({ enabled: true, groups: [{ id: "default" }, { id: "stg", name: "Klant X – staging", color: "#1971c2", enabled: false }],
    rules: [{ host: "a.nl", ip: "1.1.1.1", group: "stg" }, { host: "*.b.nl", ip: "2.2.2.2" }, { host: "c.b.nl", ip: "3.3.3.3" }] });
  assert.deepEqual(M.activeRules(s).map((r) => r.host), ["*.b.nl", "c.b.nl"]);
  assert.equal(M.matchRule(M.activeRules(s), "c.b.nl").ip, "2.2.2.2");
  assert.equal(M.activeRules({ ...s, enabled: false }).length, 0);
  assert.equal(M.normState({ rules: [{ host: "x.nl", ip: "1.1.1.1", group: "bestaat-niet" }] }).rules[0].group, "default");
});
await test("één groep tegelijk: aanzetten zet de rest uit; badgekleur volgt de enige actieve groep", () => {
  let s = M.normState({ enabled: true, exclusiveGroups: true, groups: [{ id: "default" }, { id: "g1", color: "#2b8a3e" }],
    rules: [{ host: "a.nl", ip: "1.1.1.1" }, { host: "b.nl", ip: "2.2.2.2", group: "g1" }] });
  s = M.setGroupEnabled(s, "g1", true);
  assert.deepEqual(s.groups.map((g) => g.enabled), [false, true]);
  assert.deepEqual(M.activeGroups(s).map((g) => g.color), ["#2b8a3e"]);
  const multi = M.setGroupEnabled({ ...s, exclusiveGroups: false }, "default", true);
  assert.equal(multi.groups.filter((g) => g.enabled).length, 2);
});
await test("notitie en groepsnaam: stuurtekens weg, ingekort", () => {
  const s = M.normState({ groups: [{ id: "default", name: "A\nB\u0000" + "x".repeat(100) }], rules: [{ host: "a.nl", ip: "1.1.1.1", note: "regel1\r\nregel2" + "y".repeat(200) }] });
  assert.ok(!/[\n\r\u0000]/.test(s.groups[0].name) && s.groups[0].name.length <= M.NAME_MAX);
  assert.ok(s.rules[0].note.startsWith("regel1 regel2") && s.rules[0].note.length <= M.NOTE_MAX);
});
await test("hosts-formaat: groepen (# group: Naam #kleur [off]), notities en hostnaam-doelen gaan heen en terug", () => {
  const s = M.normState({ groups: [{ id: "default" }, { id: "g1", name: "Klant X – staging", color: "#1971c2", enabled: false }],
    rules: [{ host: "a.nl", ip: "1.1.1.1", note: "nieuwe server" }, { host: "b.nl", ip: "srv1.hosting.nl", group: "g1" }, { host: "c.nl", ip: "::1", group: "g1", enabled: false }] });
  const text = M.formatHosts(s.rules, s.groups);
  assert.match(text, /^# group: Default #c2410c\n1\.1\.1\.1 a\.nl  # nieuwe server\n\n# group: Klant X – staging #1971c2 off\nsrv1\.hosting\.nl b\.nl\n#off ::1 c\.nl$/);
  const p = M.parseHosts(text);
  assert.equal(p.skipped, 0);
  assert.deepEqual(p.groups.map((g) => [g.name, g.color, g.enabled]), [["Default", "#c2410c", true], ["Klant X – staging", "#1971c2", false]]);
  assert.deepEqual(p.rules.map((r) => [r.host, r.ip, r.enabled, r.note || "", r.groupName]), [
    ["a.nl", "1.1.1.1", true, "nieuwe server", "Default"], ["b.nl", "srv1.hosting.nl", true, "", "Klant X – staging"], ["c.nl", "::1", false, "", "Klant X – staging"]]);
  // In een lege toestand importeren: groep wordt aangemaakt, Default wordt de standaardgroep.
  const m = M.mergeParsed(M.normState({}), p, "default", () => 0.5);
  assert.equal(m.added, 3); assert.equal(m.state.groups.length, 2);
  const g1 = m.state.groups.find((g) => g.name === "Klant X – staging");
  assert.equal(g1.enabled, false); assert.equal(g1.color, "#1971c2");
  assert.equal(m.state.rules.find((r) => r.host === "a.nl").group, "default");
  assert.equal(m.state.rules.find((r) => r.host === "b.nl").group, g1.id);
  // Nog een keer: niets nieuw, niets gewijzigd, geen dubbele groep.
  const again = M.mergeParsed(m.state, p, "default", () => 0.7);
  assert.equal(again.added + again.changed, 0); assert.equal(again.state.groups.length, 2);
});
await test("parseHosts: gewone hosts-regels, rommel en injectie worden overgeslagen", () => {
  const p = M.parseHosts("127.0.0.1 localhost\n1.2.3.4 a.nl www.a.nl #c\nfoo\n1.2.3.4 $(id).nl\n`id` b.nl\n# group: \n5.6.7.8 c.nl");
  assert.deepEqual(p.rules.map((r) => r.host), ["localhost", "a.nl", "www.a.nl", "c.nl"]);
  assert.equal(p.rules[1].note, "c"); assert.equal(p.skipped, 3);
});
await test("indicator: {group} in het label", () => {
  assert.equal(renderLabel("{group} · {ip}", { ip: "1.2.3.4", group: "Klant X" }), "Klant X · 1.2.3.4");
  assert.equal(renderLabel("{group} · {ip}", { ip: "1.2.3.4" }), "1.2.3.4");
  assert.equal(normIndicator({}).groupColor, true);
});
await test("registreerbaar domein (bij benadering)", () => {
  assert.equal(M.regDomain("www.shop.example.nl"), "example.nl");
  assert.equal(M.regDomain("cdn.example.co.uk"), "example.co.uk");
  assert.equal(M.regDomain("*.example.com"), "example.com");
  assert.equal(M.regDomain("foo.github.io"), "foo.github.io");
  assert.equal(M.regDomain("1.2.3.4"), "1.2.3.4");
});

await test("verbindingen: regel / hosts-bestand / live, en 'nog live' bij hetzelfde domein", () => {
  const st = M.normState({ enabled: true, rules: [{ host: "www.shop.nl", ip: "10.0.0.1" }, { host: "*.klant.nl", ip: "10.0.0.2" }] });
  const rec = { page: "www.shop.nl", total: 9, hosts: {
    "www.shop.nl": { n: 4, ips: ["127.0.0.1"], types: { main_frame: 1, image: 3 } },
    "cdn.shop.nl": { n: 2, ips: ["93.184.215.14"], types: { script: 2 } },
    "shop.nl": { n: 1, ips: ["93.184.215.14"], types: { image: 1 } },
    "fonts.gstatic.com": { n: 1, ips: ["142.250.1.1"], types: { font: 1 } },
    "dev.local.test": { n: 1, ips: ["10.9.9.9"], types: { xmlhttprequest: 1 } },
  } };
  const a = M.analyzeConnections(rec, M.activeRules(st), { "dev.local.test": [{ ip: "10.9.9.9", kind: "override" }] });
  const by = Object.fromEntries(a.rows.map((r) => [r.host, r]));
  assert.equal(by["www.shop.nl"].kind, "rule");
  assert.equal(by["dev.local.test"].kind, "hosts"); assert.equal(by["dev.local.test"].hostsIp, "10.9.9.9");
  assert.ok(by["cdn.shop.nl"].stillLive && by["shop.nl"].stillLive);
  assert.equal(by["cdn.shop.nl"].suggest.ip, "10.0.0.1");
  assert.ok(!by["fonts.gstatic.com"].stillLive);
  assert.deepEqual(a.rows.slice(0, 2).map((r) => r.host).sort(), ["cdn.shop.nl", "shop.nl"], "nog live bovenaan");
  assert.equal(a.total, 9); assert.equal(a.types.image, 4); assert.equal(a.stillLive, 2); assert.equal(a.viaRule, 1);
});

console.log("Abonnementen, sync en back-up");
const fakeFetch = (body, { status = 200, url, headers = {} } = {}) => async (u) => {
  const r = new Response(body, { status, headers });
  Object.defineProperty(r, "url", { value: url || u });
  return r;
};
await test("abonnement: alleen https, geen inloggegevens; geldige lijst met groepskop wordt gelezen", async () => {
  await assert.rejects(fetchSubList("http://x.nl/l.txt", { fetchFn: fakeFetch("") }), { code: "https" });
  await assert.rejects(fetchSubList("https://u:p@x.nl/l.txt", { fetchFn: fakeFetch("") }), { code: "credentials" });
  await assert.rejects(fetchSubList("javascript:alert(1)", { fetchFn: fakeFetch("") }), { code: "https" });
  await assert.rejects(fetchSubList("https://x.nl/l.txt", { fetchFn: fakeFetch(""), hasPermission: async () => false }), { code: "permission" });
  const r = await fetchSubList("https://x.nl/l.txt", { fetchFn: fakeFetch("# group: Team staging #2b8a3e\n10.0.0.1 a.nl # db\nrommel\nsrv.host.nl b.nl\n") });
  assert.equal(r.rules.length, 2); assert.equal(r.skipped, 1); assert.equal(r.groups[0].name, "Team staging"); assert.equal(r.rules[0].note, "db");
});
await test("abonnement: foutcodes (HTTP-status, te groot, HTML, leeg, doorverwijzing naar http)", async () => {
  await assert.rejects(fetchSubList("https://x.nl/l", { fetchFn: fakeFetch("nope", { status: 404 }) }), { code: "http-404" });
  await assert.rejects(fetchSubList("https://x.nl/l", { fetchFn: fakeFetch("1.1.1.1 a.nl\n".repeat(30000)) }), { code: "too-big" });
  await assert.rejects(fetchSubList("https://x.nl/l", { fetchFn: fakeFetch("x", { headers: { "content-length": String(10 * 1024 * 1024) } }) }), { code: "too-big" });
  await assert.rejects(fetchSubList("https://x.nl/l", { fetchFn: fakeFetch("<!doctype html><p>login") }), { code: "not-hosts" });
  await assert.rejects(fetchSubList("https://x.nl/l", { fetchFn: fakeFetch("# alleen commentaar\n") }), { code: "no-rules" });
  await assert.rejects(fetchSubList("https://x.nl/l", { fetchFn: fakeFetch("1.1.1.1 a.nl", { url: "http://x.nl/l" }) }), { code: "https" });
  await assert.rejects(fetchSubList("https://x.nl/l", { fetchFn: async () => { throw new TypeError("Failed to fetch"); } }), { code: "network" });
});
await test("abonnementsregels: alleen-lezen in een eigen groep, eigen regel wint bij dezelfde host", () => {
  const s = M.normState({ enabled: true, rules: [{ host: "a.nl", ip: "9.9.9.9" }], subs: [{ id: "s1", url: "https://x.nl/l.txt", rules: [{ host: "a.nl", ip: "1.1.1.1" }, { host: "b.nl", ip: "2.2.2.2" }] }] });
  const g = s.groups.find((x) => x.sub === "s1");
  assert.ok(g && g.id === "sub-s1");
  const all = M.allRules(s);
  assert.deepEqual(all.map((r) => [r.host, r.ip, !!r.readOnly]), [["a.nl", "9.9.9.9", false], ["a.nl", "1.1.1.1", true], ["b.nl", "2.2.2.2", true]]);
  assert.equal(M.matchRule(M.activeRules(s), "a.nl").ip, "9.9.9.9");
  assert.equal(M.normState({ subs: [{ id: "s1", url: "http://x.nl" }] }).subs.length, 0, "http-abonnement valt weg");
  assert.equal(M.normState({ groups: [{ id: "sub-s9", sub: "s9" }] }).groups.length, 1, "groep van opgezegd abonnement verdwijnt");
});
await test("sync: nooit het helper-geheim of wachtwoorden; stukken < 8 KB; heen en terug; kapotte stukken = null", () => {
  const raw = { enabled: true, helperSecret: "a".repeat(64), lang: "en", indicator: { color: "#1971c2" },
    groups: [{ id: "default" }, { id: "stg", name: "Staging – ü", auth: { user: "jan", pass: "geheim" }, headers: [{ name: "X-A", value: "1" }] }],
    rules: Array.from({ length: 400 }, (_, i) => ({ host: `host${i}.voorbeeld-met-een-lange-naam.nl`, ip: `10.0.${i >> 8}.${i & 255}`, group: i % 2 ? "stg" : "default", note: "notitie " + i })),
    subs: [{ id: "s1", url: "https://x.nl/l.txt", rules: [{ host: "z.nl", ip: "1.1.1.1" }] }] };
  const p = M.syncPayload(raw);
  const json = JSON.stringify(p);
  assert.ok(!json.includes("a".repeat(64)) && !json.includes("geheim"), "geen geheim/wachtwoord");
  assert.ok(!json.includes("z.nl"), "opgehaalde abonnementsregels gaan niet mee");
  assert.equal(p.settings.lang, "en"); assert.equal(p.settings.enabled, undefined);
  const { meta, items } = M.encodeSync(p, { ts: 5, dev: "d1" });
  assert.ok(meta.n > 1);
  for (const [k, v] of Object.entries(items)) assert.ok(new TextEncoder().encode(k + JSON.stringify(v)).length < 8192, k);
  assert.ok(meta.bytes < M.SYNC_MAX);
  assert.deepEqual(M.decodeSync({ "ho:meta": meta, ...items }), p);
  assert.equal(M.decodeSync({ "ho:meta": meta, ...items, "ho:c0": items["ho:c0"].slice(1) }), null, "half binnengekomen");
  assert.equal(M.decodeSync({ "ho:meta": { ...meta, n: 99 }, ...items }), null);
  // Toepassen op een andere computer: wachtwoord blijft lokaal, opgehaalde lijst blijft, hoofdschakelaar ongemoeid.
  const other = { enabled: false, groups: [{ id: "default" }, { id: "stg", auth: { user: "jan", pass: "lokaal" } }], subs: [{ id: "old", url: "https://x.nl/l.txt", rules: [{ host: "q.nl", ip: "3.3.3.3" }] }] };
  const out = M.applySync(other, M.decodeSync({ "ho:meta": meta, ...items }), "replace");
  assert.equal(out.rules.length, 400); assert.equal(out.lang, "en"); assert.equal(out.enabled, undefined);
  assert.equal(out.groups.find((g) => g.id === "stg").auth.pass, "lokaal");
  assert.equal(out.subs[0].rules[0].host, "q.nl"); assert.equal(out.subs[0].id, "s1");
  // Eerste keer: samenvoegen, lokaal wint bij dezelfde host.
  const merged = M.applySync({ rules: [{ host: "host1.voorbeeld-met-een-lange-naam.nl", ip: "1.1.1.1" }, { host: "eigen.nl", ip: "2.2.2.2" }] }, p, "merge");
  assert.equal(merged.rules.length, 401);
  assert.equal(merged.rules.find((r) => r.host === "host1.voorbeeld-met-een-lange-naam.nl").ip, "1.1.1.1");
});
await test("back-up: geheim en wachtwoorden alleen als aangevinkt; voorbeeld; samenvoegen of vervangen", () => {
  const raw = { enabled: true, helperSecret: "b".repeat(64), dohProvider: "google", groups: [{ id: "default" }, { id: "stg", auth: { user: "jan", pass: "pw" } }],
    rules: [{ host: "a.nl", ip: "1.1.1.1" }, { host: "b.nl", ip: "srv.x.nl", group: "stg", note: "n" }], subs: [{ id: "s1", url: "https://x.nl/l", rules: [{ host: "z.nl", ip: "1.1.1.1" }] }] };
  const plain = JSON.stringify(M.buildBackup(raw));
  assert.ok(!plain.includes("b".repeat(64)) && !plain.includes('"pw"') && !plain.includes("z.nl"));
  const full = M.buildBackup(raw, { includeSecrets: true });
  assert.equal(full.secret, "b".repeat(64)); assert.equal(full.data.groups[1].auth.pass, "pw");
  const b = M.readBackup(JSON.stringify(full));
  assert.equal(b.secret, "b".repeat(64)); assert.equal(b.settings.dohProvider, "google");
  const local = { rules: [{ host: "a.nl", ip: "9.9.9.9" }, { host: "c.nl", ip: "3.3.3.3" }] };
  const pv = M.backupPreview(local, b);
  assert.deepEqual([pv.rules, pv.added, pv.changed, pv.removed, pv.secret], [2, 1, 1, 1, true]);
  const merged = M.applyBackup(local, b, "merge");
  assert.deepEqual(merged.rules.map((r) => r.host).sort(), ["a.nl", "b.nl", "c.nl"]);
  assert.equal(merged.rules.find((r) => r.host === "a.nl").ip, "1.1.1.1");
  const replaced = M.applyBackup(local, b, "replace");
  assert.deepEqual(replaced.rules.map((r) => r.host), ["a.nl", "b.nl"]);
  for (const bad of ["{", "[]", JSON.stringify({ kind: "x", v: 1, data: {} }), "x".repeat(6 * 1024 * 1024)]) assert.throws(() => M.readBackup(bad));
  const evil = M.readBackup(JSON.stringify({ kind: M.BACKUP_KIND, v: 1, data: { rules: [{ host: "a.nl;rm", ip: "1.1.1.1" }, { host: "ok.nl", ip: "$(id)" }], groups: [{ id: "../x", color: "red" }], settings: { helperSecret: "x", evil: 1 } }, secret: "nope" }));
  assert.equal(evil.state.rules.length, 0); assert.equal(evil.secret, null); assert.deepEqual(Object.keys(evil.settings), []);
});

console.log("Verzoek-headers per groep (declarativeNetRequest)");
await test("headers: naam/waarde streng; hop-by-hop, verboden en eigen velden geblokkeerd", () => {
  assert.equal(M.headerProblem("X-Debug", "1"), null);
  for (const n of ["Host", "connection", "Cookie", "Authorization", "Transfer-Encoding", "Upgrade", "Sec-Fetch-Mode", "Proxy-Authorization", "Origin", "X-Host-Override-Token"]) assert.equal(M.headerProblem(n, "x"), "blocked", n);
  for (const n of ["", "X Debug", "X:Debug", "Ünïcode", "a".repeat(65)]) assert.equal(M.headerProblem(n, "x"), "name", n);
  for (const v of ["a\r\nX-Evil: 1", "a\nb", "\u0000", "x".repeat(1025)]) assert.equal(M.headerProblem("X-A", v), "value", JSON.stringify(v).slice(0, 20));
  assert.equal(M.authProblem("user", "p@ss:w0rd"), null);
  assert.equal(M.authProblem("us:er", "x"), "user"); assert.equal(M.authProblem("", "x"), "user"); assert.equal(M.authProblem("u", "a\nb"), "pass");
  const g = M.normGroup({ id: "g1", headers: [{ name: "X-Ok", value: "1" }, { name: "Cookie", value: "a=b" }, { name: "X-Bad", value: "a\r\nb" }], auth: { user: "a:b", pass: "x" } }, 1);
  assert.deepEqual(g.headers, [{ name: "X-Ok", value: "1" }]); assert.equal(g.auth, null);
});
await test("DNR: alleen actieve regels van groepen met headers; exact = regex op de host, wildcard = domein + subdomeinen", () => {
  const raw = { enabled: true, groups: [{ id: "default" }, { id: "stg", noCache: true, auth: { user: "jan", pass: "wächter" }, headers: [{ name: "X-Debug", value: "1" }] }, { id: "off", noCache: true, enabled: false }],
    rules: [{ host: "a.nl", ip: "1.1.1.1" }, { host: "shop.x.nl", ip: "2.2.2.2", group: "stg" }, { host: "*.y.nl", ip: "3.3.3.3", group: "stg" }, { host: "api.y.nl", ip: "4.4.4.4" }, { host: "z.nl", ip: "5.5.5.5", group: "off" }, { host: "q.nl", ip: "6.6.6.6", group: "stg", enabled: false }] };
  const rules = M.buildDnrRules(M.normState(raw));
  assert.equal(rules.length, 2);
  const [exact, wild] = rules;
  assert.equal(exact.condition.regexFilter, "^[a-z]+://shop\\.x\\.nl(:[0-9]+)?(/|$)");
  assert.ok(new RegExp(exact.condition.regexFilter).test("https://shop.x.nl/a") && !new RegExp(exact.condition.regexFilter).test("https://shop.x.nl.evil.com/"));
  assert.ok(!new RegExp(exact.condition.regexFilter).test("https://sub.shop.x.nl/"));
  assert.deepEqual(wild.condition.requestDomains, ["y.nl"]);
  assert.equal(wild.condition.excludedRequestDomains, undefined, "api.y.nl staat later in de lijst: de wildcard wint (eerste treffer)");
  const hdr = Object.fromEntries(exact.action.requestHeaders.map((x) => [x.header, x.value]));
  assert.equal(hdr["cache-control"], "no-cache"); assert.equal(hdr.pragma, "no-cache"); assert.equal(hdr["x-debug"], "1");
  assert.equal(hdr.authorization, "Basic " + Buffer.from("jan:wächter", "utf8").toString("base64"));
  assert.ok(rules.every((r, i) => r.id === i + 1 && r.action.type === "modifyHeaders"));
  assert.equal(M.buildDnrRules(M.normState({ ...raw, enabled: false })).length, 0, "hoofdschakelaar uit");
  // Een specifieke regel uit een andere groep vóór de wildcard: die host wordt uitgezonderd.
  const raw2 = { ...raw, rules: [{ host: "api.y.nl", ip: "4.4.4.4" }, { host: "y.nl", ip: "4.4.4.4" }, { host: "*.y.nl", ip: "3.3.3.3", group: "stg" }] };
  const [w2] = M.buildDnrRules(M.normState(raw2));
  assert.deepEqual(w2.condition.excludedRequestDomains, ["api.y.nl"]);
  assert.ok(w2.condition.regexFilter && !w2.condition.requestDomains, "kaal domein hoort bij een andere regel: alleen subdomeinen");
  assert.ok(new RegExp(w2.condition.regexFilter).test("https://www.y.nl/") && !new RegExp(w2.condition.regexFilter).test("https://y.nl/"));
  assert.deepEqual(M.groupOrigins(M.normState(raw), "stg"), ["*://shop.x.nl/*", "*://*.y.nl/*", "*://q.nl/*"]);
});

// ---------- 4. Helper: /__hosts ----------
console.log("Helper /__hosts (eigen helper, tijdelijke HOME)");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ho-test-"));
const home = path.join(tmp, "home");
fs.mkdirSync(path.join(home, ".host-override"), { recursive: true });
const SECRET = crypto.randomBytes(32).toString("hex");
const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";
const ORIGIN = `chrome-extension://${EXT_ID}`;
const HOSTS = path.join(tmp, "hosts");
fs.writeFileSync(HOSTS, sample);
const port = await new Promise((res) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
assert.notEqual(port, 8899);

function startHelper(withConfig = true) {
  if (withConfig) fs.writeFileSync(path.join(home, ".host-override", "config.json"), JSON.stringify({ origins: [ORIGIN], secret: SECRET }));
  else fs.rmSync(path.join(home, ".host-override", "config.json"), { force: true });
  const child = spawn(process.execPath, [path.join(EXT, "helper", "proxy.js")], {
    env: { ...process.env, HOME: home, USERPROFILE: home, PORT: String(port), HOST_OVERRIDE_HOSTS_FILE: HOSTS },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((res, rej) => {
    let out = "";
    child.stdout.on("data", (d) => { out += d; if (out.includes("proxy op 127.0.0.1")) res(child); });
    child.stderr.on("data", (d) => { out += d; });
    child.on("exit", (c) => rej(new Error("helper stopte: " + c + " " + out)));
    setTimeout(() => rej(new Error("helper start niet: " + out)), 5000);
  });
}
function req(pathname, { method = "GET", token = SECRET, origin = ORIGIN, host = `127.0.0.1:${port}`, body, marker = true } = {}) {
  return new Promise((res, rej) => {
    const headers = { Host: host };
    if (origin) headers.Origin = origin;
    if (marker) headers["X-Host-Override"] = "1";
    if (token) headers["X-Host-Override-Token"] = token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const r = http.request({ host: "127.0.0.1", port, path: pathname, method, headers }, (resp) => {
      let data = "";
      resp.on("data", (c) => (data += c));
      resp.on("end", () => { let json = null; try { json = JSON.parse(data); } catch { /* tekst */ } res({ status: resp.statusCode, json, text: data }); });
    });
    r.on("error", rej);
    if (body !== undefined) r.write(typeof body === "string" ? body : JSON.stringify(body));
    r.end();
  });
}

let helper = await startHelper();
try {
  await test("versie blijft 6 en status-HMAC werkt nog", async () => {
    const nonce = crypto.randomBytes(16).toString("hex");
    const r = await req(`/__status?nonce=${nonce}`, { token: null, origin: null, marker: false });
    assert.equal(r.json.helper, 6);
    assert.equal(r.json.proof, crypto.createHmac("sha256", SECRET).update("host-override/status:" + nonce).digest("hex"));
  });
  await test("403 zonder token", async () => {
    const r = await req("/__hosts?names=shop.example.com", { token: null });
    assert.equal(r.status, 403); assert.equal(r.json.error, "forbidden"); assert.ok(!r.text.includes("10.0.0.5"));
  });
  await test("403 met verkeerd token, verkeerde Origin, zonder X-Host-Override of met vreemde Host (DNS-rebinding)", async () => {
    assert.equal((await req("/__hosts", { token: "0".repeat(64) })).status, 403);
    assert.equal((await req("/__hosts", { origin: "https://evil.example" })).status, 403);
    assert.equal((await req("/__hosts", { origin: "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" })).status, 403);
    assert.equal((await req("/__hosts", { marker: false })).status, 403);
    assert.equal((await req("/__hosts", { host: `evil.example:${port}` })).status, 403);
  });
  await test("GET ?names= geeft alleen treffers voor die namen", async () => {
    const r = await req("/__hosts?names=shop.example.com,WWW.Shop.Example.com.,nothere.example,ads.tracker.example,localhost");
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json.matches).sort(), ["ads.tracker.example", "localhost", "nothere.example", "shop.example.com", "www.shop.example.com"]);
    assert.deepEqual(r.json.matches["shop.example.com"], [{ ip: "10.0.0.5", kind: "override", line: 6 }]);
    assert.equal(r.json.matches["www.shop.example.com"][0].ip, "10.0.0.5");
    assert.deepEqual(r.json.matches["nothere.example"], []);
    assert.equal(r.json.matches["ads.tracker.example"][0].kind, "blocked");
    assert.deepEqual(r.json.matches.localhost, [], "standaardregel geen treffer");
    assert.equal(r.json.path, HOSTS); assert.equal(r.json.truncated, false);
    assert.equal(r.json.entries, undefined, "geen volledig overzicht als er namen gevraagd zijn");
  });
  await test("POST {names} werkt ook", async () => {
    const r = await req("/__hosts", { method: "POST", body: { names: ["v6.example.com"] } });
    assert.equal(r.status, 200); assert.equal(r.json.matches["v6.example.com"][0].ip, "2001:db8::10");
  });
  await test("overzicht zonder names: overrides + geteld aantal blokkeringen", async () => {
    const r = await req("/__hosts");
    assert.equal(r.status, 200);
    assert.ok(r.json.entries.some((e) => e.ip === "10.0.0.5"));
    assert.ok(!r.json.entries.some((e) => e.kind === "blocked"));
    assert.equal(r.json.blocked, 2); assert.equal(r.json.blockedSample.length, 2);
    assert.equal(r.json.defaults, 6);
  });
  await test("ongeldige invoer: 400 (vreemde naam, >50 namen, kapotte JSON), andere methode 405", async () => {
    assert.equal((await req("/__hosts?names=" + encodeURIComponent("a b.com"))).status, 400);
    assert.equal((await req("/__hosts?names=" + encodeURIComponent("../../etc/passwd"))).status, 400);
    assert.equal((await req("/__hosts?names=" + Array.from({ length: 51 }, (_, i) => `n${i}.example`).join(","))).status, 400);
    assert.equal((await req("/__hosts", { method: "POST", body: "{kapot" })).status, 400);
    assert.equal((await req("/__hosts", { method: "POST", body: { names: "a.com" } })).status, 400);
    assert.equal((await req("/__hosts", { method: "PUT", body: {} })).status, 405);
  });
  await test("wijziging in het bestand wordt opgepikt (cache op grootte + mtime)", async () => {
    fs.appendFileSync(HOSTS, "\n10.0.0.99 later.example.com\n");
    const t = new Date(Date.now() + 2000); fs.utimesSync(HOSTS, t, t);
    const r = await req("/__hosts?names=later.example.com");
    assert.equal(r.json.matches["later.example.com"][0].ip, "10.0.0.99");
  });
  await test("hosts-bestand ontbreekt: exists=false, geen fout", async () => {
    const keep = fs.readFileSync(HOSTS);
    fs.rmSync(HOSTS);
    const r = await req("/__hosts?names=a.example.com");
    fs.writeFileSync(HOSTS, keep);
    assert.equal(r.status, 200); assert.equal(r.json.exists, false); assert.deepEqual(r.json.matches["a.example.com"], []);
  });
  await test("groottelimiet: >5 MB leest alleen de eerste 5 MB (afgekapt op een hele regel)", async () => {
    const keep = fs.readFileSync(HOSTS);
    const filler = "0.0.0.0 " + "x".repeat(40) + ".blocklist.example\n";
    const n = Math.ceil((tools.HOSTS_MAX + 512 * 1024) / filler.length);
    const fd = fs.openSync(HOSTS, "w");
    fs.writeSync(fd, "10.2.2.2 early.example.com\n");
    for (let i = 0; i < n; i += 1000) fs.writeSync(fd, filler.repeat(Math.min(1000, n - i)));
    fs.writeSync(fd, "10.3.3.3 late.example.com\n");
    fs.closeSync(fd);
    const t0 = Date.now();
    const r = await req("/__hosts?names=early.example.com,late.example.com");
    const ms = Date.now() - t0;
    assert.equal(r.status, 200);
    assert.equal(r.json.truncated, true);
    assert.equal(r.json.matches["early.example.com"][0].ip, "10.2.2.2");
    assert.deepEqual(r.json.matches["late.example.com"], [], "na de limiet niet gelezen");
    const o = await req("/__hosts");
    assert.ok(o.json.blocked > 50000 && o.json.blockedSample.length === 50, "overzicht blijft compact");
    assert.ok(o.text.length < 100000, `antwoord klein (${o.text.length} bytes)`);
    const t1 = Date.now(); await req("/__hosts?names=early.example.com"); const cached = Date.now() - t1;
    console.log(`        (eerste keer ${ms} ms, uit cache ${cached} ms, overzicht ${o.text.length} bytes)`);
    fs.writeFileSync(HOSTS, keep);
  });
  await test("de helper schrijft nooit naar het hosts-bestand", async () => {
    const sha = () => crypto.createHash("sha256").update(fs.readFileSync(HOSTS)).digest("hex");
    const before = { h: sha(), m: fs.statSync(HOSTS).mtimeMs };
    await req("/__hosts"); await req("/__hosts?names=a.example.com"); await req("/__hosts", { method: "POST", body: { names: ["x.example"] } });
    assert.deepEqual({ h: sha(), m: fs.statSync(HOSTS).mtimeMs }, before);
  });
  // ---------- Doel als hostnaam ----------
  await test("status meldt de uitbreidingen (features)", async () => {
    const r = await req(`/__status?nonce=${"ab".repeat(16)}`, { token: null, origin: null, marker: false });
    for (const f of ["hosts", "targets", "resolve"]) assert.ok(r.json.features.includes(f), f);
  });
  await test("/__resolve: systeem-resolver, alleen met geheim, strikte namen", async () => {
    assert.equal((await req("/__resolve", { method: "POST", body: { names: ["localhost"] }, token: null })).status, 403);
    assert.equal((await req("/__resolve", { method: "POST", body: { names: ["localhost"] }, origin: "https://evil.example" })).status, 403);
    const r = await req("/__resolve", { method: "POST", body: { names: ["localhost", "does-not-exist.invalid"] } });
    assert.equal(r.status, 200);
    assert.ok(r.json.results.localhost.ips.some((ip) => ip === "127.0.0.1" || ip === "::1"), JSON.stringify(r.json));
    assert.deepEqual(r.json.results["does-not-exist.invalid"].ips, []);
    assert.ok(r.json.results["does-not-exist.invalid"].error);
    for (const bad of [["*.x.nl"], ["1.2.3.4"], ["a b"], ["x.nl;id"], Array.from({ length: 51 }, (_, i) => `n${i}.example`), "localhost"]) {
      assert.equal((await req("/__resolve", { method: "POST", body: { names: bad } })).status, 400, JSON.stringify(bad).slice(0, 40));
    }
  });
  await test("/__rules accepteert een hostnaam als doel; de proxy verbindt via het opgezochte IP", async () => {
    const site = http.createServer((q, s) => s.end("hallo van " + q.headers.host));
    await new Promise((r) => site.listen(0, "127.0.0.1", r));
    const sport = site.address().port;
    try {
      const bad = await req("/__rules", { method: "POST", body: [{ host: "x.nl", ip: "*.evil.nl" }] });
      assert.equal(bad.status, 400);
      const ok = await req("/__rules", { method: "POST", body: [{ host: "staging.example.test", ip: "localhost" }] });
      assert.equal(ok.status, 200);
      // Gewoon HTTP-proxyverzoek (zoals Chrome dat via de PAC-regel doet).
      const body = await new Promise((res, rej) => {
        const r = http.request({ host: "127.0.0.1", port, method: "GET", path: `http://staging.example.test:${sport}/`, headers: { Host: `staging.example.test:${sport}` } },
          (resp) => { let d = ""; resp.on("data", (c) => (d += c)); resp.on("end", () => res(d)); });
        r.on("error", rej); r.end();
      });
      assert.equal(body, `hallo van staging.example.test:${sport}`);
      // CONNECT-tunnel (HTTPS-pad) naar dezelfde hostnaam.
      const tunnel = await new Promise((res, rej) => {
        const sock = net.connect(port, "127.0.0.1", () => sock.write(`CONNECT staging.example.test:${sport} HTTP/1.1\r\nHost: staging.example.test:${sport}\r\n\r\n`));
        let d = "";
        sock.on("data", (c) => {
          d += c;
          if (d.includes("\r\n\r\n") && !d.includes("hallo")) sock.write(`GET / HTTP/1.1\r\nHost: tunnel.test\r\nConnection: close\r\n\r\n`);
        });
        sock.on("end", () => res(d)); sock.on("error", rej);
      });
      assert.match(tunnel, /^HTTP\/1\.1 200 Connection Established/); assert.match(tunnel, /hallo van tunnel\.test/);
      // Onvindbaar doel: nette 502, geen verbinding naar iets anders.
      await req("/__rules", { method: "POST", body: [{ host: "gone.example.test", ip: "does-not-exist.invalid" }] });
      const gone = await new Promise((res) => {
        const r = http.request({ host: "127.0.0.1", port, method: "GET", path: `http://gone.example.test:${sport}/`, headers: { Host: "gone.example.test" } }, (resp) => res(resp.statusCode));
        r.end();
      });
      assert.equal(gone, 502);
    } finally { site.close(); await req("/__rules", { method: "POST", body: [] }); }
  });
} finally {
  helper.kill();
}

await test("zonder config.json: 403 met error 'setup'", async () => {
  helper = await startHelper(false);
  try {
    const r = await req("/__hosts");
    assert.equal(r.status, 403); assert.equal(r.json.error, "setup");
  } finally { helper.kill(); }
});
await test("HOST_OVERRIDE_HOSTS_FILE komt alleen uit de omgeving van de helper", () => {
  const src = fs.readFileSync(path.join(EXT, "helper", "proxy.js"), "utf8") + fs.readFileSync(path.join(EXT, "helper", "dnstools.js"), "utf8");
  assert.equal((src.match(/HOST_OVERRIDE_HOSTS_FILE/g) || []).length, 3, "alleen in dnstools.js (commentaar + process.env)");
  for (const f of ["setup.sh", "setup.ps1"]) assert.ok(!fs.readFileSync(path.join(EXT, "helper", f), "utf8").includes("HOST_OVERRIDE_HOSTS_FILE"));
  for (const f of fs.readdirSync(EXT).filter((x) => x.endsWith(".js"))) assert.ok(!fs.readFileSync(path.join(EXT, f), "utf8").includes("HOST_OVERRIDE_HOSTS_FILE"), f);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} geslaagd, ${failed} mislukt`);
process.exit(failed ? 1 : 0);

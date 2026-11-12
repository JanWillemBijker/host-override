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

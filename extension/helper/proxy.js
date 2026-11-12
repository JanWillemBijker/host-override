// Host Override proxy
// Lokale forward-proxy die verbindingen voor gekoppelde domeinen naar een ander IP stuurt.
// Hostnaam, SNI en Host-header blijven gelijk, dus HTTPS werkt met het gewone certificaat.
// Geen dependencies. Regels worden bewaard in ~/.host-override/rules.json.
"use strict";
const http = require("http");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const dns = require("dns");

let tools = null; // DNS-tools (dnstools.js), optioneel naast proxy.js
try { tools = require("./dnstools.js"); } catch { /* oudere installatie: DNS-pagina meldt dat een update nodig is */ }

const HELPER_VERSION = 6; // 6: gedeeld geheim (token) + HMAC-bewijs in /__status, /__hosts (hosts-bestand lezen)
// Uitbreidingen binnen protocol 6 (de extensie ziet in /__status welke er zijn):
// targets = doel mag een hostnaam zijn, resolve = /__resolve
const FEATURES = ["hosts", "targets", "resolve"];
const PORT = Number(process.env.PORT || 8899);
const DIR = path.join(os.homedir(), ".host-override");
const FILE = path.join(DIR, "rules.json");
const CONFIG = path.join(DIR, "config.json");

// Strikte hostnaam-controle (zelfde regel als de extensie): labels a-z, 0-9, -, optioneel "*." vooraan.
const HOST_RE = /^(\*\.)?(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/i;
const isHost = (h) => typeof h === "string" && h.length <= 255 && HOST_RE.test(h);
// Doel als hostnaam: geen wildcard, max 253, laatste label bevat een letter (zelfde regel als de extensie).
const isTargetHost = (h) => typeof h === "string" && h.length <= 253 && !h.startsWith("*.") && HOST_RE.test(h) && /[a-z]/i.test(h.slice(h.lastIndexOf(".") + 1));
const isTarget = (t) => typeof t === "string" && (net.isIP(t) > 0 || isTargetHost(t));

// Wie de helper mag aansturen. Het setup-commando uit de extensie schrijft config.json met het ID van die
// extensie en een willekeurig geheim (32 bytes, hex) dat alleen de extensie en deze helper kennen.
// Fail closed: zonder geldige config.json (ontbreekt, kapot, geen geheim) worden alle opdrachten geweigerd.
const SECRET_RE = /^[0-9a-f]{64}$/;
const ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;
let config = null; // { origins: [...], secret: Buffer }
function loadConfig() {
  config = null;
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8").replace(/^\uFEFF/, ""));
    const origins = (Array.isArray(cfg.origins) ? cfg.origins : []).filter((o) => typeof o === "string" && ORIGIN_RE.test(o));
    const secret = typeof cfg.secret === "string" ? cfg.secret.toLowerCase() : "";
    if (origins.length && SECRET_RE.test(secret)) config = { origins, secret: Buffer.from(secret, "utf8") };
  } catch { /* geen of kapotte config: alles weigeren */ }
}

// Bestanden in ~/.host-override alleen voor de eigen gebruiker (map 0700, bestanden 0600).
function tightenPerms() {
  if (process.platform === "win32") return; // gebruikersprofiel is al privé
  try {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.chmodSync(DIR, 0o700);
    for (const f of fs.readdirSync(DIR)) {
      const full = path.join(DIR, f);
      try { if (fs.lstatSync(full).isFile()) fs.chmodSync(full, 0o600); } catch { /* overslaan */ }
    }
  } catch (e) { console.error("Kon rechten van", DIR, "niet aanscherpen:", e.message); }
}

let rules = []; // [{host, ip}]

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (valid(parsed)) rules = parsed;
  } catch { /* geen bestand of kapot: begin leeg */ }
}

function save() {
  try {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(FILE, JSON.stringify(rules, null, 2), { mode: 0o600 });
    if (process.platform !== "win32") fs.chmodSync(FILE, 0o600); // bestaand bestand houdt anders zijn oude rechten
  } catch (e) { console.error("Kon regels niet opslaan:", e.message); }
}

function valid(list) {
  return Array.isArray(list) && list.length <= 5000 && list.every((r) => r && isHost(r.host) && isTarget(r.ip));
}

// ---------- Doel als hostnaam: opzoeken via de systeem-resolver, ~60 s gecachet ----------
// (dns.lookup gebruikt de resolver van het besturingssysteem, inclusief het hosts-bestand.)
const RESOLVE_TTL = 60 * 1000, RESOLVE_FAIL_TTL = 10 * 1000;
const resolveCache = new Map(); // naam -> { ips, error, exp, at }
const inflight = new Map();
function resolveName(name) {
  name = name.toLowerCase();
  const c = resolveCache.get(name);
  if (c && c.exp > Date.now()) return Promise.resolve(c);
  if (inflight.has(name)) return inflight.get(name);
  const p = new Promise((resolve) => {
    dns.lookup(name, { all: true, verbatim: true }, (err, addrs) => {
      const now = Date.now();
      const v = err || !addrs?.length
        ? { ips: [], error: err ? err.code || err.message : "geen adres", exp: now + RESOLVE_FAIL_TTL, at: now }
        : { ips: [...new Set(addrs.map((a) => a.address))].slice(0, 8), error: null, exp: now + RESOLVE_TTL, at: now };
      resolveCache.set(name, v);
      if (resolveCache.size > 500) resolveCache.delete(resolveCache.keys().next().value);
      inflight.delete(name);
      resolve(v);
    });
  });
  inflight.set(name, p);
  return p;
}
// Doel van een regel controleren: IP's direct, hostnamen via de cache. Gooit een fout als het niet lukt.
async function targetIp(target) {
  if (net.isIP(target)) return target;
  const r = await resolveName(target);
  if (!r.ips.length) throw new Error(`${target}: ${r.error}`);
  return r.ips[0];
}
// lookup-functie voor net.connect/http.request: zelfde cache, alle adressen (Node probeert IPv6 en IPv4,
// autoSelectFamily), zodat een doel als "localhost" of een dual-stack-server gewoon werkt.
function cachedLookup(hostname, opts, cb) {
  if (typeof opts === "function") { cb = opts; opts = {}; }
  resolveName(hostname).then((r) => {
    if (!r.ips.length) return cb(Object.assign(new Error(r.error || "ENOTFOUND"), { code: "ENOTFOUND" }));
    const list = r.ips.map((address) => ({ address, family: net.isIP(address) }));
    if (opts && opts.all) cb(null, list); else cb(null, list[0].address, list[0].family);
  });
}

function lookup(hostname) {
  const h = hostname.toLowerCase();
  for (const r of rules) {
    const p = r.host.toLowerCase();
    if (p.startsWith("*.")) {
      const base = p.slice(2);
      if (h === base || h.endsWith("." + base)) return r.ip;
    } else if (h === p) return r.ip;
  }
  return null;
}

function splitHostPort(s, defPort) {
  const m = s.match(/^\[(.+)\](?::(\d+))?$/) || s.match(/^([^:]+)(?::(\d+))?$/);
  return m ? { host: m[1], port: Number(m[2] || defPort) } : null;
}

// Alleen de extensie mag regels lezen of zetten, niet een website of een ander programma op deze computer.
// - Het geheim uit config.json moet meekomen in X-Host-Override-Token (de echte controle; headers zijn
//   door elk lokaal programma na te maken, het geheim niet).
// - Origin moet de eigen extensie zijn (websites kunnen geen chrome-extension://-origin sturen).
// - De eigen header dwingt bij cross-origin verzoeken een CORS-preflight af, die hier nooit slaagt.
// - De Host-header moet 127.0.0.1/localhost zijn (tegen DNS-rebinding).
function tokenOk(req) {
  if (!config) return false;
  const got = Buffer.from(String(req.headers["x-host-override-token"] || ""), "utf8");
  return got.length === config.secret.length && crypto.timingSafeEqual(got, config.secret);
}
function fromExtension(req) {
  return !!config && config.origins.includes(req.headers.origin || "") && localHost(req) &&
    req.headers["x-host-override"] === "1" && tokenOk(req);
}
// Antwoord bij geweigerde opdracht. "setup" = helper heeft geen (geldige) config: setup-commando opnieuw plakken.
function deny(res) {
  res.writeHead(403, { "Content-Type": "application/json" }).end(JSON.stringify({ error: config ? "forbidden" : "setup" }));
}
function localHost(req) {
  return [`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(String(req.headers.host || "").toLowerCase());
}

function control(req, res) {
  if (!fromExtension(req)) return deny(res);
  if (req.method === "GET") { res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(rules)); return; }
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on("end", () => {
    try {
      const parsed = JSON.parse(body);
      if (!valid(parsed)) throw new Error("bad rules");
      rules = parsed.map(({ host, ip }) => ({ host, ip }));
      save();
      console.log(new Date().toISOString(), "Regels:", rules.map((r) => `${r.host} -> ${r.ip}`).join(", ") || "(geen)");
      res.writeHead(200).end("ok");
    } catch { res.writeHead(400).end("bad request"); }
  });
}

// ---------- Apart Chrome-venster starten ----------

function resolverRules(list) {
  const parts = [];
  for (const r of list) {
    const ip = r.ip.includes(":") ? `[${r.ip}]` : r.ip;
    if (r.host.startsWith("*.")) parts.push(`MAP ${r.host.slice(2)} ${ip}`, `MAP ${r.host} ${ip}`);
    else parts.push(`MAP ${r.host} ${ip}`);
  }
  return [...new Set(parts)].join(", ");
}

function findChrome() {
  if (process.platform === "darwin") return { cmd: "open", pre: ["-na", "Google Chrome", "--args"] };
  const candidates = [];
  if (process.platform === "win32") {
    for (const base of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]) {
      if (base) candidates.push(path.join(base, "Google", "Chrome", "Application", "chrome.exe"));
    }
    const hit = candidates.find((c) => fs.existsSync(c));
    return hit ? { cmd: hit, pre: [] } : null;
  }
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    for (const dir of (process.env.PATH || "").split(path.delimiter)) {
      const full = path.join(dir, name);
      if (dir && fs.existsSync(full)) return { cmd: full, pre: [] };
    }
  }
  return null;
}

function launch(req, res) {
  const reply = (code, obj) => res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(obj));
  if (!fromExtension(req)) return deny(res);
  if (req.method !== "POST") return reply(405, { error: "POST verwacht" });
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on("end", () => {
    let data;
    try { data = JSON.parse(body); } catch { return reply(400, { error: "ongeldige invoer" }); }
    const list = data.rules;
    if (!Array.isArray(list) || list.length === 0 || list.length > 500 ||
        !list.every((r) => r && isHost(r.host) && isTarget(r.ip))) {
      return reply(400, { error: "geen geldige regels" });
    }
    let url = null;
    if (data.url) {
      try {
        const u = new URL(data.url);
        // Alleen origin + pad: geen query of fragment (tokens e.d.) in de argumenten van Chrome (zichtbaar in ps).
        if (u.protocol === "http:" || u.protocol === "https:") url = u.origin + u.pathname;
      } catch { /* geen url */ }
    }
    const chrome = findChrome();
    if (!chrome) return reply(404, { error: "Chrome niet gevonden" });
    const args = [
      ...chrome.pre,
      "--no-first-run", "--no-default-browser-check",
      `--user-data-dir=${path.join(os.homedir(), "chrome-test")}`,
      `--host-resolver-rules=${resolverRules(list)}`,
      ...(url ? [url] : []),
    ];
    if (process.env.HO_DRY_LAUNCH) return reply(200, { ok: true, dry: true, cmd: chrome.cmd, args });
    const child = spawn(chrome.cmd, args, { detached: true, stdio: "ignore" });
    child.once("error", (e) => reply(500, { error: e.message }));
    child.once("spawn", () => { child.unref(); reply(200, { ok: true }); });
  });
}

// ---------- DNS-tools voor de extensie ----------
const DNS_API = {
  async "/__dns"(d) {
    if (typeof d.name !== "string" || d.name.length > 253) throw new Error("ongeldige naam");
    if (d.server && d.server !== "system" && !net.isIP(d.server)) throw new Error("ongeldige server");
    return tools.query(d.name, d.type, { server: d.server, rd: d.rd !== false });
  },
  async "/__trace"(d) {
    if (typeof d.name !== "string" || d.name.length > 253) throw new Error("ongeldige naam");
    return tools.trace(d.name);
  },
  // Doel-hostnamen opzoeken zoals de proxy dat doet (systeem-resolver, zelfde cache).
  async "/__resolve"(d) {
    if (!Array.isArray(d.names) || d.names.length > 50 || !d.names.every(isTargetHost)) throw new Error("ongeldige namen");
    const results = {};
    await Promise.all(d.names.map(async (n) => {
      const r = await resolveName(n);
      results[n] = { ips: r.ips, error: r.error, age: Math.round((Date.now() - r.at) / 1000) };
    }));
    return { results };
  },
  async "/__check"(d) {
    if (!isHost(d.host) || d.host.startsWith("*.") || typeof d.ip !== "string" || !net.isIP(d.ip)) throw new Error("ongeldige invoer");
    return tools.check(d.host, d.ip);
  },
};

function dnsApi(req, res) {
  const reply = (code, obj) => res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(obj));
  if (!fromExtension(req)) return deny(res);
  if (!tools && req.url.split("?")[0] !== "/__resolve") return reply(501, { error: "DNS-tools ontbreken, werk de helper bij" });
  if (req.method !== "POST") return reply(405, { error: "POST verwacht" });
  const handler = DNS_API[req.url.split("?")[0]];
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on("end", async () => {
    try { reply(200, await handler(JSON.parse(body || "{}"))); }
    catch (e) { reply(400, { error: e.message }); }
  });
}

// ---------- Hosts-bestand (alleen lezen) ----------
// GET /__hosts?names=a.nl,b.nl -> alleen de treffers voor die namen (max 50).
// GET /__hosts                 -> compact overzicht (overrides, aantal blokkeringen).
// POST met {"names": [...]} (of {} voor het overzicht) doet hetzelfde; de extensie gebruikt POST, omdat Chrome
// bij GET vanuit een extensie geen Origin-header meestuurt. Zelfde controles als de andere opdrachten (geheim, Origin, Host).
// Het pad is vast (/etc/hosts of %SystemRoot%\System32\drivers\etc\hosts); de extensie kan het niet kiezen.
const HOSTS_NAME_RE = /^(?!-)[a-z0-9_-]{1,63}(?<!-)(\.(?!-)[a-z0-9_-]{1,63}(?<!-))*$/;
function parseNames(list) {
  if (list == null) return null;
  if (!Array.isArray(list) || list.length > 50) throw new Error("ongeldige namen");
  const out = [];
  for (const raw of list) {
    const n = String(raw).trim().toLowerCase().replace(/\.$/, "");
    if (n.length > 253 || !HOSTS_NAME_RE.test(n)) throw new Error("ongeldige naam");
    if (!out.includes(n)) out.push(n);
  }
  return out;
}
function hostsApi(req, res) {
  const reply = (code, obj) => res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(obj));
  if (!fromExtension(req)) return deny(res);
  if (!tools || !tools.hosts) return reply(501, { error: "hosts-tools ontbreken, werk de helper bij" });
  const run = async (names) => {
    try { reply(200, await tools.hosts(parseNames(names))); }
    catch (e) { reply(400, { error: e.message }); }
  };
  if (req.method === "GET") {
    const q = new URL(req.url, "http://x").searchParams.get("names");
    return run(q == null ? null : q.split(",").filter(Boolean));
  }
  if (req.method !== "POST") return reply(405, { error: "GET of POST verwacht" });
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on("end", () => {
    let d;
    try { d = JSON.parse(body || "{}"); } catch { return reply(400, { error: "ongeldige invoer" }); }
    run(d.names);
  });
}

// Status zonder token: versie, of er een geldige config is, en een bewijs dat deze helper het geheim kent.
// De extensie stuurt een willekeurige nonce en controleert proof = HMAC-SHA256(geheim, "host-override/status:" + nonce)
// voordat ze het geheim of regels stuurt. Een ander programma op poort 8899 kan dat bewijs niet leveren.
function status(req, res) {
  const nonce = new URL(req.url, "http://x").searchParams.get("nonce") || "";
  const out = { helper: HELPER_VERSION, configured: !!config, features: FEATURES };
  if (config && /^[0-9a-f]{32,128}$/.test(nonce)) {
    out.proof = crypto.createHmac("sha256", config.secret).update("host-override/status:" + nonce).digest("hex");
  }
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(out));
}

// Proxy-verkeer: domeinen met een regel mogen elke poort gebruiken (het IP geldt voor alle poorten van dat domein),
// overige hosts alleen 80/443/8443. Zo is de helper geen open doorgeefluik naar willekeurige poorten.
const OPEN_PORTS = new Set([80, 443, 8443]);
const portAllowed = (host, port) => Number.isInteger(port) && port > 0 && port < 65536 && (OPEN_PORTS.has(port) || lookup(host) !== null);
const IDLE_MS = 5 * 60 * 1000;

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/__rules")) return control(req, res);
  if (req.url.startsWith("/__launch")) return launch(req, res);
  if (Object.hasOwn(DNS_API, req.url.split("?")[0])) return dnsApi(req, res);
  if (req.url.split("?")[0] === "/__hosts") return hostsApi(req, res);
  // Eigen pagina's (geen proxy-verzoek): alleen via 127.0.0.1/localhost, niet via een herbonden domeinnaam.
  if (req.url.startsWith("/") && !localHost(req)) { res.writeHead(403).end("forbidden"); return; }
  if (req.url.split("?")[0] === "/__status") return status(req, res);
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Host Override proxy draait (versie ${HELPER_VERSION}).${config ? "" : " Niet ingesteld: plak het setup-commando uit de extensie."}\n`);
    return;
  }
  let u;
  try { u = new URL(req.url); } catch { res.writeHead(400).end("proxy only"); return; }
  if (u.protocol !== "http:") { res.writeHead(400).end("proxy only"); return; }
  const port = Number(u.port || 80);
  if (!portAllowed(u.hostname, port)) { res.writeHead(403).end("port not allowed"); return; }
  const mapped = lookup(u.hostname);
  (mapped ? targetIp(mapped) : Promise.resolve(u.hostname)).then(() => {
    const target = mapped || u.hostname;
    const out = http.request(
      { host: target, port, method: req.method, path: u.pathname + u.search, headers: req.headers, ...(mapped ? { lookup: cachedLookup } : {}) },
      (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }
    );
    out.setTimeout(IDLE_MS, () => out.destroy(new Error("timeout")));
    out.on("error", (e) => { if (!res.headersSent) res.writeHead(502); res.end("upstream error: " + e.message); });
    req.pipe(out);
  }, (e) => { res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" }).end("Host Override: doel niet gevonden (" + e.message + ")"); });
});
server.maxConnections = 512;
server.headersTimeout = 30 * 1000;
server.requestTimeout = 0; // lange uploads via de proxy mogen; inactiviteit vangt setTimeout hieronder af
server.setTimeout(IDLE_MS);

server.on("connect", (req, client, head) => {
  const hp = splitHostPort(req.url, 443);
  if (!hp) { client.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
  if (!portAllowed(hp.host, hp.port)) { client.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
  const mapped = lookup(hp.host);
  if (mapped && !net.isIP(mapped)) {
    client.pause();
    targetIp(mapped).then(() => { client.resume(); tunnel(client, head, hp.port, mapped, cachedLookup); },
      () => client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
    return;
  }
  tunnel(client, head, hp.port, mapped || hp.host);
});

function tunnel(client, head, port, target, lookup) {
  const upstream = net.connect({ port, host: target, timeout: 15 * 1000, ...(lookup ? { lookup, autoSelectFamily: true } : {}) }, () => {
    upstream.setTimeout(IDLE_MS);
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  const close = () => { upstream.destroy(); client.destroy(); };
  client.setTimeout(IDLE_MS, close);
  upstream.on("timeout", close);
  upstream.on("error", close);
  upstream.on("close", close);
  client.on("error", close);
  client.on("close", close);
}

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error(`Poort ${PORT} is al in gebruik. Draait de proxy al?`);
  else console.error(e);
  process.exit(1);
});

tightenPerms();
load();
loadConfig();
server.listen(PORT, "127.0.0.1", () => console.log(`Host Override proxy op 127.0.0.1:${PORT} (${rules.length} regels geladen, ${config ? "alleen " + config.origins.join(", ") + " met geheim" : "GEEN geldige config.json: alle opdrachten worden geweigerd, plak het setup-commando opnieuw"})`));

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
// check2 = /__check met detail (redirectketen, headers, certificaat www), crtsh = /__crtsh, rdap = /__rdap
// pair = eenmalig koppelen met een koppelcode van 12 tekens (/__pair), alleen in een koppelvenster (--pair of eerste start van de binary)
const FEATURES = ["hosts", "targets", "resolve", "check2", "crtsh", "rdap", "pair"];
// Draait dit als losse binary (Node Single Executable Application) of als `node proxy.js`?
const IS_BIN = (() => { try { return require("node:sea").isSea(); } catch { return false; } })();
const ARGS = process.argv.slice(2); // ook in de binary: argv = [binary, binary, ...opties]
const PORT = Number(process.env.PORT || 8899);
const DIR = path.join(os.homedir(), ".host-override");
const FILE = path.join(DIR, "rules.json");
const CONFIG = path.join(DIR, "config.json");

// Strikte hostnaam-controle (zelfde regel als de extensie): labels a-z, 0-9, -, optioneel "*." vooraan.
const HOST_RE = /^(\*\.)?(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/i;
const isHost = (h) => typeof h === "string" && h.length <= 255 && HOST_RE.test(h);
// Doel als hostnaam: geen wildcard, max 253, laatste label bevat een letter (zelfde regel als de extensie).
const isTargetHost = (h) => typeof h === "string" && h.length <= 253 && !h.startsWith("*.") && HOST_RE.test(h) &&
  (h.includes(".") || h.toLowerCase() === "localhost") && /[a-z]/i.test(h.slice(h.lastIndexOf(".") + 1));
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
    return tools.check(d.host, d.ip, { detail: d.detail === true });
  },
  // Subdomeinen via Certificate Transparency (crt.sh). Alleen op klik vanuit de migratie-check.
  async "/__crtsh"(d) {
    if (!isHost(d.domain) || d.domain.startsWith("*.") || !d.domain.includes(".")) throw new Error("ongeldig domein");
    return tools.crtsh(d.domain.toLowerCase());
  },
  // Registratiegegevens via RDAP (registrar, verloopdatum, DNSSEC, locks).
  async "/__rdap"(d) {
    if (!isHost(d.domain) || d.domain.startsWith("*.") || !d.domain.includes(".")) throw new Error("ongeldig domein");
    return tools.rdap(d.domain.toLowerCase());
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

// ---------- Eenmalig koppelen (pairing) ----------
// Alleen tijdens een koppelvenster: de helper is in de voorgrond gestart (eerste start van de binary of --pair) en
// toont een willekeurige koppelcode van 12 tekens (Crockford-base32, 60 bits, als XXXX-XXXX-XXXX). De gebruiker typt
// die code in de extensie. Daarna (zie extension/pair.js):
//   1. hello:  extensie stuurt nonce nE; de helper antwoordt met nH en proof = HMAC(kProof, "ho-pair-proof|nE|nH").
//              Zo bewijst de helper EERST dat hij de code kent; een ander programma op de poort krijgt niets.
//   2. finish: de extensie stuurt het geheim versleuteld (AES-256-GCM, sleutel uit de code, AAD met nE, nH en Origin).
//              Lukt ontsleutelen, dan kende de extensie de code; het extensie-ID komt uit de Origin-header.
// Sleutels: k0 = PBKDF2-SHA256(code, "ho-pair-v1|"+nE, 600.000), kProof/kEnc via HKDF. De code heeft 60 bits entropie:
// een onderschept bewijs offline kraken kost 2^60 PBKDF2-berekeningen en is dus onhaalbaar.
// Limieten: code 5 minuten geldig, één geslaagde koppeling, max. 5 hello's (pogingen) per code, elke sessie één finish
// binnen 60 s.
// Zelfde controles als de andere opdrachten: Host 127.0.0.1/localhost, Origin chrome-extension://, X-Host-Override.
// Schrijft config.json atomisch met rechten 0600 (map 0700). Zonder koppelvenster: 410, nooit stil koppelen.
const PAIR_TTL = Number(process.env.HOST_OVERRIDE_PAIR_TTL) > 0 ? Number(process.env.HOST_OVERRIDE_PAIR_TTL) : 5 * 60 * 1000;
const PAIR_MAX_TRIES = 5;
const PAIR_SESSION_MS = 60 * 1000; // ruim, zodat PBKDF2 op een trage machine past
const PAIR_ITERATIONS = 600000; // zelfde waarde als extension/pair.js
const HEX32 = /^[0-9a-f]{32}$/;
let pairing = null; // { code: Buffer, exp, tries, file }
let onPaired = null; // callback na geslaagd koppelen (installeren als dienst e.d.)
// Crockford-base32 (zonder I, L, O, U): 12 tekens x 5 bits = 60 bits. Bij invoer worden O->0 en I/L->1 gelezen
// (Crockford), dus verwarrende tekens kunnen niet fout gaan. Met 2^60 mogelijke codes is een onderschept bewijs
// (PBKDF2 600.000 iteraties per poging) offline niet te kraken.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;
const newCode = () => Array.from({ length: 12 }, () => CODE_ALPHABET[crypto.randomInt(0, 32)]).join("");
function openPairing() {
  const code = newCode();
  pairing = { code: Buffer.from(code), exp: Date.now() + PAIR_TTL, tries: 0, file: false, sessions: new Map() };
  return code;
}
// Koppelverzoek via ~/.host-override/pair.json: als de helper al als dienst draait (poort bezet), schrijft een in de
// voorgrond gestarte helper daar een code met vervaltijd. Alleen een privé bestand (0600, eigen gebruiker) telt;
// wie dat kan schrijven, kan ook config.json schrijven, dus dit geeft niemand meer rechten.
const PAIR_FILE = path.join(DIR, "pair.json");
function filePairing() {
  try {
    const st = fs.lstatSync(PAIR_FILE);
    const priv = st.isFile() && (process.platform === "win32" || ((st.mode & 0o077) === 0 && st.uid === process.getuid()));
    const d = priv ? JSON.parse(fs.readFileSync(PAIR_FILE, "utf8")) : null;
    if (!d || typeof d.code !== "string" || !CODE_RE.test(d.code) || !(d.exp > Date.now()) || d.exp > Date.now() + PAIR_TTL + 5000) {
      fs.rmSync(PAIR_FILE, { force: true });
      return null;
    }
    return { code: Buffer.from(d.code), exp: d.exp, tries: 0, file: true, sessions: new Map() };
  } catch { return null; }
}
function currentPairing() {
  if (pairing && !pairing.file) { if (Date.now() < pairing.exp) return pairing; pairing = null; return null; }
  const f = filePairing();
  if (!f) { pairing = null; return null; }
  if (!pairing || !pairing.code.equals(f.code)) pairing = f; // nieuw verzoek; foute pogingen tellen per code
  return pairing;
}
function closePairing() {
  if (pairing?.file) fs.rmSync(PAIR_FILE, { force: true });
  pairing = null;
}
function writeConfig(origin, secret) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(DIR, 0o700);
  const tmp = path.join(DIR, `.config.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  const fd = fs.openSync(tmp, "wx", 0o600);
  try { fs.writeSync(fd, JSON.stringify({ origins: [origin], secret }) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, CONFIG);
  if (process.platform !== "win32") fs.chmodSync(CONFIG, 0o600);
}
function pairKeys(code, nE, nH) {
  return new Promise((res, rej) => crypto.pbkdf2(code, "ho-pair-v1|" + nE, PAIR_ITERATIONS, 32, "sha256", (err, k0) => {
    if (err) return rej(err);
    res({
      proof: Buffer.from(crypto.hkdfSync("sha256", k0, Buffer.from(nE, "hex"), "ho-pair-proof", 32)),
      enc: Buffer.from(crypto.hkdfSync("sha256", k0, Buffer.from(nE + nH, "hex"), "ho-pair-enc", 32)),
    });
  }));
}
function pair(req, res) {
  const reply = (code, obj) => res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(obj));
  const origin = String(req.headers.origin || "");
  if (!ORIGIN_RE.test(origin) || req.headers["x-host-override"] !== "1") return reply(403, { error: "forbidden" });
  if (req.method !== "POST") return reply(405, { error: "POST verwacht" });
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 4096) req.destroy(); });
  req.on("end", async () => {
    const p = currentPairing();
    if (!p) return reply(410, { error: "no-pairing" });
    let d;
    try { d = JSON.parse(body); } catch { return reply(400, { error: "ongeldige invoer" }); }
    if (!d || typeof d !== "object" || !HEX32.test(d.nonce || "")) return reply(400, { error: "ongeldige invoer" });
    const now = Date.now();
    for (const [k, v] of p.sessions) if (v.exp < now) p.sessions.delete(k);

    if (d.step === "hello") {
      if (p.tries >= PAIR_MAX_TRIES) { closePairing(); return reply(410, { error: "no-pairing" }); }
      p.tries++; // elke hello is een poging: een bewijs mag maar beperkt vaak worden opgevraagd
      const nH = crypto.randomBytes(16).toString("hex");
      let k;
      try { k = await pairKeys(p.code, d.nonce, nH); } catch { return reply(500, { error: "crypto" }); }
      if (pairing !== p) return reply(410, { error: "no-pairing" }); // intussen gesloten
      p.sessions.set(nH, { nE: d.nonce, enc: k.enc, exp: Date.now() + PAIR_SESSION_MS, origin });
      const proof = crypto.createHmac("sha256", k.proof).update(`ho-pair-proof|${d.nonce}|${nH}`).digest("hex");
      return reply(200, { helperNonce: nH, proof, left: PAIR_MAX_TRIES - p.tries });
    }

    if (d.step === "finish") {
      const s = HEX32.test(d.helperNonce || "") ? p.sessions.get(d.helperNonce) : null;
      if (s) p.sessions.delete(d.helperNonce); // elke sessie één finish
      const fail = (code, error) => {
        if (p.tries >= PAIR_MAX_TRIES && !p.sessions.size) { closePairing(); console.log("Te veel pogingen: koppelen gestopt. Start opnieuw voor een nieuwe code."); }
        return reply(code, { error });
      };
      if (!s || s.nE !== d.nonce || s.origin !== origin) return fail(403, "session");
      if (!/^[0-9a-f]{24}$/.test(d.iv || "") || !/^([0-9a-f]{2}){17,256}$/.test(d.data || "")) return fail(400, "ongeldige invoer");
      let secret;
      try {
        const data = Buffer.from(d.data, "hex");
        const dec = crypto.createDecipheriv("aes-256-gcm", s.enc, Buffer.from(d.iv, "hex"));
        dec.setAAD(Buffer.from(`ho-pair-secret|${d.nonce}|${d.helperNonce}|${origin}`));
        dec.setAuthTag(data.subarray(data.length - 16));
        secret = Buffer.concat([dec.update(data.subarray(0, data.length - 16)), dec.final()]).toString("utf8").toLowerCase();
      } catch { return fail(403, "code"); }
      if (!SECRET_RE.test(secret)) return fail(400, "ongeldige invoer");
      closePairing(); // eenmalig
      try { writeConfig(origin, secret); } catch (e) { console.error("Kon config.json niet schrijven:", e.message); return reply(500, { error: "config" }); }
      loadConfig();
      console.log(`Gekoppeld met ${origin}.`);
      reply(200, { ok: true });
      if (onPaired) setImmediate(onPaired);
      return;
    }
    return reply(400, { error: "ongeldige invoer" });
  });
}

// Status zonder token: versie, of er een geldige config is, en een bewijs dat deze helper het geheim kent.
// De extensie stuurt een willekeurige nonce en controleert proof = HMAC-SHA256(geheim, "host-override/status:" + nonce)
// voordat ze het geheim of regels stuurt. Een ander programma op poort 8899 kan dat bewijs niet leveren.
function status(req, res) {
  const nonce = new URL(req.url, "http://x").searchParams.get("nonce") || "";
  const out = { helper: HELPER_VERSION, configured: !!config, features: FEATURES, kind: IS_BIN ? "bin" : "node",
    pairing: !!currentPairing() };
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
  if (req.url.split("?")[0] === "/__pair") return pair(req, res);
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
const sockets = new Set();
server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
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

// ---------- Starten ----------
// node proxy.js            -> helper draaien (zoals het setup-commando en de LaunchAgent/systemd/Opstarten doen)
// binary zonder opties     -> instellen: koppelen met een nieuwe code, daarna als dienst installeren (zie setup())
// --serve                  -> alleen draaien (zo start de dienst de binary)
// --pair                   -> draaien met een koppelvenster (nieuwe code), ook als er al een config is
// --install / --uninstall  -> automatisch starten bij inloggen aan- of uitzetten (service.js)
function start({ pairMode = false } = {}) {
  tightenPerms();
  load();
  loadConfig();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Host Override proxy op 127.0.0.1:${PORT} (${rules.length} regels geladen, ${config ? "alleen " + config.origins.join(", ") + " met geheim" : "GEEN geldige config.json: alle opdrachten worden geweigerd" + (pairMode ? "" : ", koppel de helper opnieuw")})`);
    if (pairMode) showCode(openPairing());
  });
}
function showCode(code) {
  const spaced = code.match(/.{4}/g).join("-");
  console.log("");
  console.log("  ┌─────────────────────────────────────────────────┐");
  console.log(`  │   Koppelcode / pairing code:  ${spaced}    │`);
  console.log("  └─────────────────────────────────────────────────┘");
  console.log("  Typ deze code in de extensie (Host Override > Koppel helper). Geldig 5 minuten, één keer.");
  console.log("  Type this code into the extension (Host Override > Connect helper). Valid 5 minutes, once.");
  console.log("");
}
const has = (f) => ARGS.includes(f);
if (has("--version")) {
  console.log(`Host Override helper (protocol ${HELPER_VERSION}${IS_BIN ? ", binary" : ""}, Node ${process.versions.node})`);
} else if (has("--help") || has("-h")) {
  console.log("Host Override helper\n  (geen optie)  instellen: koppelen en automatisch starten bij inloggen\n  --pair        nieuwe koppelcode (ook als de helper al gekoppeld is)\n  --serve       alleen draaien\n  --install     automatisch starten bij inloggen\n  --uninstall   automatisch starten uitzetten en ~/.host-override verwijderen\n  --version     versie");
} else if (has("--install") || has("--uninstall")) {
  const svc = loadService();
  if (!svc) process.exit(1);
  try { has("--install") ? svc.install() : svc.uninstall(); } catch (e) { console.error(e.message); process.exit(1); }
} else if (has("--serve") || (!IS_BIN && !has("--pair"))) {
  start();
} else if (has("--pair")) {
  start({ pairMode: true }); // koppelvenster; blijft daarna gewoon draaien
} else {
  setup(); // binary zonder opties
}

// Instellen (binary zonder opties): altijd koppelen met een nieuwe code (ook bij bijwerken: zo kan een andere
// extensie of een verlopen geheim nooit stil blijven hangen), daarna kopiëren naar ~/.host-override/bin en
// automatisch laten starten. Draait er al een helper met koppel-ondersteuning, dan loopt het koppelen via die
// helper (pair.json); anders stopt de oude dienst en draait deze helper zelf tot er gekoppeld is.
async function setup() {
  const svc = loadService();
  if (!svc) process.exit(1);
  const running = await probe();
  if (running?.features?.includes("pair")) {
    const id = () => { try { const st = fs.statSync(CONFIG); return `${st.ino}:${st.mtimeMs}`; } catch { return ""; } };
    const before = id();
    const code = newCode();
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.rmSync(PAIR_FILE, { force: true });
    fs.writeFileSync(PAIR_FILE, JSON.stringify({ code, exp: Date.now() + PAIR_TTL }), { mode: 0o600, flag: "wx" });
    showCode(code);
    const t0 = Date.now();
    while (Date.now() - t0 < PAIR_TTL + 2000 && fs.existsSync(PAIR_FILE)) await new Promise((r) => setTimeout(r, 500));
    fs.rmSync(PAIR_FILE, { force: true });
    loadConfig();
    if (!config || id() === before) { console.error("Niet gekoppeld (code verlopen of te vaak fout). Start de helper opnieuw voor een nieuwe code."); process.exitCode = 1; return; }
    console.log("Gekoppeld. Helper bijwerken en automatisch laten starten...");
    try { svc.install(); } catch (e) { console.error(e.message); process.exitCode = 1; }
    return;
  }
  svc.stop(); // oude dienst (ook de Node-helper) maakt de poort vrij
  for (let i = 0; i < 20 && await portBusy(); i++) await new Promise((r) => setTimeout(r, 250));
  onPaired = () => {
    server.close();
    for (const s of sockets) s.destroy();
    setTimeout(() => { try { svc.install(); } catch (e) { console.error(e.message); process.exitCode = 1; } }, 300);
  };
  start({ pairMode: true });
}
function probe() {
  return new Promise((res) => {
    const r = http.get({ host: "127.0.0.1", port: PORT, path: "/__status", timeout: 1500 }, (resp) => {
      let d = ""; resp.on("data", (c) => { d += c; }); resp.on("end", () => { try { res(JSON.parse(d)); } catch { res(null); } });
    });
    r.on("error", () => res(null)); r.on("timeout", () => { r.destroy(); res(null); });
  });
}
function portBusy() {
  return new Promise((res) => { const t = net.createServer().once("error", () => res(true)).listen(PORT, "127.0.0.1", () => t.close(() => res(false))); });
}
function loadService() {
  try { return require("./service.js"); }
  catch (e) { console.error("service.js ontbreekt (alleen in de losse helper-binary):", e.message); return null; }
}

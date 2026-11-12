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
const { spawn } = require("child_process");

let tools = null; // DNS-tools (dnstools.js), optioneel naast proxy.js
try { tools = require("./dnstools.js"); } catch { /* oudere installatie: DNS-pagina meldt dat een update nodig is */ }

const HELPER_VERSION = 5;
const PORT = Number(process.env.PORT || 8899);
const DIR = path.join(os.homedir(), ".host-override");
const FILE = path.join(DIR, "rules.json");
const CONFIG = path.join(DIR, "config.json");

// Strikte hostnaam-controle (zelfde regel als de extensie): labels a-z, 0-9, -, optioneel "*." vooraan.
const HOST_RE = /^(\*\.)?(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/i;
const isHost = (h) => typeof h === "string" && h.length <= 255 && HOST_RE.test(h);

// Welke extensie(s) de helper mogen aansturen. Het setup-commando uit de extensie schrijft config.json
// met het ID van die extensie. Zonder config.json (handmatige installatie) geldt elke chrome-extension://.
let allowedOrigins = null;
function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8").replace(/^\uFEFF/, ""));
    const list = (cfg.origins || []).filter((o) => /^chrome-extension:\/\/[a-p]{32}$/.test(o));
    allowedOrigins = list.length ? list : null;
  } catch { allowedOrigins = null; }
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
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(rules, null, 2));
  } catch (e) { console.error("Kon regels niet opslaan:", e.message); }
}

function valid(list) {
  return Array.isArray(list) && list.length <= 5000 && list.every((r) => r && isHost(r.host) && typeof r.ip === "string" && net.isIP(r.ip));
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

// Alleen de extensie mag regels lezen of zetten, geen willekeurige website via localhost.
// - Origin moet de eigen extensie zijn (websites kunnen geen chrome-extension://-origin sturen).
// - De eigen header dwingt bij cross-origin verzoeken een CORS-preflight af, die hier nooit slaagt.
// - De Host-header moet 127.0.0.1/localhost zijn (tegen DNS-rebinding).
function fromExtension(req) {
  const origin = req.headers.origin || "";
  const okOrigin = allowedOrigins ? allowedOrigins.includes(origin) : /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
  return okOrigin && localHost(req) && req.headers["x-host-override"] === "1";
}
function localHost(req) {
  return [`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(String(req.headers.host || "").toLowerCase());
}

function control(req, res) {
  if (!fromExtension(req)) { res.writeHead(403).end("forbidden"); return; }
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
  if (!fromExtension(req)) return reply(403, { error: "forbidden" });
  if (req.method !== "POST") return reply(405, { error: "POST verwacht" });
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on("end", () => {
    let data;
    try { data = JSON.parse(body); } catch { return reply(400, { error: "ongeldige invoer" }); }
    const list = data.rules;
    if (!Array.isArray(list) || list.length === 0 || list.length > 500 ||
        !list.every((r) => r && isHost(r.host) && typeof r.ip === "string" && net.isIP(r.ip))) {
      return reply(400, { error: "geen geldige regels" });
    }
    let url = null;
    if (data.url) {
      try {
        const u = new URL(data.url);
        if (u.protocol === "http:" || u.protocol === "https:") url = u.href;
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
  async "/__check"(d) {
    if (!isHost(d.host) || d.host.startsWith("*.") || typeof d.ip !== "string" || !net.isIP(d.ip)) throw new Error("ongeldige invoer");
    return tools.check(d.host, d.ip);
  },
};

function dnsApi(req, res) {
  const reply = (code, obj) => res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(obj));
  if (!fromExtension(req)) return reply(403, { error: "forbidden" });
  if (!tools) return reply(501, { error: "DNS-tools ontbreken, werk de helper bij" });
  if (req.method !== "POST") return reply(405, { error: "POST verwacht" });
  const handler = DNS_API[req.url.split("?")[0]];
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on("end", async () => {
    try { reply(200, await handler(JSON.parse(body || "{}"))); }
    catch (e) { reply(400, { error: e.message }); }
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/__rules")) return control(req, res);
  if (req.url.startsWith("/__launch")) return launch(req, res);
  if (Object.hasOwn(DNS_API, req.url.split("?")[0])) return dnsApi(req, res);
  // Eigen pagina's (geen proxy-verzoek): alleen via 127.0.0.1/localhost, niet via een herbonden domeinnaam.
  if (req.url.startsWith("/") && !localHost(req)) { res.writeHead(403).end("forbidden"); return; }
  if (req.url === "/__status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ helper: HELPER_VERSION, rules: rules.length }));
    return;
  }
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Host Override proxy draait (versie ${HELPER_VERSION}). Actieve regels: ${rules.length}\n`);
    return;
  }
  let u;
  try { u = new URL(req.url); } catch { res.writeHead(400).end("proxy only"); return; }
  const target = lookup(u.hostname) || u.hostname;
  const out = http.request(
    { host: target, port: u.port || 80, method: req.method, path: u.pathname + u.search, headers: req.headers },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }
  );
  out.on("error", (e) => { if (!res.headersSent) res.writeHead(502); res.end("upstream error: " + e.message); });
  req.pipe(out);
});

server.on("connect", (req, client, head) => {
  const hp = splitHostPort(req.url, 443);
  if (!hp) { client.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
  const target = lookup(hp.host) || hp.host;
  const upstream = net.connect(hp.port, target, () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  const close = () => { upstream.destroy(); client.destroy(); };
  upstream.on("error", close);
  client.on("error", close);
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error(`Poort ${PORT} is al in gebruik. Draait de proxy al?`);
  else console.error(e);
  process.exit(1);
});

load();
loadConfig();
server.listen(PORT, "127.0.0.1", () => console.log(`Host Override proxy op 127.0.0.1:${PORT} (${rules.length} regels geladen, ${allowedOrigins ? "alleen " + allowedOrigins.join(", ") : "elke extensie (geen config.json)"})`));

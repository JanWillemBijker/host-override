// Host Override: dig-achtige DNS-client (UDP/TCP), delegatie-trace en server-check (HTTP/TLS).
// Geen dependencies. Wordt gebruikt door proxy.js voor de DNS-pagina van de extensie.
"use strict";
const dgram = require("dgram");
const net = require("net");
const tls = require("tls");
const http = require("http");
const https = require("https");
const dns = require("dns");
const crypto = require("crypto");
const { domainToASCII } = require("url");

const TYPES = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, DS: 43, DNSKEY: 48, CAA: 257 };
const TYPE_NAMES = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [v, k]));
const RCODES = ["NOERROR", "FORMERR", "SERVFAIL", "NXDOMAIN", "NOTIMP", "REFUSED"];
const ROOTS = ["198.41.0.4", "199.9.14.201", "192.33.4.12", "199.7.91.13"];

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };

function encodeName(name) {
  const trimmed = String(name).replace(/\.$/, "");
  const ascii = trimmed === "" ? "" : domainToASCII(trimmed);
  if (trimmed !== "" && !ascii) throw new Error("ongeldige naam");
  const out = [];
  for (const label of ascii ? ascii.split(".") : []) {
    if (label.length === 0 || label.length > 63) throw new Error("ongeldige naam");
    out.push(Buffer.from([label.length]), Buffer.from(label, "ascii"));
  }
  out.push(Buffer.from([0]));
  return Buffer.concat(out);
}

function buildQuery(name, type, rd) {
  const id = crypto.randomInt(0, 65536);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(rd ? 0x0100 : 0, 2);
  header.writeUInt16BE(1, 4); // vragen
  header.writeUInt16BE(1, 10); // extra records: EDNS0 OPT
  const opt = Buffer.from([0, 0, 41, 0x04, 0xd0, 0, 0, 0, 0, 0, 0]);
  return { id, buf: Buffer.concat([header, encodeName(name), u16(type), u16(1), opt]) };
}

function readName(buf, off) {
  const labels = [];
  let end = off, jumped = false, hops = 0;
  for (;;) {
    const len = buf[off];
    if (len === undefined) throw new Error("kapot pakket");
    if (len === 0) { off++; break; }
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) { end = off + 2; jumped = true; }
      off = ((len & 0x3f) << 8) | buf[off + 1];
      if (++hops > 30) throw new Error("kapot pakket");
      continue;
    }
    labels.push(buf.toString("latin1", off + 1, off + 1 + len));
    off += 1 + len;
  }
  if (!jumped) end = off;
  return [labels.join(".") || ".", end];
}

function fmt6(b) {
  const g = [];
  for (let i = 0; i < 16; i += 2) g.push(b.readUInt16BE(i));
  let bs = -1, bl = 0;
  for (let i = 0; i < 8;) {
    if (g[i] === 0) { let j = i; while (j < 8 && g[j] === 0) j++; if (j - i > bl) { bs = i; bl = j - i; } i = j; } else i++;
  }
  const h = (x) => x.toString(16);
  if (bl < 2) return g.map(h).join(":");
  return g.slice(0, bs).map(h).join(":") + "::" + g.slice(bs + bl).map(h).join(":");
}

function rdata(buf, type, off, len) {
  const end = off + len;
  switch (type) {
    case 1: return { data: [...buf.subarray(off, end)].join(".") };
    case 28: return { data: fmt6(buf.subarray(off, end)) };
    case 2: case 5: case 12: return { data: readName(buf, off)[0] };
    case 15: { const [host] = readName(buf, off + 2); const pref = buf.readUInt16BE(off); return { data: `${pref} ${host}`, pref, host }; }
    case 16: {
      const parts = [];
      for (let o = off; o < end;) { const l = buf[o]; parts.push(buf.toString("utf8", o + 1, o + 1 + l)); o += 1 + l; }
      return { data: parts.join("") };
    }
    case 6: {
      const [mname, o1] = readName(buf, off);
      const [rname, o2] = readName(buf, o1);
      const [serial, refresh, retry, expire, minimum] = [0, 4, 8, 12, 16].map((d) => buf.readUInt32BE(o2 + d));
      return { data: `${mname} ${rname} ${serial} ${refresh} ${retry} ${expire} ${minimum}`, serial, mname, rname, refresh, retry, expire, minimum };
    }
    case 257: {
      const tl = buf[off + 1];
      return { data: `${buf[off]} ${buf.toString("ascii", off + 2, off + 2 + tl)} "${buf.toString("utf8", off + 2 + tl, end)}"` };
    }
    case 33: { const [t] = readName(buf, off + 6); return { data: `${buf.readUInt16BE(off)} ${buf.readUInt16BE(off + 2)} ${buf.readUInt16BE(off + 4)} ${t}` }; }
    default: return { data: buf.subarray(off, end).toString("hex") };
  }
}

function readRR(buf, off) {
  const [name, o] = readName(buf, off);
  const type = buf.readUInt16BE(o);
  const ttl = buf.readUInt32BE(o + 4);
  const len = buf.readUInt16BE(o + 8);
  const rr = { name, type: TYPE_NAMES[type] || String(type), ttl, ...rdata(buf, type, o + 10, len) };
  return [rr, o + 10 + len];
}

function parseMessage(buf) {
  if (buf.length < 12) throw new Error("kapot pakket");
  const f = buf.readUInt16BE(2);
  const counts = [4, 6, 8, 10].map((o) => buf.readUInt16BE(o));
  let off = 12;
  for (let i = 0; i < counts[0]; i++) off = readName(buf, off)[1] + 4;
  const sections = [];
  for (let s = 1; s <= 3; s++) {
    const list = [];
    for (let i = 0; i < counts[s]; i++) { const [rr, n] = readRR(buf, off); off = n; if (rr.type !== "41") list.push(rr); }
    sections.push(list);
  }
  return {
    id: buf.readUInt16BE(0),
    rcode: RCODES[f & 15] || String(f & 15),
    flags: { aa: !!(f & 0x400), tc: !!(f & 0x200), rd: !!(f & 0x100), ra: !!(f & 0x80) },
    answers: sections[0], authority: sections[1], additional: sections[2],
  };
}

// Vergelijkbare vorm van een IP (IPv6 kan op meerdere manieren geschreven worden).
const canonIp = (ip) => { try { return net.isIPv6(ip) ? new URL(`http://[${ip}]/`).hostname : ip; } catch { return ip; } };
// Vraagsectie (naam, type, klasse) van een bericht; hoofdletters tellen niet mee.
const question = (b, end) => Buffer.from(b.subarray(12, end)).toString("latin1").toLowerCase();

function udp(buf, id, server, port, timeout) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket(net.isIPv6(server) ? "udp6" : "udp4");
    const timer = setTimeout(() => { sock.close(); reject(new Error("timeout")); }, timeout);
    const want = canonIp(server);
    const qEnd = buf.length - 11; // de vraag eindigt vlak voor het EDNS0-OPT-record (11 bytes)
    const q = question(buf, qEnd);
    sock.on("message", (msg, rinfo) => {
      // Alleen antwoorden van de gevraagde server en poort, met hetzelfde ID en dezelfde vraag (tegen spoofing).
      if (canonIp(rinfo.address) !== want || rinfo.port !== port) return;
      if (msg.length < qEnd || msg.readUInt16BE(0) !== id || question(msg, qEnd) !== q) return;
      clearTimeout(timer); sock.close(); resolve(msg);
    });
    sock.on("error", (e) => { clearTimeout(timer); sock.close(); reject(e); });
    sock.send(buf, port, server, (e) => { if (e) { clearTimeout(timer); sock.close(); reject(e); } });
  });
}

function tcp(buf, server, port, timeout) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, server);
    const chunks = [];
    let need = null;
    const done = (err, val) => { clearTimeout(timer); sock.destroy(); err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => done(new Error("timeout")), timeout);
    sock.on("connect", () => sock.write(Buffer.concat([u16(buf.length), buf])));
    sock.on("data", (d) => {
      chunks.push(d);
      const all = Buffer.concat(chunks);
      if (need === null && all.length >= 2) need = all.readUInt16BE(0);
      if (need !== null && all.length >= need + 2) done(null, all.subarray(2, 2 + need));
    });
    sock.on("error", (e) => done(e));
    sock.on("close", () => done(new Error("verbinding gesloten")));
  });
}

function systemServer() {
  for (const s of dns.getServers()) {
    const m = s.match(/^\[(.+)\](?::\d+)?$/);
    const ip = m ? m[1] : s;
    if (net.isIP(ip) && !ip.includes("%")) return ip;
  }
  return "1.1.1.1";
}

async function query(name, type, { server, rd = true, port = 53, timeout = 3000 } = {}) {
  const t = typeof type === "number" ? type : TYPES[String(type).toUpperCase()];
  if (!t) throw new Error("onbekend type");
  server = !server || server === "system" ? systemServer() : server;
  const { id, buf } = buildQuery(name, t, rd);
  const start = Date.now();
  let raw;
  try { raw = await udp(buf, id, server, port, timeout); }
  catch (e) { if (e.message !== "timeout") throw e; raw = await udp(buf, id, server, port, timeout); } // één nieuwe poging
  let msg = parseMessage(raw);
  let via = "udp";
  if (msg.flags.tc) { msg = parseMessage(await tcp(buf, server, port, timeout)); via = "tcp"; }
  return { ...msg, server, via, ms: Date.now() - start };
}

// Volgt de delegatie vanaf de root (zoals dig +trace). Geeft de zone, de NS-set bij de parent en in de zone zelf.
async function trace(name) {
  const steps = [];
  let servers = ROOTS.map((ip) => ({ ip, name: "root" }));
  let zone = ".", delegationNs = [], parent = null, childNs = [];
  for (let hop = 0; hop < 12; hop++) {
    let msg = null, used = null;
    for (const s of servers.slice(0, 3)) {
      try { msg = await query(name, "NS", { server: s.ip, rd: false, timeout: 2500 }); used = s; break; } catch { /* volgende server */ }
    }
    if (!msg) { steps.push({ error: "geen antwoord", server: servers[0].ip }); break; }
    const answers = msg.answers.filter((r) => r.type === "NS");
    const referral = msg.authority.filter((r) => r.type === "NS");
    if (msg.rcode === "NXDOMAIN") { steps.push({ server: used.name, ip: used.ip, rcode: "NXDOMAIN" }); break; }
    if (!answers.length && referral.length) {
      zone = referral[0].name;
      delegationNs = [...new Set(referral.map((r) => r.data.toLowerCase()))];
      parent = used.name === "root" ? "." : used.name;
      steps.push({ server: used.name, ip: used.ip, zone, ns: delegationNs });
      const glue = msg.additional.filter((r) => r.type === "A" || r.type === "AAAA");
      const next = [];
      for (const ns of delegationNs) {
        const g = glue.find((r) => r.name.toLowerCase() === ns && r.type === "A") || glue.find((r) => r.name.toLowerCase() === ns);
        if (g) next.push({ ip: g.data, name: ns });
      }
      for (const ns of delegationNs) {
        if (next.length >= 3) break;
        if (next.some((n) => n.name === ns)) continue;
        try {
          const r = await query(ns, "A", { server: "1.1.1.1", timeout: 2500 });
          const a = r.answers.find((x) => x.type === "A");
          if (a) next.push({ ip: a.data, name: ns });
        } catch { /* sla over */ }
      }
      if (!next.length) { steps.push({ error: "geen IP voor de nameservers van " + zone }); break; }
      servers = next;
      continue;
    }
    if (answers.length) childNs = [...new Set(answers.map((r) => r.data.toLowerCase()))];
    steps.push({ server: used.name, ip: used.ip, zone, ns: childNs, final: true, note: answers.length ? null : "geen NS op deze naam (geen eigen zone)" });
    break;
  }
  return { zone, parent, delegationNs, childNs, steps };
}

// ---------- Server-check: HTTP en HTTPS rechtstreeks op een IP, met de juiste Host en SNI ----------
function certInfo(socket, cert, host) {
  if (!cert || !cert.valid_to) return null;
  const to = new Date(cert.valid_to);
  const bare = host.replace(/^www\./, "");
  const san = (cert.subjectaltname || "").split(", ").filter((x) => x.startsWith("DNS:")).map((x) => x.slice(4));
  return {
    authorized: socket.authorized,
    authError: socket.authorizationError ? String(socket.authorizationError) : null,
    subject: cert.subject?.CN || null,
    issuer: cert.issuer?.O || cert.issuer?.CN || null,
    from: new Date(cert.valid_from).toISOString(),
    to: to.toISOString(),
    daysLeft: Math.floor((to - Date.now()) / 864e5),
    san: san.slice(0, 100),
    sanCount: san.length,
    hostMatch: !tls.checkServerIdentity(host, cert),
    // Dekt het certificaat ook het kale domein en www? (belangrijk bij een verhuizing)
    bareMatch: !tls.checkServerIdentity(bare, cert),
    wwwMatch: !tls.checkServerIdentity("www." + bare, cert),
    protocol: socket.getProtocol ? socket.getProtocol() : null,
  };
}

// Beveiligings- en cacheheaders die de migratie-check live en nieuw naast elkaar zet.
const CHECK_HEADERS = ["strict-transport-security", "content-security-policy", "x-frame-options", "x-content-type-options",
  "referrer-policy", "permissions-policy", "cross-origin-opener-policy", "server", "x-powered-by", "cache-control", "content-type"];
// Alleen voor tests: andere poorten dan 80/443 ("8080,8443"), te zetten in de omgeving van de helper, niet vanuit de extensie.
const TEST_PORTS = (process.env.HOST_OVERRIDE_TEST_PORTS || "").split(",").map(Number);
const portFor = (secure) => (secure ? TEST_PORTS[1] || 443 : TEST_PORTS[0] || 80);

function probe(proto, host, ip, timeout = 6000, pathname = "/") {
  return new Promise((resolve) => {
    const start = Date.now();
    const secure = proto === "https";
    const opts = {
      host: ip, port: portFor(secure), method: "GET", path: pathname, timeout, agent: false,
      headers: { Host: host, "User-Agent": "HostOverride-check", Accept: "text/html,*/*" },
    };
    if (secure) { opts.servername = host; opts.rejectUnauthorized = false; }
    const req = (secure ? https : http).request(opts, (res) => {
      const headers = {};
      for (const h of CHECK_HEADERS) if (res.headers[h] != null) headers[h] = String(res.headers[h]).slice(0, 300);
      const out = {
        ok: true, status: res.statusCode, location: res.headers.location || null,
        server: res.headers.server || null, poweredBy: res.headers["x-powered-by"] || null, ms: Date.now() - start, headers,
      };
      if (secure) out.tls = certInfo(res.socket, res.socket.getPeerCertificate(), host);
      res.destroy();
      req.destroy();
      resolve(out);
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
    req.on("error", (e) => resolve({ ok: false, error: e.code || e.message }));
    req.end();
  });
}

// Doorverwijzingen volgen (max 5) tegen hetzelfde IP, zolang het doel dezelfde naam, www.naam of de kale naam is.
// Een verwijzing naar een andere host wordt genoteerd maar niet gevolgd (die draait niet per se op deze server).
async function chain(proto, host, ip) {
  const bare = host.replace(/^www\./, "");
  const same = new Set([host, bare, "www." + bare]);
  const hops = [];
  let cur = { proto, host, path: "/" };
  const t0 = Date.now();
  for (let i = 0; i < 6; i++) {
    const r = await probe(cur.proto, cur.host, ip, 6000, cur.path);
    hops.push({ url: `${cur.proto}://${cur.host}${cur.path}`, status: r.ok ? r.status : null, error: r.ok ? null : r.error, ms: r.ok ? r.ms : null });
    if (!r.ok || !(r.status >= 300 && r.status < 400) || !r.location) return { hops, final: r, totalMs: Date.now() - t0 };
    let next;
    try { next = new URL(r.location, `${cur.proto}://${cur.host}${cur.path}`); } catch { return { hops, final: r, totalMs: Date.now() - t0 }; }
    if (!["http:", "https:"].includes(next.protocol) || !same.has(next.hostname.toLowerCase())) {
      hops.push({ url: next.href.slice(0, 300), external: true });
      return { hops, final: r, totalMs: Date.now() - t0 };
    }
    cur = { proto: next.protocol.slice(0, -1), host: next.hostname.toLowerCase(), path: (next.pathname + next.search).slice(0, 500) };
  }
  return { hops, final: { ok: false, error: "te veel doorverwijzingen" }, totalMs: Date.now() - t0 };
}

async function check(host, ip, { detail = false } = {}) {
  const [httpRes, httpsRes] = await Promise.all([probe("http", host, ip), probe("https", host, ip)]);
  const out = { ip, http: httpRes, https: httpsRes };
  if (detail) {
    const [httpChain, httpsChain] = await Promise.all([chain("http", host, ip), chain("https", host, ip)]);
    out.httpChain = httpChain;
    out.httpsChain = httpsChain;
  }
  return out;
}

// ---------- HTTPS GET met grenzen (crt.sh, RDAP) ----------
// Alleen https, maximale grootte en tijd, hooguit 3 doorverwijzingen (ook die alleen https).
function httpsGet(url, { max = 2 * 1024 * 1024, timeout = 20000, redirects = 3, accept = "application/json" } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error("ongeldige url")); }
    if (u.protocol !== "https:") return reject(new Error("alleen https"));
    const req = https.get(u, { timeout, headers: { "User-Agent": "HostOverride-check", Accept: accept } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error("te veel doorverwijzingen"));
        let next;
        try { next = new URL(res.headers.location, u).href; } catch { return reject(new Error("ongeldige doorverwijzing")); }
        return httpsGet(next, { max, timeout, redirects: redirects - 1, accept }).then(resolve, reject);
      }
      const chunks = [];
      let size = 0;
      res.on("data", (c) => { size += c.length; if (size > max) { req.destroy(); reject(new Error("antwoord te groot")); } else chunks.push(c); });
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8"), url: u.href }));
      res.on("error", reject);
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", (e) => reject(new Error(e.code || e.message)));
  });
}

const NAME_OK = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

// Subdomeinen uit Certificate Transparency (crt.sh). Alleen namen onder het domein, ontdubbeld, max 500.
async function crtsh(domain) {
  const r = await httpsGet(`https://crt.sh/?q=${encodeURIComponent("%." + domain)}&output=json`, { max: 8 * 1024 * 1024, timeout: 30000 });
  if (r.status !== 200) throw new Error(`crt.sh gaf HTTP ${r.status}`);
  let list;
  try { list = JSON.parse(r.body); } catch { throw new Error("crt.sh gaf geen JSON (druk? probeer het later opnieuw)"); }
  const names = new Set();
  let wildcard = false;
  for (const c of Array.isArray(list) ? list : []) {
    for (let n of String(c?.name_value || "").split(/\s+/)) {
      n = n.toLowerCase().replace(/\.$/, "");
      if (n.startsWith("*.")) { wildcard = true; n = n.slice(2); }
      if ((n === domain || n.endsWith("." + domain)) && n.length <= 253 && NAME_OK.test(n)) names.add(n);
    }
  }
  const sorted = [...names].sort((a, b) => a.split(".").length - b.split(".").length || a.localeCompare(b));
  return { names: sorted.slice(0, 500), total: sorted.length, truncated: sorted.length > 500, certs: Array.isArray(list) ? list.length : 0, wildcard };
}

// RDAP: registrar, verloopdatum, DNSSEC en status (locks). Server via de IANA-bootstrap (24 uur gecachet).
let rdapBoot = null;
async function rdapServer(tld) {
  if (!rdapBoot || rdapBoot.exp < Date.now()) {
    const r = await httpsGet("https://data.iana.org/rdap/dns.json", { max: 1024 * 1024 });
    const j = JSON.parse(r.body);
    const map = new Map();
    for (const [tlds, urls] of j.services || []) {
      const url = (urls || []).find((x) => /^https:\/\//.test(x));
      if (url) for (const t of tlds) map.set(String(t).toLowerCase(), url.endsWith("/") ? url : url + "/");
    }
    rdapBoot = { map, exp: Date.now() + 864e5 };
  }
  return rdapBoot.map.get(tld) || null;
}
function vcardName(entity) {
  const v = entity?.vcardArray?.[1];
  const fn = Array.isArray(v) ? v.find((x) => x[0] === "fn") : null;
  return fn ? String(fn[3]).slice(0, 120) : entity?.handle ? String(entity.handle).slice(0, 60) : null;
}
async function rdap(domain) {
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  const base = await rdapServer(tld);
  if (!base) return { domain, supported: false };
  const r = await httpsGet(`${base}domain/${encodeURIComponent(domain)}`, { max: 1024 * 1024, accept: "application/rdap+json, application/json" });
  if (r.status === 404) return { domain, supported: true, found: false, server: new URL(base).hostname };
  if (r.status !== 200) throw new Error(`RDAP gaf HTTP ${r.status}`);
  const j = JSON.parse(r.body);
  const ev = (a) => (j.events || []).find((e) => e.eventAction === a)?.eventDate || null;
  const registrar = (j.entities || []).find((e) => (e.roles || []).includes("registrar"));
  return {
    domain, supported: true, found: true, server: new URL(r.url).hostname,
    registrar: vcardName(registrar),
    created: ev("registration"), expires: ev("expiration"), changed: ev("last changed"),
    dnssec: j.secureDNS ? !!j.secureDNS.delegationSigned : null,
    status: (j.status || []).map(String).slice(0, 20),
    nameservers: (j.nameservers || []).map((n) => String(n.ldhName || "").toLowerCase()).filter(Boolean).slice(0, 13),
  };
}

// ---------- Hosts-bestand (alleen lezen) ----------
// Leest het hosts-bestand van het systeem en zoekt namen op. Er wordt nooit iets naar geschreven.
// HOST_OVERRIDE_HOSTS_FILE is alleen voor tests (een nep-hosts-bestand); de extensie kan dit niet zetten:
// het is een omgevingsvariabele van het helper-proces en de setup-scripts zetten hem niet.
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOSTS_MAX = 5 * 1024 * 1024; // ad-block-hosts-bestanden kunnen enorm zijn; daarboven lezen we alleen het begin
const HOSTS_LOOPBACK_LIST = 50; // meer loopback-namen dan dit: een blokkeerlijst in 127.0.0.1-stijl
const DEFAULT_NAMES = new Set(["localhost", "localhost.localdomain", "localdomain", "broadcasthost", "local",
  "ip6-localhost", "ip6-loopback", "ip6-localnet", "ip6-mcastprefix", "ip6-allnodes", "ip6-allrouters", "ip6-allhosts"]);
// Namen in een hosts-bestand: iets ruimer dan regels in de extensie (underscore komt voor), geen wildcards.
const NAME_RE = /^(?!-)[a-z0-9_-]{1,63}(?<!-)(\.(?!-)[a-z0-9_-]{1,63}(?<!-))*$/;

function hostsPath() {
  if (process.env.HOST_OVERRIDE_HOSTS_FILE) return process.env.HOST_OVERRIDE_HOSTS_FILE;
  if (process.platform === "win32") return path.join(process.env.SystemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts");
  return "/etc/hosts";
}

// Canonieke vorm, zodat "::FFFF:1.2.3.4", "2001:DB8:0::1" en "1.2.3.4" vergelijkbaar zijn
// (zelfde regel als normIp in de extensie). IPv4-mapped IPv6 wordt gewoon IPv4.
function plainIp(ip) {
  ip = String(ip).toLowerCase();
  if (!net.isIPv6(ip)) return ip;
  let c;
  try { c = new URL(`http://[${ip}]/`).hostname.slice(1, -1); } catch { return ip; }
  const m = c.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) { const a = parseInt(m[1], 16), b = parseInt(m[2], 16); return [a >> 8, a & 255, b >> 8, b & 255].join("."); }
  return c;
}

function ipKind(ip) {
  if (ip === "0.0.0.0" || ip === "::") return "blocked";
  if (/^127\./.test(ip) || ip === "::1") return "loopback";
  return "override";
}

// Robuuste parser: BOM, CRLF/CR, commentaar (ook achter een regel), tabs, meerdere namen per regel,
// IPv4/IPv6 (ook met zone-index zoals fe80::1%lo0), hoofdletters en een punt aan het eind van een naam.
// Uitkomst: { lines: [{ ip, names, kind, line }], defaults, invalid }
function parseHostsText(text) {
  const lines = [];
  let defaults = 0, invalid = 0, n = 0;
  for (const raw of String(text).replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
    n++;
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [ipRaw, ...rest] = line.split(/[ \t\f\v]+/);
    const ipBare = ipRaw.replace(/%[\w.-]+$/, "");
    if (!net.isIP(ipBare) || rest.length === 0) { invalid++; continue; }
    const ip = plainIp(ipBare);
    const kind = ipKind(ip);
    const names = [];
    for (let name of rest) {
      name = name.toLowerCase().replace(/\.$/, "");
      if (name.length > 253 || !NAME_RE.test(name)) { invalid++; continue; }
      if (DEFAULT_NAMES.has(name) || (kind === "loopback" && name === os.hostname().toLowerCase())) { defaults++; continue; }
      if (!names.includes(name)) names.push(name);
    }
    if (names.length) lines.push({ ip, names, kind, line: n });
  }
  // Veel namen op 127.0.0.1/::1: dat is een blokkeerlijst, geen lokale ontwikkelomgeving.
  const loopbackNames = lines.filter((l) => l.kind === "loopback").reduce((a, l) => a + l.names.length, 0);
  if (loopbackNames > HOSTS_LOOPBACK_LIST) for (const l of lines) if (l.kind === "loopback") l.kind = "blocked";
  return { lines, defaults, invalid };
}

// Leest maximaal HOSTS_MAX bytes (afgekapt op een hele regel) en bouwt een index naam -> [{ip, kind}].
// Gecachet op pad + grootte + wijzigingstijd, zodat een groot bestand niet bij elke paginaweergave opnieuw wordt gelezen.
let hostsCache = null;
async function loadHosts() {
  const file = hostsPath();
  let st;
  try { st = await fs.promises.stat(file); }
  catch (e) { return { path: file, exists: false, error: e.code === "ENOENT" ? null : (e.code || e.message), lines: [], index: new Map(), defaults: 0, invalid: 0, size: 0, truncated: false }; }
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  if (hostsCache && hostsCache.key === key) return hostsCache;
  if (!st.isFile()) return { path: file, exists: false, error: "not a file", lines: [], index: new Map(), defaults: 0, invalid: 0, size: 0, truncated: false };
  const fh = await fs.promises.open(file, "r");
  let buf;
  try {
    const len = Math.min(st.size, HOSTS_MAX);
    buf = Buffer.alloc(len);
    let off = 0;
    while (off < len) {
      const { bytesRead } = await fh.read(buf, off, len - off, off);
      if (!bytesRead) break;
      off += bytesRead;
    }
    buf = buf.subarray(0, off);
  } finally { await fh.close(); }
  const truncated = st.size > HOSTS_MAX;
  let text = buf.toString("utf8");
  if (truncated) text = text.slice(0, Math.max(0, text.lastIndexOf("\n")));
  const parsed = parseHostsText(text);
  const index = new Map();
  for (const l of parsed.lines) {
    for (const name of l.names) {
      const list = index.get(name) || [];
      if (!list.some((e) => e.ip === l.ip)) list.push({ ip: l.ip, kind: l.kind, line: l.line });
      index.set(name, list);
    }
  }
  hostsCache = { key, path: file, exists: true, error: null, size: st.size, mtime: st.mtime.toISOString(), truncated, index, ...parsed };
  return hostsCache;
}

// names gegeven: alleen de treffers voor die namen. Zonder names: een compact overzicht
// (overrides volledig tot 1000 regels, blokkeringen alleen geteld plus een klein voorbeeld).
async function hosts(names) {
  const h = await loadHosts();
  const base = { path: h.path, exists: h.exists, error: h.error, size: h.size, mtime: h.mtime || null, truncated: h.truncated, max: HOSTS_MAX };
  if (names) {
    const matches = {};
    for (const n of names) matches[n] = (h.index.get(n) || []).map(({ ip, kind, line }) => ({ ip, kind, line }));
    return { ...base, matches };
  }
  const over = h.lines.filter((l) => l.kind !== "blocked");
  const blocked = h.lines.filter((l) => l.kind === "blocked");
  return {
    ...base,
    entries: over.slice(0, 1000),
    entriesTruncated: over.length > 1000,
    blocked: blocked.reduce((a, l) => a + l.names.length, 0),
    blockedSample: blocked.slice(0, 50),
    defaults: h.defaults,
    invalid: h.invalid,
  };
}

module.exports = { query, trace, check, crtsh, rdap, TYPES, hosts, parseHostsText, hostsPath, plainIp, HOSTS_MAX };

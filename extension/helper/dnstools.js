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

function udp(buf, id, server, port, timeout) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket(net.isIPv6(server) ? "udp6" : "udp4");
    const timer = setTimeout(() => { sock.close(); reject(new Error("timeout")); }, timeout);
    sock.on("message", (msg) => {
      if (msg.length >= 2 && msg.readUInt16BE(0) === id) { clearTimeout(timer); sock.close(); resolve(msg); }
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
  return {
    authorized: socket.authorized,
    authError: socket.authorizationError ? String(socket.authorizationError) : null,
    subject: cert.subject?.CN || null,
    issuer: cert.issuer?.O || cert.issuer?.CN || null,
    from: new Date(cert.valid_from).toISOString(),
    to: to.toISOString(),
    daysLeft: Math.floor((to - Date.now()) / 864e5),
    san: (cert.subjectaltname || "").replace(/DNS:/g, "").split(", ").filter(Boolean).slice(0, 12),
    hostMatch: !tls.checkServerIdentity(host, cert),
    protocol: socket.getProtocol ? socket.getProtocol() : null,
  };
}

function probe(proto, host, ip, timeout = 6000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const secure = proto === "https";
    const opts = {
      host: ip, port: secure ? 443 : 80, method: "GET", path: "/", timeout, agent: false,
      headers: { Host: host, "User-Agent": "HostOverride-check", Accept: "*/*" },
    };
    if (secure) { opts.servername = host; opts.rejectUnauthorized = false; }
    const req = (secure ? https : http).request(opts, (res) => {
      const out = {
        ok: true, status: res.statusCode, location: res.headers.location || null,
        server: res.headers.server || null, poweredBy: res.headers["x-powered-by"] || null, ms: Date.now() - start,
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

async function check(host, ip) {
  const [httpRes, httpsRes] = await Promise.all([probe("http", host, ip), probe("https", host, ip)]);
  return { ip, http: httpRes, https: httpsRes };
}

module.exports = { query, trace, check, TYPES };

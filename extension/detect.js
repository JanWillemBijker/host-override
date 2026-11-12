// Herkennen of een pagina van het live IP komt: Host Override-regel, hosts-bestand (via de helper)
// of een verbonden IP dat afwijkt van publieke DNS. Gedeeld door achtergrondscript, popup en DNS-check.
// classify() en de IP-hulpjes zijn puur (geen chrome.*), zodat ze ook in Node te testen zijn.
import { helperFetch } from "./common.js";

// ---------- IP-hulpjes ----------
// Canonieke vorm: kleine letters, IPv6 ingekort ("2001:DB8:0::1" -> "2001:db8::1"),
// IPv4-mapped IPv6 ("::ffff:1.2.3.4") -> "1.2.3.4". Zelfde regel als plainIp in helper/dnstools.js.
export function normIp(ip) {
  if (typeof ip !== "string" || !ip) return "";
  let s = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!s.includes(":")) return s;
  try { s = new URL(`http://[${s}]/`).hostname.slice(1, -1); } catch { return s; }
  const m = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (m) { const a = parseInt(m[1], 16), b = parseInt(m[2], 16); return [a >> 8, a & 255, b >> 8, b & 255].join("."); }
  return s;
}

export const isLoopback = (ip) => { const n = normIp(ip); return n.startsWith("127.") || n === "::1"; };

function v6Groups(ip) {
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const fill = ip.includes("::") ? Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...fill, ...t].map((x) => parseInt(x || "0", 16));
}

// Zelfde /24 (IPv4) of /48 (IPv6): bij CDN's en geo-DNS wisselen adressen vaak binnen zo'n blok.
export function sameNet(a, b) {
  a = normIp(a); b = normIp(b);
  if (!a || !b || a.includes(":") !== b.includes(":")) return false;
  if (!a.includes(":")) return a.split(".").slice(0, 3).join(".") === b.split(".").slice(0, 3).join(".");
  const ga = v6Groups(a), gb = v6Groups(b);
  return ga[0] === gb[0] && ga[1] === gb[1] && ga[2] === gb[2];
}

// ---------- Beslissen ----------
// in:  host, ip (verbonden IP volgens Chrome, of null), rule (Host Override-regel of null),
//      hosts (treffers uit het hosts-bestand: array, of null = onbekend/geen helper),
//      doh ({ status: "ok"|"nxdomain"|"nodata", ips: [...] } of null = niet opgezocht)
// uit: { source, ip, certain, near, mismatch, connected, publicIps, entries }
//   source: "rule" | "hosts" | "differs" | "live" | "unknown"
//   - rule en hosts zijn zeker (certain). differs is een vermoeden: hosts-bestand, lokale DNS, VPN of proxy.
//   - live: het verbonden IP staat in het publieke DNS-antwoord (A + AAAA samen).
//   - near: wijkt af, maar zit in hetzelfde /24 of /48 als een publiek adres (waarschijnlijk CDN/geo-DNS).
export function classify({ ip = null, rule = null, hosts = null, doh = null } = {}) {
  const conn = rule ? null : normIp(ip) || null; // met een regel is het verbonden IP de lokale helper
  const publicIps = doh?.status === "ok" ? doh.ips.map(normIp) : [];
  const base = { connected: conn, publicIps, entries: hosts || [], certain: false, near: false, mismatch: false };
  if (rule) return { ...base, source: "rule", ip: rule.ip, certain: true };

  if (hosts && hosts.length) {
    const hit = conn && hosts.find((e) => normIp(e.ip) === conn);
    if (hit) return { ...base, source: "hosts", ip: hit.ip, certain: true };
    // 0.0.0.0 / :: blokkeren alleen; als de pagina toch laadde, gebruikte Chrome die regel niet.
    const usable = hosts.filter((e) => e.kind !== "blocked");
    if (usable.length) return { ...base, source: "hosts", ip: usable[0].ip, certain: true, mismatch: !!conn };
  }

  if (conn && doh) {
    if (publicIps.includes(conn)) return { ...base, source: "live", ip: conn, certain: true };
    const near = publicIps.some((p) => sameNet(p, conn));
    return { ...base, source: "differs", ip: conn, near };
  }
  return { ...base, source: "unknown", ip: conn };
}

// Moet de pagina-indicator verschijnen voor deze uitkomst?
export function triggers(result, ind) {
  if (!result) return false;
  if (result.source === "rule") return ind.onRule;
  if (result.source === "hosts") return ind.onHosts;
  if (result.source === "differs") return ind.onDiffers && !result.near;
  return false;
}

// ---------- Publieke DNS (DNS-over-HTTPS, of via de helper) ----------
// Instelling "dohProvider": cloudflare (standaard), google, quad9 of helper (de DNS-server van je systeem,
// rechtstreeks bevraagd door de helper; geen derde partij, maar wel je eigen/zakelijke resolver).
// Google en Quad9 vragen eenmalig toegang tot hun domein (optionele host-permissie).
export const DOH_PROVIDERS = {
  cloudflare: { label: "Cloudflare", url: "https://cloudflare-dns.com/dns-query", origin: "https://cloudflare-dns.com/*" },
  google: { label: "Google", url: "https://dns.google/resolve", origin: "https://dns.google/*" },
  quad9: { label: "Quad9", url: "https://dns.quad9.net/dns-query", origin: "https://dns.quad9.net/*", wire: true }, // alleen RFC 8484
  helper: { label: "helper", url: null, origin: null },
};
export async function dohProvider() {
  try { const { dohProvider: p } = await chrome.storage.local.get("dohProvider"); return DOH_PROVIDERS[p] ? p : "cloudflare"; }
  catch { return "cloudflare"; }
}

// RFC 8484 (wire-formaat) voor diensten zonder JSON-API: alleen A/AAAA, antwoord in dezelfde vorm als de JSON-API.
export function dnsWireQuery(host, type) {
  const bytes = [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]; // ID 0 (RFC 8484), RD, 1 vraag
  for (const label of host.replace(/\.$/, "").split(".")) {
    const b = new TextEncoder().encode(label);
    if (!b.length || b.length > 63) throw new Error("ongeldige naam");
    bytes.push(b.length, ...b);
  }
  bytes.push(0, 0, type === "AAAA" ? 28 : 1, 0, 1);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function parseDnsWire(buf) {
  if (buf.length < 12) throw new Error("kapot DNS-antwoord");
  const u16 = (o) => (buf[o] << 8) | buf[o + 1];
  const skipName = (o) => {
    for (let n = 0; n < 128; n++) {
      const l = buf[o];
      if (l === undefined) throw new Error("kapot DNS-antwoord");
      if (l === 0) return o + 1;
      if ((l & 0xc0) === 0xc0) return o + 2;
      o += 1 + l;
    }
    throw new Error("kapot DNS-antwoord");
  };
  const status = buf[3] & 15, qd = u16(4), an = u16(6);
  let o = 12;
  for (let i = 0; i < qd; i++) o = skipName(o) + 4;
  const Answer = [];
  for (let i = 0; i < an && o < buf.length; i++) {
    o = skipName(o);
    const type = u16(o), TTL = ((buf[o + 4] << 24) >>> 0) + (buf[o + 5] << 16) + (buf[o + 6] << 8) + buf[o + 7], len = u16(o + 8);
    const d = buf.subarray(o + 10, o + 10 + len);
    if (type === 1 && len === 4) Answer.push({ type, TTL, data: [...d].join(".") });
    else if (type === 28 && len === 16) {
      const g = [];
      for (let j = 0; j < 16; j += 2) g.push(((d[j] << 8) | d[j + 1]).toString(16));
      Answer.push({ type, TTL, data: g.join(":") });
    }
    o += 10 + len;
  }
  return { Status: status, Answer };
}

// A en AAAA samen, zodat een IPv6-verbinding niet als "afwijkend" telt als alleen naar A gekeken wordt.
// Gecachet in chrome.storage.session per hostnaam, zo lang als de TTL (min 1 min, max 1 uur).
export async function dohLookup(host, { cache = true } = {}) {
  const key = `doh:${host}`;
  if (cache) {
    const c = (await chrome.storage.session.get(key))[key];
    if (c && c.exp > Date.now()) return c;
  }
  const provider = await dohProvider();
  const P = DOH_PROVIDERS[provider];
  const ask = async (type) => {
    if (provider === "helper") {
      const r = await helperFetch("/__dns", { body: { name: host, type, server: "system" } });
      if (!r.ok) throw new Error(`helper ${r.status}`);
      const j = await r.json();
      return { Status: j.rcode === "NXDOMAIN" ? 3 : 0, Answer: (j.answers || []).map((a) => ({ type: a.type === "A" ? 1 : a.type === "AAAA" ? 28 : 0, data: a.data, TTL: a.ttl })) };
    }
    if (P.wire) {
      const r = await fetch(`${P.url}?dns=${dnsWireQuery(host, type)}`, { headers: { accept: "application/dns-message" }, credentials: "omit", signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`DoH ${r.status}`);
      return parseDnsWire(new Uint8Array(await r.arrayBuffer()));
    }
    const r = await fetch(`${P.url}?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: "application/dns-json" }, credentials: "omit", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`DoH ${r.status}`);
    return r.json();
  };
  const [a, aaaa] = await Promise.all([ask("A"), ask("AAAA")]);
  const ans = [...(a.Answer || []), ...(aaaa.Answer || [])].filter((x) => x.type === 1 || x.type === 28);
  const ips = [...new Set(ans.map((x) => normIp(x.data)))];
  const status = ips.length ? "ok" : a.Status === 3 ? "nxdomain" : "nodata";
  const ttl = Math.min(3600, Math.max(60, ans.length ? Math.min(...ans.map((x) => x.TTL || 60)) : 60));
  const out = { status, ips, exp: Date.now() + ttl * 1000, via: provider };
  try { await chrome.storage.session.set({ [key]: out }); } catch { /* sessie-opslag vol: niet cachen */ }
  return out;
}

// ---------- Hosts-bestand via de helper ----------
// Geeft de treffers voor één naam ([{ip, kind, line}]) of null als de helper niet beschikbaar is
// (niet gekoppeld, oude versie zonder /__hosts, of fout). Leest nooit, schrijft nooit: alleen de helper leest.
export async function hostsLookup(host) {
  try {
    // POST: Chrome stuurt bij GET vanuit een extensie geen Origin-header mee, en de helper eist die.
    const res = await helperFetch("/__hosts", { body: { names: [host] } });
    if (!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j?.matches?.[host]) ? j.matches[host] : null;
  } catch { return null; }
}

// Volledig overzicht voor de tab Meer. Gooit een fout met code als de helper niet beschikbaar is.
export async function hostsOverview() {
  const res = await helperFetch("/__hosts", { body: {} });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || (res.status === 400 || res.status === 404 ? "helper-outdated" : `status ${res.status}`));
  return j;
}

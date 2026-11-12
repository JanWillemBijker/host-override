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

// ---------- Publieke DNS (Cloudflare DNS-over-HTTPS) ----------
// A en AAAA samen, zodat een IPv6-verbinding niet als "afwijkend" telt als alleen naar A gekeken wordt.
// Gecachet in chrome.storage.session per hostnaam, zo lang als de TTL (min 1 min, max 1 uur).
export async function dohLookup(host, { cache = true } = {}) {
  const key = `doh:${host}`;
  if (cache) {
    const c = (await chrome.storage.session.get(key))[key];
    if (c && c.exp > Date.now()) return c;
  }
  const ask = async (type) => {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: "application/dns-json" } });
    if (!r.ok) throw new Error(`DoH ${r.status}`);
    return r.json();
  };
  const [a, aaaa] = await Promise.all([ask("A"), ask("AAAA")]);
  const ans = [...(a.Answer || []), ...(aaaa.Answer || [])].filter((x) => x.type === 1 || x.type === 28);
  const ips = [...new Set(ans.map((x) => normIp(x.data)))];
  const status = ips.length ? "ok" : a.Status === 3 ? "nxdomain" : "nodata";
  const ttl = Math.min(3600, Math.max(60, ans.length ? Math.min(...ans.map((x) => x.TTL || 60)) : 60));
  const out = { status, ips, exp: Date.now() + ttl * 1000 };
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

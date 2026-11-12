// Migratie-check (in de DNS-check): blijft alles werken als het domein naar de nieuwe server gaat?
// Vergelijkt live met de nieuwe server (Host Override-regel of test-IP) en controleert e-mail, certificaat,
// registratie (RDAP) en optioneel subdomeinen uit Certificate Transparency (crt.sh, alleen op klik).
// Alles via de helper; resultaten alleen als tekst in de DOM (textContent).
import { helperFetch, loadState, activeRules, matchRule } from "./common.js";
import { regDomain, DEFAULT_GROUP } from "./model.js";
import { t } from "./i18n.js";

const $ = (id) => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) (k === "class" ? (el.className = v) : el.setAttribute(k, v === true ? "" : v));
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
}
async function api(path, body) {
  const r = await helperFetch(path, { body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `status ${r.status}`);
  return j;
}
const attempt = async (p) => { try { return { ok: true, v: await p }; } catch (e) { return { ok: false, e: e.message }; } };
const dnsq = (name, type) => api("/__dns", { name, type, server: "system", rd: true });
const txt = async (name) => { const r = await attempt(dnsq(name, "TXT")); return r.ok ? r.v.answers.filter((a) => a.type === "TXT").map((a) => a.data) : []; };
const aRecs = async (name) => { const r = await attempt(dnsq(name, "A")); return r.ok ? { ips: r.v.answers.filter((a) => a.type === "A").map((a) => a.data), cname: r.v.answers.find((a) => a.type === "CNAME")?.data || null, nx: r.v.rcode === "NXDOMAIN" } : { ips: [], cname: null, err: r.e }; };

export const DKIM_SELECTORS = ["default", "google", "selector1", "selector2", "k1", "mail", "dkim", "s1", "s2"];
const SEC_HEADERS = [["strict-transport-security", "HSTS"], ["content-security-policy", "CSP"], ["x-frame-options", "X-Frame-Options"],
  ["x-content-type-options", "X-Content-Type-Options"], ["referrer-policy", "Referrer-Policy"], ["permissions-policy", "Permissions-Policy"]];

let items = []; // { sec, level, text }
let report = { name: "", live: [], target: null, at: null };
let ctx = null; // { name, override: {ip, name?}, liveIps, group }
let running = 0;

// Door dns.js gezet na elke controle: domein, nieuwe server en live IP's.
export function setMigrationContext(c) {
  ctx = c;
  running++;
  items = [];
  renderIntro();
}

function add(sec, level, text) { items.push({ sec, level, text }); }
const ICON = { bad: "✖", warn: "⚠", ok: "✔", info: "ℹ" };
const SECS = [["reg", "Domeinregistratie"], ["web", "Website: live en nieuwe server"], ["tls", "Certificaat op de nieuwe server"], ["mail", "E-mail blijft werken"], ["sub", "Subdomeinen"]];

function renderIntro() {
  const body = $("dMig").querySelector(".body");
  body.textContent = "";
  $("dMig").querySelector(".ssub").textContent = "";
  $("dMig").querySelector(".sdot").className = "sdot";
  const target = ctx?.override;
  body.append(h("p", { class: "small" }, t("Controleert of alles blijft werken als het domein naar de nieuwe server gaat: website (status, doorverwijzingen, beveiligingsheaders, snelheid) live en nieuw naast elkaar, certificaat, e-mail (MX, SPF, DKIM, DMARC, MTA-STS, autodiscover) en de registratie.")));
  if (!target) body.append(h("p", { class: "help" }, t("Nieuwe server onbekend: maak een Host Override-regel voor dit domein of vul bij \"Servers: live en test\" een test-IP in en klik Vergelijk.")));
  else body.append(h("p", { class: "small" }, t("Nieuwe server: {ip}", { ip: target.name ? `${target.name} (${target.ip})` : target.ip })));
  const cb = h("input", { type: "checkbox", id: "migCrt" });
  const btn = h("button", { class: "primary mini-primary", type: "button" }, t("Start migratie-check"));
  btn.onclick = () => runMigration(cb.checked);
  body.append(
    h("label", { class: "check" }, cb, t("Ook subdomeinen zoeken via Certificate Transparency (crt.sh)")),
    h("p", { class: "small indent" }, t("Stuurt de domeinnaam naar crt.sh (een openbare database van uitgegeven certificaten). Alleen als je dit aanvinkt.")),
    h("div", { class: "row" }, btn));
}

function renderResults(done) {
  const body = $("dMig").querySelector(".body");
  body.textContent = "";
  const n = (l) => items.filter((i) => i.level === l).length;
  $("dMig").querySelector(".ssub").textContent = done ? [n("bad") ? `✖ ${n("bad")}` : "", n("warn") ? `⚠ ${n("warn")}` : "", `✔ ${n("ok")}`].filter(Boolean).join("  ") : t("bezig...");
  $("dMig").querySelector(".sdot").className = "sdot " + (n("bad") ? "bad" : n("warn") ? "warn" : items.length ? "ok" : "");
  for (const [sec, title] of SECS) {
    const list = items.filter((i) => i.sec === sec);
    if (!list.length) continue;
    body.append(h("h4", { class: "migh" }, t(title)), h("ul", { class: "find" }, list.map((i) => h("li", { class: i.level }, h("span", { class: "i" }, ICON[i.level]), h("span", {}, i.text, i.node || null)))));
  }
  if (report.table) body.append(report.table);
  if (report.subs) body.append(report.subs);
  if (!done) body.append(h("p", { class: "muted" }, t("Laden...")));
  else {
    const c1 = h("button", { class: "secondary", type: "button" }, t("Kopieer rapport (tekst)"));
    const c2 = h("button", { class: "secondary", type: "button" }, t("Kopieer als Markdown"));
    const again = h("button", { class: "secondary", type: "button" }, t("Opnieuw"));
    c1.onclick = () => copyReport(false, c1);
    c2.onclick = () => copyReport(true, c2);
    again.onclick = renderIntro;
    body.append(h("div", { class: "row wrap" }, c1, c2, again));
  }
}

async function copyReport(md, btn) {
  const L = [];
  const head = `${t("Migratie-check")} ${report.name}` + (report.target ? ` → ${report.target}` : "");
  L.push(md ? `## ${head}` : head, md ? `_${new Date(report.at).toLocaleString()}_` : new Date(report.at).toLocaleString(), "");
  const mark = { bad: md ? "🔴" : "[X]", warn: md ? "🟠" : "[!]", ok: md ? "🟢" : "[OK]", info: md ? "ℹ️" : "[i]" };
  for (const [sec, title] of SECS) {
    const list = items.filter((i) => i.sec === sec);
    if (!list.length) continue;
    L.push(md ? `### ${t(title)}` : `== ${t(title)} ==`);
    for (const i of list) L.push(`${md ? "- " : ""}${mark[i.level]} ${i.text}`);
    L.push("");
  }
  if (report.rows?.length) {
    L.push(md ? `### ${t("Live en nieuw naast elkaar")}` : `== ${t("Live en nieuw naast elkaar")} ==`);
    if (md) { L.push(`| | ${t("Live")} | ${t("Nieuw")} |`, "|---|---|---|"); for (const r of report.rows) L.push(`| ${r[0]} | ${String(r[1]).replace(/\|/g, "\\|")} | ${String(r[2]).replace(/\|/g, "\\|")} |`); }
    else for (const r of report.rows) L.push(`${r[0]}: ${t("live")} ${r[1]} | ${t("nieuw")} ${r[2]}`);
    L.push("");
  }
  await navigator.clipboard.writeText(L.join("\n"));
  const old = btn.textContent;
  btn.textContent = t("Gekopieerd");
  setTimeout(() => (btn.textContent = old), 1600);
}

const fmtDate = (s) => (s ? new Date(s).toLocaleDateString() : "-");
const daysTo = (s) => (s ? Math.floor((new Date(s) - Date.now()) / 864e5) : null);
function hopsText(c) {
  if (!c) return "-";
  return c.hops.map((x) => x.external ? `→ ${x.url} (${t("extern")})` : `${x.status ?? x.error}`).join(" → ") + (c.final?.ok ? ` · ${c.totalMs} ms` : "");
}

async function runMigration(useCrt) {
  if (!ctx) return;
  const my = ++running;
  await ctx.ready; // live IP's van de DNS-check
  const live = () => my === running;
  const { name, override } = ctx;
  const zone = regDomain(name);
  items = [];
  report = { name, target: override ? (override.name ? `${override.name} (${override.ip})` : override.ip) : null, at: Date.now(), rows: [], table: null, subs: null };
  renderResults(false);
  const step = () => live() && renderResults(false);

  // 1. Registratie (RDAP, op het registreerbare domein)
  const regP = (async () => {
    const r = await attempt(api("/__rdap", { domain: zone }));
    if (!r.ok) { add("reg", "info", t("Registratiegegevens niet op te halen ({e}).", { e: r.e })); return; }
    const d = r.v;
    if (!d.supported) { add("reg", "info", t("Geen RDAP-dienst voor .{tld}: controleer de registratie bij je registrar.", { tld: zone.split(".").pop() })); return; }
    if (!d.found) { add("reg", "warn", t("{d} niet gevonden in RDAP.", { d: zone })); return; }
    add("reg", "info", t("Registrar: {r} · nameservers: {ns}", { r: d.registrar || "?", ns: d.nameservers.join(", ") || "-" }));
    const left = daysTo(d.expires);
    if (left == null) add("reg", "info", t("Verloopdatum niet openbaar bij deze registry: controleer bij je registrar of automatisch verlengen aan staat."));
    if (left != null) add("reg", left < 14 ? "bad" : left < 45 ? "warn" : "ok", t("Registratie verloopt op {date} (over {n} dagen).", { date: fmtDate(d.expires), n: left }));
    if (d.dnssec) add("reg", "warn", t("DNSSEC staat aan. Wissel je van nameservers (DNS-hosting), zet dan eerst DNSSEC uit of zet het DS-record van de nieuwe provider klaar; anders werkt het domein na de wissel niet meer (SERVFAIL). Alleen het A-record aanpassen bij dezelfde DNS-provider is geen probleem."));
    else if (d.dnssec === false) add("reg", "ok", t("DNSSEC staat uit: nameservers wisselen geeft geen DNSSEC-problemen."));
    const locks = d.status.filter((s) => /prohibited/i.test(s));
    if (locks.length) add("reg", "info", t("Status: {s}. Een transfer-lock blokkeert verhuizen naar een andere registrar (bescherming tegen kaping); hef hem alleen op als je de registratie zelf verhuist.", { s: locks.join(", ") }));
    else if (d.status.length) add("reg", "info", t("Status: {s}.", { s: d.status.join(", ") }));
    step();
  })();

  // 2. Website live en nieuw naast elkaar (status, keten, headers, tijd) + 3. certificaat nieuw
  const webP = (async () => {
    const liveIp = ctx.liveIps[0];
    if (!override) { add("web", "warn", t("Geen nieuwe server opgegeven: alleen de live site gecontroleerd.")); }
    const [L, N] = await Promise.all([
      liveIp ? attempt(api("/__check", { host: name, ip: liveIp, detail: true })) : Promise.resolve(null),
      override ? attempt(api("/__check", { host: name, ip: override.ip, detail: true })) : Promise.resolve(null),
    ]);
    const lv = L?.ok ? L.v : null, nv = N?.ok ? N.v : null;
    if (N && !N.ok) add("web", "bad", t("Nieuwe server niet te controleren: {e}", { e: N.e }));
    if (nv && !nv.httpsChain) add("web", "warn", t("De helper kent de uitgebreide controle nog niet: plak het setup-commando opnieuw."));
    const fin = (v) => v?.httpsChain?.final?.ok ? v.httpsChain.final : v?.https?.ok ? v.https : null;
    const lf = fin(lv), nf = fin(nv);
    if (nv) {
      if (!nf) add("web", "bad", t("Nieuwe server: HTTPS werkt niet ({e}).", { e: nv.https.error || "?" }));
      else if (nf.status >= 500) add("web", "bad", t("Nieuwe server geeft HTTP {s}.", { s: nf.status }));
      else if (nf.status >= 400) add("web", "warn", t("Nieuwe server geeft HTTP {s}.", { s: nf.status }));
      else add("web", "ok", t("Nieuwe server antwoordt met HTTP {s}.", { s: nf.status }));
      if (lf && nf && lf.status !== nf.status) add("web", "warn", t("Eindstatus verschilt: live {a}, nieuw {b}.", { a: lf.status, b: nf.status }));
      const lh = lv?.httpChain?.hops?.length || 0, nh = nv?.httpChain?.hops?.length || 0;
      if (lv?.httpChain && nv.httpChain && hopsText(lv.httpChain).replace(/ · \d+ ms$/, "") !== hopsText(nv.httpChain).replace(/ · \d+ ms$/, "")) add("web", "warn", t("Doorverwijzingen vanaf http:// verschillen (live {a} stap(pen), nieuw {b}). Controleer http→https en www.", { a: lh, b: nh }));
      if (nv.httpChain && !nv.httpChain.hops.some((x) => /^https:/.test(x.url))) add("web", "warn", t("Nieuwe server stuurt http:// niet door naar https://."));
      if (lf && nf) {
        for (const [k, label] of SEC_HEADERS) {
          if (lf.headers?.[k] && !nf.headers?.[k]) add("web", "warn", t("{h} staat live wel aan, op de nieuwe server niet.", { h: label }));
        }
        const lt = lv.httpsChain?.totalMs ?? lf.ms, nt = nv.httpsChain?.totalMs ?? nf.ms;
        if (nt > 2 * lt + 300) add("web", "warn", t("Nieuwe server reageert trager: {b} ms tegen {a} ms live (eerste meting, zonder cache).", { a: lt, b: nt }));
        else add("web", "ok", t("Reactietijd: live {a} ms, nieuw {b} ms.", { a: lt, b: nt }));
      }
      // Certificaat
      const c = nv.https?.tls;
      if (!c) add("tls", nv.https?.ok ? "warn" : "bad", t("Geen certificaat gezien op de nieuwe server."));
      else {
        add("tls", c.hostMatch ? "ok" : "bad", c.hostMatch ? t("Certificaat geldig voor {n} (uitgever: {i}).", { n: name, i: c.issuer || "?" }) : t("Certificaat is niet geldig voor {n} (SAN: {s}).", { n: name, s: c.san.slice(0, 5).join(", ") }));
        const wwwName = "www." + name.replace(/^www\./, "");
        const other = name.startsWith("www.") ? name.slice(4) : wwwName;
        const otherOk = name.startsWith("www.") ? c.bareMatch : c.wwwMatch;
        const otherDns = await aRecs(other);
        if (!otherOk) add("tls", otherDns.ips.length || otherDns.cname ? "bad" : "info", t("Certificaat dekt {o} niet{x}.", { o: other, x: otherDns.ips.length || otherDns.cname ? t(" terwijl die naam wel in DNS staat") : "" }));
        else add("tls", "ok", t("Certificaat dekt ook {o}.", { o: other }));
        add("tls", !c.authorized ? "bad" : "ok", c.authorized ? t("Vertrouwde uitgever, keten compleet.") : t("Niet vertrouwd: {e}.", { e: c.authError || "?" }));
        add("tls", c.daysLeft < 14 ? "bad" : c.daysLeft < 30 ? "warn" : "ok", t("Verloopt op {d} (over {n} dagen).", { d: c.to.slice(0, 10), n: c.daysLeft }));
      }
    }
    // Tabel live | nieuw
    const row = (label, f) => [label, lv ? f(lv) : "-", nv ? f(nv) : "-"];
    const rows = [
      row(t("HTTP-keten"), (v) => hopsText(v.httpChain)),
      row(t("HTTPS-keten"), (v) => hopsText(v.httpsChain)),
      row(t("Eindstatus"), (v) => fin(v)?.status ?? v.https?.error ?? "-"),
      ...SEC_HEADERS.map(([k, label]) => row(label, (v) => fin(v)?.headers?.[k] ? "✔ " + fin(v).headers[k].slice(0, 60) : "–")),
      row("Server", (v) => fin(v)?.headers?.server || "-"),
      row(t("Certificaat"), (v) => v.https?.tls ? `${v.https.tls.issuer || "?"} · ${v.https.tls.to.slice(0, 10)}` : "-"),
    ];
    report.rows = rows;
    report.table = h("div", { class: "tablewrap" }, h("table", { class: "mig" }, h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, t("Live") + (liveIp ? ` ${liveIp}` : "")), h("th", {}, t("Nieuw") + (override ? ` ${override.ip}` : "")))),
      h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c, i) => (i === 0 ? h("th", {}, c) : h("td", {}, String(c)))))))));
    step();
  })();

  // 4. E-mail: blijft alles werken na de DNS-wissel?
  const mailP = (async () => {
    const [mx, spfAll, dmarc, mtasts, tlsrpt, autod, autodSrv, autoc, ...dkim] = await Promise.all([
      attempt(dnsq(zone, "MX")), txt(zone), txt("_dmarc." + zone), txt("_mta-sts." + zone), txt("_smtp._tls." + zone),
      aRecs("autodiscover." + zone), attempt(dnsq("_autodiscover._tcp." + zone, "SRV")), aRecs("autoconfig." + zone),
      ...DKIM_SELECTORS.map((s) => txt(`${s}._domainkey.${zone}`)),
    ]);
    const mxs = mx.ok ? mx.v.answers.filter((a) => a.type === "MX").sort((a, b) => a.pref - b.pref) : [];
    const liveIps = new Set(ctx.liveIps);
    if (!mxs.length) add("mail", "info", t("Geen MX-records: {z} ontvangt geen e-mail.", { z: zone }));
    else {
      add("mail", "ok", t("MX: {list}", { list: mxs.map((m) => `${m.pref} ${m.host}`).join(", ") }));
      for (const m of mxs) {
        const host = m.host.replace(/\.$/, "");
        if (host === zone || host.endsWith("." + zone)) {
          const a = await aRecs(host);
          if (a.ips.some((ip) => liveIps.has(ip))) add("mail", "warn", t("{h} wijst naar hetzelfde IP als de website ({ip}). Verhuist alleen de website, laat {h} dan naar de oude server wijzen (of verhuis de mail mee); pas niet blind alle A-records aan.", { h: host, ip: a.ips.join(", ") }));
          if (host === zone) add("mail", "warn", t("MX wijst naar het domein zelf ({h}): het A-record van {h} aanpassen verplaatst ook de mail.", { h: host }));
        }
      }
    }
    const spf = spfAll.filter((x) => /^v=spf1/i.test(x));
    if (!spf.length) add("mail", mxs.length ? "warn" : "info", t("Geen SPF-record."));
    else if (spf.length > 1) add("mail", "bad", t("Meerdere SPF-records (maar één is toegestaan)."));
    else {
      add("mail", "ok", t("SPF: {v}", { v: spf[0] }));
      const mechs = spf[0].split(/\s+/);
      const ipHit = [...liveIps].filter((ip) => mechs.some((m) => m === `ip4:${ip}` || m.startsWith(`ip4:${ip}/`)));
      if (ipHit.length && override) add("mail", "warn", t("SPF noemt het oude server-IP ({ip}). Verstuurt de nieuwe server ook mail (contactformulieren, webshop), voeg dan ip4:{n} toe.", { ip: ipHit.join(", "), n: override.ip }));
      if (mechs.some((m) => /^[+?~]?a(:|$)/.test(m) || /^[+?~]?mx(:|$)/.test(m))) add("mail", "info", t("SPF gebruikt \"a\" of \"mx\": na de DNS-wissel mag ook het nieuwe IP mail versturen namens {z}. Klopt dat zo?", { z: zone }));
    }
    const dk = DKIM_SELECTORS.map((s, i) => [s, dkim[i].filter((x) => /v=DKIM1|k=rsa|p=/i.test(x))]).filter(([, v]) => v.length);
    add("mail", dk.length ? "ok" : mxs.length ? "info" : "info", dk.length
      ? t("DKIM gevonden voor selector(s): {s} (best effort: alleen veelgebruikte selectors gecontroleerd).", { s: dk.map(([s]) => s).join(", ") })
      : t("Geen DKIM gevonden bij de veelgebruikte selectors ({s}). Best effort: je provider kan een andere selector gebruiken.", { s: DKIM_SELECTORS.join(", ") }));
    const dm = dmarc.filter((x) => /^v=DMARC1/i.test(x));
    add("mail", dm.length ? "ok" : mxs.length ? "warn" : "info", dm.length ? t("DMARC: {v}", { v: dm[0] }) : t("Geen DMARC-record."));
    if (mtasts.some((x) => /^v=STSv1/i.test(x))) add("mail", "info", t("MTA-STS staat aan: het beleid op https://mta-sts.{z}/.well-known/mta-sts.txt moet na de verhuizing bereikbaar blijven (met geldig certificaat).", { z: zone }));
    if (tlsrpt.some((x) => /^v=TLSRPTv1/i.test(x))) add("mail", "info", t("TLS-RPT is ingesteld (_smtp._tls)."));
    const ad = autod.ips.length || autod.cname || (autodSrv.ok && autodSrv.v.answers.some((a) => a.type === "SRV"));
    if (ad) add("mail", "info", t("Autodiscover ingesteld ({v}): laat dit naar de mailprovider wijzen, niet naar de nieuwe webserver.", { v: autod.cname || autod.ips.join(", ") || "SRV" }));
    if (autoc.ips.length || autoc.cname) add("mail", autoc.ips.some((ip) => liveIps.has(ip)) ? "warn" : "info", t("Autoconfig ingesteld ({v}).", { v: autoc.cname || autoc.ips.join(", ") }) + (autoc.ips.some((ip) => liveIps.has(ip)) ? " " + t("Wijst naar de webserver: na de verhuizing kunnen mailprogramma's hun instellingen niet meer vinden.") : ""));
    step();
  })();

  // 5. Subdomeinen (crt.sh), alleen op verzoek
  const subP = useCrt ? (async () => {
    const r = await attempt(api("/__crtsh", { domain: zone }));
    if (!r.ok) { add("sub", "warn", t("crt.sh niet bereikbaar of druk ({e}). Probeer het later opnieuw.", { e: r.e })); return; }
    const state = await loadState();
    const active = activeRules({ ...state, enabled: true });
    const names = r.v.names.slice(0, 60);
    const res = [];
    for (let i = 0; i < names.length; i += 8) {
      const batch = await Promise.all(names.slice(i, i + 8).map(async (n) => ({ n, a: await aRecs(n) })));
      res.push(...batch);
      if (!live()) return;
    }
    const liveIps = new Set(ctx.liveIps);
    const missing = res.filter((x) => x.a.ips.some((ip) => liveIps.has(ip)) && !matchRule(active, x.n));
    add("sub", "info", t("{n} namen gevonden in certificaten{more}.", { n: r.v.total, more: r.v.total > names.length ? t(" (eerste {k} gecontroleerd)", { k: names.length }) : "" }) + (r.v.wildcard ? " " + t("Er is ook een wildcard-certificaat: niet alle subdomeinen zijn zichtbaar.") : ""));
    if (missing.length) add("sub", "warn", t("{n} subdomein(en) draaien op de live webserver maar hebben geen regel: {list}.", { n: missing.length, list: missing.slice(0, 8).map((x) => x.n).join(", ") }));
    else if (override) add("sub", "ok", t("Alle gevonden subdomeinen op de live webserver hebben een regel."));
    const rows = res.map(({ n, a }) => {
      const rule = matchRule(active, n);
      const same = a.ips.some((ip) => liveIps.has(ip));
      const ipCell = a.nx ? "NXDOMAIN" : a.ips.join(", ") || (a.cname ? `CNAME ${a.cname}` : "-");
      let action = rule ? h("span", { class: "b test" }, t("regel → {ip}", { ip: rule.ip })) : "";
      if (!rule && override && (a.ips.length || a.cname)) {
        const b = h("button", { class: "mini", type: "button" }, t("Regel toevoegen"));
        b.onclick = async () => {
          const s = await chrome.storage.local.get(["rules"]);
          const rules = Array.isArray(s.rules) ? s.rules : [];
          if (!rules.some((x) => x.host === n)) {
            const group = ctx.group || DEFAULT_GROUP;
            await chrome.storage.local.set({ rules: [...rules, { host: n, ip: override.name || override.ip, enabled: true, group, note: t("uit migratie-check") }] });
          }
          b.replaceWith(h("span", { class: "b test" }, t("toegevoegd")));
        };
        action = b;
      }
      return h("tr", { class: same && !rule ? "still" : "" }, h("td", {}, h("span", { class: "mono" }, n)), h("td", {}, h("span", { class: "mono" }, ipCell), same ? h("span", { class: "small" }, " " + t("(zelfde server)")) : ""), h("td", {}, action));
    });
    report.subs = h("div", { class: "tablewrap" }, h("table", { class: "mig" }, h("thead", {}, h("tr", {}, h("th", {}, t("Subdomein")), h("th", {}, t("Live IP")), h("th", {}, ""))), h("tbody", {}, rows)));
    step();
  })() : Promise.resolve();

  await Promise.all([regP, webP, mailP, subP]);
  if (live()) renderResults(true);
}


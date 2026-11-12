// Gedeelde hulpfuncties voor achtergrondscript en popup.
import { pairClient } from "./pair.js";
export const PORT = 8899;
export const EXPECTED_HELPER = 6; // verhoog als helper/proxy.js een nieuwe versie krijgt
export const HELPER_BASE = `http://127.0.0.1:${PORT}`;

// ---------- Gedeeld geheim met de helper ----------
// 32 willekeurige bytes (hex), eenmalig aangemaakt en bewaard in chrome.storage.local. Het setup-commando
// schrijft het in ~/.host-override/config.json; elke opdracht aan de helper stuurt het mee.
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
const SECRET_RE = /^[0-9a-f]{64}$/;

export async function getSecret() {
  const read = async () => (await chrome.storage.local.get("helperSecret")).helperSecret;
  let s = await read();
  if (SECRET_RE.test(s || "")) return s;
  // Lock: popup, welkomstpagina en achtergrond kunnen tegelijk starten; maak maar één geheim aan.
  const make = async () => {
    s = await read();
    if (SECRET_RE.test(s || "")) return s;
    s = hex(crypto.getRandomValues(new Uint8Array(32)));
    await chrome.storage.local.set({ helperSecret: s });
    return s;
  };
  return navigator.locks ? navigator.locks.request("host-override-secret", make) : make();
}

// Controleert of op poort 8899 echt onze helper draait: die moet HMAC(geheim, nonce) terugsturen.
// Pas daarna gaat het geheim (en gaan de regels) naar de helper.
// Uitkomst: { reachable, version, configured, verified, error }
export async function helperStatus() {
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  let json;
  try {
    const res = await fetch(`${HELPER_BASE}/__status?nonce=${nonce}`, { cache: "no-store" });
    json = await res.json().catch(() => null);
  } catch (e) {
    return { reachable: false, version: 0, configured: false, verified: false, error: String(e) };
  }
  const version = Number(json?.helper) || 1;
  const configured = json?.configured === true;
  let verified = false;
  if (configured && typeof json.proof === "string" && /^[0-9a-f]{64}$/.test(json.proof)) {
    try {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(await getSecret()),
        { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
      verified = await crypto.subtle.verify("HMAC", key, fromHex(json.proof), new TextEncoder().encode("host-override/status:" + nonce));
    } catch { verified = false; }
  }
  // features: uitbreidingen binnen protocol 6 (oudere v6-helpers sturen dit niet mee).
  const features = Array.isArray(json?.features) ? json.features.filter((f) => typeof f === "string").slice(0, 30) : [];
  return { reachable: true, version, configured, verified, features, pairing: json?.pairing === true, kind: json?.kind === "bin" ? "bin" : "node" };
}

// ---------- Helper als losse download (geen Node.js nodig) ----------
// De extensie linkt alleen naar de download; ze downloadt of start zelf nooit iets.
export const HELPER_RELEASES = "https://github.com/JanWillemBijker/host-override/releases/latest/download/";
// Zet op true zodra de binaries voor dat platform ondertekend (en voor macOS genotariseerd) zijn; dan verdwijnt
// de uitleg over "Toch openen" / "Toch uitvoeren". Zie store/SIGNING.md.
export const HELPER_SIGNED = { mac: false, win: false };

// "arm64" of "x64" (alleen relevant voor macOS). Chrome op Apple silicon meldt architecture "arm".
export async function detectArch() {
  try {
    const v = await navigator.userAgentData?.getHighEntropyValues?.(["architecture"]);
    if (v?.architecture) return v.architecture === "arm" ? "arm64" : "x64";
  } catch { /* geen client hints */ }
  return "arm64"; // macOS: vrijwel alle nieuwe Macs; de andere link staat er ook bij
}
export function helperAsset(os, arch = "arm64") {
  if (os === "mac") return `host-override-helper-macos-${arch === "x64" ? "x64" : "arm64"}.zip`;
  if (os === "win" || os === "winps") return "host-override-helper-windows-x64.exe";
  return "host-override-helper-linux-x64.tar.gz";
}
export const helperUrl = (os, arch) => HELPER_RELEASES + helperAsset(os, arch);

// Koppelen: de gebruiker typt de 6-cijferige code die de helper toont. De helper moet eerst bewijzen dat hij die
// code kent; pas dan gaat het geheim (versleuteld) naar hem toe (zie pair.js). Alleen als de helper op
// 127.0.0.1:8899 zegt dat er een koppelvenster open staat. Mislukt het bewijs, dan wordt dezelfde code niet nog eens
// gebruikt (de gebruiker moet hem opnieuw typen of een nieuwe code vragen).
// Uitkomst: { ok } of { ok: false, error: "missing" | "no-pairing" | "proof" | "reused" | "format" | ..., sent }
const failedCodes = new Set();
export async function pairHelper(code) {
  code = String(code || "").replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, error: "format" };
  if (failedCodes.has(code)) return { ok: false, error: "reused" };
  const st = await helperStatus();
  if (!st.reachable) return { ok: false, error: "missing" };
  if (!st.pairing) return { ok: false, error: "no-pairing" };
  const post = async (body) => {
    const res = await fetch(`${HELPER_BASE}/__pair`, {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Host-Override": "1" },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const r = await pairClient({ code, secret: await getSecret(), origin: location.origin, post });
  if (!r.ok && r.error !== "missing" && r.error !== "no-pairing") failedCodes.add(code);
  forgetHelper();
  return r;
}

// Korte cache per pagina/achtergrond, zodat niet elke DNS-vraag eerst een status-check doet.
let verifiedUntil = 0;
export function forgetHelper() { verifiedUntil = 0; }

// Opdracht aan de helper, met geheim. Weigert als de helper zich niet heeft bewezen.
export async function helperFetch(path, { method = "POST", body } = {}) {
  if (Date.now() > verifiedUntil) {
    const st = await helperStatus();
    if (!st.verified) {
      const e = new Error(!st.reachable ? "helper-missing" : st.version < EXPECTED_HELPER ? "helper-outdated" : "helper-setup");
      e.code = e.message;
      throw e;
    }
    verifiedUntil = Date.now() + 10000;
  }
  const res = await fetch(HELPER_BASE + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Host-Override": "1", "X-Host-Override-Token": await getSecret() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 403) forgetHelper();
  return res;
}

// Validatie, groepen, matchen en het hosts-formaat staan in model.js (puur, ook in Node te testen).
import { isHost, isIp, isTarget, isTargetHost, validRules, activeRules, matchRule, formatHosts, parseHosts, normState } from "./model.js";
export { isHost, isIp, isTarget, isTargetHost, validRules, activeRules, matchRule, formatHosts, parseHosts, normState };

// Alles wat de extensie over regels en groepen bewaart, genormaliseerd (migreert ook oude losse regels).
export const STATE_KEYS = ["enabled", "rules", "groups", "subs", "exclusiveGroups"];
export async function loadState() {
  return normState(await chrome.storage.local.get(STATE_KEYS));
}

// ---------- Besturingssysteem ----------
export const OS_LABELS = { mac: "macOS", win: "Windows (cmd)", winps: "Windows (PowerShell)", linux: "Linux" };

export function detectOS() {
  const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "").toLowerCase();
  if (p.includes("mac")) return "mac";
  if (p.includes("win")) return "win";
  return "linux";
}

// ---------- Apart Chrome-venster met dezelfde DNS-regels ----------
export function resolverRules(rules) {
  const parts = [];
  for (const r of validRules(rules).filter((x) => x.enabled !== false)) {
    // Doel is een IP of (gevalideerde) hostnaam; Chrome's MAP-regel accepteert beide.
    const ip = r.ip.includes(":") ? `[${r.ip}]` : r.ip;
    if (r.host.startsWith("*.")) parts.push(`MAP ${r.host.slice(2)} ${ip}`, `MAP ${r.host} ${ip}`);
    else parts.push(`MAP ${r.host} ${ip}`);
  }
  return [...new Set(parts)].join(", ");
}

export function buildChromeCommand(rules, os, profile = "chrome-test") {
  const map = resolverRules(rules);
  if (!map) return "";
  const flags = "--no-first-run --no-default-browser-check";
  if (os === "mac") {
    return `open -na "Google Chrome" --args \\\n  ${flags} \\\n  --user-data-dir="$HOME/${profile}" \\\n  --host-resolver-rules="${map}"`;
  }
  if (os === "win") {
    return `start "" chrome ${flags} --user-data-dir="%USERPROFILE%\\${profile}" --host-resolver-rules="${map}"`;
  }
  if (os === "winps") {
    return `Start-Process chrome -ArgumentList '${flags.split(" ").join("', '")}', "--user-data-dir=\`"$env:USERPROFILE\\${profile}\`"", '--host-resolver-rules="${map}"'`;
  }
  return `google-chrome \\\n  ${flags} \\\n  --user-data-dir="$HOME/${profile}" \\\n  --host-resolver-rules="${map}" &`;
}

// ---------- Setup-commando voor de helper ----------
const HELPER_FILES = ["proxy.js", "dnstools.js"];

// `read(pad)` geeft de tekst van een meegeleverd bestand terug. `extId` is het ID van deze extensie.
// config.json legt ID en geheim vast: de helper accepteert daarna alleen opdrachten met dat geheim.
export async function buildSetupCommand(os, read, extId = chrome.runtime.id, secret) {
  secret = secret || await getSecret();
  if (!/^[a-p]{32}$/.test(extId || "") || !SECRET_RE.test(secret)) throw new Error("geen geldig extensie-ID of geheim");
  const files = await Promise.all(HELPER_FILES.map(async (f) => [f, (await read(`helper/${f}`)).trimEnd()]));
  files.push(["config.json", JSON.stringify({ origins: [`chrome-extension://${extId}`], secret })]);
  if (os === "win" || os === "winps") {
    const setup = (await read("helper/setup.ps1")).trimEnd();
    let out = '$d = "$env:USERPROFILE\\.host-override"\nNew-Item -ItemType Directory -Force -Path $d | Out-Null\n';
    for (const [name, text] of files) out += "@'\n" + text + `\n'@ | Set-Content -Encoding UTF8 -Path "$d\\${name}"\n`;
    return out + setup + "\n";
  }
  const setup = (await read("helper/setup.sh")).trimEnd();
  // Map eerst afschermen (0700), zodat config.json met het geheim nooit voor anderen leesbaar is.
  let out = "mkdir -p ~/.host-override && chmod 700 ~/.host-override\n";
  files.forEach(([name, text], i) => {
    out += `cat > ~/.host-override/${name} <<'HO_FILE_${i}_EOF'\n${text}\nHO_FILE_${i}_EOF\n`;
  });
  return out + "bash <<'HO_SETUP_EOF'\n" + setup + "\nHO_SETUP_EOF\n";
}

// Laad de tab opnieuw als een wijziging van de regels die tab raakt (nieuwe verbinding, geen cache).
export async function reloadIfAffected(tab, oldState, newState) {
  if (!tab?.url || !/^https?:/.test(tab.url)) return;
  const host = new URL(tab.url).hostname;
  const before = matchRule(activeRules(oldState), host)?.ip ?? null;
  const after = matchRule(activeRules(newState), host)?.ip ?? null;
  if (before !== after) await chrome.tabs.reload(tab.id, { bypassCache: true });
}

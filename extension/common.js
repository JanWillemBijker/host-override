// Gedeelde hulpfuncties voor achtergrondscript en popup.
export const PORT = 8899;
export const EXPECTED_HELPER = 4; // verhoog als helper/proxy.js een nieuwe versie krijgt

const HOST_RE = /^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+$/i;

export const isHost = (h) => HOST_RE.test(h);

export function isIp(ip) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split(".").every((n) => +n <= 255);
  return ip.includes(":") && /^[0-9a-f:.]+$/i.test(ip);
}

export function activeRules({ enabled, rules }) {
  return enabled ? rules.filter((r) => r.enabled !== false) : [];
}

// Zelfde matchlogica als de PAC-regel en de proxy: exact, of "*.domein" voor domein + subdomeinen.
export function matchRule(rules, host) {
  const h = host.toLowerCase();
  for (const r of rules) {
    const p = r.host.toLowerCase();
    if (p.startsWith("*.")) {
      const base = p.slice(2);
      if (h === base || h.endsWith("." + base)) return r;
    } else if (h === p) return r;
  }
  return null;
}

// Hosts-bestand-formaat: "1.2.3.4 voorbeeld.nl www.voorbeeld.nl". Uitgezette regels: "#off 1.2.3.4 voorbeeld.nl".
export function formatHosts(rules) {
  return rules.map((r) => `${r.enabled === false ? "#off " : ""}${r.ip} ${r.host}`).join("\n");
}

export function parseHosts(text) {
  const rules = [];
  let skipped = 0;
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    let enabled = true;
    if (/^#off\s/i.test(line)) { enabled = false; line = line.slice(4).trim(); }
    else if (line.startsWith("#")) continue;
    line = line.replace(/\s+#.*$/, "");
    const [ip, ...hosts] = line.split(/\s+/);
    if (!isIp(ip) || hosts.length === 0) { skipped++; continue; }
    for (const h of hosts) {
      const host = h.toLowerCase();
      if (isHost(host)) rules.push({ host, ip, enabled });
      else skipped++;
    }
  }
  return { rules, skipped };
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
  for (const r of rules.filter((x) => x.enabled !== false)) {
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

// `read(pad)` geeft de tekst van een meegeleverd bestand terug.
export async function buildSetupCommand(os, read) {
  const files = await Promise.all(HELPER_FILES.map(async (f) => [f, (await read(`helper/${f}`)).trimEnd()]));
  if (os === "win" || os === "winps") {
    const setup = (await read("helper/setup.ps1")).trimEnd();
    let out = '$d = "$env:USERPROFILE\\.host-override"\nNew-Item -ItemType Directory -Force -Path $d | Out-Null\n';
    for (const [name, text] of files) out += "@'\n" + text + `\n'@ | Set-Content -Encoding UTF8 -Path "$d\\${name}"\n`;
    return out + setup + "\n";
  }
  const setup = (await read("helper/setup.sh")).trimEnd();
  let out = "mkdir -p ~/.host-override\n";
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

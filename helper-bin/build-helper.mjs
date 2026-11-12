// Bouwt de Host Override helper als losse binary per platform (Node Single Executable Application).
//   node helper-bin/build-helper.mjs [--targets macos-arm64,macos-x64,windows-x64,linux-x64] [--universal] [--bundle-only]
// Normaal via ./build-helper.sh. Uitvoer in dist/helper/ (gitignored, nooit in de extensie-zip):
//   host-override-helper.js                    gebundelde helper (proxy.js + dnstools.js + service.js), ook met node te starten
//   host-override-helper-macos-arm64.zip       (en -macos-x64.zip, optioneel -macos-universal.zip)
//   host-override-helper-windows-x64.exe
//   host-override-helper-linux-x64.tar.gz
//   SHA256SUMS
//
// Werking: de officiële Node.js-binary (versie NODE_VERSION, gedownload van nodejs.org en gecontroleerd tegen
// SHASUMS256.txt) krijgt de gebundelde helper ingebakken met `node --build-sea`. Dat kan voor alle platforms vanaf
// één machine; alleen macOS-binaries moeten op een Mac ondertekend worden (codesign), en Windows-ondertekening
// gebeurt op Windows (signtool) of met osslsigncode.
//
// Ondertekenen (alles optioneel; zonder: ongetekende build met een duidelijke waarschuwing). Zie store/SIGNING.md.
//   macOS : APPLE_DEV_ID ("Developer ID Application: Naam (TEAMID)"), APPLE_TEAM_ID,
//           notarisatie met APPLE_NOTARY_PROFILE (notarytool-sleutelhangerprofiel) of
//           APPLE_ID + APPLE_APP_PASSWORD (+ APPLE_TEAM_ID) of APPLE_API_KEY_PATH + APPLE_API_KEY_ID + APPLE_API_ISSUER.
//   Windows: WIN_CERT_PATH + WIN_CERT_PASSWORD (.pfx), of WIN_CERT_SHA1 (certificaat in de Windows-certstore/token),
//           of AZURE_SIGNING_DLIB + AZURE_SIGNING_METADATA (Azure Artifact Signing via signtool).
//           WIN_TIMESTAMP_URL (standaard http://timestamp.acs.microsoft.com bij Azure, anders http://timestamp.digicert.com).
"use strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "helper");
const STAGE = path.join(OUT, "stage");
const CACHE = path.join(ROOT, ".cache", "node");
const NODE_VERSION = process.env.NODE_VERSION || "v26.13.1"; // Node LTS; bijwerken bij een nieuwe LTS-patch
const NAME = "host-override-helper";

const TARGETS = {
  "macos-arm64": { node: "darwin-arm64", archive: "tar.gz", exe: "bin/node", os: "darwin" },
  "macos-x64": { node: "darwin-x64", archive: "tar.gz", exe: "bin/node", os: "darwin" },
  "windows-x64": { node: "win-x64", archive: "zip", exe: "node.exe", os: "win32" },
  "linux-x64": { node: "linux-x64", archive: "tar.xz", exe: "bin/node", os: "linux" },
};
const HOST = { "darwin-arm64": "macos-arm64", "darwin-x64": "macos-x64", "win32-x64": "windows-x64", "linux-x64": "linux-x64" }[`${process.platform}-${process.arch}`];

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const flag = (name) => argv.includes(name);
const env = process.env;
const warnings = [];
const warn = (m) => { warnings.push(m); console.warn("\x1b[33mLET OP:\x1b[0m " + m); };
const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { stdio: "inherit", ...o });
const have = (cmd) => { try { execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" }); return true; } catch { return false; } };
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

// ---------- 1. Bundelen ----------
// SEA kent alleen ingebouwde modules in require(); proxy.js laadt ./dnstools.js en ./service.js. We pakken die
// in een kleine module-tabel. Geen dependencies, geen minificatie: de bundel blijft leesbaar en controleerbaar.
function bundle() {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/^#!.*\n/, "");
  const mods = { "./dnstools.js": read("extension/helper/dnstools.js"), "./service.js": read("helper-bin/service.js") };
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "extension", "manifest.json"), "utf8")).version;
  let out = `// Host Override helper ${version} (gebundeld door helper-bin/build-helper.mjs; bron: extension/helper/*.js en helper-bin/service.js)\n"use strict";\n`;
  out += "const __mods = {\n";
  for (const [name, src] of Object.entries(mods)) out += `${JSON.stringify(name)}: function (module, exports, require) {\n${src}\n},\n`;
  out += "};\nconst __cache = {};\nconst __nativeRequire = require;\n";
  out += "function __require(n) {\n  if (!Object.prototype.hasOwnProperty.call(__mods, n)) return __nativeRequire(n);\n" +
    "  if (!__cache[n]) { const m = { exports: {} }; __cache[n] = m; __mods[n](m, m.exports, __require); }\n  return __cache[n].exports;\n}\n";
  out += `(function (require) {\n${read("extension/helper/proxy.js")}\n})(__require);\n`;
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${NAME}.js`);
  fs.writeFileSync(file, out);
  execFileSync(process.execPath, ["--check", file]);
  return file;
}

// ---------- 2. Node-binaries ophalen en controleren ----------
async function fetchFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}
async function nodeBinary(target) {
  const t = TARGETS[target];
  const dir = path.join(CACHE, NODE_VERSION, t.node);
  const exe = path.join(dir, path.basename(t.exe));
  if (fs.existsSync(exe)) return exe;
  fs.mkdirSync(dir, { recursive: true });
  const sums = path.join(CACHE, NODE_VERSION, "SHASUMS256.txt");
  if (!fs.existsSync(sums)) await fetchFile(`https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`, sums);
  const base = `node-${NODE_VERSION}-${t.node}`;
  const file = `${base}.${t.archive}`;
  const archive = path.join(CACHE, NODE_VERSION, file);
  if (!fs.existsSync(archive)) { console.log(`Download ${file}...`); await fetchFile(`https://nodejs.org/dist/${NODE_VERSION}/${file}`, archive); }
  const want = fs.readFileSync(sums, "utf8").split("\n").find((l) => l.trim().endsWith("  " + file))?.split(/\s+/)[0];
  if (!want || want !== sha256(archive)) { fs.rmSync(archive); throw new Error(`Controlegetal klopt niet voor ${file}`); }
  const member = `${base}/${t.exe}`;
  if (t.archive === "zip") {
    // Windows: de ingebouwde bsdtar (leest zip); de GNU tar van Git Bash kan dat niet.
    if (process.platform === "win32") sh(path.join(env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-xf", archive, "-C", dir, "--strip-components=1", member]);
    else sh("unzip", ["-q", "-j", "-o", archive, member, "-d", dir]);
  } else sh("tar", ["-xf", archive, "-C", dir, `--strip-components=${t.exe.split("/").length}`, member]);
  if (t.os === "win32") stripAuthenticode(exe); // handtekening van de OpenJS Foundation klopt na het inbakken niet meer
  return exe;
}

// Verwijdert de Authenticode-handtekening uit een PE-bestand (security directory leeg, certificaattabel eraf).
function stripAuthenticode(file) {
  const b = fs.readFileSync(file);
  const pe = b.readUInt32LE(0x3c);
  if (b.readUInt32LE(pe) !== 0x4550) throw new Error("geen PE-bestand: " + file);
  const optHdr = pe + 24;
  const dd = optHdr + (b.readUInt16LE(optHdr) === 0x20b ? 112 : 96);
  const off = b.readUInt32LE(dd + 4 * 8), size = b.readUInt32LE(dd + 4 * 8 + 4);
  if (!off || !size) return;
  if (off + size !== b.length) throw new Error("onverwachte plek van de certificaattabel in " + file);
  b.writeUInt32LE(0, dd + 32); b.writeUInt32LE(0, dd + 36);
  fs.writeFileSync(file, b.subarray(0, off));
}

// ---------- 3. Binary maken ----------
async function build(target, bundleFile, hostNode) {
  const t = TARGETS[target];
  const dir = path.join(STAGE, target);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, t.os === "win32" ? `${NAME}.exe` : NAME);
  const cfg = path.join(dir, "sea-config.json");
  fs.writeFileSync(cfg, JSON.stringify({
    main: bundleFile, output: out, executable: await nodeBinary(target),
    disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, // code cache is platformgebonden
  }, null, 2));
  sh(hostNode, ["--build-sea", cfg]);
  fs.rmSync(cfg);
  if (t.os !== "win32") fs.chmodSync(out, 0o755);
  return out;
}

// ---------- 4. Ondertekenen ----------
function signMac(file) {
  if (process.platform !== "darwin") { warn(`${path.basename(path.dirname(file))}: macOS-binaries kunnen alleen op een Mac ondertekend worden; overgeslagen.`); return false; }
  sh("codesign", ["--remove-signature", file]);
  if (env.APPLE_DEV_ID) {
    sh("codesign", ["--force", "--options", "runtime", "--timestamp", "--entitlements", path.join(ROOT, "helper-bin", "entitlements.plist"), "--sign", env.APPLE_DEV_ID, file]);
    sh("codesign", ["--verify", "--strict", "--verbose=2", file]);
    return true;
  }
  // Ad-hoc: nodig om op Apple silicon überhaupt te starten; geeft geen vertrouwen (Gatekeeper blokkeert een download).
  sh("codesign", ["--force", "--options", "runtime", "--entitlements", path.join(ROOT, "helper-bin", "entitlements.plist"), "--sign", "-", file]);
  return false;
}
function notarize(zip) {
  let auth = null;
  if (env.APPLE_NOTARY_PROFILE) auth = ["--keychain-profile", env.APPLE_NOTARY_PROFILE];
  else if (env.APPLE_ID && env.APPLE_APP_PASSWORD && env.APPLE_TEAM_ID) auth = ["--apple-id", env.APPLE_ID, "--password", env.APPLE_APP_PASSWORD, "--team-id", env.APPLE_TEAM_ID];
  else if (env.APPLE_API_KEY_PATH && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) auth = ["--key", env.APPLE_API_KEY_PATH, "--key-id", env.APPLE_API_KEY_ID, "--issuer", env.APPLE_API_ISSUER];
  if (!auth) { warn(`${path.basename(zip)} is ondertekend maar NIET genotariseerd (geen APPLE_NOTARY_PROFILE / APPLE_ID+APPLE_APP_PASSWORD / API-sleutel).`); return; }
  sh("xcrun", ["notarytool", "submit", zip, ...auth, "--wait"]);
  // Een losse binary kan geen 'stapled' ticket dragen; Gatekeeper haalt het ticket online op bij de eerste start.
}
function signWindows(file) {
  const ts = env.WIN_TIMESTAMP_URL || (env.AZURE_SIGNING_DLIB ? "http://timestamp.acs.microsoft.com" : "http://timestamp.digicert.com");
  const common = ["/fd", "SHA256", "/tr", ts, "/td", "SHA256", "/d", "Host Override helper"];
  if (env.AZURE_SIGNING_DLIB && env.AZURE_SIGNING_METADATA) {
    if (!have("signtool")) { warn("Azure Artifact Signing vraagt signtool (Windows SDK) op Windows."); return false; }
    sh("signtool", ["sign", "/v", ...common, "/dlib", env.AZURE_SIGNING_DLIB, "/dmdf", env.AZURE_SIGNING_METADATA, file]);
  } else if (env.WIN_CERT_SHA1) {
    if (!have("signtool")) { warn("WIN_CERT_SHA1 vraagt signtool op Windows (certificaat in de certstore of op een token)."); return false; }
    sh("signtool", ["sign", "/v", ...common, "/sha1", env.WIN_CERT_SHA1, file]);
  } else if (env.WIN_CERT_PATH) {
    if (have("signtool")) sh("signtool", ["sign", "/v", ...common, "/f", env.WIN_CERT_PATH, "/p", env.WIN_CERT_PASSWORD || "", file], { stdio: ["ignore", "inherit", "inherit"] });
    else if (have("osslsigncode")) {
      const tmp = file + ".signed";
      sh("osslsigncode", ["sign", "-pkcs12", env.WIN_CERT_PATH, "-pass", env.WIN_CERT_PASSWORD || "", "-h", "sha256", "-n", "Host Override helper", "-ts", ts, "-in", file, "-out", tmp]);
      fs.renameSync(tmp, file);
    } else { warn("WIN_CERT_PATH gezet, maar signtool en osslsigncode ontbreken."); return false; }
  } else return false;
  return true;
}

// ---------- 5. Inpakken ----------
function pack(target, bin) {
  const t = TARGETS[target];
  const name = `${NAME}-${target}`;
  if (t.os === "darwin") {
    const zip = path.join(OUT, `${name}.zip`);
    fs.rmSync(zip, { force: true });
    if (process.platform === "darwin") sh("ditto", ["-c", "-k", "--norsrc", "--noextattr", "--noacl", bin, zip]); // behoudt rechten; handtekening zit in de binary
    else sh("zip", ["-j", "-q", zip, bin]);
    return zip;
  }
  if (t.os === "win32") { const exe = path.join(OUT, `${name}.exe`); fs.copyFileSync(bin, exe); return exe; }
  const tgz = path.join(OUT, `${name}.tar.gz`);
  sh("tar", ["-czf", tgz, "-C", path.dirname(bin), path.basename(bin)]);
  return tgz;
}

// ---------- Hoofdprogramma ----------
const bundleFile = bundle();
console.log("Bundel:", path.relative(ROOT, bundleFile));
if (flag("--bundle-only")) process.exit(0);
if (!HOST) throw new Error(`Bouwen op ${process.platform}-${process.arch} wordt niet ondersteund`);

let targets = (opt("--targets") || Object.keys(TARGETS).join(",")).split(",").map((s) => s.trim()).filter(Boolean);
for (const t of targets) if (!TARGETS[t]) throw new Error("Onbekend doel: " + t);
if (process.platform !== "darwin" && targets.some((t) => TARGETS[t].os === "darwin")) {
  warn("macOS-doelen overgeslagen: die moeten op een Mac gebouwd en ondertekend worden (codesign).");
  targets = targets.filter((t) => TARGETS[t].os !== "darwin");
}
const hostNode = await nodeBinary(HOST);
const assets = [];
const signed = {};
const macBins = {};
for (const target of targets) {
  console.log(`\n== ${target} ==`);
  const bin = await build(target, bundleFile, hostNode);
  const os = TARGETS[target].os;
  if (os === "darwin") { signed[target] = signMac(bin); macBins[target] = bin; }
  else if (os === "win32") signed[target] = signWindows(bin);
  else signed[target] = null; // Linux: geen ondertekening nodig; SHA256SUMS
  const file = pack(target, bin);
  if (os === "darwin" && signed[target]) notarize(file);
  assets.push(file);
}
if (flag("--universal") && macBins["macos-arm64"] && macBins["macos-x64"]) {
  console.log("\n== macos-universal ==");
  const dir = path.join(STAGE, "macos-universal");
  fs.mkdirSync(dir, { recursive: true });
  const uni = path.join(dir, NAME);
  sh("lipo", ["-create", macBins["macos-arm64"], macBins["macos-x64"], "-output", uni]);
  signed["macos-universal"] = signMac(uni);
  const zip = path.join(OUT, `${NAME}-macos-universal.zip`);
  fs.rmSync(zip, { force: true });
  sh("ditto", ["-c", "-k", "--norsrc", "--noextattr", "--noacl", uni, zip]);
  if (signed["macos-universal"]) notarize(zip);
  assets.push(zip);
}

// Controlegetallen voor alle assets in dist/helper (ook van eerdere builds voor andere platforms, bv. in CI).
const all = fs.readdirSync(OUT).filter((f) => f.startsWith(NAME + "-") && /\.(zip|exe|tar\.gz)$/.test(f)).sort();
fs.writeFileSync(path.join(OUT, "SHA256SUMS"), all.map((f) => `${sha256(path.join(OUT, f))}  ${f}`).join("\n") + "\n");
fs.rmSync(STAGE, { recursive: true, force: true });

console.log("\nKlaar (Node " + NODE_VERSION + "):");
for (const f of all) console.log(`  ${f}  ${(fs.statSync(path.join(OUT, f)).size / 1048576).toFixed(1)} MB`);
console.log("  SHA256SUMS");
for (const [t, s] of Object.entries(signed)) {
  if (s === false) warn(`${t}: NIET ondertekend. ${TARGETS[t]?.os === "win32" ? "Windows SmartScreen waarschuwt bij openen." : "Gatekeeper blokkeert de download tot de gebruiker 'Toch openen' kiest."} Zie store/SIGNING.md.`);
}
if (warnings.length) console.warn(`\n${warnings.length} waarschuwing(en), zie hierboven.`);

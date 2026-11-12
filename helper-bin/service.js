// Host Override helper-binary: automatisch starten bij inloggen aan- of uitzetten.
// Alleen voor de losse binary (wordt mee-gebundeld door build-helper.mjs); de Node-route gebruikt setup.sh/setup.ps1.
// Zelfde eigenschappen als de Node-route: map ~/.host-override 0700, bestanden 0600, helper luistert alleen op
// 127.0.0.1 en weigert alles zonder geldige config.json. Externe programma's (launchctl, systemctl, wscript,
// powershell) worden zonder shell aangeroepen (execFileSync met losse argumenten).
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const LABEL = "com.hostoverride.proxy"; // zelfde naam als de Node-route: de binary vervangt die netjes
const UNIT = "host-override.service";
const DRY = process.env.HO_DRY_INSTALL === "1"; // tests: alleen bestanden schrijven, niets starten of stoppen
const PLATFORM = (DRY && process.env.HO_PLATFORM) || process.platform;
const HOME = os.homedir();
const DIR = path.join(HOME, ".host-override");
const IS_BIN = (() => { try { return require("node:sea").isSea(); } catch { return false; } })();
const BIN = path.join(DIR, "bin", PLATFORM === "win32" ? "host-override-helper.exe" : "host-override-helper");

const run = (cmd, args) => { if (DRY) return ""; try { return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }).toString(); } catch { return null; } };
const xmlEsc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const qSystemd = (s) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "$$$$").replace(/%/g, "%%") + '"';
const qDesktop = (s) => '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/`/g, "\\`").replace(/\$/g, "\\$").replace(/\\/g, "\\\\").replace(/%/g, "%%") + '"';
const writePrivate = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, { mode: 0o600 }); if (PLATFORM !== "win32") fs.chmodSync(file, 0o600); };

function paths() {
  const cfg = process.env.XDG_CONFIG_HOME || path.join(HOME, ".config");
  return {
    plist: path.join(HOME, "Library", "LaunchAgents", LABEL + ".plist"),
    log: path.join(HOME, "Library", "Logs", "host-override.log"),
    unit: path.join(cfg, "systemd", "user", UNIT),
    desktop: path.join(cfg, "autostart", "host-override.desktop"),
    startup: path.join(process.env.APPDATA || path.join(HOME, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "HostOverride.vbs"),
  };
}

// Wat de dienst start: de gekopieerde binary, of (tests/ontwikkeling) node + deze gebundelde helper.
function program() {
  return IS_BIN ? [BIN, "--serve"] : [process.execPath, path.join(DIR, "bin", "host-override-helper.js"), "--serve"];
}

function copySelf() {
  fs.mkdirSync(path.join(DIR, "bin"), { recursive: true, mode: 0o700 });
  if (PLATFORM !== "win32") { fs.chmodSync(DIR, 0o700); fs.chmodSync(path.join(DIR, "bin"), 0o700); }
  const src = IS_BIN ? process.execPath : process.argv[1]; // node host-override-helper.js --install
  const dst = IS_BIN ? BIN : path.join(DIR, "bin", "host-override-helper.js");
  if (path.resolve(src) === path.resolve(dst)) return;
  const tmp = dst + ".new";
  fs.copyFileSync(src, tmp);
  fs.chmodSync(tmp, 0o700);
  fs.renameSync(tmp, dst); // atomisch; een draaiende oude versie is eerst gestopt
}

function stop() {
  const p = paths();
  if (PLATFORM === "darwin") run("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`]);
  else if (PLATFORM === "linux") {
    run("systemctl", ["--user", "stop", UNIT]);
    run("pkill", ["-f", path.join(DIR, "proxy.js")]);
    run("pkill", ["-f", path.join(DIR, "bin", "host-override-helper")]);
  } else if (PLATFORM === "win32") {
    // Oude Node-helper en een eerder geïnstalleerde binary stoppen, niet dit proces zelf.
    const ps = "Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne " + process.pid +
      " -and (($_.Name -eq 'node.exe' -and $_.CommandLine -like '*.host-override*proxy.js*') -or ($_.ExecutablePath -eq $env:HO_BIN)) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }";
    if (!DRY) { try { execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { env: { ...process.env, HO_BIN: BIN }, stdio: "ignore" }); } catch { /* niets te stoppen */ } }
  }
  void p;
}

function install() {
  const p = paths();
  if (!fs.existsSync(path.join(DIR, "config.json"))) console.warn("Let op: nog niet gekoppeld (config.json ontbreekt). De helper weigert alle opdrachten tot je koppelt (start met --pair).");
  stop();
  copySelf();
  const [cmd, ...args] = program();
  if (PLATFORM === "darwin") {
    fs.mkdirSync(path.dirname(p.log), { recursive: true });
    writePrivate(p.plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${[cmd, ...args].map((a) => `    <string>${xmlEsc(a)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xmlEsc(p.log)}</string>
  <key>StandardErrorPath</key><string>${xmlEsc(p.log)}</string>
</dict>
</plist>
`);
    fs.chmodSync(p.plist, 0o644); // launchd leest de plist; er staat geen geheim in
    if (!DRY && run("launchctl", ["bootstrap", `gui/${process.getuid()}`, p.plist]) === null) throw new Error("launchctl bootstrap mislukte; zie " + p.log);
  } else if (PLATFORM === "linux") {
    const hasSystemd = DRY || run("systemctl", ["--user", "show-environment"]) !== null;
    if (hasSystemd) {
      writePrivate(p.unit, `[Unit]\nDescription=Host Override proxy\n\n[Service]\nExecStart=${[cmd, ...args].map(qSystemd).join(" ")}\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=default.target\n`);
      run("systemctl", ["--user", "daemon-reload"]);
      run("systemctl", ["--user", "enable", UNIT]);
      if (!DRY && run("systemctl", ["--user", "restart", UNIT]) === null) throw new Error("systemctl --user restart mislukte");
    } else {
      writePrivate(p.desktop, `[Desktop Entry]\nType=Application\nName=Host Override proxy\nExec=${[cmd, ...args].map(qDesktop).join(" ")}\nX-GNOME-Autostart-enabled=true\n`);
      if (!DRY) spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
    }
  } else if (PLATFORM === "win32") {
    // Onzichtbaar starten bij inloggen (Opstarten-map), zoals de Node-route. Paden kunnen geen " bevatten.
    const line = 'CreateObject("WScript.Shell").Run ' + '"' + [cmd, ...args].map((a) => '""' + a + '""').join(" ") + '"' + ", 0, False";
    fs.mkdirSync(path.dirname(p.startup), { recursive: true });
    fs.writeFileSync(p.startup, line + "\r\n", { encoding: "ascii" });
    if (!DRY) spawn("wscript.exe", [p.startup], { detached: true, stdio: "ignore" }).unref();
  } else throw new Error("Onbekend systeem: " + PLATFORM);
  console.log(DRY ? "DRY: bestanden klaargezet, niets gestart." : "Klaar. De helper draait en start voortaan automatisch bij inloggen. Je kunt dit venster sluiten.");
  // Dubbelklik op Windows: consolevenster even open houden zodat de melding leesbaar is.
  if (PLATFORM === "win32" && IS_BIN && !DRY && process.stdout.isTTY) setTimeout(() => {}, 15000);
  return { program: [cmd, ...args], ...p };
}

function uninstall() {
  const p = paths();
  stop();
  if (PLATFORM === "darwin") fs.rmSync(p.plist, { force: true });
  else if (PLATFORM === "linux") {
    run("systemctl", ["--user", "disable", UNIT]);
    fs.rmSync(p.unit, { force: true }); fs.rmSync(p.desktop, { force: true });
  } else if (PLATFORM === "win32") fs.rmSync(p.startup, { force: true });
  try { fs.rmSync(DIR, { recursive: true, force: true }); }
  catch (e) { console.warn(`Kon ${DIR} niet helemaal verwijderen (${e.message}). Verwijder de map zelf.`); }
  console.log("Helper verwijderd. Verwijder daarna de extensie zelf via chrome://extensions.");
}

module.exports = { install, uninstall, stop, paths, BIN, LABEL };

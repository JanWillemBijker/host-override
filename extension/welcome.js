import { OS_LABELS, detectOS, buildSetupCommand } from "./common.js";
import { initI18n, t } from "./i18n.js";

await initI18n();

const $ = (id) => document.getElementById(id);
let os = detectOS();
const read = (p) => fetch(chrome.runtime.getURL(p)).then((r) => r.text());

for (const [value, label] of Object.entries(OS_LABELS)) {
  if (value === "winps") continue; // één Windows-keuze: het commando draait in PowerShell
  const o = document.createElement("option");
  o.value = value === "win" ? "winps" : value;
  o.textContent = value === "win" ? "Windows" : label;
  $("os").append(o);
}
if (os === "win") os = "winps";

async function renderOs() {
  $("os").value = os;
  const win = os === "winps";
  $("term").textContent = win ? "PowerShell" : "Terminal";
  $("termHint").textContent = win
    ? t("Zoek in het Startmenu naar PowerShell.")
    : os === "mac" ? t("Druk op Cmd+Spatie en typ Terminal.") : t("Meestal Ctrl+Alt+T.");
  $("paste").textContent = os === "mac" ? "Cmd+V" : "Ctrl+V";
  $("cmd").value = await buildSetupCommand(os, read);
}
$("os").onchange = () => { os = $("os").value; renderOs(); };
$("copy").onclick = async () => {
  await navigator.clipboard.writeText($("cmd").value);
  $("copy").textContent = t("Gekopieerd, plak het nu");
  setTimeout(() => ($("copy").textContent = t("Kopieer setup-commando")), 2000);
};

// Controleer elke 2 seconden of de helper draait.
async function poll() {
  try {
    const r = await fetch("http://127.0.0.1:8899/__status");
    if (r.ok) {
      $("state").className = "state ok";
      $("stateText").textContent = t("Helper actief. Je bent klaar voor stap 2.");
      return;
    }
  } catch { /* helper draait nog niet */ }
  $("state").className = "state wait";
  $("stateText").textContent = t("Wachten op de helper...");
  setTimeout(poll, 2000);
}

renderOs();
poll();

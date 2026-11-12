import { OS_LABELS, detectOS, detectArch, buildSetupCommand, helperStatus, EXPECTED_HELPER, helperUrl, helperAsset, HELPER_RELEASES, HELPER_SIGNED, pairHelper } from "./common.js";
import { initI18n, t } from "./i18n.js";
import { openText, unsignedText, pairError } from "./helpertext.js";
import { formatCode } from "./pair.js";

await initI18n();

const $ = (id) => document.getElementById(id);
let os = detectOS();
const arch = await detectArch();
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
  // Download (alleen een link: de extensie downloadt of start zelf niets).
  $("dl").href = helperUrl(os, arch);
  $("dl").textContent = os === "mac" ? (arch === "x64" ? t("Download voor macOS (Intel)") : t("Download voor macOS (Apple silicon)"))
    : win ? t("Download voor Windows") : t("Download voor Linux (x64)");
  const alt = os === "mac" ? (arch === "x64" ? "arm64" : "x64") : null;
  $("dlAlt").hidden = !alt;
  if (alt) { $("dlAlt").href = helperUrl("mac", alt); $("dlAlt").textContent = alt === "x64" ? t("Intel-Mac? Download voor Intel") : t("Mac met Apple silicon? Download die versie"); }
  $("sums").href = HELPER_RELEASES + "SHA256SUMS";
  $("openText").textContent = openText(os, helperAsset(os, arch), t);
  $("unsignedText").textContent = unsignedText(os, HELPER_SIGNED, t);
  // Geavanceerd: Node.js-route (setup-commando plakken).
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

$("code").oninput = () => { const el = $("code"); el.value = formatCode(el.value); };
$("pairForm").onsubmit = async (e) => {
  e.preventDefault();
  const btn = $("pairForm").querySelector("button");
  btn.disabled = true;
  $("pairMsg").className = "pairmsg";
  $("pairMsg").textContent = t("Koppelen...");
  const r = await pairHelper($("code").value);
  btn.disabled = false;
  $("pairMsg").className = "pairmsg " + (r.ok ? "ok" : "bad");
  $("pairMsg").textContent = r.ok ? t("Gekoppeld. De helper zet zich nu klaar om automatisch te starten.") : pairError(r, t);
  if (r.ok) { $("code").value = ""; poll(); }
};

// Controleer elke 2 seconden of de helper draait en deze extensie herkent (bewijs met het geheim).
let timer = null;
async function poll() {
  clearTimeout(timer);
  const st = await helperStatus();
  if (st.verified) {
    $("state").className = "state ok";
    $("stateText").textContent = t("Helper actief. Je bent klaar voor stap 2.");
    return;
  }
  $("state").className = "state wait";
  $("stateText").textContent = !st.reachable ? t("Wachten op de helper...")
    : st.pairing ? t("De helper wacht op de koppelcode. Typ of plak de 12 tekens hierboven.")
    : st.version < EXPECTED_HELPER ? t("Er draait een oudere helper. Download de nieuwe helper (of gebruik het Node.js-commando) om hem bij te werken.")
    : t("De helper draait, maar herkent deze extensie nog niet. Open de gedownloade helper opnieuw voor een koppelcode.");
  timer = setTimeout(poll, 2000);
}

renderOs();
poll();

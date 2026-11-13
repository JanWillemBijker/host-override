// Teksten voor het installeren van de helper-download (welkomstpagina en popup). Alleen tekst: de extensie
// downloadt of start zelf niets.

export function openText(os, file, t) {
  if (os === "mac") return t("Open het zip-bestand en dubbelklik op host-override-helper. Er opent een Terminal-venster.");
  if (os === "win" || os === "winps") return t("Dubbelklik op het gedownloade bestand ({f}). Er opent een venster.", { f: file });
  return t("Pak het uit en start host-override-helper vanuit een terminal (zie hieronder).");
}

// Zolang de binaries niet ondertekend zijn, waarschuwt het systeem bij het openen. Stappen plus een
// kant-en-klaar terminalcommando (met kopieerknop) dat de waarschuwing overslaat.
export function unsignedHelp(os, file, signed, t) {
  if (os === "mac" && !signed.mac) return {
    title: t("Melding \"Apple kon niet verifiëren…\"? Zo open je de helper toch"),
    steps: [
      t("Klik in de melding op <b>Gereed</b> (niet op \"Verplaats naar prullenmand\")."),
      t("Open <b>Systeeminstellingen</b> → <b>Privacy en beveiliging</b>."),
      t("Scrol helemaal naar beneden. Bij <i>\"host-override-helper\" is geblokkeerd</i> klik je op <b>Toch openen</b> en bevestig je met je wachtwoord of Touch ID."),
      t("Open de helper opnieuw en kies <b>Toch openen</b>. Daarna verschijnt het venster met de koppelcode."),
    ],
    cmdIntro: t("Sneller: plak dit in Terminal (Cmd+Spatie, typ Terminal). Het haalt de blokkade weg en opent de helper meteen:"),
    cmd: "xattr -dr com.apple.quarantine ~/Downloads/host-override-helper && open ~/Downloads/host-override-helper",
    note: t("Werkt als de helper na het uitpakken in Downloads staat."),
  };
  if ((os === "win" || os === "winps") && !signed.win) return {
    title: t("Melding \"Windows heeft uw pc beschermd\"? Zo open je de helper toch"),
    steps: [
      t("Zegt Chrome bij het downloaden dat het bestand niet vaak wordt gedownload? Open de downloads (Ctrl+J) en kies bij het bestand <b>Behouden</b>."),
      t("Krijg je bij het openen \"Windows heeft uw pc beschermd\"? Klik op <b>Meer info</b>."),
      t("Klik op <b>Toch uitvoeren</b>. Daarna verschijnt het venster met de koppelcode."),
    ],
    cmdIntro: t("Sneller: plak dit in PowerShell (zoek in het Startmenu naar PowerShell). Het haalt de blokkade weg en opent de helper meteen:"),
    cmd: `$f = "$env:USERPROFILE\\Downloads\\${file}"; Unblock-File $f; Start-Process $f`,
    note: t("Werkt als de helper in Downloads staat."),
  };
  if (os === "linux") return {
    title: t("Starten vanuit de terminal"),
    steps: [],
    cmdIntro: t("Plak dit in een terminal (meestal Ctrl+Alt+T). Het pakt de helper uit en start hem:"),
    cmd: `cd ~/Downloads && tar -xzf ${file} && ./host-override-helper`,
    note: t("Werkt als de download in Downloads staat."),
  };
  return null;
}

// Tekent de hulp in el (statische teksten uit dit pakket; het commando als platte tekst).
export function renderUnsigned(el, help, t, { open = false } = {}) {
  el.replaceChildren();
  el.hidden = !help;
  if (!help) return;
  const d = document.createElement("details");
  d.className = "unsigned";
  d.open = open;
  const sum = document.createElement("summary");
  sum.textContent = help.title;
  d.append(sum);
  if (help.steps.length) {
    const ol = document.createElement("ol");
    for (const s of help.steps) { const li = document.createElement("li"); li.innerHTML = s; ol.append(li); }
    d.append(ol);
  }
  const p = document.createElement("p");
  p.textContent = help.cmdIntro;
  const row = document.createElement("div");
  row.className = "cmdrow";
  const code = document.createElement("code");
  code.textContent = help.cmd;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "secondary";
  btn.textContent = t("Kopieer");
  btn.onclick = async () => {
    try { await navigator.clipboard.writeText(help.cmd); btn.textContent = t("Gekopieerd"); }
    catch { btn.textContent = t("Kopiëren lukte niet"); }
    setTimeout(() => (btn.textContent = t("Kopieer")), 2000);
  };
  row.append(code, btn);
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = help.note;
  d.append(p, row, note);
  el.append(d);
}

export function pairError(r, t) {
  return {
    format: t("Typ de koppelcode van 12 tekens uit het venster van de helper (bijvoorbeeld 7K3M-Q9PX-2HTR)."),
    missing: t("Geen helper gevonden. Staat het venster met de code nog open?"),
    "no-pairing": t("De helper wacht niet op een code (verlopen, al gebruikt of te vaak geprobeerd). Open de helper opnieuw voor een nieuwe code."),
    proof: t("Koppelen afgebroken: de helper kon niet bewijzen dat hij deze code kent, en er is niets verstuurd. Controleer de code en typ hem opnieuw. Klopt hij wel? Dan luistert er mogelijk een ander programma op poort 8899."),
    reused: t("Deze code is al geprobeerd. Typ de code opnieuw zoals hij in het venster staat, of open de helper opnieuw voor een nieuwe code."),
    session: t("Koppelen duurde te lang of is onderbroken. Probeer het opnieuw."),
    code: t("Koppelen mislukt: de helper accepteerde het versleutelde geheim niet. Open de helper opnieuw voor een nieuwe code."),
  }[r.error] || t("Koppelen mislukt ({e}).", { e: r.error });
}

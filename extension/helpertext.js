// Teksten voor het installeren van de helper-download (welkomstpagina en popup). Alleen tekst: de extensie
// downloadt of start zelf niets.

export function openText(os, file, t) {
  if (os === "mac") return t("Open het zip-bestand en dubbelklik op host-override-helper. Er opent een Terminal-venster.");
  if (os === "win" || os === "winps") return t("Dubbelklik op het gedownloade bestand ({f}). Er opent een venster.", { f: file });
  return t("Pak het uit en start het in een terminal: tar -xzf {f} && ./host-override-helper", { f: file });
}

// Zolang de binaries niet ondertekend zijn, waarschuwt het systeem bij het openen. Leg uit wat je dan doet.
export function unsignedText(os, signed, t) {
  if (os === "mac" && !signed.mac) return t("Nog niet ondertekend: macOS meldt dat de app niet geopend kan worden. Ga naar Systeeminstellingen > Privacy en beveiliging, klik onderaan op 'Toch openen' en daarna op 'Open'.");
  if ((os === "win" || os === "winps") && !signed.win) return t("Nog niet ondertekend: Windows toont 'Windows heeft uw pc beschermd'. Klik op 'Meer info' en daarna op 'Toch uitvoeren'.");
  return "";
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

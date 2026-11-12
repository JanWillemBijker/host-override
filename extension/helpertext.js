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
    format: t("Typ de 6 cijfers uit het venster van de helper."),
    missing: t("Geen helper gevonden. Staat het venster met de code nog open?"),
    "no-pairing": t("De helper wacht niet op een code (verlopen, al gebruikt of te vaak fout). Open de helper opnieuw voor een nieuwe code."),
    code: r.left ? t("Code klopt niet. Nog {n} poging(en).", { n: r.left }) : t("Code klopt niet."),
  }[r.error] || t("Koppelen mislukt ({e}).", { e: r.error });
}

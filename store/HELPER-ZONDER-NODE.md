# Plan: helper zonder Node.js

Status (12 november 2026): **gebouwd**, nog niet ondertekend. Wat er afwijkt van het plan hieronder:
- Node SEA via `node --build-sea` (Node 25.5+) met `"executable"` in de config: alle platforms vanaf één Mac,
  geen postject en geen CI-matrix nodig om te bouwen (wel voor ondertekenen op Windows). Basis: Node LTS v26.13.1.
- Geen "verwachte SHA-256 in de extensie": de release bevat `SHA256SUMS` en de welkomstpagina linkt ernaar;
  een hash in de extensie zou bij elke helper-release een nieuwe extensieversie vragen.
- Geen kort setup-commando voor de binary: de binary **koppelt zelf** met een 6-cijferige code die de gebruiker
  in de extensie typt (`/__pair`), en installeert zichzelf (`--install`). Het geheim staat dus nooit in een
  commando of URL. De Node-route blijft als "Geavanceerd: met Node.js".
- macOS: zip met een genotariseerde binary (stapling kan niet op een losse binary; Gatekeeper controleert online).
- Grootte: macOS-zip ca. 42–44 MB, Linux tar.gz 45 MB, Windows-exe 96 MB (ongecomprimeerd geleverd voor dubbelklikken).

Zie `README.md` (Helper als losse binary), `store/SIGNING.md` (certificaten, kosten, bouwen) en
`.github/workflows/release-helper.yml`. Hieronder het oorspronkelijke plan.

## Waarom
De helper vraagt nu Node.js. Voor niet-ontwikkelaars is dat de grootste drempel. Een losse binary per platform haalt die stap weg.

## Opties

| | Node SEA (Single Executable Application) | `bun build --compile` |
| --- | --- | --- |
| Wat | Officiële Node-functie: script + Node-runtime in één bestand (`node --experimental-sea-config`, `postject`) | Bun bundelt script + runtime |
| Compatibiliteit | 100 % (zelfde Node-API's als nu: `http`, `net`, `dgram`, `tls`, `dns`) | Hoog, maar `dgram`/`tls`-randgevallen en `dns.lookup`-gedrag apart testen |
| Grootte | ca. 90–110 MB per platform (ongecomprimeerd), ca. 35–40 MB gezipt | ca. 55–95 MB per platform, ca. 25–35 MB gezipt |
| Cross-compile | Nee: bouwen per OS (GitHub Actions-matrix: macOS arm64 + x64, Windows x64, Linux x64/arm64) | Ja, vanaf één machine (`--target=bun-darwin-arm64` enz.) |
| Advies | **Voorkeur**: geen gedragsverschil met de huidige, geteste helper | Alternatief als bestandsgrootte zwaar weegt |

De code blijft `proxy.js` + `dnstools.js` (geen dependencies), dus beide opties zijn haalbaar zonder herschrijven.

## Ondertekening per platform

| Platform | Nodig | Kosten | Zonder ondertekening |
| --- | --- | --- | --- |
| macOS | Developer ID Application-certificaat + notarisatie (`notarytool`) + hardened runtime; ad-hoc gesigneerde SEA eerst `codesign --remove-signature`, daarna opnieuw tekenen | Apple Developer Program **€99 per jaar** | Gatekeeper blokkeert ("kan niet worden geopend omdat de ontwikkelaar niet kan worden geverifieerd"); gebruiker moet via Systeeminstellingen → Privacy en beveiliging → "Toch openen", of `xattr -d com.apple.quarantine`. Niet uit te leggen aan de doelgroep. |
| Windows | Authenticode-certificaat (OV ca. €200–400/jaar, EV of Azure Trusted Signing ca. €10/maand); sinds 2023 sleutel op hardware-token of cloud-HSM | zie links | SmartScreen: "Windows heeft uw pc beschermd" → "Meer info" → "Toch uitvoeren". Reputatie bouwt langzaam op, ook met OV. |
| Linux | Niets verplicht | – | Werkt; eventueel SHA-256 en een GPG-handtekening publiceren. |

Conclusie: zonder Apple-account is een binary op macOS geen verbetering ten opzichte van "installeer Node.js". Aanbevolen volgorde: (1) Apple Developer + notarisatie, (2) Azure Trusted Signing voor Windows, (3) Linux direct.

## Hoe de extensie de download aanbiedt
- Welkomstpagina krijgt een keuze: **"Download de helper (aanbevolen)"** of **"Ik heb Node.js"** (huidige weg).
- Binaries staan op een vaste https-locatie (GitHub Releases van het project), per versie met een `SHA256SUMS`.
  De extensie bevat de **verwachte SHA-256** per platform voor de helperversie waar ze bij hoort, zodat de gebruiker (of het setup-script) de download kan controleren.
- Het setup-commando blijft bestaan maar wordt korter: `config.json` (extensie-ID + geheim) schrijven en de gedownloade binary registreren (LaunchAgent / Opstarten-map / systemd). Het geheim gaat nooit mee in een download-URL.
- **De vertrouwensketen blijft gelijk:** de binary kent het geheim alleen via `~/.host-override/config.json`, en de extensie stuurt pas iets na de HMAC-controle op `/__status` (nonce → HMAC-SHA256(geheim, nonce)). Een vervalste of verkeerde binary zonder het geheim krijgt dus nog steeds geen regels of verkeer. Code signing beschermt de installatie; geheim + HMAC beschermen de verbinding.
- Updates: de extensie ziet via `/__status` (versie + `features`) dat de helper verouderd is en toont de downloadlink; geen automatische updates door de helper zelf (geen extra netwerkverkeer, geen remote code).

## Chrome Web Store
- De extensie **downloadt of start zelf geen code**: de gebruiker downloadt de binary via een gewone link en installeert die zelf. Dat valt niet onder "remote code" (die regel gaat over code die de extensie uitvoert), maar vermeld het in de reviewer-notities en de beschrijving ("vereist een lokale helper, apart te downloaden").
- Privacybeleid aanvullen: downloadlocatie (GitHub), geen telemetrie in de binary.
- Bij voorkeur blijft de huidige Node-route beschikbaar (broncode in het pakket, zelf te controleren): dat helpt bij review en bij gebruikers die geen binary willen.

## Inschatting werk
- CI-matrix met SEA-build, signing en notarisatie: 1–2 dagen (eenmalig), daarna per release automatisch.
- Welkomstpagina + setup-scripts aanpassen: 0,5 dag. Testen op schone macOS/Windows/Linux-machines: 1 dag.

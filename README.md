# Host Override

Stuur in één Chrome-profiel een domein naar een ander IP (bijvoorbeeld een teststaging-server), terwijl een incognito-venster gewoon de live site toont. Je hosts-file blijft onaangeroerd. Werkt op macOS, Windows en Linux.

## Hoe het werkt

- De **extensie** zet een proxy-regel die alleen voor het gewone profiel geldt. Alleen domeinen uit je lijst gaan via de helper, de rest gaat direct.
- De **helper** (een klein lokaal Node-programma, alleen bereikbaar op 127.0.0.1) maakt verbinding met het IP dat je opgaf. Hostnaam en certificaat blijven gelijk, dus HTTPS werkt.
- **Incognito** gebruikt die proxy-regel niet, dus daar zie je de live site.

Een extensie kan geen IP-adressen koppelen zonder zo'n helper. Daarom is er eenmalig één stap buiten Chrome nodig. Die zit ingebouwd in de extensie.

## Installeren

Je hebt [Node.js](https://nodejs.org) nodig.

1. Ga in Chrome naar `chrome://extensions`, zet **Ontwikkelaarsmodus** aan, kies **Uitgepakte extensie laden** en selecteer de map `extension/` (de map met `manifest.json`).
2. Er opent een welkomstpagina. Kies je systeem, klik **Kopieer setup-commando**, plak het in Terminal (macOS/Linux) of PowerShell (Windows) en druk op Enter. De pagina meldt zodra de helper actief is.
3. Pin het icoon via de puzzelknop.

Laat "Toestaan in incognito" uit (standaard uit).

De helper start voortaan zelf bij inloggen (macOS: LaunchAgent, Linux: systemd-gebruikersservice of autostart, Windows: Opstarten-map). Vanuit deze map kan het ook met `./install.sh` (macOS/Linux) of `extension/helper/setup.ps1` (Windows).

## Gebruiken

- **Huidige site** bovenin de popup toont het IP waarmee de tab verbonden is, met label Override (testserver) of Live. Voor live-IP's vraagt de extensie eenmalig toestemming via **IP-weergave inschakelen**. Daarna krijgt een tab met override de badge TEST.
- **Live IP opzoeken** haalt het echte DNS-adres op via Cloudflare DNS-over-HTTPS. Alleen op klik, en dan gaat de hostnaam naar Cloudflare.
- **Open in incognito** opent dezelfde pagina live, om te vergelijken.
- **Overschrijf dit domein** vult het formulier met de huidige site.
- Een regel is `example.nl` of `*.example.nl` (ook alle subdomeinen) met een IP. Het IP pas je in de lijst direct aan. Bij twee of meer regels kun je alle IP's tegelijk wisselen.
- De tab wordt automatisch herladen (zonder cache) als een wijziging die tab raakt. Uit te zetten onderin.
- Sneltoets **Alt+Shift+H** zet alles aan of uit (wijzigen via `chrome://extensions/shortcuts`).
- **Testvenster** opent met één klik een tweede Chrome (eigen profiel `chrome-test`) dat jouw regels gebruikt, met de huidige pagina. Handig voor twee vensters naast elkaar. De helper start dat venster. Lukt dat niet, dan kopieer je het commando (macOS, Windows cmd of PowerShell, Linux) en plak je het zelf in je terminal. Het commando werkt ook zonder helper.
- **DNS-check** is een tab in de popup zelf (naast Regels), met subtabs voor Samenvatting, Records, Nameservers, Resolvers, Servers en E-mail. Het doet alles wat je anders met `dig` doet: records (A, AAAA, CNAME, MX, NS, TXT, SOA, CAA met TTL), de delegatie vanaf de root, elke nameserver rechtstreeks bevraagd (authoritative, SOA-serial, A-record), vergelijking van resolvers (systeem, Cloudflare, Google, Quad9, OpenDNS) om te zien of een wijziging overal door is, SPF en DMARC, en een servercontrole per IP: HTTP en HTTPS met de juiste hostnaam, redirect, certificaat (geldig voor het domein, vertrouwd, verloopdatum) en reverse DNS. Staat er een override voor het domein, dan vergelijkt het live en test naast elkaar. Bovenaan staat een samenvatting met fouten en aandachtspunten, en je kopieert het rapport met één klik. Dit werkt via de helper (versie 4). De check start automatisch voor de huidige site, secties met problemen klappen vanzelf open, je kunt een test-IP invullen om live en test te vergelijken, en recente domeinen worden onthouden.
- **Delen** toont je regels in hosts-formaat. Plakken bij een collega en "Toevoegen uit tekst" kiezen is genoeg.

## Delen en Chrome Web Store

De extensie bevat alles (ook de helper), dus delen is alleen de extensie delen.

- **Zip:** `./package.sh` maakt `dist/host-override-<versie>.zip`. Een collega pakt die uit, laadt de map als uitgepakte extensie en volgt de welkomstpagina.
- **Chrome Web Store:** dezelfde zip kan worden geüpload. Teksten, rechtvaardiging van de rechten en het privacybeleid staan in `store/`. Stappen staan onderaan `store/LISTING.md`.

## Problemen oplossen

| Melding | Oplossing |
| --- | --- |
| "Helper draait niet" | Plak het setup-commando opnieuw (uit de popup of welkomstpagina). Controle: open `http://127.0.0.1:8899` |
| "Een andere extensie beheert de proxy" | Zet andere proxy- of VPN-extensies uit |
| Certificaatfout | De testserver moet een geldig certificaat voor dat domein hebben |
| Oude site blijft staan | Hard verversen of tab sluiten en opnieuw openen |
| Helper start niet na Node-update | Plak het setup-commando opnieuw (het pad naar Node wordt dan vernieuwd) |

Logs: macOS `~/Library/Logs/host-override.log`, Linux `journalctl --user -u host-override`.

## Verwijderen

macOS en Linux: `./uninstall.sh`. Windows: `extension/helper/uninstall.ps1`. Verwijder daarna de extensie in `chrome://extensions`.

## Beperkingen

- De helper-installatie op Windows en Linux is geschreven en syntactisch gecontroleerd, maar nog niet op die systemen uitgeprobeerd.
- Poort 8899 staat vast (`extension/common.js`, `extension/helper/proxy.js`).
- Het IP geldt voor alle poorten van dat domein.
- In incognito is de extensie uit, dus daar zie je geen IP-kaart.


## Wat is er nieuw in 1.5.0
- Tabs **Regels / DNS-check / Meer**. Testvenster, delen en instellingen staan onder Meer.
- Compacte helper-melding in plaats van een grote kaart. Zonder helper kun je wel het Chrome-commando voor een testvenster kopieren.
- Huidige site toont **Live** naast **Test**, met een knop "Test dit domein" die het laatst gebruikte IP onthoudt.
- Optioneel TEST-label in de pagina zelf (uit te zetten onder Meer). Vereist IP-weergave.
- Zoeken in regels vanaf 7 regels, pijltjestoetsen op de tabs, betere kleurcontrasten, NL- en EN-naam en -omschrijving voor de Store.

## Wat is er nieuw in 1.6.0
- **Rustiger Regels-tab:** de huidige site toont alleen het live IP. Vergelijken met een testserver doe je in de DNS-check (sectie Servers).
- **DNS-check:** alle secties zijn standaard dicht en tonen rechts een korte status. Een gekleurd bolletje laat zien of er iets mis is.
- **Zijpaneel:** klik op het paneel-icoon naast de aan/uit-schakelaar om de extensie rechts in Chrome te openen. Het volgt je actieve tab en controleert in de DNS-tab automatisch elk nieuw domein. Onder Meer kun je kiezen om altijd als zijpaneel te openen.
- **Taal:** Engels en Nederlands. Standaard volgt de extensie de browsertaal, onder Meer kies je zelf. De meldingen van de installatiescripts in Terminal blijven Nederlands.

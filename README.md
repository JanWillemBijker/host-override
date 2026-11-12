# Host Override

Stuur in één Chrome-profiel een domein naar een ander IP (bijvoorbeeld een teststaging-server), terwijl een incognito-venster gewoon de live site toont. Je hosts-file blijft onaangeroerd. Werkt op macOS, Windows en Linux.

## Hoe het werkt

- De **extensie** zet een proxy-regel die alleen voor het gewone profiel geldt. Alleen domeinen uit je lijst gaan via de helper, de rest gaat direct.
- De **helper** (een klein lokaal programma, alleen bereikbaar op 127.0.0.1; als losse download of vanuit de broncode met Node.js) maakt verbinding met het IP dat je opgaf. Hostnaam en certificaat blijven gelijk, dus HTTPS werkt.
- **Incognito** gebruikt die proxy-regel niet, dus daar zie je de live site.

Een extensie kan geen IP-adressen koppelen zonder zo'n helper. Daarom is er eenmalig één stap buiten Chrome nodig. Die zit ingebouwd in de extensie.

## Installeren

1. Ga in Chrome naar `chrome://extensions`, zet **Ontwikkelaarsmodus** aan, kies **Uitgepakte extensie laden** en selecteer de map `extension/` (de map met `manifest.json`).
2. Er opent een welkomstpagina. Twee manieren om de helper te installeren:
   - **Download (geen Node.js nodig, aanbevolen):** klik **Download** voor je systeem (macOS Apple silicon/Intel, Windows x64, Linux x64), open het bestand. Er verschijnt een venster met een **koppelcode van 6 cijfers**; typ die op de welkomstpagina (of in de popup) en klik **Koppel**. De helper kopieert zichzelf naar `~/.host-override/bin/` en start voortaan bij inloggen.
     Zolang de binaries niet ondertekend zijn: macOS > Systeeminstellingen > Privacy en beveiliging > **Toch openen**; Windows > **Meer info** > **Toch uitvoeren**. Zie `store/SIGNING.md`.
   - **Geavanceerd: met Node.js:** klik **Kopieer setup-commando**, plak het in Terminal (macOS/Linux) of PowerShell (Windows) en druk op Enter. Werkt zonder download, vanuit de broncode in de extensie.
   De pagina meldt zodra de helper actief is.
3. Pin het icoon via de puzzelknop.

Laat "Toestaan in incognito" uit (standaard uit).

De helper start voortaan zelf bij inloggen (macOS: LaunchAgent, Linux: systemd-gebruikersservice of autostart, Windows: Opstarten-map).

De extensie maakt bij de eerste start een geheime sleutel aan. Het setup-commando, of het koppelen met de code, schrijft die met het extensie-ID in `~/.host-override/config.json` (alleen leesbaar voor jou). De helper voert alleen opdrachten uit die die sleutel meesturen, en bewijst bij elke statuscontrole dat hij de sleutel kent; anders stuurt de extensie hem niets. Zonder geldige `config.json` weigert de helper alles.

Vanuit deze map kan het ook met `./install.sh <extensie-id> <geheim>` (macOS/Linux), maar het geheim staat alleen in de extensie: het setup-commando plakken is eenvoudiger. `./install.sh` zonder argumenten laat een bestaande `config.json` staan. Windows: `extension/helper/setup.ps1` na het plakken van het setup-commando.

## Gebruiken

- **Huidige site** bovenin de popup toont het IP waarmee de tab verbonden is (**Verbonden**) en wat publieke DNS zegt (**Live IP**), met de bron: *Override naar …* (Host Override-regel), *Hosts-bestand: …* (de naam staat in je hosts-bestand), *Wijkt af van DNS* (vermoeden) of *Live*. Voor het verbonden IP vraagt de extensie eenmalig toestemming via **IP-weergave inschakelen**. Het icoon krijgt per tab de badge TEST (regel), HOST (hosts-bestand) of DNS? (wijkt af, alleen als die controle aan staat).
- **Live IP opzoeken** haalt het echte DNS-adres (A en AAAA) op via Cloudflare DNS-over-HTTPS en vergelijkt het met het verbonden IP. Alleen op klik, en dan gaat de hostnaam naar Cloudflare.
- **Hosts-bestand:** met de helper ziet de extensie of een site in je hosts-bestand staat (`/etc/hosts` op macOS en Linux, `%SystemRoot%\System32\drivers\etc\hosts` op Windows). Alleen lezen: Host Override past het hosts-bestand nooit aan. Onder **Meer** staat een overzicht van alle regels (met "Alleen overrides tonen"), en je kunt ze kopiëren of importeren als Host Override-regels. In de **DNS-check** staat een sectie Hosts-bestand.
- **Indicator in de pagina** (onder Meer): een hoekbadge, gekleurde balk of rand om de pagina als de site niet van het live IP komt. Instelbaar: wanneer (Host Override-regel en hosts-bestand standaard aan, "wijkt af van publieke DNS" standaard uit), stijl, positie, kleur, tekst (`{ip}`, `{host}`, `{source}`; standaard `TEST · {ip}`), grootte, dekking, IP tonen, bijna onzichtbaar bij muis erover en klik om te verbergen voor die tab. Met live voorbeeld; open tabs passen zich direct aan. Vereist IP-weergave.
- **Open in incognito** opent dezelfde pagina live, om te vergelijken.
- **Overschrijf dit domein** vult het formulier met de huidige site.
- Een regel is `example.nl` of `*.example.nl` (ook alle subdomeinen) met een IP. Het IP pas je in de lijst direct aan. Bij twee of meer regels kun je alle IP's tegelijk wisselen.
- De tab wordt automatisch herladen (zonder cache) als een wijziging die tab raakt. Uit te zetten onderin.
- Sneltoets **Alt+Shift+H** zet alles aan of uit (wijzigen via `chrome://extensions/shortcuts`).
- **Testvenster** opent met één klik een tweede Chrome (eigen profiel `chrome-test`) dat jouw regels gebruikt, met de huidige pagina. Handig voor twee vensters naast elkaar. De helper start dat venster. Lukt dat niet, dan kopieer je het commando (macOS, Windows cmd of PowerShell, Linux) en plak je het zelf in je terminal. Het commando werkt ook zonder helper.
- **DNS-check** is een tab in de popup zelf (naast Regels), met subtabs voor Samenvatting, Records, Nameservers, Resolvers, Servers en E-mail. Het doet alles wat je anders met `dig` doet: records (A, AAAA, CNAME, MX, NS, TXT, SOA, CAA met TTL), de delegatie vanaf de root, elke nameserver rechtstreeks bevraagd (authoritative, SOA-serial, A-record), vergelijking van resolvers (systeem, Cloudflare, Google, Quad9, OpenDNS) om te zien of een wijziging overal door is, SPF en DMARC, en een servercontrole per IP: HTTP en HTTPS met de juiste hostnaam, redirect, certificaat (geldig voor het domein, vertrouwd, verloopdatum) en reverse DNS. Staat er een override voor het domein, dan vergelijkt het live en test naast elkaar. Bovenaan staat een samenvatting met fouten en aandachtspunten, en je kopieert het rapport met één klik. Dit werkt via de helper (versie 6). De check start automatisch voor de huidige site, secties met problemen klappen vanzelf open, je kunt een test-IP invullen om live en test te vergelijken, en recente domeinen worden onthouden.
- **Delen** toont je regels in hosts-formaat. Plakken bij een collega en "Toevoegen uit tekst" kiezen is genoeg. Groepen gaan mee als `# group: Naam #kleur` (met `off` erachter als de groep uit staat), notities als `# notitie` achter de regel.

### Groepen (omgevingen)
- Regels staan in groepen met een naam en kleur, bijvoorbeeld "Klant X – staging". Een hele groep zet je met één schakelaar aan of uit; onder Meer kun je kiezen voor **maar één groep tegelijk actief**.
- Groepen zijn in te klappen. Het tandwiel opent naam, kleur, verzoek-headers en (bij een abonnement) de lijst-instellingen. Via **⋯** bij een regel verplaats je hem naar een andere groep en geef je hem een **notitie** (tweede regel in de lijst, tooltip, in de export als `# notitie`).
- De groepskleur zie je in de badge op het icoon (als er één groep actief is), in de huidige-site-kaart en in de indicator in de pagina (optie "kleur van de groep gebruiken"); de naam kan in de indicatortekst met `{group}`.
- Bestaande regels van vóór de groepen komen automatisch in de groep "Mijn regels".

### Hostnaam als doel
Een regel mag naar een hostnaam wijzen in plaats van een IP, bijvoorbeeld `server123.hostingpartij.nl`. De helper zoekt die op met de resolver van het systeem (ongeveer 60 seconden gecachet, 10 seconden bij een fout) en probeert alle adressen (IPv6 en IPv4). De popup toont het gevonden IP onder de regel. Strenge controle: geen wildcard, minstens één punt (of `localhost`), en het laatste deel bevat een letter.

### Verzoek-headers per groep
In de groepsinstellingen: **Geen cache** (`Cache-Control: no-cache` en `Pragma: no-cache`), **Basic-auth** (gebruikersnaam/wachtwoord voor een staging achter het inlogvenster van de browser) en maximaal 10 **eigen headers**. Ze gelden alleen voor de hosts van die groep en alleen zolang de groep aan staat (via `declarativeNetRequest`). Chrome zet ze alleen op hosts waarvoor de extensie toegang heeft; de groepsinstellingen vragen daar zo nodig om. Let op: een CDN zoals Cloudflare kan ondanks "geen cache" een kopie leveren, en Basic-auth helpt niet bij WordPress- of app-logins. Niet toegestaan: Host, Cookie, Authorization (gebruik Basic-auth), Origin, Referer, hop-by-hop-headers, `Sec-*`, `Proxy-*`.

### Verbindingen
Tab **Verbindingen**: alle hosts (en IP's) waar de huidige tab sinds de laatste paginaweergave iets van laadde, met het aantal verzoeken per type en of het via een regel, het hosts-bestand of live ging. Oranje **nog live**: een host van hetzelfde domein als een overschreven host (www, cdn, api) komt nog van de live server; met **Regel met zelfde IP** los je dat met één klik op. Vereist de toegang tot alle sites (zelfde als IP-weergave). Alleen hostnaam, IP, type en status worden bijgehouden, per tab in de sessie.

### Abonnementen en sync
- **Abonneren** (Meer): een regellijst op een https-URL in hosts-formaat (optioneel met `# group:`), vernieuwd handmatig, elk uur of elke dag. Max 256 KB en 2000 regels. De regels zijn alleen-lezen en komen in een eigen groep die eerst uit staat. Chrome vraagt bij abonneren toegang tot alleen die website.
- **Synchroniseren** (Meer, standaard uit): eigen regels, groepen, notities, abonnementen (alleen de URL) en instellingen via de sync-opslag van Chrome. Nooit de helper-sleutel, Basic-auth-wachtwoorden of de aan/uit-schakelaar. Maximaal ongeveer 90 KB.

### Back-up en publieke DNS
- **Back-up** (Meer): alles naar één JSON-bestand, en terug met een voorbeeld (samenvoegen of alles vervangen). Helper-sleutel en wachtwoorden alleen als je dat aanvinkt.
- **Publieke DNS** voor "Opzoeken" en "wijkt af van publieke DNS": Cloudflare (standaard), Google, Quad9 of via de helper (DNS-server van je systeem).

### Migratie-check (DNS-check)
Sectie **Migratie-check**, op klik: vergelijkt live met de nieuwe server (je regel of het test-IP). Domeinregistratie via RDAP (registrar, verloopdatum, DNSSEC, locks, met uitleg), website live en nieuw naast elkaar (redirectketen, status, beveiligingsheaders, reactietijd), certificaat van de nieuwe server (domein + www, vertrouwd, verloopdatum), e-mail (MX, SPF, DKIM met veelgebruikte selectors, DMARC, MTA-STS, autodiscover/autoconfig) en optioneel subdomeinen uit Certificate Transparency (crt.sh, alleen als je dat aanvinkt) met "Regel toevoegen". Uitkomst als checklist (groen/oranje/rood), te kopiëren als tekst of Markdown.

## Hoe "niet live" wordt bepaald

1. **Host Override-regel** voor de host: zeker (het verkeer loopt via de helper naar jouw IP).
2. **Hosts-bestand** (via de helper, alleen als die gekoppeld is): staat de naam erin met een eigen IP, dan is dat zeker. Een regel met `0.0.0.0` of `::` is een blokkade; als de pagina toch laadde, telt die niet. Een hosts-bestand met meer dan 50 namen op `127.0.0.1`/`::1` wordt als blokkeerlijst gezien. `localhost`, `broadcasthost`, `ip6-*` en de eigen computernaam worden overgeslagen.
3. **Wijkt af van publieke DNS** (vermoeden): het verbonden IP staat niet in het antwoord van Cloudflare DNS (A en AAAA samen, IPv4-mapped IPv6 genormaliseerd). Dit kan ook een VPN, proxy, lokale DNS of een CDN met geo-DNS zijn. Daarom: zachte formulering in de popup, zit het verbonden IP in hetzelfde /24 (IPv4) of /48 (IPv6) als een publiek adres dan heet het "wijkt licht af" en volgen geen badge en geen indicator, en de automatische controle (die elke hostnaam naar Cloudflare stuurt) staat standaard uit.

## Helper-uitbreidingen binnen protocol 6

`/__status` meldt naast de versie ook `features`: `hosts`, `targets` (hostnaam als doel), `resolve` (`POST /__resolve {"names": [...]}`, max 50), `check2` (`/__check` met `"detail": true`: redirectketen, headers, certificaat www), `crtsh` (`POST /__crtsh {"domain"}`) en `rdap` (`POST /__rdap {"domain"}`). Allemaal met dezelfde controles (geheim, Origin, Host). Een oudere v6-helper zonder een uitbreiding geeft een duidelijke melding in de popup (setup-commando opnieuw plakken).

## Helper-endpoint `/__hosts` (protocol 6)

`POST /__hosts` met `{"names": ["a.nl"]}` geeft alleen de treffers voor die namen (max 50); `{}` geeft een compact overzicht (overrides tot 1000 regels, blokkeringen alleen geteld met een voorbeeld van 50). `GET /__hosts?names=…` mag ook, maar de extensie gebruikt POST omdat Chrome bij GET geen Origin-header meestuurt. Zelfde controles als de andere opdrachten (geheim, Origin, Host). Het bestand wordt hooguit tot 5 MB gelezen (daarboven alleen het begin, `truncated: true`) en gecachet op grootte en wijzigingstijd. De helper-versie blijft 6: dit endpoint is een uitbreiding, een oudere v6-helper zonder `/__hosts` levert gewoon geen hosts-informatie op.

## Helper als losse binary (zonder Node.js)

`./build-helper.sh` bundelt `extension/helper/proxy.js`, `dnstools.js` en `helper-bin/service.js` en bakt ze met `node --build-sea` (Node Single Executable Application) in de officiële Node-LTS-binary (versie vast in `helper-bin/build-helper.mjs`, gedownload van nodejs.org en gecontroleerd met SHA-256). Vanaf een Mac komen alle platforms in één keer (`--targets` om te kiezen, `--universal` voor een universele macOS-binary van ca. 280 MB). Uitvoer in `dist/helper/` (gitignored, nooit in de extensie-zip): `host-override-helper-macos-arm64.zip`, `-macos-x64.zip`, `-windows-x64.exe`, `-linux-x64.tar.gz` (40–95 MB) en `SHA256SUMS`. Ondertekenen en notariseren gaan automatisch als de omgevingsvariabelen gezet zijn; anders een ongetekende build met waarschuwing. Alles over certificaten en kosten: `store/SIGNING.md`. Bij een tag `v*` bouwt `.github/workflows/release-helper.yml` alles en zet het bij de GitHub-release; de extensie linkt naar `HELPER_RELEASES` in `extension/common.js`.

Opties van de binary:

| | |
| --- | --- |
| (geen) | instellen: toont een koppelcode, wacht tot je die in de extensie typt, kopieert zichzelf naar `~/.host-override/bin/` en zet automatisch starten aan (LaunchAgent / systemd-gebruikersservice of autostart / Opstarten-map, dezelfde namen als de Node-route, die hij dus vervangt). Draait er al een helper, dan loopt het koppelen via die helper. |
| `--pair` | koppelvenster met een nieuwe code, blijft daarna draaien |
| `--serve` | alleen draaien (zo start de dienst hem) |
| `--install` / `--uninstall` | automatisch starten aan / uit (uninstall verwijdert ook `~/.host-override`) |
| `--version`, `--help` | |

**Koppelen (`POST /__pair`):** alleen tijdens een koppelvenster; de code (6 cijfers, `crypto.randomInt`) geldt 5 minuten en één keer. De helper bewijst **eerst** dat hij de code kent, pas daarna gaat het geheim naar hem toe (`extension/pair.js`, zelfde berekening in `proxy.js`):
1. `hello`: de extensie stuurt een willekeurige nonce `nE`; de helper antwoordt met `nH` en `proof = HMAC-SHA256(kProof, "ho-pair-proof|nE|nH")`.
2. De extensie controleert het bewijs (WebCrypto `verify`). Klopt het niet, dan breekt ze af met een duidelijke melding ("ander programma op poort 8899?"); er gaat niets meer naartoe, en dezelfde code wordt niet nog eens geprobeerd.
3. `finish`: het geheim gaat versleuteld mee (AES-256-GCM, AAD bindt `nE`, `nH` en de Origin). Lukt ontsleutelen, dan kende de extensie de code; het extensie-ID komt uit de Origin-header.

Sleutels: `k0 = PBKDF2-SHA256(code, "ho-pair-v1|" + nE, 600.000 iteraties)`, daaruit `kProof = HKDF(k0, salt nE, "ho-pair-proof")` en `kEnc = HKDF(k0, salt nE‖nH, "ho-pair-enc")`. Limieten: max. 5 pogingen (elke `hello` telt), 20 seconden tussen `hello` en `finish`, één `finish` per sessie, na een geslaagde koppeling is het venster dicht. Zelfde controles als de andere opdrachten (Host `127.0.0.1`/`localhost`, Origin `chrome-extension://…`, header `X-Host-Override`); `config.json` wordt atomisch geschreven (0600, map 0700). Buiten een koppelvenster: 410. `/__status` meldt `pairing`, `kind` (`bin`/`node`) en feature `pair`.

Restrisico: een programma op deze computer dat een `hello` naar de echte helper stuurt, krijgt een bewijs waarmee het de code in theorie offline kan raden (er zijn maar 10⁶ codes). Daarom de trage PBKDF2 (600.000 iteraties per poging) en het tijdslot van 20 seconden: het raden moet binnen die 20 s klaar zijn, en dat zou meer rekenkracht vragen dan een gewone computer heeft. Daarnaast kost elke `hello` een van de 5 pogingen, en zo'n aanval valt op: de echte koppeling mislukt dan. Een programma dat op poort 8899 luistert zonder de code te kennen (de oude zwakte), krijgt het geheim niet meer.

## Testen

`node tests/run.mjs` test de hosts-parser, de beslisregels, de indicator-instellingen, groepen/notities/hosts-formaat, headers (declarativeNetRequest), verbindingen, abonnementen, sync, back-up en DoH-wire-formaat, en start een eigen helper op een vrije poort met een tijdelijke HOME en een nep-hosts-bestand. Daarvoor leest de helper de omgevingsvariabelen `HOST_OVERRIDE_HOSTS_FILE` en `HOST_OVERRIDE_TEST_PORTS` (alleen voor tests; de extensie kan die niet zetten en de setup-scripts doen dat niet). Met `NET=1` lopen ook netwerktests mee (crt.sh, RDAP). Koppelen (verkeerde code, eenmalig, verlopen via `HOST_OVERRIDE_PAIR_TTL`, 5 pogingen, 0600, `pair.json`) en `--install`/`--uninstall` (droog, `HO_DRY_INSTALL=1`, per platform) worden ook getest. Met `HELPER_BIN=pad/naar/host-override-helper node tests/run.mjs` lopen dezelfde helpertests tegen de gebouwde binary. Een draaiende helper op poort 8899 en `~/.host-override` worden niet aangeraakt.

## Delen en Chrome Web Store

De extensie bevat alles (ook de helper), dus delen is alleen de extensie delen.

- **Zip:** `./package.sh` maakt `dist/host-override-<versie>.zip`. Een collega pakt die uit, laadt de map als uitgepakte extensie en volgt de welkomstpagina.
- **Chrome Web Store:** dezelfde zip kan worden geüpload. Teksten, rechtvaardiging van de rechten en het privacybeleid staan in `store/`. Stappen staan onderaan `store/LISTING.md`.

## Problemen oplossen

| Melding | Oplossing |
| --- | --- |
| "Helper draait niet" | Open de gedownloade helper opnieuw en typ de code, of plak het setup-commando opnieuw (uit de popup of welkomstpagina). Controle: open `http://127.0.0.1:8899` |
| "Code klopt niet" / "wacht niet op een code" | De code geldt 5 minuten, één keer, max. 5 pogingen. Open de helper opnieuw voor een nieuwe code. |
| "Helper-update beschikbaar" of "Helper moet opnieuw worden ingesteld" | Open de gedownloade helper opnieuw en typ de nieuwe code, of kopieer het setup-commando uit de popup en plak het nog één keer. Blijft de melding, kijk dan wat er op poort 8899 draait (`lsof -i :8899`). Tot het is opgelost gaan domeinen op je lijst nergens heen (foutmelding in plaats van een verkeerde server). |
| "Een andere extensie beheert de proxy" | Zet andere proxy- of VPN-extensies uit |
| Certificaatfout | De testserver moet een geldig certificaat voor dat domein hebben |
| Oude site blijft staan | Hard verversen of tab sluiten en opnieuw openen |
| Helper start niet na Node-update | Plak het setup-commando opnieuw (het pad naar Node wordt dan vernieuwd) |

Logs: macOS `~/Library/Logs/host-override.log`, Linux `journalctl --user -u host-override`.

## Verwijderen

Binary: `~/.host-override/bin/host-override-helper --uninstall` (Windows: `%USERPROFILE%\.host-override\bin\host-override-helper.exe --uninstall`). Node-route: macOS en Linux `./uninstall.sh`, Windows `extension/helper/uninstall.ps1`. Verwijder daarna de extensie in `chrome://extensions`.

## Beperkingen

- De helper-installatie op Windows en Linux is geschreven en syntactisch gecontroleerd, maar nog niet op die systemen uitgeprobeerd.
- Poort 8899 staat vast (`extension/common.js`, `extension/helper/proxy.js`; voor tests kan de helper met `PORT=...` op een andere poort).
- Het IP geldt voor alle poorten van dat domein.
- Het "registreerbare domein" (voor "nog live" en de migratie-check) wordt bij benadering bepaald, zonder volledige Public Suffix List.
- Headers per groep werken alleen op hosts waarvoor de extensie toegang heeft; bij navigatie vanaf een andere site is toegang tot alle sites nodig.
- De helper-binaries zijn nog niet ondertekend (geen certificaten); zie `store/SIGNING.md`. Getest: macOS arm64 (binary door de volledige testsuite, instellen en koppelen end-to-end met droge installatie). Windows- en Linux-binaries zijn gebouwd maar nog niet op die systemen gestart (CI draait de tests op Linux).
- De binaries zijn groot (40–45 MB gezipt, Windows-exe 95 MB): de volledige Node-runtime zit erin.
- In incognito is de extensie uit, dus daar zie je geen IP-kaart.


## Wat is er nieuw in 1.5.0
- Tabs **Regels / DNS-check / Meer**. Testvenster, delen en instellingen staan onder Meer.
- Compacte helper-melding in plaats van een grote kaart. Zonder helper kun je wel het Chrome-commando voor een testvenster kopieren.
- Huidige site toont **Live** naast **Test**, met een knop "Test dit domein" die het laatst gebruikte IP onthoudt.
- Optioneel TEST-label in de pagina zelf (uit te zetten onder Meer). Vereist IP-weergave. (Sinds 1.7.0 instelbaar als indicator.)
- Zoeken in regels vanaf 7 regels, pijltjestoetsen op de tabs, betere kleurcontrasten, NL- en EN-naam en -omschrijving voor de Store.

## Wat is er nieuw in 1.6.0
- **Rustiger Regels-tab:** de huidige site toont alleen het live IP. Vergelijken met een testserver doe je in de DNS-check (sectie Servers).
- **DNS-check:** alle secties zijn standaard dicht en tonen rechts een korte status. Een gekleurd bolletje laat zien of er iets mis is.
- **Zijpaneel:** klik op het paneel-icoon naast de aan/uit-schakelaar om de extensie rechts in Chrome te openen. Het volgt je actieve tab en controleert in de DNS-tab automatisch elk nieuw domein. Onder Meer kun je kiezen om altijd als zijpaneel te openen.
- **Taal:** Engels en Nederlands. Standaard volgt de extensie de browsertaal, onder Meer kies je zelf. De meldingen van de installatiescripts in Terminal blijven Nederlands.

## Wat is er nieuw in 1.7.0
- **Klaar voor de Chrome Web Store:** nieuwe teksten, rechtvaardigingen en privacybeleid in `store/`, schermafbeeldingen en promotegels (NL en EN) in `store/images/`. Gemaakt door [BijBijker](https://bijbijker.nl), met een kleine credit onderin popup, zijpaneel en welkomstpagina.
- **Veiligheid helper (versie 6):** de extensie maakt een geheime sleutel (32 willekeurige bytes) en het setup-commando legt die met het extensie-ID vast in `~/.host-override/config.json` (map 0700, bestanden 0600). De helper voert alleen opdrachten uit met die sleutel (plus de controles op Origin en `127.0.0.1`/`localhost` tegen DNS-rebinding), en weigert alles zonder geldige config. Voordat de extensie iets stuurt, moet de helper met een HMAC over een willekeurige nonce bewijzen dat hij de sleutel kent; lukt dat niet (bijvoorbeeld een ander programma op poort 8899), dan toont het icoon "!" en gaan er geen regels of verkeer naartoe. Verder: testvenster krijgt alleen origin + pad van de pagina (geen query), maximaal 512 verbindingen en time-outs in de proxy, andere poorten dan 80/443/8443 alleen voor domeinen met een regel, en DNS-antwoorden worden alleen geaccepteerd van de gevraagde server. Na het bijwerken van de extensie vraagt de popup om het setup-commando nog één keer te plakken.
- **Strengere invoercontrole:** domeinen (labels a-z, 0-9, -, max 63 tekens, optioneel `*.`) en IP's (IPv4 zonder voorloopnullen, geldige IPv6) worden overal hetzelfde gecontroleerd: popup, PAC-regel, testvenster-commando en helper.
- **Hosts-bestand en live-check:** de extensie herkent sites die via je hosts-bestand (macOS, Windows, Linux, via de helper, alleen lezen) of een afwijkend IP (ten opzichte van publieke DNS) niet het live IP gebruiken. Zichtbaar in de popup, de DNS-check, de badge op het icoon en een overzicht onder Meer (kopiëren of importeren als regels).
- **Indicator in de pagina:** het TEST-label is nu instelbaar: badge, balk of rand, positie, kleur, tekst, grootte, dekking, verbergen bij muis erover of klik. Ook voor het hosts-bestand en (optioneel) afwijkende DNS.
- **Groepen, notities, hostnaam als doel, headers per groep, verbindingen, abonnementen, sync, back-up, keuze publieke DNS en migratie-check** (zie hierboven bij Gebruiken).
- **Toegankelijkheid:** betere contrasten (AA) in licht en donker, zichtbare focus op alle bedieningselementen, foutmeldingen op de tab Meer staan nu ook op die tab, sneltoets en TEST-label vertaald.

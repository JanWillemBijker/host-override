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

De helper start voortaan zelf bij inloggen (macOS: LaunchAgent, Linux: systemd-gebruikersservice of autostart, Windows: Opstarten-map).

Het setup-commando bevat een geheime sleutel die de extensie bij de eerste start aanmaakt. Het commando schrijft die met het extensie-ID in `~/.host-override/config.json` (alleen leesbaar voor jou). De helper voert alleen opdrachten uit die die sleutel meesturen, en bewijst bij elke statuscontrole dat hij de sleutel kent; anders stuurt de extensie hem niets. Zonder geldige `config.json` weigert de helper alles.

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
- **Delen** toont je regels in hosts-formaat. Plakken bij een collega en "Toevoegen uit tekst" kiezen is genoeg.

## Hoe "niet live" wordt bepaald

1. **Host Override-regel** voor de host: zeker (het verkeer loopt via de helper naar jouw IP).
2. **Hosts-bestand** (via de helper, alleen als die gekoppeld is): staat de naam erin met een eigen IP, dan is dat zeker. Een regel met `0.0.0.0` of `::` is een blokkade; als de pagina toch laadde, telt die niet. Een hosts-bestand met meer dan 50 namen op `127.0.0.1`/`::1` wordt als blokkeerlijst gezien. `localhost`, `broadcasthost`, `ip6-*` en de eigen computernaam worden overgeslagen.
3. **Wijkt af van publieke DNS** (vermoeden): het verbonden IP staat niet in het antwoord van Cloudflare DNS (A en AAAA samen, IPv4-mapped IPv6 genormaliseerd). Dit kan ook een VPN, proxy, lokale DNS of een CDN met geo-DNS zijn. Daarom: zachte formulering in de popup, zit het verbonden IP in hetzelfde /24 (IPv4) of /48 (IPv6) als een publiek adres dan heet het "wijkt licht af" en volgen geen badge en geen indicator, en de automatische controle (die elke hostnaam naar Cloudflare stuurt) staat standaard uit.

## Helper-endpoint `/__hosts` (protocol 6)

`POST /__hosts` met `{"names": ["a.nl"]}` geeft alleen de treffers voor die namen (max 50); `{}` geeft een compact overzicht (overrides tot 1000 regels, blokkeringen alleen geteld met een voorbeeld van 50). `GET /__hosts?names=…` mag ook, maar de extensie gebruikt POST omdat Chrome bij GET geen Origin-header meestuurt. Zelfde controles als de andere opdrachten (geheim, Origin, Host). Het bestand wordt hooguit tot 5 MB gelezen (daarboven alleen het begin, `truncated: true`) en gecachet op grootte en wijzigingstijd. De helper-versie blijft 6: dit endpoint is een uitbreiding, een oudere v6-helper zonder `/__hosts` levert gewoon geen hosts-informatie op.

## Testen

`node tests/run.mjs` test de hosts-parser, de beslisregels en de indicator-instellingen, en start een eigen helper op een vrije poort met een tijdelijke HOME en een nep-hosts-bestand. Daarvoor leest de helper de omgevingsvariabele `HOST_OVERRIDE_HOSTS_FILE` (alleen voor tests; de extensie kan die niet zetten en de setup-scripts doen dat niet). Een draaiende helper op poort 8899 en `~/.host-override` worden niet aangeraakt.

## Delen en Chrome Web Store

De extensie bevat alles (ook de helper), dus delen is alleen de extensie delen.

- **Zip:** `./package.sh` maakt `dist/host-override-<versie>.zip`. Een collega pakt die uit, laadt de map als uitgepakte extensie en volgt de welkomstpagina.
- **Chrome Web Store:** dezelfde zip kan worden geüpload. Teksten, rechtvaardiging van de rechten en het privacybeleid staan in `store/`. Stappen staan onderaan `store/LISTING.md`.

## Problemen oplossen

| Melding | Oplossing |
| --- | --- |
| "Helper draait niet" | Plak het setup-commando opnieuw (uit de popup of welkomstpagina). Controle: open `http://127.0.0.1:8899` |
| "Helper-update beschikbaar" of "Helper moet opnieuw worden ingesteld" | Kopieer het setup-commando uit de popup en plak het nog één keer. Blijft de melding, kijk dan wat er op poort 8899 draait (`lsof -i :8899`). Tot het is opgelost gaan domeinen op je lijst nergens heen (foutmelding in plaats van een verkeerde server). |
| "Een andere extensie beheert de proxy" | Zet andere proxy- of VPN-extensies uit |
| Certificaatfout | De testserver moet een geldig certificaat voor dat domein hebben |
| Oude site blijft staan | Hard verversen of tab sluiten en opnieuw openen |
| Helper start niet na Node-update | Plak het setup-commando opnieuw (het pad naar Node wordt dan vernieuwd) |

Logs: macOS `~/Library/Logs/host-override.log`, Linux `journalctl --user -u host-override`.

## Verwijderen

macOS en Linux: `./uninstall.sh`. Windows: `extension/helper/uninstall.ps1`. Verwijder daarna de extensie in `chrome://extensions`.

## Beperkingen

- De helper-installatie op Windows en Linux is geschreven en syntactisch gecontroleerd, maar nog niet op die systemen uitgeprobeerd.
- Poort 8899 staat vast (`extension/common.js`, `extension/helper/proxy.js`; voor tests kan de helper met `PORT=...` op een andere poort).
- Het IP geldt voor alle poorten van dat domein.
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
- **Toegankelijkheid:** betere contrasten (AA) in licht en donker, zichtbare focus op alle bedieningselementen, foutmeldingen op de tab Meer staan nu ook op die tab, sneltoets en TEST-label vertaald.

# Privacybeleid Host Override / Privacy policy Host Override

Laatst bijgewerkt / Last updated: 12 november 2026 (versie 1.7.0)

Host Override is gemaakt door BijBijker (https://bijbijker.nl).

## Nederlands

**Kort:** Host Override verzamelt, verkoopt of verstuurt geen persoonsgegevens naar de maker of naar derden. Er is geen account, geen analytics en geen tracking.

### Wat lokaal wordt opgeslagen
- Jouw regels (domein en IP of hostnaam), groepen, notities, verzoek-headers per groep (inclusief een eventueel Basic-auth-wachtwoord), abonnementen (URL en de opgehaalde regels), instellingen (aan/uit, taal, automatisch herladen, indicator in de pagina, zijpaneel, DNS-dienst), recente domeinen van de DNS-check, het laatst gebruikte test-IP en een willekeurig aangemaakte geheime sleutel voor de helper: in de opslag van je eigen browser (chrome.storage.local).
- Het IP-adres van de hoofdpagina per tab en of dat het live IP is, en per tab een overzicht van de hosts, IP's en soorten verzoeken (script, afbeelding...) van de pagina (alleen met toegang tot alle sites), plus opgezochte DNS-antwoorden: tijdelijk in de browsersessie (chrome.storage.session), gewist bij een nieuwe pagina (overzicht), het sluiten van de tab of de browser. Geen volledige adressen, geen inhoud.
- De helper bewaart een kopie van je regels, het ID van de extensie en dezelfde geheime sleutel in je eigen thuismap (`~/.host-override/rules.json` en `config.json`, alleen leesbaar voor jouw gebruikersaccount).

### De lokale helper
De helper is een klein programma dat je zelf installeert: als losse download (van de GitHub-releases van het project; de extensie toont alleen de link en downloadt of start zelf niets) of vanuit de broncode in het pakket van de extensie met Node.js. Het draait alleen op je eigen computer en luistert alleen op 127.0.0.1. Opdrachten (regels, DNS-check, testvenster) voert het alleen uit als ze een geheime sleutel bevatten die alleen deze extensie en jouw helper kennen; die sleutel wordt bij de eerste start willekeurig aangemaakt en komt in de helper via het setup-commando dat je zelf plakt, of doordat je de koppelcode die de helper toont in de extensie typt (de extensie stuurt de sleutel dan eenmalig naar de helper op je eigen computer). De download bevat geen telemetrie en de helper zoekt niet zelf naar updates. GitHub (de downloadsite) kan bij het downloaden, zoals elke website, je IP-adres en browsergegevens zien; zie het privacybeleid van GitHub. Voordat de extensie iets naar de helper stuurt, moet de helper bewijzen dat hij die sleutel kent. Zonder geldige sleutel weigert de helper alle opdrachten. De helper stuurt verkeer voor domeinen op je lijst naar het IP dat jij hebt opgegeven en neemt geen contact op met de maker. De sleutel verlaat je computer niet.

### Hosts-bestand
Met de helper kijkt Host Override of een site in het hosts-bestand van je computer staat (`/etc/hosts` op macOS en Linux, `%SystemRoot%\System32\drivers\etc\hosts` op Windows). De helper leest dat bestand alleen (hooguit 5 MB) en schrijft er nooit in. De treffers worden alleen in de extensie getoond (popup, DNS-check, overzicht onder Meer, badge en indicator). Er gaat niets van je computer af.

### Synchroniseren (standaard uit)
Zet je "Synchroniseren" aan, dan gaan je eigen regels, groepen, notities, abonnementen (alleen de URL) en instellingen via de sync-opslag van Chrome (chrome.storage.sync) naar je andere Chrome-installaties met hetzelfde Google-account. Dat loopt via Google (Chrome-synchronisatie), niet via de maker. De helper-sleutel, Basic-auth-wachtwoorden en de aan/uit-schakelaar gaan nooit mee.

### Back-up
Een back-up is een JSON-bestand dat je zelf opslaat. De helper-sleutel en Basic-auth-wachtwoorden staan er alleen in als je dat bij het exporteren aanvinkt.

### Verzoek-headers
Stel je bij een groep "geen cache", Basic-auth of eigen headers in, dan voegt Chrome die headers toe aan verzoeken naar de hosts van die groep (zolang de groep aan staat). Het Basic-auth-wachtwoord gaat dus naar die servers, zoals bij gewoon inloggen; nergens anders heen.

### Toegang tot sites
Als je "IP-weergave inschakelen" kiest, geef je de extensie optioneel toegang tot alle sites. Die wordt alleen gebruikt om het IP-adres van de hoofdpagina te lezen, om in de tab Verbindingen per pagina te tonen van welke hosts en IP's ze iets laadde (hostnaam, IP, soort en aantal verzoeken), en om een kleine, instelbare indicator (bijvoorbeeld "TEST · 1.2.3.4") te tonen op pagina's die niet van het live IP komen. Daarnaast vraagt de extensie soms toegang tot een paar losse domeinen, altijd op jouw klik: de website van een regellijst waarop je abonneert, de hosts van een groep waarvoor je headers instelt, of dns.google / dns.quad9.net als je die DNS-dienst kiest. De indicator wordt in de pagina gezet, maar leest niets uit de pagina. De inhoud van pagina's wordt niet gelezen of opgeslagen. Je kunt deze toegang altijd intrekken via chrome://extensions.

### Verbindingen met derden (alleen op jouw verzoek)
- **Live IP opzoeken:** alleen als je op "Opzoeken" klikt, gaat de hostnaam van de huidige site naar de gekozen DNS-dienst: standaard Cloudflare DNS-over-HTTPS (cloudflare-dns.com), of naar keuze Google (dns.google), Quad9 (dns.quad9.net) of "via de helper" (dan vraagt de helper de DNS-server van je eigen systeem/netwerk, geen externe dienst). Zie het privacybeleid van die dienst.
- **Indicator "als het IP afwijkt van publieke DNS":** staat standaard uit. Zet je deze optie aan, dan gaat de hostnaam van elke pagina die je opent naar de gekozen DNS-dienst, om het verbonden IP te vergelijken met het publieke DNS-antwoord. Dat staat ook bij de optie zelf.
- **Abonnementen:** de extensie haalt de regellijst op van de https-URL die je zelf opgeeft (bij abonneren en daarna handmatig, elk uur of elke dag). Die server ziet dan een verzoek van jouw IP; er worden geen cookies of inloggegevens meegestuurd.
- **Migratie-check (op klik):** de helper vraagt de registratiegegevens van het domein op via RDAP (de lijst van IANA op data.iana.org en de RDAP-server van de registry, bijvoorbeeld rdap.sidn.nl). Alleen als je "Ook subdomeinen zoeken via crt.sh" aanvinkt, gaat de domeinnaam ook naar crt.sh (een openbare database van certificaten, beheerd door Sectigo). Verder doet de helper DNS-vragen en `GET`-verzoeken (met doorverwijzingen op hetzelfde IP) naar de live en de nieuwe server van dat domein.
- **DNS-check:** bij een controle stelt de helper op je eigen computer DNS-vragen aan openbare DNS-servers (root- en TLD-servers, de nameservers van het domein, en de resolvers van Cloudflare, Google, Quad9 en OpenDNS) en doet HTTP(S)-verzoeken (`GET /`) naar de IP-adressen van dat domein. Een controle start als je een domein invult, als je de tab DNS-check opent (voor de site in je actieve tab), en **in het zijpaneel automatisch voor elk nieuw domein in je actieve tab** zolang de tab DNS-check daar open staat. Die domeinnamen gaan dan dus naar die DNS-servers, en de servers van het domein zien een verzoek van jouw IP. Wil je dat niet, gebruik dan het zijpaneel niet op de tab DNS-check. Resultaten blijven op je computer.
- **Testvenster:** de helper start op jouw klik een tweede Chrome-venster met een eigen profiel (`~/chrome-test`).

### Verwijderen
Verwijder de extensie via chrome://extensions. De helper en zijn bestanden verwijder je met `host-override-helper --uninstall` (download) of het meegeleverde script (`uninstall.sh` of `helper/uninstall.ps1`).

### Contact
BijBijker – https://bijbijker.nl (contactadres: zie de website).

## English

**In short:** Host Override does not collect, sell or send personal data to the developer or any third party. There is no account, no analytics and no tracking.

### Stored locally
- Your rules (domain and IP or hostname), groups, notes, request headers per group (including any Basic auth password), subscriptions (URL and the fetched rules), settings (on/off, language, auto reload, on-page indicator, side panel, DNS service), recent DNS-check domains, the last used test IP and a randomly generated secret key for the helper: in your own browser storage (chrome.storage.local).
- The main-frame IP per tab and whether it is the live IP, and per tab an overview of the hosts, IPs and request types (script, image...) the page used (only with access to all sites), plus looked-up DNS answers: temporarily in the browser session (chrome.storage.session), cleared on a new page (overview), when the tab closes or the browser closes. No full addresses, no content.
- The helper keeps a copy of your rules, the extension ID and the same secret key in your home folder (`~/.host-override/rules.json` and `config.json`, readable only by your user account).

### The local helper
The helper is a small program you install yourself: as a separate download (from the project's GitHub releases; the extension only shows the link and never downloads or starts anything itself) or from the source code inside the extension package using Node.js. It runs only on your own computer and listens only on 127.0.0.1. It only carries out commands (rules, DNS check, test window) that include a secret key that only this extension and your helper know; the key is generated randomly on first run and reaches the helper through the setup command you paste yourself, or when you type the pairing code shown by the helper into the extension (the extension then sends the key once to the helper on your own computer). The download contains no telemetry and the helper does not check for updates by itself. Like any website, GitHub (the download site) can see your IP address and browser details when you download; see GitHub's privacy policy. Before the extension sends anything to the helper, the helper must prove it knows that key. Without a valid key the helper refuses all commands. The helper routes traffic for the domains on your list to the IP you entered and never contacts the developer. The key never leaves your computer.

### Hosts file
With the helper, Host Override checks whether a site is listed in your computer's hosts file (`/etc/hosts` on macOS and Linux, `%SystemRoot%\System32\drivers\etc\hosts` on Windows). The helper only reads that file (at most 5 MB) and never writes to it. Matches are shown only inside the extension (popup, DNS check, overview under More, badge and indicator). Nothing leaves your computer.

### Sync (off by default)
If you turn on "Sync", your own rules, groups, notes, subscriptions (URL only) and settings are copied via Chrome's sync storage (chrome.storage.sync) to your other Chrome installs with the same Google account. That goes through Google (Chrome sync), not through the developer. The helper key, Basic auth passwords and the on/off switch are never synced.

### Backup
A backup is a JSON file you save yourself. It only contains the helper key and Basic auth passwords if you tick that when exporting.

### Request headers
If you set "no cache", Basic auth or custom headers for a group, Chrome adds those headers to requests to that group's hosts (while the group is on). The Basic auth password therefore goes to those servers, as with a normal login, and nowhere else.

### Site access
If you choose "Enable IP display" you optionally grant access to all sites. It is used only to read the IP address of the main page, to show in the Connections tab which hosts and IPs a page loaded something from (hostname, IP, type and number of requests), and to show a small, configurable indicator (for example "TEST · 1.2.3.4") on pages that are not served from their live IP. In addition the extension sometimes asks for access to a few single domains, always on your click: the website of a rules list you subscribe to, the hosts of a group for which you set headers, or dns.google / dns.quad9.net if you choose that DNS service. The indicator is added to the page but reads nothing from it. Page content is not read or stored. You can revoke this at any time via chrome://extensions.

### Third-party connections (only when you ask)
- **Look up live IP:** only when you click "Look up", the current hostname is sent to the chosen DNS service: Cloudflare DNS-over-HTTPS (cloudflare-dns.com) by default, or optionally Google (dns.google), Quad9 (dns.quad9.net) or "via the helper" (the helper then asks your own system/network DNS server, no external service). See that service's privacy policy.
- **Indicator "when the IP differs from public DNS":** off by default. If you turn it on, the hostname of every page you open is sent to the chosen DNS service to compare the connected IP with the public DNS answer. This is also stated next to the option.
- **Subscriptions:** the extension fetches the rules list from the https URL you enter (when subscribing and then manually, hourly or daily). That server sees a request from your IP; no cookies or credentials are sent.
- **Migration check (on click):** the helper looks up the domain's registration data via RDAP (IANA's list at data.iana.org and the registry's RDAP server, for example rdap.sidn.nl). Only if you tick "Also find subdomains via crt.sh" is the domain name also sent to crt.sh (a public certificate database run by Sectigo). The helper also makes DNS queries and `GET` requests (following redirects on the same IP) to the live and the new server of that domain.
- **DNS check:** during a check, the helper on your computer queries public DNS servers (root and TLD servers, the domain's nameservers, and the Cloudflare, Google, Quad9 and OpenDNS resolvers) and makes HTTP(S) requests (`GET /`) to that domain's IP addresses. A check starts when you enter a domain, when you open the DNS check tab (for the site in your active tab), and **in the side panel automatically for every new domain in your active tab** while the DNS check tab is open there. Those domain names are therefore sent to those DNS servers, and the domain's servers see a request from your IP. If you do not want that, do not leave the side panel on the DNS check tab. Results stay on your computer.
- **Test window:** on your click, the helper starts a second Chrome window with its own profile (`~/chrome-test`).

### Removal
Remove the extension via chrome://extensions. Remove the helper and its files with `host-override-helper --uninstall` (download) or the bundled script (`uninstall.sh` or `helper/uninstall.ps1`).

### Contact
BijBijker – https://bijbijker.nl (contact details on the website).

# Privacybeleid Host Override / Privacy policy Host Override

Laatst bijgewerkt / Last updated: 12 november 2026 (versie 1.7.0)

Host Override is gemaakt door BijBijker (https://bijbijker.nl).

## Nederlands

**Kort:** Host Override verzamelt, verkoopt of verstuurt geen persoonsgegevens naar de maker of naar derden. Er is geen account, geen analytics en geen tracking.

### Wat lokaal wordt opgeslagen
- Jouw regels (domein en IP), instellingen (aan/uit, taal, automatisch herladen, TEST-label, zijpaneel), recente domeinen van de DNS-check, het laatst gebruikte test-IP en een willekeurig aangemaakte geheime sleutel voor de helper: in de opslag van je eigen browser (chrome.storage.local).
- Het IP-adres van de hoofdpagina per tab (alleen met IP-weergave aan): tijdelijk in de browsersessie (chrome.storage.session), gewist bij het sluiten van de tab of browser.
- De helper bewaart een kopie van je regels, het ID van de extensie en dezelfde geheime sleutel in je eigen thuismap (`~/.host-override/rules.json` en `config.json`, alleen leesbaar voor jouw gebruikersaccount).

### De lokale helper
De helper is een klein programma uit het pakket van de extensie dat je zelf installeert. Het draait alleen op je eigen computer en luistert alleen op 127.0.0.1. Opdrachten (regels, DNS-check, testvenster) voert het alleen uit als ze een geheime sleutel bevatten die alleen deze extensie en jouw helper kennen; die sleutel wordt bij de eerste start willekeurig aangemaakt en via het setup-commando dat je zelf plakt in de helper gezet. Voordat de extensie iets naar de helper stuurt, moet de helper bewijzen dat hij die sleutel kent. Zonder geldige sleutel weigert de helper alle opdrachten. De helper stuurt verkeer voor domeinen op je lijst naar het IP dat jij hebt opgegeven en neemt geen contact op met de maker. De sleutel verlaat je computer niet.

### Toegang tot sites
Als je "IP-weergave inschakelen" kiest, geef je de extensie optioneel toegang tot alle sites. Die wordt alleen gebruikt om het IP-adres van de hoofdpagina te lezen en om een klein TEST-label te tonen op pagina's die van je testserver komen. De inhoud van pagina's wordt niet gelezen of opgeslagen. Je kunt deze toegang altijd intrekken via chrome://extensions.

### Verbindingen met derden (alleen op jouw verzoek)
- **Live IP opzoeken:** alleen als je op "Opzoeken" klikt, gaat de hostnaam van de huidige site naar Cloudflare DNS-over-HTTPS (cloudflare-dns.com). Zie het privacybeleid van Cloudflare.
- **DNS-check:** bij een controle stelt de helper op je eigen computer DNS-vragen aan openbare DNS-servers (root- en TLD-servers, de nameservers van het domein, en de resolvers van Cloudflare, Google, Quad9 en OpenDNS) en doet HTTP(S)-verzoeken (`GET /`) naar de IP-adressen van dat domein. Een controle start als je een domein invult, als je de tab DNS-check opent (voor de site in je actieve tab), en **in het zijpaneel automatisch voor elk nieuw domein in je actieve tab** zolang de tab DNS-check daar open staat. Die domeinnamen gaan dan dus naar die DNS-servers, en de servers van het domein zien een verzoek van jouw IP. Wil je dat niet, gebruik dan het zijpaneel niet op de tab DNS-check. Resultaten blijven op je computer.
- **Testvenster:** de helper start op jouw klik een tweede Chrome-venster met een eigen profiel (`~/chrome-test`).

### Verwijderen
Verwijder de extensie via chrome://extensions. De helper en zijn bestanden verwijder je met het meegeleverde script (`uninstall.sh` of `helper/uninstall.ps1`).

### Contact
BijBijker – https://bijbijker.nl (contactadres: zie de website).

## English

**In short:** Host Override does not collect, sell or send personal data to the developer or any third party. There is no account, no analytics and no tracking.

### Stored locally
- Your rules (domain and IP), settings (on/off, language, auto reload, TEST label, side panel), recent DNS-check domains, the last used test IP and a randomly generated secret key for the helper: in your own browser storage (chrome.storage.local).
- The main-frame IP per tab (only with IP display enabled): temporarily in the browser session (chrome.storage.session), cleared when the tab or browser closes.
- The helper keeps a copy of your rules, the extension ID and the same secret key in your home folder (`~/.host-override/rules.json` and `config.json`, readable only by your user account).

### The local helper
The helper is a small program from the extension package that you install yourself. It runs only on your own computer and listens only on 127.0.0.1. It only carries out commands (rules, DNS check, test window) that include a secret key that only this extension and your helper know; the key is generated randomly on first run and put into the helper by the setup command you paste yourself. Before the extension sends anything to the helper, the helper must prove it knows that key. Without a valid key the helper refuses all commands. The helper routes traffic for the domains on your list to the IP you entered and never contacts the developer. The key never leaves your computer.

### Site access
If you choose "Enable IP display" you optionally grant access to all sites. It is used only to read the IP address of the main page and to show a small TEST label on pages served by your test server. Page content is not read or stored. You can revoke this at any time via chrome://extensions.

### Third-party connections (only when you ask)
- **Look up live IP:** only when you click "Look up", the current hostname is sent to Cloudflare DNS-over-HTTPS (cloudflare-dns.com). See Cloudflare's privacy policy.
- **DNS check:** during a check, the helper on your computer queries public DNS servers (root and TLD servers, the domain's nameservers, and the Cloudflare, Google, Quad9 and OpenDNS resolvers) and makes HTTP(S) requests (`GET /`) to that domain's IP addresses. A check starts when you enter a domain, when you open the DNS check tab (for the site in your active tab), and **in the side panel automatically for every new domain in your active tab** while the DNS check tab is open there. Those domain names are therefore sent to those DNS servers, and the domain's servers see a request from your IP. If you do not want that, do not leave the side panel on the DNS check tab. Results stay on your computer.
- **Test window:** on your click, the helper starts a second Chrome window with its own profile (`~/chrome-test`).

### Removal
Remove the extension via chrome://extensions. Remove the helper and its files with the bundled script (`uninstall.sh` or `helper/uninstall.ps1`).

### Contact
BijBijker – https://bijbijker.nl (contact details on the website).

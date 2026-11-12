# Privacybeleid Host Override / Privacy policy Host Override

Laatst bijgewerkt / Last updated: 12 november 2026 (versie 1.7.0)

Host Override is gemaakt door BijBijker (https://bijbijker.nl).

## Nederlands

**Kort:** Host Override verzamelt, verkoopt of verstuurt geen persoonsgegevens naar de maker of naar derden. Er is geen account, geen analytics en geen tracking.

### Wat lokaal wordt opgeslagen
- Jouw regels (domein en IP), instellingen (aan/uit, taal, automatisch herladen, TEST-label, zijpaneel), recente domeinen van de DNS-check en het laatst gebruikte test-IP: in de opslag van je eigen browser (chrome.storage.local).
- Het IP-adres van de hoofdpagina per tab (alleen met IP-weergave aan): tijdelijk in de browsersessie (chrome.storage.session), gewist bij het sluiten van de tab of browser.
- De helper bewaart een kopie van je regels en het ID van de extensie in je eigen thuismap (`~/.host-override/rules.json` en `config.json`).

### De lokale helper
De helper is een klein programma uit het pakket van de extensie dat je zelf installeert. Het draait alleen op je eigen computer, luistert alleen op 127.0.0.1 en accepteert alleen opdrachten van deze extensie. Het stuurt verkeer voor domeinen op je lijst naar het IP dat jij hebt opgegeven. Het neemt geen contact op met de maker.

### Toegang tot sites
Als je "IP-weergave inschakelen" kiest, geef je de extensie optioneel toegang tot alle sites. Die wordt alleen gebruikt om het IP-adres van de hoofdpagina te lezen en om een klein TEST-label te tonen op pagina's die van je testserver komen. De inhoud van pagina's wordt niet gelezen of opgeslagen. Je kunt deze toegang altijd intrekken via chrome://extensions.

### Verbindingen met derden (alleen op jouw verzoek)
- **Live IP opzoeken:** alleen als je op "Opzoeken" klikt, gaat de hostnaam van de huidige site naar Cloudflare DNS-over-HTTPS (cloudflare-dns.com). Zie het privacybeleid van Cloudflare.
- **DNS-check:** als je een domein controleert, stelt de helper op je eigen computer DNS-vragen aan openbare DNS-servers (root- en TLD-servers, de nameservers van het domein, en de resolvers van Cloudflare, Google, Quad9 en OpenDNS) en doet HTTP(S)-verzoeken naar de IP-adressen van dat domein. Resultaten blijven op je computer.
- **Testvenster:** de helper start op jouw klik een tweede Chrome-venster met een eigen profiel (`~/chrome-test`).

### Verwijderen
Verwijder de extensie via chrome://extensions. De helper en zijn bestanden verwijder je met het meegeleverde script (`uninstall.sh` of `helper/uninstall.ps1`).

### Contact
BijBijker – https://bijbijker.nl (contactadres: zie de website).

## English

**In short:** Host Override does not collect, sell or send personal data to the developer or any third party. There is no account, no analytics and no tracking.

### Stored locally
- Your rules (domain and IP), settings (on/off, language, auto reload, TEST label, side panel), recent DNS-check domains and the last used test IP: in your own browser storage (chrome.storage.local).
- The main-frame IP per tab (only with IP display enabled): temporarily in the browser session (chrome.storage.session), cleared when the tab or browser closes.
- The helper keeps a copy of your rules and the extension ID in your home folder (`~/.host-override/rules.json` and `config.json`).

### The local helper
The helper is a small program from the extension package that you install yourself. It runs only on your own computer, listens only on 127.0.0.1 and only accepts commands from this extension. It routes traffic for the domains on your list to the IP you entered. It never contacts the developer.

### Site access
If you choose "Enable IP display" you optionally grant access to all sites. It is used only to read the IP address of the main page and to show a small TEST label on pages served by your test server. Page content is not read or stored. You can revoke this at any time via chrome://extensions.

### Third-party connections (only when you ask)
- **Look up live IP:** only when you click "Look up", the current hostname is sent to Cloudflare DNS-over-HTTPS (cloudflare-dns.com). See Cloudflare's privacy policy.
- **DNS check:** when you check a domain, the helper on your computer queries public DNS servers (root and TLD servers, the domain's nameservers, and the Cloudflare, Google, Quad9 and OpenDNS resolvers) and makes HTTP(S) requests to that domain's IP addresses. Results stay on your computer.
- **Test window:** on your click, the helper starts a second Chrome window with its own profile (`~/chrome-test`).

### Removal
Remove the extension via chrome://extensions. Remove the helper and its files with the bundled script (`uninstall.sh` or `helper/uninstall.ps1`).

### Contact
BijBijker – https://bijbijker.nl (contact details on the website).

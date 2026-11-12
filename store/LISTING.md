# Chrome Web Store: teksten en antwoorden

## Naam
Host Override

## Korte beschrijving (max 132 tekens)
NL: Test een site op een andere server (IP) in je gewone Chrome. Incognito blijft de live site tonen.
EN: Test a site on another server (IP) in your normal Chrome while incognito keeps showing the live site.

## Uitgebreide beschrijving (NL)
Host Override koppelt domeinen aan een ander IP-adres, alleen in je gewone Chrome-profiel. Ideaal om een website op een teststaging- of nieuwe server te controleren, zonder je hosts-bestand aan te passen.

- Vergelijk live en test naast elkaar: gewoon venster = testserver, incognito = live site.
- Zie direct op welk IP de huidige site draait, met een TEST-label op tabs met een override.
- Wildcards (*.voorbeeld.nl), IP's per regel aanpassen, alles tegelijk wisselen, aan/uit met Alt+Shift+H.
- Deel je regels als gewone tekst in hosts-formaat.
- Open met één klik een apart testvenster met dezelfde regels, of kopieer het commando (macOS, Windows en Linux).
- Ingebouwde DNS-check: records, nameservers rechtstreeks bevraagd, resolvers vergelijken, SPF/DMARC en een HTTP/HTTPS/certificaatcontrole per IP.

Let op: Chrome staat zelf geen IP-koppeling toe. Daarom installeer je eenmalig een klein lokaal programma (helper, vereist Node.js). De extensie leidt je er stap voor stap doorheen. De helper draait alleen op je eigen computer.

## Detailed description (EN)
Host Override maps domains to another IP address, in your regular Chrome profile only. Ideal for checking a website on a staging or new server without editing your hosts file.

- Compare live and test side by side: normal window = test server, incognito = live site.
- See which IP the current site runs on, with a TEST badge on tabs with an override.
- Wildcards (*.example.com), per-rule IPs, switch all at once, toggle with Alt+Shift+H.
- Share your rules as plain text in hosts-file format.
- One click opens a separate test window with the same rules, or copy the command (macOS, Windows, Linux).
- Built-in DNS check: records, nameservers queried directly, resolver comparison, SPF/DMARC and an HTTP/HTTPS/certificate check per IP.

Note: Chrome does not allow IP mapping by itself, so you install a small local program (helper, requires Node.js) once. The extension guides you through it. The helper only runs on your own computer.

## Single purpose
Per Chrome-profiel domeinen naar een ander IP-adres sturen om een site op een andere server te testen.

## Rechtvaardiging per toestemming
- **proxy**: zet een proxy-regel (PAC) alleen voor het gewone profiel, zodat de gekozen domeinen via de lokale helper naar het opgegeven IP gaan.
- **storage**: bewaart de regels en instellingen van de gebruiker.
- **alarms**: controleert elke minuut of de lokale helper bereikbaar is en stuurt de regels opnieuw door.
- **activeTab**: leest de URL van de actieve tab als de gebruiker op het icoon klikt, om het huidige domein te tonen en de tab te herladen.
- **webRequest** (en optioneel host-toegang tot alle sites): leest alleen het IP-adres van de hoofdpagina om dat in de popup te tonen. Alleen actief nadat de gebruiker "IP-weergave inschakelen" kiest. Er wordt niets bewaard buiten de browser of verstuurd.
- **Host-toegang http://127.0.0.1:8899**: communicatie met de lokale helper.
- **Host-toegang https://cloudflare-dns.com**: optionele DNS-opzoeking op klik van de gebruiker ("Live IP opzoeken").

## Remote code
Geen. Alle code zit in het pakket. Het setup-commando voor de helper wordt uit meegeleverde bestanden samengesteld en door de gebruiker zelf geplakt.

## Gegevensgebruik (formulier in het ontwikkelaarsdashboard)
Geen gegevens verzameld. Zie PRIVACY.md.

## Nog te doen voor publicatie
1. Ontwikkelaarsaccount aanmaken (eenmalig 5 USD): https://chrome.google.com/webstore/devconsole
2. `./package.sh` draaien en `dist/host-override-<versie>.zip` uploaden.
3. Schermafbeeldingen 1280x800 maken (popup met regels, huidige-site-kaart, welkomstpagina).
4. PRIVACY.md op een openbare URL zetten (bijvoorbeeld GitHub Pages) en die URL invullen.
5. Zichtbaarheid "Niet vermeld" kiezen als je alleen een link wilt delen.

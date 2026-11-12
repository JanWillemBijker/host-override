# Chrome Web Store: teksten en antwoorden (versie 1.7.0)

Gemaakt door BijBijker (https://bijbijker.nl).

## Basis

| Veld | Waarde |
| --- | --- |
| Naam (max 75) | Host Override (13 tekens, uit `_locales/*/messages.json` → `extName`) |
| Categorie | Ontwikkelaarstools (Developer Tools) |
| Taal | Nederlands en Engels (`_locales/nl`, `_locales/en`, standaard `en`) |
| Website | https://bijbijker.nl (ook `homepage_url` in het manifest) |
| Zichtbaarheid | Openbaar of "Niet vermeld" (alleen via link) |

## Korte beschrijving (max 132, staat in het manifest via `extDesc`)
- NL (113): Test een site op een andere server (IP) in je gewone Chrome, terwijl incognito de live site toont. Met DNS-check.
- EN (123): Test a site on another server (IP) in your normal Chrome while incognito keeps showing the live site. Includes a DNS check.

## Uitgebreide beschrijving (NL)
Host Override koppelt domeinen aan een ander IP-adres, alleen in je gewone Chrome-profiel. Ideaal om een website op een staging- of nieuwe server te controleren, zonder je hosts-bestand aan te passen.

- Vergelijk live en test naast elkaar: gewoon venster = testserver, incognito = live site.
- Zie op welk IP de huidige site draait, met een TEST-label op tabs met een override.
- Wildcards (*.voorbeeld.nl), IP's per regel aanpassen, alles tegelijk wisselen, aan/uit met Alt+Shift+H.
- Deel je regels als gewone tekst in hosts-formaat.
- Open met één klik een apart testvenster met dezelfde regels, of kopieer het commando (macOS, Windows en Linux).
- Ingebouwde DNS-check: records, nameservers rechtstreeks bevraagd, resolvers vergelijken, SPF/DMARC en een HTTP/HTTPS/certificaatcontrole per IP. In het zijpaneel controleert hij automatisch elk nieuw domein in je actieve tab zolang de tab DNS-check open staat.
- Werkt als popup of in het zijpaneel van Chrome.

BELANGRIJK: lokale helper vereist
Chrome laat een extensie zelf geen IP-adressen koppelen. Daarom installeer je eenmalig een klein lokaal programma (de helper, vereist Node.js). De extensie leidt je er stap voor stap doorheen: je kopieert een setup-commando en plakt het zelf in Terminal of PowerShell. De helper zit volledig in het pakket van de extensie (er wordt niets gedownload), draait alleen op je eigen computer en is alleen bereikbaar via 127.0.0.1. Hij voert alleen opdrachten uit met een geheime sleutel die alleen deze extensie en jouw helper kennen (bij de installatie aangemaakt), en de extensie controleert eerst of de helper die sleutel kent. Verwijderen kan met één commando.

Privacy: geen account, geen tracking, geen analytics. Regels en instellingen blijven op je eigen computer.

Gemaakt door BijBijker – https://bijbijker.nl

## Detailed description (EN)
Host Override maps domains to another IP address, in your regular Chrome profile only. Ideal for checking a website on a staging or new server without editing your hosts file.

- Compare live and test side by side: normal window = test server, incognito = live site.
- See which IP the current site runs on, with a TEST badge on tabs with an override.
- Wildcards (*.example.com), per-rule IPs, switch all at once, toggle with Alt+Shift+H.
- Share your rules as plain text in hosts-file format.
- One click opens a separate test window with the same rules, or copy the command (macOS, Windows, Linux).
- Built-in DNS check: records, nameservers queried directly, resolver comparison, SPF/DMARC and an HTTP/HTTPS/certificate check per IP. In the side panel it automatically checks every new domain in your active tab while the DNS check tab is open.
- Works as a popup or in Chrome's side panel.

IMPORTANT: local helper required
Chrome does not let an extension map IP addresses by itself, so you install a small local program (the helper, requires Node.js) once. The extension guides you step by step: you copy a setup command and paste it into Terminal or PowerShell yourself. The helper ships entirely inside the extension package (nothing is downloaded), runs only on your own computer and is only reachable via 127.0.0.1. It only carries out commands that include a secret key that only this extension and your helper know (created during setup), and the extension first checks that the helper knows that key. It can be removed with one command.

Privacy: no account, no tracking, no analytics. Rules and settings stay on your own computer.

Made by BijBijker – https://bijbijker.nl

## Single purpose (veld "Doel met één functie")
NL: Websites testen op een andere server door domeinen, alleen in het gewone Chrome-profiel, naar een zelfgekozen IP-adres te sturen, met hulpmiddelen om live en test te vergelijken (huidig IP, DNS-check).
EN: Test websites on another server by routing chosen domains to a user-specified IP address in the regular Chrome profile only, with tools to compare live and test (current IP, DNS check).

## Rechtvaardiging per toestemming (Engels invullen in het dashboard)
| Toestemming | Rechtvaardiging (EN) |
| --- | --- |
| `proxy` | Sets a PAC proxy rule for the regular profile only, so that only the domains the user added are routed via the local helper (127.0.0.1) to the IP the user entered. All other traffic goes DIRECT. This is the core function. |
| `storage` | Stores the user's rules and settings locally (chrome.storage.local), the random secret key shared with the local helper, and per-tab IP info for the session (chrome.storage.session). |
| `alarms` | Once per minute checks whether the local helper is running and re-sends the rules, so the extension recovers after the helper restarts. |
| `webRequest` | Reads only the server IP of main-frame requests (onCompleted) to show which IP the current site runs on and to mark tabs with an active override. Only works after the user grants optional host access via "Enable IP display". Nothing is blocked, modified, stored outside the browser or sent anywhere. |
| `activeTab` | Reads the URL of the active tab when the user opens the popup or presses the shortcut, to show the current domain and reload it after a rule change. |
| `scripting` | Shows a small "TEST <ip>" label on pages that are served by the test server (only with IP display enabled; can be turned off). Injects a self-contained function, no remote code. |
| `sidePanel` | Lets the user open the same interface in Chrome's side panel. |
| Host `http://127.0.0.1:8899/*` | Communication with the local helper program on the user's own computer. |
| Host `https://cloudflare-dns.com/*` | Optional live-IP lookup via DNS-over-HTTPS, only when the user clicks "Look up". |
| Optional host `<all_urls>` | Requested at runtime only (button "Enable IP display") to read the IP of the main frame via webRequest and to show the TEST label. Not requested at install. |

## Remote code
Antwoord: **Nee, geen remote code.** Alle JavaScript zit in het pakket. Geen `eval`, geen `new Function`, geen externe scripts. De PAC-regel wordt lokaal opgebouwd uit gevalideerde domeinnamen (alleen a-z, 0-9, `-`, `.` en `*.`). De helper (`helper/proxy.js`, `helper/dnstools.js`) zit in het pakket; het setup-commando wordt uit die meegeleverde bestanden samengesteld en door de gebruiker zelf in de terminal geplakt. De extensie voert zelf niets uit op het systeem en downloadt niets.

Toelichting voor de reviewer (veld "Opmerkingen" of in de beschrijving):
> This extension requires a small local helper (Node.js) because Chrome extensions cannot map hostnames to IP addresses. The helper source is bundled in the package (`helper/`), shown to the user before they copy it, and installed by the user themselves. It listens on 127.0.0.1 only and does not contact the developer.
>
> How setup and authentication work: on first run the extension generates a random 32-byte secret (`crypto.getRandomValues`) and keeps it in `chrome.storage.local`. The setup command shown on the welcome page / popup is assembled locally from the bundled helper files plus a `config.json` containing the extension ID and that secret; the user pastes it into Terminal/PowerShell, which writes `~/.host-override/` (directory 0700, files 0600 on macOS/Linux) and registers the helper to start at login (LaunchAgent / systemd user service / Startup folder). Every control request (`/__rules`, `/__launch`, `/__dns`, `/__trace`, `/__check`) carries the secret in an `X-Host-Override-Token` header; the helper compares it in constant time and additionally checks the Origin (this extension's ID) and Host header (127.0.0.1/localhost, against DNS rebinding). Without a valid config the helper rejects every control request. Before sending anything, the extension sends a random nonce to `/__status` and verifies via WebCrypto that the helper answers with HMAC-SHA256(secret, nonce); if not (e.g. another program on port 8899), it shows a warning and sends no rules or traffic there. In the side panel, the DNS check runs automatically for the active tab's domain while the DNS tab is open (disclosed in the privacy policy).
>
> Test instructions: load the extension, follow the welcome page (copy the setup command, paste in Terminal), add a rule such as `example.com` → `93.184.215.14`.

## Gegevensgebruik (formulier "Privacypraktijken")
- Verzamelde gegevens: **geen van de categorieën aanvinken.** De extensie verzamelt en verstuurt geen gegevens naar de maker of derden.
  - Websitecontent/webgeschiedenis: niet verzameld. Het IP van de hoofdpagina wordt alleen lokaal getoond (chrome.storage.session).
  - De hostnaam gaat alleen naar Cloudflare DNS als de gebruiker op "Opzoeken" klikt; dat is een door de gebruiker gestarte functie, geen verzameling door de ontwikkelaar.
  - De DNS-check (via de lokale helper; in het zijpaneel automatisch voor het domein van de actieve tab zolang de tab DNS-check open staat) stuurt domeinnamen naar openbare DNS-servers en doet `GET /` naar de IP's van dat domein. Dat is functionaliteit op de computer van de gebruiker, geen verzameling door de ontwikkelaar; het staat in het privacybeleid.
- Vink de drie verklaringen aan: geen verkoop aan derden, geen gebruik buiten de kernfunctie, geen gebruik voor kredietwaardigheid.
- Privacybeleid-URL: openbare URL van `store/PRIVACY.md` (zie hieronder).

## Afbeeldingen (`store/images/`)
Alle bestanden zijn 24-bit PNG zonder alfakanaal, opgebouwd uit echte schermen van de extensie.

| Bestand | Formaat | Gebruik |
| --- | --- | --- |
| `screenshot-1-rules-{nl,en}.png` | 1280x800 | Regels + huidige site |
| `screenshot-2-dns-{nl,en}.png` | 1280x800 | DNS-check |
| `screenshot-3-more-{nl,en}.png` | 1280x800 | Testvenster + delen |
| `screenshot-4-welcome-{nl,en}.png` | 1280x800 | Eenmalige installatie helper |
| `promo-small-440x280-{nl,en}.png` | 440x280 | Kleine promotegel |
| `marquee-1400x560-{nl,en}.png` | 1400x560 | Marquee-promotegel |

Upload de NL-set bij de Nederlandse vermelding en de EN-set bij de Engelse (in het dashboard kun je per taal afbeeldingen opgeven). Storepictogram: `extension/icons/icon128.png` (96x96 beeld met 16 px transparante rand).

## Checklist voor publicatie
- [x] Manifest V3, versie 1.7.0, `homepage_url` = https://bijbijker.nl
- [x] Naam ≤ 75 en korte beschrijving ≤ 132 tekens, NL en EN
- [x] `_locales/en` en `_locales/nl` compleet (naam, omschrijving, sneltoets, TEST-label)
- [x] Iconen 16/32/48/128, 128 met transparante rand
- [x] Alle permissies gebruikt en gerechtvaardigd; `<all_urls>` alleen optioneel en op klik
- [x] Geen remote code, geen eval; `node --check` op alle JS (zit in `package.sh`)
- [x] Lokale helper duidelijk vermeld in de beschrijving en in de schermafbeeldingen
- [x] Schermafbeeldingen, promotegel en marquee in NL en EN
- [ ] Ontwikkelaarsaccount (eenmalig 5 USD): https://chrome.google.com/webstore/devconsole
- [ ] `./package.sh` draaien en `dist/host-override-1.7.0.zip` uploaden
- [ ] `store/PRIVACY.md` op een openbare URL zetten (bijvoorbeeld bijbijker.nl/host-override/privacy of GitHub Pages) en invullen
- [ ] Contact-e-mail in `PRIVACY.md` en in het dashboard invullen (verplicht geverifieerd e-mailadres)
- [ ] Teksten hierboven, permissie-rechtvaardigingen en de reviewer-toelichting in het dashboard plakken
- [ ] Categorie "Ontwikkelaarstools" kiezen en zichtbaarheid instellen

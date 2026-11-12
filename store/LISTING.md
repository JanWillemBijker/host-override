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
- Zie op welk IP de huidige site draait en of dat het live IP is: herkent je eigen regels, je hosts-bestand (alleen lezen, macOS/Windows/Linux) en een IP dat afwijkt van publieke DNS.
- Instelbare indicator in de pagina (badge, balk of rand; kleur, positie en tekst naar keuze) zodat je nooit vergeet dat je op de testserver zit.
- Groepen per omgeving ("Klant X – staging") met eigen kleur: een hele groep met één klik aan of uit, optioneel maar één groep tegelijk. Notitie per regel.
- Doel mag een IP of een hostnaam zijn (bijvoorbeeld server123.hostingpartij.nl); de helper zoekt het IP op.
- Verbindingen-overzicht: alle hosts en IP's die de pagina gebruikt, met waarschuwing als www, cdn of api nog van de live server komt, en één klik om dat op te lossen.
- Per groep: "geen cache", Basic-auth voor een staging achter een wachtwoord, en eigen request-headers.
- Wildcards (*.voorbeeld.nl), IP's per regel aanpassen, alles tegelijk wisselen, aan/uit met Alt+Shift+H.
- Deel je regels als gewone tekst in hosts-formaat (met groepen en notities), abonneer op een gedeelde regellijst (https), synchroniseer optioneel tussen je eigen Chrome-installaties en maak een back-up als JSON.
- Open met één klik een apart testvenster met dezelfde regels, of kopieer het commando (macOS, Windows en Linux).
- Ingebouwde DNS-check: records, nameservers rechtstreeks bevraagd, resolvers vergelijken, SPF/DMARC en een HTTP/HTTPS/certificaatcontrole per IP. Plus een migratie-check: live en nieuwe server naast elkaar (redirects, beveiligingsheaders, snelheid, certificaat), e-mail (MX, SPF, DKIM, DMARC, MTA-STS, autodiscover), domeinregistratie (RDAP, DNSSEC, locks) en optioneel subdomeinen uit Certificate Transparency. In het zijpaneel controleert hij automatisch elk nieuw domein in je actieve tab zolang de tab DNS-check open staat.
- Werkt als popup of in het zijpaneel van Chrome.

BELANGRIJK: lokale helper vereist
Chrome laat een extensie zelf geen IP-adressen koppelen. Daarom installeer je eenmalig een klein lokaal programma (de helper). De extensie leidt je er stap voor stap doorheen: je downloadt de helper voor je systeem (macOS, Windows, Linux; geen Node.js nodig), opent hem en typt de koppelcode (12 tekens) die hij toont. Met Node.js kan het ook zonder download: dan plak je een setup-commando uit de extensie in Terminal of PowerShell. De extensie downloadt of start zelf niets. De helper draait alleen op je eigen computer en is alleen bereikbaar via 127.0.0.1. Hij voert alleen opdrachten uit met een geheime sleutel die alleen deze extensie en jouw helper kennen (bij de installatie aangemaakt), en de extensie controleert eerst of de helper die sleutel kent. Verwijderen kan met één commando.

Privacy: geen account, geen tracking, geen analytics. Regels en instellingen blijven op je eigen computer (behalve als je zelf sync aanzet: dan via je eigen Chrome-account).

Gemaakt door BijBijker – https://bijbijker.nl

## Detailed description (EN)
Host Override maps domains to another IP address, in your regular Chrome profile only. Ideal for checking a website on a staging or new server without editing your hosts file.

- Compare live and test side by side: normal window = test server, incognito = live site.
- See which IP the current site runs on and whether it is the live IP: detects your own rules, your hosts file (read only, macOS/Windows/Linux) and an IP that differs from public DNS.
- Configurable on-page indicator (badge, bar or border; your choice of colour, position and text) so you never forget you are on the test server.
- Groups per environment ("Client X – staging") with their own colour: switch a whole group on or off with one click, optionally only one group at a time. A note per rule.
- The target can be an IP or a hostname (e.g. server123.hostingcompany.com); the helper resolves it.
- Connections overview: every host and IP the page uses, with a warning when www, cdn or api still come from the live server, and one click to fix it.
- Per group: "no cache", Basic auth for a password-protected staging, and custom request headers.
- Wildcards (*.example.com), per-rule IPs, switch all at once, toggle with Alt+Shift+H.
- Share your rules as plain text in hosts-file format (with groups and notes), subscribe to a shared rules list (https), optionally sync between your own Chrome installs, and back up as JSON.
- One click opens a separate test window with the same rules, or copy the command (macOS, Windows, Linux).
- Built-in DNS check: records, nameservers queried directly, resolver comparison, SPF/DMARC and an HTTP/HTTPS/certificate check per IP. Plus a migration check: live and new server side by side (redirects, security headers, speed, certificate), e-mail (MX, SPF, DKIM, DMARC, MTA-STS, autodiscover), domain registration (RDAP, DNSSEC, locks) and optionally subdomains from Certificate Transparency. In the side panel it automatically checks every new domain in your active tab while the DNS check tab is open.
- Works as a popup or in Chrome's side panel.

IMPORTANT: local helper required
Chrome does not let an extension map IP addresses by itself, so you install a small local program (the helper) once. The extension guides you step by step: you download the helper for your system (macOS, Windows, Linux; no Node.js needed), open it and type the 12-character pairing code it shows. With Node.js you can also skip the download and paste a setup command from the extension into Terminal or PowerShell. The extension itself never downloads or starts anything. The helper runs only on your own computer and is only reachable via 127.0.0.1. It only carries out commands that include a secret key that only this extension and your helper know (created during setup), and the extension first checks that the helper knows that key. It can be removed with one command.

Privacy: no account, no tracking, no analytics. Rules and settings stay on your own computer (unless you turn on sync yourself: then via your own Chrome account).

Made by BijBijker – https://bijbijker.nl

## Single purpose (veld "Doel met één functie")
NL: Websites testen op een andere server door domeinen, alleen in het gewone Chrome-profiel, naar een zelfgekozen IP-adres te sturen, met hulpmiddelen om live en test te vergelijken en te herkennen (huidig IP, hosts-bestand, DNS-check, indicator in de pagina).
EN: Test websites on another server by routing chosen domains to a user-specified IP address in the regular Chrome profile only, with tools to compare and recognise live and test (current IP, hosts file, DNS check, on-page indicator).

## Rechtvaardiging per toestemming (Engels invullen in het dashboard)
| Toestemming | Rechtvaardiging (EN) |
| --- | --- |
| `proxy` | Sets a PAC proxy rule for the regular profile only, so that only the domains the user added are routed via the local helper (127.0.0.1) to the IP the user entered. All other traffic goes DIRECT. This is the core function. |
| `storage` | Stores the user's rules, groups, notes, subscriptions and settings locally (chrome.storage.local), the random secret key shared with the local helper, and per-tab IP info, per-tab connection summaries (host, IP, request type) and cached DNS answers for the session (chrome.storage.session). Only if the user turns on "Sync" (off by default): rules, groups and settings are copied to chrome.storage.sync (the user's own Chrome account) — never the helper secret or Basic-auth passwords. |
| `alarms` | Once per minute checks whether the local helper is running and re-sends the rules, so the extension recovers after the helper restarts. Every 15 minutes checks whether a subscribed rules list is due for its user-chosen refresh (hourly/daily). |
| `webRequest` | Observes requests (onBeforeRequest for main frames, onCompleted, onErrorOccurred) to (1) show which IP the current site runs on and whether it is the live IP (Host Override rule, the user's hosts file via the local helper, or different from public DNS), and (2) list, per tab, which hosts/IPs the page loaded resources from with request counts per type (the "Connections" tab), so the user sees resources that still come from the live server. Only hostname, IP, resource type and success are kept, per tab in session storage, cleared on navigation and tab close; no URL paths, no content. Only works after the user grants the optional host access. Nothing is blocked, modified or sent anywhere. |
| `declarativeNetRequestWithHostAccess` | Optional, per user-defined group of hosts: adds request headers the user configured ("Cache-Control/Pragma: no-cache", an `Authorization: Basic` header for a password-protected staging server, or custom headers) only to requests for that group's hosts and only while the group is switched on. Uses dynamic modifyHeaders rules; acts only on hosts the user granted access to. No requests are blocked or redirected. |
| `activeTab` | Reads the URL of the active tab when the user opens the popup or presses the shortcut, to show the current domain and reload it after a rule change. |
| `scripting` | Shows a small, user-configurable indicator (badge, bar or border, e.g. "TEST · <ip>") in the top frame of pages that are not served from their live IP (only with IP display enabled; can be turned off). Injects a self-contained bundled function into a closed shadow root using textContent only; no remote code, page content is not read. |
| `sidePanel` | Lets the user open the same interface in Chrome's side panel. |
| Host `http://127.0.0.1:8899/*` | Communication with the local helper program on the user's own computer. |
| Host `https://cloudflare-dns.com/*` | Live-IP lookup via DNS-over-HTTPS (A and AAAA) to compare with the connected IP: when the user clicks "Look up", or automatically per visited page only if the user turns on the (default off, clearly labelled) option "When the IP differs from public DNS". |
| Optional host `<all_urls>` | Never requested at install. Requested at runtime, always from a user click and as narrowly as possible: all sites only for "Enable IP display" / the Connections overview / the on-page indicator (to read request IPs via webRequest and inject the indicator); a single origin when subscribing to a rules list (to fetch that https URL); the hosts of one group when the user enables request headers for it (declarativeNetRequest only acts on hosts with access); `dns.google` or `dns.quad9.net` only if the user picks that DNS provider instead of Cloudflare. |

## Remote code
Antwoord: **Nee, geen remote code.** Alle JavaScript zit in het pakket. Geen `eval`, geen `new Function`, geen externe scripts. De PAC-regel wordt lokaal opgebouwd uit gevalideerde domeinnamen (alleen a-z, 0-9, `-`, `.` en `*.`). De helper (`helper/proxy.js`, `helper/dnstools.js`) zit in het pakket; het setup-commando wordt uit die meegeleverde bestanden samengesteld en door de gebruiker zelf in de terminal geplakt. Daarnaast biedt de extensie een gewone **downloadlink** (`<a href>` naar de GitHub-releases van het project) naar dezelfde helper als losse binary; de gebruiker downloadt en opent die zelf. De extensie voert zelf niets uit op het systeem, downloadt niets en laadt geen code: de binary wordt nooit door de extensie gestart of ingeladen, en er is geen `downloads`-permissie. (De Remote Code-regel gaat over code die de extensie uitvoert; een los programma dat de gebruiker zelf installeert valt daar niet onder, maar we vermelden het hier en in de beschrijving.)

Toelichting voor de reviewer (veld "Opmerkingen" of in de beschrijving):
> This extension requires a small local helper because Chrome extensions cannot map hostnames to IP addresses. Two ways to install it, both done by the user outside Chrome: (1) a standalone helper binary for macOS/Windows/Linux, offered as a plain download link to the project's GitHub releases (`https://github.com/JanWillemBijker/host-override/releases`, with SHA256SUMS; built from the same bundled source with Node.js Single Executable Applications); or (2) with Node.js, a setup command assembled from the helper source bundled in the package (`helper/`), shown to the user before they copy it. The extension never downloads, starts or loads the binary itself (no `downloads` or `nativeMessaging` permission, no remote code). The helper listens on 127.0.0.1 only and does not contact the developer.
>
> Pairing the downloaded helper: when started, the helper shows a random 12-character pairing code (Crockford base32, 60 bits, shown as XXXX-XXXX-XXXX) in its own window. The user types that code in the extension. The helper must first prove it knows the code (HMAC over two nonces with a key derived from the code via PBKDF2 + HKDF, verified with WebCrypto; with 60 bits of entropy the proof cannot be brute-forced offline); only then does the extension send the secret, encrypted with AES-GCM under a code-derived key, to `http://127.0.0.1:8899/__pair` (the extension ID comes from the Origin header). If the proof fails, the extension aborts and sends nothing. The helper accepts this only during that pairing window: code valid 5 minutes, single use, max 5 attempts, 60 s per attempt, same Host/Origin/header checks as all other endpoints, then writes `config.json` (0600). After that, the normal secret + HMAC verification below applies unchanged.
>
> How setup and authentication work: on first run the extension generates a random 32-byte secret (`crypto.getRandomValues`) and keeps it in `chrome.storage.local`. The setup command shown on the welcome page / popup is assembled locally from the bundled helper files plus a `config.json` containing the extension ID and that secret; the user pastes it into Terminal/PowerShell, which writes `~/.host-override/` (directory 0700, files 0600 on macOS/Linux) and registers the helper to start at login (LaunchAgent / systemd user service / Startup folder). Every control request (`/__rules`, `/__launch`, `/__dns`, `/__trace`, `/__check`, `/__hosts`) carries the secret in an `X-Host-Override-Token` header; the helper compares it in constant time and additionally checks the Origin (this extension's ID) and Host header (127.0.0.1/localhost, against DNS rebinding). Without a valid config the helper rejects every control request. Before sending anything, the extension sends a random nonce to `/__status` and verifies via WebCrypto that the helper answers with HMAC-SHA256(secret, nonce); if not (e.g. another program on port 8899), it shows a warning and sends no rules or traffic there. In the side panel, the DNS check runs automatically for the active tab's domain while the DNS tab is open (disclosed in the privacy policy).
>
> Hosts file: `/__hosts` lets the helper read the system hosts file (`/etc/hosts`, or `%SystemRoot%\System32\drivers\etc\hosts` on Windows) read-only, capped at 5 MB, and return only the entries for the requested host names (or a compact overview for the "More" tab). The path is fixed in the helper and cannot be chosen by the extension; nothing is written and nothing leaves the computer. No new permissions were added for this.
>
> Additions in 1.7.0 (no new install-time warnings): `declarativeNetRequestWithHostAccess` (no permission warning) for user-configured request headers per group of hosts; webRequest is now also used for the per-tab Connections overview (hostname, IP, type only). Subscribed rules lists are plain-text hosts files fetched from an https URL the user enters (max 256 KB, 2000 lines, each line strictly validated as hostname + IP/hostname; HTML/JSON rejected); they are data, never executed, and shown read-only in a group that starts switched off. Optional sync uses chrome.storage.sync and never includes the helper secret or passwords. New helper endpoints (same token/Origin/Host checks): `/__resolve` (hostname targets via the system resolver), `/__check` with `detail` (redirect chain and security headers), `/__crtsh` (Certificate Transparency lookup at crt.sh, only when the user ticks it in the migration check) and `/__rdap` (registration data via the IANA RDAP bootstrap). These requests are made by the local helper, only on the user's click.
>
> On-page indicator: injected with `chrome.scripting.executeScript` (bundled function, top frame only, only on http(s) pages with the optional host access) into a closed shadow root, text via `textContent`, `pointer-events: none` except the optional dismiss target.
>
> Test instructions: load the extension, follow the welcome page (copy the setup command, paste in Terminal), add a rule such as `example.com` → `93.184.215.14`.

## Gegevensgebruik (formulier "Privacypraktijken")
- Verzamelde gegevens: **geen van de categorieën aanvinken.** De extensie verzamelt en verstuurt geen gegevens naar de maker of derden.
  - Websitecontent/webgeschiedenis: niet verzameld. Het IP van de hoofdpagina wordt alleen lokaal getoond (chrome.storage.session).
  - De hostnaam gaat alleen naar Cloudflare DNS als de gebruiker op "Opzoeken" klikt, of per bezochte pagina als de gebruiker zelf de optie "Als het IP afwijkt van publieke DNS" aanzet (standaard uit, bij de optie uitgelegd). Dat is een door de gebruiker gekozen functie, geen verzameling door de ontwikkelaar; het staat in het privacybeleid.
  - Hosts-bestand: wordt lokaal door de helper gelezen (alleen lezen) en alleen in de extensie getoond; er gaat niets van de computer af.
  - Migratie-check (op klik): de helper vraagt registratiegegevens op via RDAP (registry van de TLD, via de IANA-lijst) en, alleen als de gebruiker dat aanvinkt, subdomeinen bij crt.sh. Daarbij gaat de domeinnaam naar die diensten. Staat in het privacybeleid.
  - Abonnementen: de extensie haalt de door de gebruiker opgegeven https-URL op. Sync (opt-in): via de eigen Chrome-account van de gebruiker. Publieke DNS: gekozen dienst (standaard Cloudflare) alleen bij "Opzoeken" of de expliciete optie.
  - Basic-auth-wachtwoorden en eigen headers blijven lokaal en gaan alleen als request-header naar de hosts van die groep.
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
| `screenshot-4-welcome-{nl,en}.png` | 1280x800 | Eenmalige installatie helper (toont nog de Node.js-route van vóór de download; opnieuw maken als je hem gebruikt) |
| `screenshot-5-indicator-{nl,en}.png` | 1280x800 | Indicator in de pagina + herkenning via hosts-bestand |
| `screenshot-6-groups-{nl,en}.png` | 1280x800 | Groepen (omgevingen), notities, hostnaam als doel |
| `screenshot-7-connections-{nl,en}.png` | 1280x800 | Verbindingen van de pagina, "nog live" |
| `screenshot-8-migration-{nl,en}.png` | 1280x800 | Migratie-check |

**Uploaden (max 5 per taal):** 6-groups, 7-connections, 8-migration, 2-dns, 5-indicator. Screenshot 1-rules (vervangen door 6-groups), 3-more en 4-welcome blijven als reserve in de map; de welkomst/helper-stap staat ook in de beschrijving.
| `promo-small-440x280-{nl,en}.png` | 440x280 | Kleine promotegel |
| `marquee-1400x560-{nl,en}.png` | 1400x560 | Marquee-promotegel |

Upload de NL-set bij de Nederlandse vermelding en de EN-set bij de Engelse (in het dashboard kun je per taal afbeeldingen opgeven). Storepictogram: `extension/icons/icon128.png` (96x96 beeld met 16 px transparante rand).

## Checklist voor publicatie
- [x] Manifest V3, versie 1.7.0, `homepage_url` = https://bijbijker.nl
- [x] Naam ≤ 75 en korte beschrijving ≤ 132 tekens, NL en EN
- [x] `_locales/en` en `_locales/nl` compleet (naam, omschrijving, sneltoets); overige teksten NL/EN via `strings.en.js`
- [x] Geen nieuwe permissies voor hosts-bestand en indicator (zelfde `webRequest`, `scripting`, optioneel `<all_urls>`)
- [x] Nieuw: `declarativeNetRequestWithHostAccess` (geen installatiewaarschuwing); alle extra host-toegang (abonnement, groep, Google/Quad9) optioneel en op klik
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

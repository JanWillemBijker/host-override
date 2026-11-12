# Helper-binaries ondertekenen (macOS en Windows)

Status (november 2026): de bouwstraat is klaar, er zijn nog **geen certificaten**. `./build-helper.sh` maakt nu
ongetekende binaries en waarschuwt daarvoor. Zodra je de onderstaande dingen hebt, zet je een paar
omgevingsvariabelen (lokaal) of GitHub-secrets (CI) en wordt alles automatisch ondertekend.

Waarom: zonder ondertekening blokkeert macOS (Gatekeeper) de download ("kan niet worden geopend") en waarschuwt
Windows (SmartScreen: "Windows heeft uw pc beschermd"). De extensie legt dan uit hoe je toch opent; na
ondertekening zet je in `extension/common.js` `HELPER_SIGNED` op `{ mac: true, win: true }` en verdwijnt die uitleg.

Ondertekening beschermt de **installatie** (de binary komt echt van jou en is niet aangepast). De **verbinding**
blijft beschermd door het geheim + HMAC en de koppelcode; daar verandert niets aan.

---

## 1. macOS: Apple Developer Program

### Wat je koopt
- **Apple Developer Program**: €99 per jaar (individu of organisatie). Aanmelden op
  <https://developer.apple.com/programs/enroll/> met je Apple-account (twee-factorauthenticatie aan).
  Als organisatie heb je een D-U-N-S-nummer nodig (gratis aan te vragen, duurt een paar dagen); als individu niet,
  maar dan staat je eigen naam als ontwikkelaar in de melding.

### Eenmalig instellen
1. **Developer ID Application-certificaat** maken (alleen de Account Holder mag dat):
   Xcode > Settings > Accounts > Manage Certificates > `+` > *Developer ID Application*,
   of via <https://developer.apple.com/account/resources/certificates> met een CSR uit Sleutelhangertoegang.
   Controleer daarna in Terminal:
   ```
   security find-identity -v -p codesigning
   # 1) ABCDEF... "Developer ID Application: Jan Willem Bijker (TEAMID1234)"
   ```
   Die naam tussen aanhalingstekens is `APPLE_DEV_ID`; de code tussen haakjes is `APPLE_TEAM_ID`.
2. **Notarisatie-toegang** (kies één):
   - App-specifiek wachtwoord: <https://account.apple.com> > Inloggen en beveiliging > App-specifieke wachtwoorden.
     Sla het op in de sleutelhanger als profiel:
     ```
     xcrun notarytool store-credentials host-override --apple-id jij@voorbeeld.nl --team-id TEAMID1234
     ```
     Dan is `APPLE_NOTARY_PROFILE=host-override`.
   - Of een App Store Connect API-sleutel (handig voor CI): `APPLE_API_KEY_PATH`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
3. Geen aparte "Developer ID Installer"-certificaat nodig: we leveren een zip met de binary, geen .pkg.

### Bouwen
```
export APPLE_DEV_ID="Developer ID Application: Jan Willem Bijker (TEAMID1234)"
export APPLE_TEAM_ID=TEAMID1234
export APPLE_NOTARY_PROFILE=host-override
./build-helper.sh
```
Het script: `codesign --remove-signature`, dan `codesign --force --options runtime --timestamp --entitlements
helper-bin/entitlements.plist --sign "$APPLE_DEV_ID"` (hardened runtime; alleen `allow-jit` en
`allow-unsigned-executable-memory`, die V8 nodig heeft), zip met `ditto`, en `xcrun notarytool submit --wait`.

**Stapling:** een ticket "nieten" (`xcrun stapler staple`) kan alleen op een .app, .pkg of .dmg, niet op een losse
binary of zip. Dat is geen probleem: bij de eerste start haalt Gatekeeper het notarisatieticket online op. Alleen een
Mac zonder internet bij de eerste start zou dan nog waarschuwen. Wil je dat ook afdekken, dan is een getekende,
genotariseerde en geniete `.pkg` (extra certificaat "Developer ID Installer", `productbuild --sign`) de volgende stap;
dat is nu bewust niet gedaan omdat een .pkg systeembreed installeert en de koppelcode toch een eigen venster nodig heeft.

Controleren na de build:
```
unzip -o dist/helper/host-override-helper-macos-arm64.zip -d /tmp/ho && spctl -a -vvv -t install /tmp/ho/host-override-helper
codesign -dv --verbose=4 /tmp/ho/host-override-helper
```

---

## 2. Windows: Authenticode

Sinds juni 2023 moet de privésleutel van elk code-signing-certificaat op hardware staan (USB-token of cloud-HSM).
Je krijgt dus geen los `.pfx`-bestand meer bij een nieuw OV- of EV-certificaat. Opties, van goedkoop naar duur:

| Optie | Kosten (indicatie, nov 2026) | Opmerkingen |
| --- | --- | --- |
| **Azure Artifact Signing** (voorheen *Trusted Signing*) | Basic-tier ca. **$10 per maand** (5.000 handtekeningen) | Microsoft beheert certificaat en sleutel; werkt direct in GitHub Actions. Identiteitscontrole vereist. Voor **organisaties** het eenvoudigst; voor individuen was de beschikbaarheid per land beperkt (stond in 2026 vooral open voor VS/Canada). Controleer bij aanmelden of je als Nederlands bedrijf (KvK) of individu in aanmerking komt. |
| **OV-certificaat** (Sectigo, SSL.com, Certum e.d.) | ca. **€200–450 per jaar** | Op USB-token of met de cloud-signing van de CA (bijv. SSL.com eSigner, DigiCert KeyLocker; vaak extra kosten). Sinds 2026 max. 460 dagen geldig. SmartScreen-reputatie bouwt langzaam op. |
| **EV-certificaat** | ca. **€300–700 per jaar** | Ook op token/cloud-HSM. Geeft sinds 2024 **geen** directe SmartScreen-reputatie meer; voor deze helper geen meerwaarde boven OV of Azure. |
| Certum Open Source Code Signing | ca. €50–100 + kaartlezer | Alleen voor open-source projecten, naam "Open Source Developer". |

Advies: **Azure Artifact Signing** als je in aanmerking komt (goedkoop, geen token, CI-vriendelijk), anders een
**OV-certificaat met cloud-signing** van de CA. Reken bij elke optie op een paar dagen voor de identiteitscontrole.

### Azure Artifact Signing instellen
1. Azure-account met abonnement > resource *Artifact Signing Account* aanmaken (kies een regio, bijv. West Europe;
   de endpoint-URL hangt van de regio af, bijv. `https://weu.codesigning.azure.net/`).
2. *Identity validation* (organisatie of individu) aanvragen en wachten op goedkeuring.
3. *Certificate profile* "Public Trust" aanmaken.
4. App-registratie (service principal) maken en die de rol **Artifact Signing Certificate Profile Signer** geven
   op het account (of alleen op het certificaatprofiel). Voor CI **geen clientgeheim** aanmaken maar een
   **federated credential** (OIDC): Entra ID > App-registraties > de app > Certificaten en geheimen > Federatieve
   referenties > *GitHub Actions*: organisatie `JanWillemBijker`, repository `host-override`, entiteit *Tag*
   met patroon `v*` (of *Environment* als je een GitHub-environment gebruikt). Dan krijgt alleen een workflow-run
   voor een tag in deze repository een kortlevend token; er staat geen langlevend geheim in GitHub.
5. Lokaal op Windows: Windows SDK (signtool) + de *Artifact Signing Client Tools* installeren, en een
   `metadata.json` maken met `Endpoint`, `CodeSigningAccountName`, `CertificateProfileName`. Dan:
   ```
   set AZURE_SIGNING_DLIB=C:\...\Azure.CodeSigning.Dlib.dll
   set AZURE_SIGNING_METADATA=C:\pad\metadata.json
   bash build-helper.sh --targets windows-x64
   ```
   (inloggen via `az login` of de omgevingsvariabelen `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`).
6. In CI logt de workflow in met `azure/login` via OIDC (`permissions: id-token: write`, alleen in de
   Windows-job) en ondertekent met de officiële action `azure/artifact-signing-action` (zie hieronder).

### OV/EV-certificaat
- Op een USB-token of in de Windows-certstore: `WIN_CERT_SHA1=<thumbprint>` en bouwen op Windows (signtool).
- Cloud-signing van de CA: volg hun signtool-plugin-instructies; daarna werkt dezelfde `WIN_CERT_SHA1`-route
  of een eigen stap in de workflow.
- Heb je toch een `.pfx` (bijv. een ouder certificaat): `WIN_CERT_PATH` + `WIN_CERT_PASSWORD`; op macOS/Linux
  gebruikt het script dan `osslsigncode` (`brew install osslsigncode`).

Tijdstempel: standaard `http://timestamp.acs.microsoft.com` (Azure) of `http://timestamp.digicert.com`;
aan te passen met `WIN_TIMESTAMP_URL`. Door de tijdstempel blijft de handtekening geldig nadat het certificaat verloopt.

Controleren: rechtsklik op de .exe > Eigenschappen > Digitale handtekeningen, of `signtool verify /pa /v host-override-helper-windows-x64.exe`.

---

## 3. Linux
Geen ondertekening nodig. De release bevat `SHA256SUMS`; de extensie linkt ernaar.

---

## 4. Overzicht omgevingsvariabelen (`./build-helper.sh`)

| Variabele | Wat |
| --- | --- |
| `APPLE_DEV_ID` | "Developer ID Application: Naam (TEAMID)"; zonder: ad-hoc (ongetekend) |
| `APPLE_TEAM_ID` | Team-ID (10 tekens) |
| `APPLE_NOTARY_PROFILE` | notarytool-sleutelhangerprofiel (lokaal) |
| `APPLE_ID` + `APPLE_APP_PASSWORD` | alternatief voor het profiel (CI) |
| `APPLE_API_KEY_PATH` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` | alternatief: App Store Connect API-sleutel |
| `AZURE_SIGNING_DLIB` + `AZURE_SIGNING_METADATA` | Azure Artifact Signing via signtool (Windows) |
| `WIN_CERT_SHA1` | certificaat in certstore/token (signtool, Windows) |
| `WIN_CERT_PATH` + `WIN_CERT_PASSWORD` | .pfx (signtool of osslsigncode) |
| `WIN_TIMESTAMP_URL` | andere tijdstempelserver |
| `NODE_VERSION` | andere Node-versie dan de vaste LTS in `helper-bin/build-helper.mjs` |

Zonder deze variabelen: ongetekende build en per platform een duidelijke waarschuwing ("LET OP: ... NIET ondertekend").

## 5. GitHub Actions (`.github/workflows/release-helper.yml`)

Bij een tag `v*` bouwt de workflow macOS (arm64 + x64), Windows x64 en Linux x64, draait de tests tegen de
macOS- en Linux-binary, maakt `SHA256SUMS` en zet alles bij de GitHub-release. Ondertekenen gebeurt alleen als de
secrets bestaan (Settings > Secrets and variables > Actions):

- macOS: `APPLE_CERT_P12_BASE64` (exporteer het Developer ID-certificaat mét sleutel als .p12 uit Sleutelhangertoegang,
  dan `base64 -i cert.p12 | pbcopy`), `APPLE_CERT_PASSWORD`, `APPLE_DEV_ID`, `APPLE_TEAM_ID`, `APPLE_ID`, `APPLE_APP_PASSWORD`.
- Windows met Azure (OIDC, geen clientgeheim): `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_SUBSCRIPTION_ID`,
  `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE` (ID's zijn geen geheimen, maar zo staan
  ze bij elkaar). Plus de federated credential uit stap 4 hierboven.
- Windows met .pfx: `WIN_CERT_PFX_BASE64`, `WIN_CERT_PASSWORD`.

Beveiliging van de workflow: alle actions staan vast op een volledige commit-SHA met de versie als commentaar
(`uses: owner/action@<sha> # vX.Y.Z`); `.github/dependabot.yml` stelt wekelijks updates voor. Rechten staan
standaard op niets (`permissions: {}`); de bouwjobs krijgen `contents: read`, de Windows-job daarnaast
`id-token: write` voor OIDC, en alleen de release-job `contents: write`. Checkout bewaart geen git-token
(`persist-credentials: false`). Het Apple-certificaat staat alleen tijdens de run in een tijdelijke sleutelhanger.
Overweeg de signing-secrets in een GitHub-*environment* met verplichte goedkeuring te zetten.

De downloadlinks in de extensie wijzen naar `HELPER_RELEASES` in `extension/common.js`
(`https://github.com/JanWillemBijker/host-override/releases/latest/download/`). Pas die ene constante aan als de
repository anders heet. Bestandsnamen: `host-override-helper-macos-arm64.zip`, `-macos-x64.zip`,
`-windows-x64.exe`, `-linux-x64.tar.gz` en `SHA256SUMS`.

## 6. Checklist na het kopen
- [ ] Apple Developer Program (€99/jaar), Developer ID Application-certificaat, notarytool-profiel
- [ ] Windows: Azure Artifact Signing (of OV-certificaat met cloud-signing)
- [ ] Lokaal `./build-helper.sh` met de variabelen; controleren met `spctl` en `signtool verify`
- [ ] GitHub-secrets invullen, tag `v1.8.0` pushen, release controleren
- [ ] `HELPER_SIGNED` in `extension/common.js` op `true`, nieuwe extensieversie
- [ ] Test op een schone Mac (Apple silicon en Intel) en een schone Windows-pc: download via de extensie, openen, code typen

# Privacybeleid Host Override

Laatst bijgewerkt: 10 november 2026

Host Override verzamelt, bewaart of verstuurt geen persoonsgegevens naar de maker of naar derden.

## Wat de extensie opslaat
De door jou ingevoerde regels (domein en IP) en instellingen worden lokaal in je browser bewaard (Chrome storage). De helper bewaart een kopie van de regels in je eigen thuismap (`.host-override/rules.json`). Er is geen account en er zijn geen analyses of tracking.

## Wat de extensie doet met sites
- Voor domeinen op je lijst stuurt de extensie het verkeer via de helper op je eigen computer (127.0.0.1) naar het IP dat jij hebt opgegeven.
- Als je "IP-weergave inschakelen" kiest, leest de extensie het IP-adres van de hoofdpagina van tabs om dat in de popup te tonen. Die informatie blijft in je browser.

## DNS-check
De DNS-pagina laat de helper op je eigen computer DNS-vragen stellen aan openbare DNS-servers (de root- en TLD-servers, de nameservers van het domein en de resolvers van Cloudflare, Google, Quad9 en OpenDNS) en HTTP(S)-verzoeken doen naar de IP-adressen van het domein dat je zelf invult. Dat gebeurt alleen als je op die pagina een domein controleert. Resultaten blijven op je computer.

## Optionele externe verzoeken
Alleen als je op "Live IP opzoeken" klikt, wordt de hostnaam van de huidige site naar Cloudflare gestuurd (DNS-over-HTTPS, cloudflare-dns.com) om het publieke IP op te vragen. Zie het privacybeleid van Cloudflare. Zonder klik gebeurt dit nooit.

## Contact
Vul hier je contactadres in voordat je dit publiceert.


## Aanvulling bij 1.5.0
- De extensie vraagt de permissie "scripting". Die wordt alleen gebruikt om een klein TEST-label in een pagina te tonen wanneer er een override actief is en je IP-weergave hebt ingeschakeld. Er wordt niets verstuurd.
- Recente domeinen en het laatst gebruikte test-IP worden alleen lokaal in je browser bewaard.

## Aanvulling bij 1.6.0
- De permissie "sidePanel" wordt alleen gebruikt om de extensie in het zijpaneel van Chrome te tonen. De taalkeuze wordt lokaal bewaard.

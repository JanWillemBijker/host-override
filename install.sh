#!/bin/bash
# Installatie vanuit deze map (ontwikkelaars): zet de helper klaar en start hem.
#   ./install.sh <extensie-id> <geheim>
# Het geheim (64 hex-tekens) maakt de extensie zelf aan. Makkelijker: kopieer het setup-commando uit de
# extensie (welkomstpagina of popup, "Koppel helper") en plak dat; dat zet ID en geheim al goed.
# Zonder argumenten blijft een bestaande ~/.host-override/config.json staan; zonder geldige config
# weigert de helper alle opdrachten (nooit "elke extensie toestaan").
set -euo pipefail
if [ $# -ne 0 ] && [ $# -ne 2 ]; then
  echo "Gebruik: $0 [<extensie-id> <geheim>]" >&2
  exit 1
fi
if [ $# -eq 2 ]; then
  export HO_EXT_ID="$1" HO_SECRET="$2"
fi
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/extension/helper/setup.sh"

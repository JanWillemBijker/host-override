#!/bin/bash
# Bouwt de helper als losse binary (geen Node.js nodig bij de gebruiker) voor macOS (arm64, x64), Windows x64 en
# Linux x64, met SHA-256-controlegetallen, in dist/helper/. Ondertekent als de omgevingsvariabelen gezet zijn
# (zie store/SIGNING.md), anders een ongetekende build met waarschuwing.
#   ./build-helper.sh                              alle platforms (macOS-doelen alleen op een Mac)
#   ./build-helper.sh --targets windows-x64,linux-x64
#   ./build-helper.sh --universal                  ook een universele macOS-binary (arm64 + x64, ca. 2x zo groot)
#   ./build-helper.sh --bundle-only                alleen dist/helper/host-override-helper.js
# Vereist Node.js 22+ om dit script te draaien; de binaries zelf gebruiken de vaste Node-LTS uit build-helper.mjs.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
exec node helper-bin/build-helper.mjs "$@"

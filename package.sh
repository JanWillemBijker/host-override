#!/bin/bash
# Maakt dist/host-override-<versie>.zip: de hele extensie (inclusief helper), klaar om te delen
# of in de Chrome Web Store te uploaden (manifest.json staat in de root van de zip).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
VERSION="$(grep -m1 '"version"' extension/manifest.json | sed 's/[^0-9.]//g')"
for f in extension/*.js extension/helper/*.js; do node --check "$f" 2>/dev/null || { echo "Syntaxfout in $f" >&2; exit 1; }; done
mkdir -p dist
rm -f "dist/host-override-$VERSION.zip"
( cd extension && zip -qr "../dist/host-override-$VERSION.zip" . -x '*.DS_Store' )
echo "Gemaakt: dist/host-override-$VERSION.zip"

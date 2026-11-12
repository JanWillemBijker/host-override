#!/bin/bash
# Host Override helper: zet de lokale proxy klaar en start hem automatisch bij inloggen.
# macOS: LaunchAgent. Linux: systemd-gebruikersservice (of autostart). Mag vaker uitgevoerd worden.
set -euo pipefail

OS="${HO_OS:-$(uname)}"
LABEL="com.hostoverride.proxy"
APP_DIR="$HOME/.host-override"

mkdir -p "$APP_DIR"
SRC="${BASH_SOURCE[0]:-}"
if [ -n "$SRC" ] && [ -f "$(dirname "$SRC")/proxy.js" ]; then
  cp "$(dirname "$SRC")/proxy.js" "$(dirname "$SRC")/dnstools.js" "$APP_DIR/"
fi
if [ ! -f "$APP_DIR/proxy.js" ]; then
  echo "proxy.js ontbreekt in $APP_DIR" >&2
  exit 1
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Node.js niet gevonden. Installeer het (https://nodejs.org) en voer dit daarna opnieuw uit." >&2
  exit 1
fi

if [ "$OS" = "Darwin" ]; then
  PLIST_DIR="${PLIST_DIR:-$HOME/Library/LaunchAgents}"
  PLIST="$PLIST_DIR/$LABEL.plist"
  LOG="$HOME/Library/Logs/host-override.log"
  mkdir -p "$PLIST_DIR" "$(dirname "$LOG")"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$APP_DIR/proxy.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
  if [ "${DRY_RUN:-0}" != "1" ]; then
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
  fi
elif [ "$OS" = "Linux" ]; then
  UNIT_DIR="${UNIT_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user}"
  if [ "${DRY_RUN:-0}" = "1" ] || { command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; }; then
    mkdir -p "$UNIT_DIR"
    cat > "$UNIT_DIR/host-override.service" <<UNIT
[Unit]
Description=Host Override proxy

[Service]
ExecStart=$NODE $APP_DIR/proxy.js
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
UNIT
    if [ "${DRY_RUN:-0}" != "1" ]; then
      systemctl --user daemon-reload
      systemctl --user enable host-override.service
      systemctl --user restart host-override.service
    fi
  else
    # Geen systemd: autostart bij inloggen via .desktop en nu direct starten.
    AUTO_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
    mkdir -p "$AUTO_DIR"
    cat > "$AUTO_DIR/host-override.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Host Override proxy
Exec=$NODE $APP_DIR/proxy.js
X-GNOME-Autostart-enabled=true
DESK
    pkill -f "$APP_DIR/proxy.js" 2>/dev/null || true
    nohup "$NODE" "$APP_DIR/proxy.js" >"$APP_DIR/proxy.log" 2>&1 &
  fi
else
  echo "Onbekend systeem ($OS). Start de helper zelf met: $NODE $APP_DIR/proxy.js"
  exit 0
fi

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN: bestanden klaargezet, services niet gestart."
  exit 0
fi
echo "Klaar. De helper draait en start voortaan automatisch bij inloggen."
echo "Ga terug naar de extensie en klik op 'Opnieuw controleren'."

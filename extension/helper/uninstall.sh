#!/bin/bash
# Stopt en verwijdert de Host Override helper (inclusief bewaarde regels). macOS en Linux.
LABEL="com.hostoverride.proxy"
if [ "$(uname)" = "Darwin" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
else
  systemctl --user disable --now host-override.service 2>/dev/null || true
  rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/host-override.service" "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/host-override.desktop"
  pkill -f "$HOME/.host-override/proxy.js" 2>/dev/null || true
fi
rm -rf "$HOME/.host-override"
echo "Helper verwijderd. Verwijder daarna de extensie zelf via chrome://extensions."

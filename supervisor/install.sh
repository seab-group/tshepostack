#!/usr/bin/env bash
# install.sh — register an agent as a persistent process via launchd (macOS)
# or systemd user services (Linux). The supervisor loop (run-agent.sh) stays
# running after logout and restarts automatically on crash.
#
# Usage: ./install.sh <agent-name> <role-file> [model]
# Examples:
#   ./install.sh agent-be FEATURE_ROLE.md claude-sonnet-4-6
#   ./install.sh agent-qa QA_ROLE.md
#
# Prereq: ~/agents/<agent-name>/config must exist (same as run-agent.sh).
#
# Uninstall:
#   macOS:  launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.cstack.agent.<name>.plist
#           rm ~/Library/LaunchAgents/com.cstack.agent.<name>.plist
#   Linux:  systemctl --user disable --now cstack-<name>
#           rm ~/.config/systemd/user/cstack-<name>.service

set -euo pipefail

AGENT_NAME="${1:?Usage: install.sh <agent-name> <role-file> [model]}"
ROLE_FILE="${2:?Provide a role file, e.g. FEATURE_ROLE.md}"
MODEL="${3:-claude-sonnet-4-6}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUPERVISOR="$SCRIPT_DIR/run-agent.sh"
AGENT_HOME="$HOME/agents/$AGENT_NAME"
LOG_DIR="$AGENT_HOME/logs"

[ -f "$SUPERVISOR" ] || { echo "run-agent.sh not found at $SUPERVISOR"; exit 1; }
[ -f "$AGENT_HOME/config" ] || { echo "Missing config: $AGENT_HOME/config"; exit 1; }
mkdir -p "$LOG_DIR"

OS="$(uname -s)"

# --- macOS: launchd LaunchAgent ---

install_macos() {
  local label="com.cstack.agent.${AGENT_NAME}"
  local plist="$HOME/Library/LaunchAgents/${label}.plist"
  mkdir -p "$HOME/Library/LaunchAgents"

  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${SUPERVISOR}</string>
        <string>${AGENT_NAME}</string>
        <string>${ROLE_FILE}</string>
        <string>${MODEL}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>Crashed</key>
        <true/>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/stderr.log</string>
    <key>WorkingDirectory</key>
    <string>${SCRIPT_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
        <key>HOME</key>
        <string>${HOME}</string>
    </dict>
</dict>
</plist>
PLIST

  # Unload existing instance if present, then load fresh
  launchctl bootout "gui/$(id -u)/${label}" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "[$AGENT_NAME] installed as launchd agent: $label"
  echo "[$AGENT_NAME] status: launchctl print gui/$(id -u)/${label}"
  echo "[$AGENT_NAME] logs:   tail -f ${LOG_DIR}/stdout.log"
}

# --- Linux: systemd user service ---

install_linux() {
  local service="cstack-${AGENT_NAME}"
  local unit_dir="$HOME/.config/systemd/user"
  mkdir -p "$unit_dir"

  cat > "$unit_dir/${service}.service" <<UNIT
[Unit]
Description=cstack agent: ${AGENT_NAME}
After=network.target

[Service]
Type=simple
ExecStart=/bin/bash ${SUPERVISOR} ${AGENT_NAME} ${ROLE_FILE} ${MODEL}
WorkingDirectory=${SCRIPT_DIR}
Restart=on-failure
RestartSec=10s
StandardOutput=append:${LOG_DIR}/stdout.log
StandardError=append:${LOG_DIR}/stderr.log
Environment=HOME=${HOME}
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
UNIT

  systemctl --user daemon-reload
  systemctl --user enable --now "${service}"
  echo "[$AGENT_NAME] installed as systemd user service: $service"
  echo "[$AGENT_NAME] status: systemctl --user status ${service}"
  echo "[$AGENT_NAME] logs:   journalctl --user -u ${service} -f"
}

case "$OS" in
  Darwin) install_macos ;;
  Linux)  install_linux ;;
  *)      echo "Unsupported OS: $OS (supported: macOS, Linux)"; exit 1 ;;
esac

echo ""
echo "Agent $AGENT_NAME is now supervised and will restart automatically on crash."
echo "To stop:  $([ "$OS" = Darwin ] && echo "launchctl bootout gui/$(id -u)/com.cstack.agent.${AGENT_NAME}" || echo "systemctl --user stop cstack-${AGENT_NAME}")"

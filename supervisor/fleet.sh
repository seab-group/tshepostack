#!/usr/bin/env bash
# fleet.sh — start, stop, and monitor all agents defined in fleet.conf
#
# Commands:
#   ./fleet.sh start     Start all agents in the background (logs → ~/agents/<name>/logs/)
#   ./fleet.sh stop      Stop all running agents gracefully
#   ./fleet.sh status    Show live status of every agent (running/idle/stopped)
#   ./fleet.sh logs      Tail all agent logs interleaved in one stream (Ctrl-C to exit)
#   ./fleet.sh install   Register all agents as launchd (macOS) / systemd (Linux) services
#                        so they start at login and restart on crash — no terminal needed
#   ./fleet.sh uninstall Remove all OS service registrations
#   ./fleet.sh restart   stop + start
#
# Quick start (development):
#   1. Create ~/agents/<agent-name>/config for each agent in fleet.conf
#   2. ./fleet.sh start
#   3. ./fleet.sh status      (check they're running)
#   4. ./fleet.sh logs        (watch live output)
#
# Production (agents survive logout and restart on crash):
#   1. ./fleet.sh install
#   2. Done — agents run as background services. No terminal window needed.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FLEET_CONF="${FLEET_CONF:-$SCRIPT_DIR/fleet.conf}"
SUPERVISOR="$SCRIPT_DIR/run-agent.sh"
PID_DIR="$SCRIPT_DIR/.pids"
OS="$(uname -s)"

# ── Helpers ───────────────────────────────────────────────────────────────────

die() { echo "ERROR: $*" >&2; exit 1; }

read_fleet() {
  # Emits: agent_name role_file model (one line per agent)
  [ -f "$FLEET_CONF" ] || die "fleet.conf not found: $FLEET_CONF"
  grep -v '^\s*#' "$FLEET_CONF" | grep -v '^\s*$' | while IFS= read -r line; do
    # shellcheck disable=SC2086
    set -- $line
    local name="$1" role="${2:-FEATURE_ROLE.md}" model="${3:-claude-sonnet-4-6}"
    echo "$name $role $model"
  done
}

agent_log_dir() { echo "$HOME/agents/$1/logs"; }
agent_presence() { echo "$HOME/agents/$1/control/mailboxes/presence/$1.json"; }

is_running_by_pid() {
  local pid_file="$PID_DIR/$1.pid"
  [ -f "$pid_file" ] || return 1
  local pid; pid=$(cat "$pid_file")
  kill -0 "$pid" 2>/dev/null
}

is_installed() {
  local name="$1"
  case "$OS" in
    Darwin) [ -f "$HOME/Library/LaunchAgents/com.cstack.agent.${name}.plist" ] ;;
    Linux)  [ -f "$HOME/.config/systemd/user/cstack-${name}.service" ] ;;
    *)      return 1 ;;
  esac
}

agent_state() {
  local name="$1"
  local presence; presence=$(agent_presence "$name")

  # Installed as OS service
  if is_installed "$name"; then
    case "$OS" in
      Darwin)
        local svc_status
        svc_status=$(launchctl print "gui/$(id -u)/com.cstack.agent.${name}" 2>/dev/null | grep 'state =' | awk '{print $3}')
        case "$svc_status" in
          running) echo "service:running" ;;
          *)       echo "service:stopped" ;;
        esac
        return
        ;;
      Linux)
        if systemctl --user is-active --quiet "cstack-${name}" 2>/dev/null; then
          echo "service:running"
        else
          echo "service:stopped"
        fi
        return
        ;;
    esac
  fi

  # Background process started by fleet.sh start
  if is_running_by_pid "$name"; then
    # Try to read detailed state from presence file
    if [ -f "$presence" ]; then
      local state ts
      state=$(python3 -c "import json,sys; d=json.load(open('$presence')); print(d.get('state','?'))" 2>/dev/null || echo "?")
      ts=$(python3 -c "import json,sys; d=json.load(open('$presence')); print(d.get('ts',''))" 2>/dev/null || echo "")
      echo "bg:${state}:${ts}"
    else
      echo "bg:starting"
    fi
    return
  fi

  echo "stopped"
}

color_state() {
  local raw="$1"
  case "$raw" in
    service:running|bg:working*)  printf '\033[32m%s\033[0m' "$raw" ;;  # green
    bg:idle*)                     printf '\033[33m%s\033[0m' "$raw" ;;  # yellow
    service:stopped|stopped)      printf '\033[31m%s\033[0m' "$raw" ;;  # red
    *)                            printf '%s' "$raw" ;;
  esac
}

# ── Commands ──────────────────────────────────────────────────────────────────

cmd_start() {
  [ -f "$SUPERVISOR" ] || die "run-agent.sh not found: $SUPERVISOR"
  mkdir -p "$PID_DIR"

  read_fleet | while read -r name role model; do
    if is_installed "$name"; then
      echo "[$name] already installed as OS service — use 'fleet.sh install' to manage"
      continue
    fi
    if is_running_by_pid "$name"; then
      echo "[$name] already running (PID $(cat "$PID_DIR/$name.pid"))"
      continue
    fi

    log_dir=$(agent_log_dir "$name")
    mkdir -p "$log_dir"

    # Launch supervisor in background, redirect output to log file
    bash "$SUPERVISOR" "$name" "$role" "$model" \
      >> "$log_dir/stdout.log" 2>> "$log_dir/stderr.log" &
    local pid=$!
    echo "$pid" > "$PID_DIR/$name.pid"
    echo "[$name] started (PID $pid, logs: $log_dir/stdout.log)"
  done
}

cmd_stop() {
  read_fleet | while read -r name role _model; do
    if is_installed "$name"; then
      case "$OS" in
        Darwin) launchctl stop "com.cstack.agent.${name}" 2>/dev/null && echo "[$name] service stopped" || echo "[$name] not running" ;;
        Linux)  systemctl --user stop "cstack-${name}" 2>/dev/null && echo "[$name] service stopped" || echo "[$name] not running" ;;
      esac
      continue
    fi

    local pid_file="$PID_DIR/$name.pid"
    if [ -f "$pid_file" ]; then
      local pid; pid=$(cat "$pid_file")
      if kill -0 "$pid" 2>/dev/null; then
        # SIGTERM the supervisor; it will propagate to child claude processes via trap
        kill "$pid" 2>/dev/null && echo "[$name] stopped (PID $pid)" || echo "[$name] failed to stop"
      else
        echo "[$name] not running (stale PID $pid)"
      fi
      rm -f "$pid_file"
    else
      echo "[$name] not running"
    fi
  done
}

cmd_status() {
  printf '\n%-14s  %-10s  %-8s  %s\n' "AGENT" "MODE" "STATE" "DETAIL"
  printf '%s\n' "------------------------------------------------------------"

  read_fleet | while read -r name role model; do
    local raw; raw=$(agent_state "$name")
    local mode state detail

    case "$raw" in
      service:*)   mode="service"; state="${raw#service:}" ;;
      bg:*:*)      mode="bg";      state=$(echo "$raw" | cut -d: -f2); detail=$(echo "$raw" | cut -d: -f3) ;;
      bg:*)        mode="bg";      state="${raw#bg:}" ;;
      stopped)     mode="—";       state="stopped" ;;
      *)           mode="?";       state="$raw" ;;
    esac

    local log_dir; log_dir=$(agent_log_dir "$name")
    local last_line=""
    [ -f "$log_dir/stdout.log" ] && last_line=$(tail -1 "$log_dir/stdout.log" 2>/dev/null | cut -c1-60 || true)

    printf '%-14s  %-10s  ' "$name" "$mode"
    color_state "$state"
    printf '  %s\n' "${detail:-$last_line}"
  done
  echo ""
}

cmd_logs() {
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"; kill 0' EXIT INT TERM

  # Tail each agent log with a prefixed label, merge into one stream
  read_fleet | while read -r name _role _model; do
    local log; log="$(agent_log_dir "$name")/stdout.log"
    mkdir -p "$(dirname "$log")"
    touch "$log"
    # tail with agent name prefix
    tail -f "$log" | sed "s/^/[$name] /" &
  done

  echo "Tailing all agent logs — Ctrl-C to exit"
  wait
}

cmd_install() {
  [ -f "$SCRIPT_DIR/install.sh" ] || die "install.sh not found: $SCRIPT_DIR/install.sh"
  read_fleet | while read -r name role model; do
    bash "$SCRIPT_DIR/install.sh" "$name" "$role" "$model"
  done
}

cmd_uninstall() {
  read_fleet | while read -r name _role _model; do
    case "$OS" in
      Darwin)
        local label="com.cstack.agent.${name}"
        local plist="$HOME/Library/LaunchAgents/${label}.plist"
        launchctl bootout "gui/$(id -u)/${label}" 2>/dev/null || true
        rm -f "$plist"
        echo "[$name] uninstalled"
        ;;
      Linux)
        systemctl --user disable --now "cstack-${name}" 2>/dev/null || true
        rm -f "$HOME/.config/systemd/user/cstack-${name}.service"
        systemctl --user daemon-reload
        echo "[$name] uninstalled"
        ;;
    esac
  done
}

# ── Entry point ───────────────────────────────────────────────────────────────

CMD="${1:-help}"
case "$CMD" in
  start)     cmd_start ;;
  stop)      cmd_stop ;;
  status)    cmd_status ;;
  logs)      cmd_logs ;;
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  restart)   cmd_stop; sleep 1; cmd_start ;;
  help|--help|-h)
    echo "Usage: fleet.sh <command>"
    echo ""
    echo "  start      Start all agents in the background"
    echo "  stop       Stop all running agents"
    echo "  status     Show live status of every agent"
    echo "  logs       Tail all agent logs in one stream (Ctrl-C to exit)"
    echo "  install    Register all as OS services (survive logout, auto-restart)"
    echo "  uninstall  Remove OS service registrations"
    echo "  restart    stop + start"
    echo ""
    echo "Agents defined in: $FLEET_CONF"
    ;;
  *) die "Unknown command: $CMD. Run './fleet.sh help' for usage." ;;
esac

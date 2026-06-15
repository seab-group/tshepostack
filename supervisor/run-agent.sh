#!/usr/bin/env bash
# cstack autonomous agent loop v7 — real-time collaboration
# Changes from v6:
#  - Presence beacon: writes mailboxes/presence/<agent>.json locally every 30s
#  - Fast idle wake: WAKE_CHECK_INTERVAL=5s (was 30); MAX_IDLE_WAIT=300s (was 1800)
#  - Local wake signals: after each session push, writes mailboxes/wake/<recipient>
#    for any same-machine agents that received mailbox messages. Recipients wake in <1s.
#  - Supabase Realtime broadcast: if SUPABASE_URL + SUPABASE_KEY are set in config,
#    broadcasts wake events cross-machine and runs wake-listen.ts as a background
#    subscriber so this agent wakes within ~1s from any machine.
#  - Parallel answer sessions: a background watcher detects incoming awaiting_info
#    questions while a main session is running and immediately spawns a focused
#    answer-only claude session in a dedicated git worktree (no index conflicts).
#  - Answer worktree: $AGENT_HOME/answer-wt — separate checkout of control repo
#    so answer sessions never touch the main session's git index.
#  - Process supervision: pair with install.sh for launchd/systemd auto-restart.
#
# Optional config keys (add to ~/agents/<agent-name>/config):
#   SUPABASE_URL=https://<project>.supabase.co
#   SUPABASE_KEY=<anon-or-service-role-key>
#
# Usage: ./run-agent.sh <agent-name> <role-file> [model]
# Examples:
#   ./run-agent.sh agent-be  FEATURE_ROLE.md claude-sonnet-4-6
#   ./run-agent.sh agent-fe  FEATURE_ROLE.md claude-sonnet-4-6
#   ./run-agent.sh agent-qa  QA_ROLE.md
#   ./run-agent.sh agent-doc DOC_ROLE.md
#
# Per-agent config: ~/agents/<agent-name>/config (required keys)
#   CONTROL_REPO_URL=git@github.com:org/control.git
#   WORK_REPO_URL=git@github.com:org/work.git   # empty for QA/doc agents
#   AGENT_DOMAIN=be                              # be | fe | full | qa | doc
#   READ_REPOS="git@github.com:org/api.git ..."  # optional, read-only

set -u

AGENT_NAME="${1:?Usage: run-agent.sh <agent-name> <role-file> [model]}"
ROLE_FILE="${2:?Provide a role file, e.g. FEATURE_ROLE.md}"
MODEL="${3:-claude-sonnet-4-6}"

AGENT_HOME="$HOME/agents/$AGENT_NAME"
CONFIG="$AGENT_HOME/config"
CONTROL_DIR="$AGENT_HOME/control"
WORK_DIR="$AGENT_HOME/work"
READ_DIR="$AGENT_HOME/read"
LOG_DIR="$AGENT_HOME/logs"
WAKE_CHECK_INTERVAL=5     # seconds between ls-remote checks while idle (was 30)
MAX_IDLE_WAIT=300         # safety-net wake after 5 min even if nothing changed (was 1800)
MAX_CONSECUTIVE_FAILS=3
PRESENCE_INTERVAL=30      # seconds between presence heartbeat writes

# Paths for real-time coordination (local only — gitignored in control repo)
MAILBOX_FILE=""           # set after CONTROL_DIR confirmed
WAKE_FILE=""
PRESENCE_FILE=""
AGENT_STATE_FILE=""
ANSWER_WT="$AGENT_HOME/answer-wt"

[ -f "$CONFIG" ] || { echo "Missing config: $CONFIG"; exit 1; }
# shellcheck disable=SC1090
source "$CONFIG"
mkdir -p "$LOG_DIR"

# Optional Supabase config (skip broadcast/listen if absent)
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_KEY="${SUPABASE_KEY:-}"

# Init local coordination paths (control dir may not exist yet before clone)
_init_collab_paths() {
  MAILBOX_FILE="$CONTROL_DIR/mailboxes/$AGENT_NAME.md"
  WAKE_FILE="$CONTROL_DIR/mailboxes/wake/$AGENT_NAME"
  PRESENCE_FILE="$CONTROL_DIR/mailboxes/presence/$AGENT_NAME.json"
  AGENT_STATE_FILE="$LOG_DIR/.agent_state"
  mkdir -p "$CONTROL_DIR/mailboxes/presence" "$CONTROL_DIR/mailboxes/wake" 2>/dev/null || true
}

# --- Presence beacon ----------------------------------------------------------
# Writes a local JSON presence file every PRESENCE_INTERVAL seconds.
# Local only — not committed to git. Other agents on the same machine can read
# these files to check if a peer is alive (mtime < 60s means live).

write_presence() {
  local state="$1"
  [ -z "$PRESENCE_FILE" ] && return 0
  echo "$state" > "$AGENT_STATE_FILE" 2>/dev/null || true
  printf '{"agent":"%s","pid":%d,"state":"%s","ts":"%s"}\n' \
    "$AGENT_NAME" "$$" "$state" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "$PRESENCE_FILE" 2>/dev/null || true
}

start_presence_beacon() {
  (
    while true; do
      state=$(cat "$AGENT_STATE_FILE" 2>/dev/null || echo "unknown")
      printf '{"agent":"%s","pid":%d,"state":"%s","ts":"%s"}\n' \
        "$AGENT_NAME" "$$" "$state" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        > "$PRESENCE_FILE" 2>/dev/null || true
      sleep "$PRESENCE_INTERVAL"
    done
  ) &
  BEACON_PID=$!
}

# --- Supabase Realtime --------------------------------------------------------
# broadcast_wake: curl-based, fires after each session push. Service-role key
# (or anon key with broadcast enabled) required for REST broadcast endpoint.

broadcast_wake() {
  local recipient="$1"
  [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_KEY" ] && return 0
  curl -s -X POST \
    "${SUPABASE_URL}/realtime/v1/api/broadcast" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"messages\":[{\"topic\":\"agent-wakes\",\"event\":\"wake\",\"payload\":{\"agent\":\"${recipient}\"}}]}" \
    > /dev/null 2>&1 || true
}

start_wake_listener() {
  [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_KEY" ] && return 0
  local listener_script
  listener_script="$(dirname "$0")/wake-listen.ts"
  [ -f "$listener_script" ] || { echo "[$AGENT_NAME] wake-listen.ts not found, skipping Supabase listener"; return 0; }
  (
    while true; do
      bun run "$listener_script" "$AGENT_NAME" "$CONTROL_DIR" "$SUPABASE_URL" "$SUPABASE_KEY" \
        >> "$LOG_DIR/wake-listen.log" 2>&1 || true
      echo "[$AGENT_NAME] wake-listen.ts exited, restarting in 5s..." >> "$LOG_DIR/wake-listen.log"
      sleep 5
    done
  ) &
  WAKE_LISTENER_PID=$!
  echo "[$AGENT_NAME] Supabase wake listener started (PID $WAKE_LISTENER_PID)"
}

# --- Same-machine wake signals ------------------------------------------------
# After each session, diff what changed in control repo and write local wake
# files for any recipient mailboxes that were modified. Agents sleeping in
# idle_wait() check this file every 1s and wake immediately.

notify_local_agents() {
  local before="$1"
  local changed
  changed=$(git -C "$CONTROL_DIR" diff --name-only "$before" HEAD 2>/dev/null \
    | grep '^mailboxes/[^/]*\.md$' \
    | grep -v "^mailboxes/${AGENT_NAME}\.md$" || true)
  [ -z "$changed" ] && return 0
  mkdir -p "$CONTROL_DIR/mailboxes/wake" 2>/dev/null || true
  for f in $changed; do
    local recipient
    recipient=$(basename "$f" .md)
    touch "$CONTROL_DIR/mailboxes/wake/$recipient" 2>/dev/null || true
    echo "[$AGENT_NAME] wake signal → $recipient"
    broadcast_wake "$recipient"
  done
}

# --- Idle wait ----------------------------------------------------------------
# Checks local wake file every 1s (fast path for same-machine agents), and
# polls git ls-remote every WAKE_CHECK_INTERVAL seconds (remote path).

idle_wait() {
  local LAST_SEEN
  LAST_SEEN=$(git -C "$CONTROL_DIR" rev-parse HEAD 2>/dev/null || echo "")
  local IDLE_START
  IDLE_START=$(date +%s)
  echo "[$AGENT_NAME] no eligible tasks — descheduled (wake file: 1s, ls-remote: ${WAKE_CHECK_INTERVAL}s, max: ${MAX_IDLE_WAIT}s)"

  while true; do
    # 1s resolution: local wake file (same-machine fast path)
    local elapsed=0
    while [ "$elapsed" -lt "$WAKE_CHECK_INTERVAL" ]; do
      if [ -f "$WAKE_FILE" ]; then
        rm -f "$WAKE_FILE" 2>/dev/null || true
        echo "[$AGENT_NAME] local wake signal — waking"
        return
      fi
      sleep 1
      elapsed=$((elapsed + 1))
    done

    # 5s resolution: remote git ls-remote
    local REMOTE_HEAD
    REMOTE_HEAD=$(git -C "$CONTROL_DIR" ls-remote -q origin HEAD 2>/dev/null | cut -f1)
    if [ -n "$REMOTE_HEAD" ] && [ "$REMOTE_HEAD" != "$LAST_SEEN" ]; then
      echo "[$AGENT_NAME] control repo changed ($REMOTE_HEAD) — waking"
      return
    fi

    local IDLE_NOW
    IDLE_NOW=$(date +%s)
    if [ $((IDLE_NOW - IDLE_START)) -ge "$MAX_IDLE_WAIT" ]; then
      echo "[$AGENT_NAME] max idle wait reached — waking for safety-net check"
      return
    fi
  done
}

# --- Parallel answer sessions -------------------------------------------------
# While a main session is running, this background watcher polls the remote
# control repo every 5s. If it detects that THIS agent's mailbox changed on
# remote (someone else wrote to it while we're mid-task), it immediately
# launches a focused answer session in the ANSWER_WT worktree so the question
# is answered without waiting for the main session to finish.
#
# The answer session uses a separate git worktree (ANSWER_WT) to avoid
# git index conflicts with the concurrently-running main session.

_launch_answer_session() {
  local answer_id="${AGENT_NAME}_answer_$(date +%Y%m%d-%H%M%S)"
  local answer_log="$LOG_DIR/${answer_id}.json"

  # Sync answer worktree to latest remote state
  git -C "$ANSWER_WT" pull --rebase -q origin 2>/dev/null || true

  local prompt
  prompt="You are $AGENT_NAME (role: $AGENT_ROLE, domain: $AGENT_DOMAIN).

FOCUSED ANSWER SESSION — do NOT claim, pick, or work on any tasks.

Another agent has sent you an awaiting_info question while you are mid-session.
Your mailbox is at mailboxes/$AGENT_NAME.md.

Do exactly this and nothing else:
1. Read mailboxes/$AGENT_NAME.md
2. For each message referencing an awaiting_info task:
   a. Read the task spec (./kernel/task show <id>)
   b. Write a ## Q&A section in the task spec file with your answer
   c. Run: ./kernel/task resume <id> --agent $AGENT_NAME --role $AGENT_ROLE
   d. Append to mailboxes/<sender>.md:
      ## from: $AGENT_NAME | <ISO ts> | re: <task-id>
      <your answer — one precise paragraph>
3. Append to PROGRESS.md:
   ## $AGENT_NAME | <ts> | answer session
   Answered awaiting_info question on <task-id>. Resumed task.
4. Clear your mailbox: set it to <!-- cleared by $AGENT_NAME at <ts> -->
5. Commit all changes: 'mailbox($AGENT_NAME): answered awaiting_info on <task-id>'
6. Push. If push is rejected, pull --rebase and push again once.
7. Exit."

  echo "[$AGENT_NAME] launching answer session → $answer_log"
  (
    cd "$ANSWER_WT" || exit 1
    claude --dangerously-skip-permissions \
           --add-dir "$ANSWER_WT" \
           -p "$prompt" \
           --model "$MODEL" \
           --output-format json
  ) > "$answer_log" 2>&1
  local exit_code=$?
  echo "[$AGENT_NAME] answer session done (exit $exit_code, log: $answer_log)"
}

watch_mailbox_background() {
  local initial_hash="$1"
  local current_hash="$initial_hash"
  local answer_in_flight=0

  while true; do
    sleep 5
    git -C "$CONTROL_DIR" fetch -q origin 2>/dev/null || { sleep 5; continue; }

    local new_hash
    new_hash=$(git -C "$CONTROL_DIR" ls-tree FETCH_HEAD "mailboxes/$AGENT_NAME.md" 2>/dev/null | awk '{print $3}' || echo "")

    if [ -n "$new_hash" ] && [ "$new_hash" != "$current_hash" ] && [ "$answer_in_flight" -eq 0 ]; then
      current_hash="$new_hash"
      # Only launch if the mailbox has actual content (not just the "cleared" marker)
      local mailbox_content
      mailbox_content=$(git -C "$CONTROL_DIR" show "FETCH_HEAD:mailboxes/$AGENT_NAME.md" 2>/dev/null || echo "")
      if echo "$mailbox_content" | grep -q '^## from:'; then
        answer_in_flight=1
        _launch_answer_session
        answer_in_flight=0
      fi
    fi
  done
}

# --- One-time setup -----------------------------------------------------------

if [ ! -d "$CONTROL_DIR/.git" ]; then
  git clone "$CONTROL_REPO_URL" "$CONTROL_DIR" || { echo "control clone failed"; exit 1; }
fi
if [ -n "${WORK_REPO_URL:-}" ] && [ ! -d "$WORK_DIR/.git" ]; then
  git clone "$WORK_REPO_URL" "$WORK_DIR" || { echo "work clone failed"; exit 1; }
fi

READ_DIRS=()
if [ -n "${READ_REPOS:-}" ]; then
  mkdir -p "$READ_DIR"
  for url in $READ_REPOS; do
    name=$(basename "$url" .git)
    dest="$READ_DIR/$name"
    if [ ! -d "$dest/.git" ]; then
      git clone "$url" "$dest" || { echo "read clone failed: $url"; exit 1; }
    fi
    READ_DIRS+=("$dest")
  done
fi

AGENT_ROLE=$(basename "$ROLE_FILE" | sed 's/_ROLE.*//' | tr '[:upper:]' '[:lower:]')

# Metrics worktree (dedicated branch, keeps main history clean)
METRICS_WT="$AGENT_HOME/metrics-wt"
if [ ! -d "$METRICS_WT/.git" ] && [ ! -f "$METRICS_WT/.git" ]; then
  git -C "$CONTROL_DIR" fetch -q origin metrics 2>/dev/null || true
  if git -C "$CONTROL_DIR" show-ref -q refs/remotes/origin/metrics; then
    git -C "$CONTROL_DIR" worktree add -q "$METRICS_WT" -B metrics origin/metrics
  else
    git -C "$CONTROL_DIR" worktree add -q "$METRICS_WT" -b metrics
  fi
fi
METRICS_FILE="$METRICS_WT/METRICS.jsonl"
mkdir -p "$(dirname "$METRICS_FILE")"

# Answer worktree (separate checkout for parallel answer sessions)
if [ ! -d "$ANSWER_WT/.git" ] && [ ! -f "$ANSWER_WT/.git" ]; then
  git -C "$CONTROL_DIR" worktree add -q "$ANSWER_WT" HEAD
fi

# QA credentials (staging only, never committed)
if [ -f "$HOME/.cstack-secrets/dsti-qa-user" ]; then
  export QA_USER
  export QA_PASS
  QA_USER="$(cat "$HOME/.cstack-secrets/dsti-qa-user")"
  QA_PASS="$(cat "$HOME/.cstack-secrets/dsti-qa-pass")"
fi

export AGENT_NAME AGENT_DOMAIN AGENT_ROLE CONTROL_DIR WORK_DIR READ_DIR

_init_collab_paths

# Start presence beacon and Supabase wake listener (once, not per iteration)
BEACON_PID=""
WAKE_LISTENER_PID=""
start_presence_beacon
start_wake_listener

echo "[$AGENT_NAME] supervisor v7 — role: $ROLE_FILE, domain: ${AGENT_DOMAIN:-?}, model: $MODEL"
echo "[$AGENT_NAME] control: $CONTROL_DIR  work: ${WORK_REPO_URL:-<none>}  read: ${READ_REPOS:-<none>}"
echo "[$AGENT_NAME] realtime: wake_interval=${WAKE_CHECK_INTERVAL}s, idle_max=${MAX_IDLE_WAIT}s, supabase=$([ -n "$SUPABASE_URL" ] && echo enabled || echo disabled)"

consecutive_fails=0

cleanup() {
  write_presence "stopped"
  [ -n "$BEACON_PID" ] && kill "$BEACON_PID" 2>/dev/null || true
  [ -n "$WAKE_LISTENER_PID" ] && kill "$WAKE_LISTENER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- Main loop ----------------------------------------------------------------

while true; do
  # Sync everything before each session
  git -C "$CONTROL_DIR" pull --rebase --quiet || true
  [ -d "$WORK_DIR/.git" ] && { git -C "$WORK_DIR" pull --rebase --quiet || true; }
  for rd in "${READ_DIRS[@]:-}"; do
    [ -n "$rd" ] && git -C "$rd" pull --quiet || true
  done

  COMMIT_CTRL=$(git -C "$CONTROL_DIR" rev-parse HEAD 2>/dev/null || echo "nogit")
  CTRL_HEAD_BEFORE="$COMMIT_CTRL"   # snapshot for post-session notify_local_agents
  TS_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  EPOCH_START=$(date +%s)
  RUN_ID="${AGENT_NAME}_$(date +%Y%m%d-%H%M%S)_${COMMIT_CTRL}"
  JSONFILE="$LOG_DIR/${RUN_ID}.json"

  echo "[$AGENT_NAME] iteration start @ control:$COMMIT_CTRL"
  write_presence "working"

  # Snapshot mailbox blob hash so the watcher can detect incoming messages
  MAILBOX_HASH=$(git -C "$CONTROL_DIR" ls-tree HEAD "mailboxes/$AGENT_NAME.md" 2>/dev/null | awk '{print $3}' || echo "")

  # Build --add-dir flags
  ADD_DIRS=(--add-dir "$CONTROL_DIR")
  for rd in "${READ_DIRS[@]:-}"; do
    [ -n "$rd" ] && ADD_DIRS+=(--add-dir "$rd")
  done

  RUN_CWD="$WORK_DIR"; [ -d "$WORK_DIR/.git" ] || RUN_CWD="$CONTROL_DIR"

  # Start background mailbox watcher for parallel answer sessions
  WATCHER_PID=""
  watch_mailbox_background "$MAILBOX_HASH" &
  WATCHER_PID=$!

  (
    cd "$RUN_CWD" || exit 1
    claude --dangerously-skip-permissions \
           "${ADD_DIRS[@]}" \
           -p "$(cat "$CONTROL_DIR/AGENT_BASE.md" "$CONTROL_DIR/roles/$ROLE_FILE")" \
           --model "$MODEL" \
           --output-format json
  ) > "$JSONFILE" 2> "$LOG_DIR/${RUN_ID}.stderr"
  EXIT_CODE=$?
  EPOCH_END=$(date +%s)
  DURATION=$((EPOCH_END - EPOCH_START))

  # Stop mailbox watcher
  [ -n "$WATCHER_PID" ] && kill "$WATCHER_PID" 2>/dev/null || true

  # Safety: hard-reset any read-only repo drift
  for rd in "${READ_DIRS[@]:-}"; do
    [ -n "$rd" ] && git -C "$rd" reset --hard -q HEAD 2>/dev/null && git -C "$rd" clean -fdq 2>/dev/null || true
  done

  # Notify same-machine agents + broadcast via Supabase for any mailbox messages we sent
  notify_local_agents "$CTRL_HEAD_BEFORE"

  # --- Extract metrics from session JSON ---
  METRIC_LINE=$(python3 - "$JSONFILE" "$AGENT_NAME" "$TS_START" "$DURATION" "$EXIT_CODE" "$COMMIT_CTRL" <<'PYEOF'
import json, sys, re
jsonfile, agent, ts, dur, exit_code, c_ctrl = sys.argv[1:7]
m = {"ts": ts, "agent": agent, "duration_s": int(dur), "exit_code": int(exit_code),
     "control_commit": c_ctrl, "task": None, "outcome": "unknown",
     "input_tokens": None, "output_tokens": None, "cache_read_tokens": None,
     "cost_usd": None, "num_turns": None, "no_work": False, "context_exhausted": False}
try:
    data = json.load(open(jsonfile))
    u = data.get("usage", {}) or {}
    m.update(input_tokens=u.get("input_tokens"), output_tokens=u.get("output_tokens"),
             cache_read_tokens=u.get("cache_read_input_tokens"),
             cost_usd=data.get("total_cost_usd") or data.get("cost_usd"),
             num_turns=data.get("num_turns"))
    txt = data.get("result", "") or ""
    if "NO_ELIGIBLE_TASKS" in txt:
        m["no_work"] = True; m["outcome"] = "no_work"
    tm = re.search(r'(?:claim|feat|fix|qa|qa-claim|docs|doc-claim|bug)\(([A-Z0-9][A-Z0-9-]+)\)', txt)
    if tm: m["task"] = tm.group(1)
    low = txt.lower()
    if m["outcome"] != "no_work":
        if "needs_human" in low: m["outcome"] = "needs_human"
        elif re.search(r'status:\s*done|marked done|qa_status:\s*passed|doc_status:\s*updated', low): m["outcome"] = "done"
        elif int(exit_code) == 0: m["outcome"] = "completed_session"
        else: m["outcome"] = "crashed"
    if data.get("is_error") and "context" in str(data.get("result","")).lower():
        m["context_exhausted"] = True
except Exception as e:
    m["outcome"] = "metrics_parse_error"; m["parse_error"] = str(e)[:200]
print(json.dumps(m, separators=(",", ":")))
PYEOF
)
  echo "$METRIC_LINE" >> "$METRICS_FILE"
  git -C "$METRICS_WT" add METRICS.jsonl 2>/dev/null && \
    git -C "$METRICS_WT" commit -qm "metrics(${AGENT_NAME}): ${RUN_ID}" 2>/dev/null && \
    git -C "$METRICS_WT" push -q -u origin metrics 2>/dev/null || \
    { git -C "$METRICS_WT" pull --rebase -q origin metrics 2>/dev/null; git -C "$METRICS_WT" push -q -u origin metrics 2>/dev/null || true; }

  # --- Circuit breaker ---
  if [ $EXIT_CODE -ne 0 ]; then
    consecutive_fails=$((consecutive_fails + 1))
    echo "[$AGENT_NAME] session exited $EXIT_CODE (fail $consecutive_fails/$MAX_CONSECUTIVE_FAILS)"
    if [ $consecutive_fails -ge $MAX_CONSECUTIVE_FAILS ]; then
      echo "[$AGENT_NAME] ESCALATION: stopping. Human needed. Last: $JSONFILE"
      exit 1
    fi
  else
    consecutive_fails=0
  fi

  # --- Idle wait (event-driven, BEAM receive-style) ---
  if echo "$METRIC_LINE" | grep -q '"no_work":true'; then
    write_presence "idle"
    idle_wait
  fi
done

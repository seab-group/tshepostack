# supervisor — cstack agent fleet runner

Scripts for starting, stopping, and monitoring the autonomous agent fleet.

| File | Purpose |
|------|---------|
| `run-agent.sh` | Single-agent supervisor loop (v7 — real-time collaboration) |
| `fleet.sh` | Start/stop/status/logs for all agents at once |
| `fleet.conf` | Declare all agents in one place |
| `install.sh` | Register an agent as a launchd (macOS) or systemd (Linux) service |
| `wake-listen.ts` | Supabase Realtime subscriber — wakes idle agents in <1s cross-machine |

---

## The full workflow

### Step 1 — One-time setup per agent (each machine)

Each agent needs a config file at `~/agents/<agent-name>/config`:

```bash
mkdir -p ~/agents/agent-be
cat > ~/agents/agent-be/config <<EOF
CONTROL_REPO_URL=git@github.com:your-org/your-control-repo.git
WORK_REPO_URL=git@github.com:your-org/your-backend-repo.git
AGENT_DOMAIN=be
EOF
```

Repeat for `agent-fe`, `agent-qa`, `agent-doc`. The `WORK_REPO_URL` is empty for QA/doc agents that only commit to the control repo.

**Optional — enable cross-machine Supabase wake (add to each config):**

```bash
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_KEY=<anon-or-service-role-key>
```

### Step 2 — Edit `fleet.conf` to match your agents

```
# supervisor/fleet.conf
agent-be    FEATURE_ROLE.md    claude-sonnet-4-6
agent-fe    FEATURE_ROLE.md    claude-sonnet-4-6
agent-qa    QA_ROLE.md         claude-sonnet-4-6
agent-doc   DOC_ROLE.md        claude-sonnet-4-6
```

### Step 3 — Choose: development mode or production mode

**Development** (one terminal, agents run in the background, stop when you kill the terminal):

```bash
cd supervisor/
./fleet.sh start    # starts all 4 agents in the background
./fleet.sh status   # see who's running / working / idle
./fleet.sh logs     # tail all 4 logs merged in one stream, Ctrl-C to exit
./fleet.sh stop     # stop all
```

**Production** (agents survive reboot, restart on crash, no terminal window needed):

```bash
cd supervisor/
./fleet.sh install    # registers all 4 as launchd services (macOS)
                      # they start immediately and persist after logout
./fleet.sh status     # shows "service:running" per agent
./fleet.sh uninstall  # removes the services when you're done
```

No need to open four terminals. Everything is driven from `fleet.sh`.

### What `./fleet.sh status` shows

```
AGENT           MODE        STATE     DETAIL
------------------------------------------------------------
agent-be        service     running   [agent-be] iteration start @ control:a3f9c2
agent-fe        bg          idle      2026-06-15T10:42:00Z
agent-qa        bg          working
agent-doc       stopped
```

- **service** — installed via `fleet.sh install`, managed by the OS
- **bg** — started via `fleet.sh start`, runs in the background of this session
- **stopped** — not running (config exists but agent was never started)

---

## Real-time collaboration (v7)

The v7 supervisor adds five layers so agents respond to each other in seconds rather than minutes:

| Layer | What it does | Latency |
|-------|-------------|---------|
| Process supervision | Agents restart on crash via launchd/systemd | — |
| Fast idle polling | `git ls-remote` every 5s (was 30s) | ≤5s |
| Local wake file | Supervisor writes `mailboxes/wake/<agent>` after each push | <1s |
| Supabase Realtime | Cross-machine broadcast via `wake-listen.ts` | ~1s |
| Parallel answer sessions | Detects incoming `awaiting_info` questions mid-session, spawns a focused answer session in a separate git worktree | ~10s |

End-to-end round-trip for an `awaiting_info` Q&A: **~15–30 seconds** (dominated by LLM response time), down from potentially hours with the v6 async mailbox-only approach.

---

## Adding a new agent

1. Add a line to `fleet.conf`
2. Create `~/agents/<new-agent>/config` on the target machine
3. Run `./fleet.sh start` (or `./fleet.sh install` for production)

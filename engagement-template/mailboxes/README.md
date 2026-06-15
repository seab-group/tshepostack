# mailboxes/ — directed agent messages

One file per agent: `agent-a.md`, `agent-b.md`, `agent-qa.md`, `agent-doc.md`.

- Agents read their own mailbox at the START of every session (AGENT_BASE.md step 1), act on each message, then clear it.
- Anyone (agents or human) appends messages; only the OWNER clears their own mailbox.
- Blackboard rule still applies: anything written to a mailbox is also summarized in PROGRESS.md.
- NEVER put secrets in a mailbox.

## Message format

```
## from: <sender> | <ISO timestamp> | re: <task-id or "general">
<precise, actionable message>
```

## Human steering example

Append to `mailboxes/agent-b.md`:

```
## from: tshepo | 2026-06-12T09:00:00Z | re: general
Deprioritize CRON tasks today. Pick SPCH-1-FK first if available.
```

Commit and push — agent-b obeys on its next iteration. Mailbox instructions override task-picking order but never override Hard Rules.

---

## Real-time wake system (v7 supervisor)

The v7 supervisor adds three layers of wake notification so agents respond to messages in seconds rather than minutes.

### How wake signals flow

```
Agent-A writes to agent-b.md → commits → pushes
  │
  ├─→ Same machine: supervisor writes mailboxes/wake/agent-b (local file)
  │     Agent-B's idle loop detects it in ≤1s → wakes immediately
  │
  └─→ Cross machine: supervisor POSTs to Supabase Realtime broadcast channel
        Agent-B's wake-listen.ts receives it in ~1s → writes mailboxes/wake/agent-b
        Agent-B's idle loop detects it in ≤1s → wakes immediately
```

For `awaiting_info` questions that arrive while Agent-B is mid-session:
```
Agent-A parks task → writes to agent-b.md → pushes
  │
  └─→ Agent-B's background mailbox watcher fetches remote every 5s
        Detects agent-b.md changed → spawns focused answer session
        Answer session runs in a separate git worktree (no index conflict)
        Answers question → resumes task → pushes → exits
        Agent-A's idle loop sees the push → wakes within 5s
```

### Local-only directories (gitignored)

`presence/` and `wake/` are **not committed** to the control repo. They are machine-local coordination files:

| Directory | Content | Written by | Read by |
|-----------|---------|------------|---------|
| `presence/<agent>.json` | `{"agent":"...","pid":N,"state":"working|idle","ts":"..."}` | Supervisor beacon (every 30s) | Same-machine peers checking if agent is live |
| `wake/<agent>` | Empty sentinel file | Supervisor post-push + wake-listen.ts | Same-machine supervisor idle loop (every 1s) |

### Configuring Supabase (optional, for cross-machine wake)

Add to `~/agents/<agent-name>/config`:

```bash
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_KEY=<anon-or-service-role-key>
```

The supervisor automatically starts `wake-listen.ts` as a background process and broadcasts wake events via the Supabase Realtime `agent-wakes` channel after each session push.

### Registering as a persistent process

```bash
cd supervisor/
./install.sh agent-be FEATURE_ROLE.md claude-sonnet-4-6
./install.sh agent-qa QA_ROLE.md
```

This installs a launchd agent (macOS) or systemd user service (Linux) that keeps the supervisor alive across reboots and auto-restarts it on crash. Without this, agents can go offline and messages queue indefinitely.

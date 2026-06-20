---
repo: tshepostack
domain: be
done_check: -
e2e_check: -
lease_hours: 3
ready: true
---
# CONS-004 — server.ts: SSE push watching all agent log directories

## Traceability
- Requirement: ad hoc — sourced from docs/designs/AGENT_CONSOLE.md, T4
- Repo: tshepostack
- Domain: be

## Context
The console uses Server-Sent Events to push live updates to the browser without polling. The original design watched a single file. Engineering review identified the gap: events come from 4 agents, each writing to `~/agents/<agent>/logs/live-events.jsonl`. The fix is one `fs.watch()` call per agent log directory at startup, all routing to the same SSE broadcast handler. The index.html already has a 5s htmx poll as reconnection fallback — this task is the push path only.

## Acceptance criteria
- AC1: Given 4 agents in fleet.conf (agent-be, agent-fe, agent-qa, agent-doc), When server.ts starts, Then it calls `fs.watch` on `~/agents/<agent>/logs/` for each of the 4 agents — 4 separate watchers.
- AC2: Given agent-fe appends a line to its `live-events.jsonl`, When the fs.watch callback fires for that directory, Then all connected SSE clients receive a `data:` event within 1 second.
- AC3: Given the console tab is open and agent-be triggers an approval request (writes to its live-events.jsonl), When the SSE event arrives at the browser, Then the approval card appears in the Approval Queue without a page reload.
- AC4: Given a log directory does not exist yet (`~/agents/agent-doc/logs/`), When server.ts starts, Then it creates the directory if missing (mkdir -p equivalent) before calling fs.watch — does not crash.
- AC5: Given 2 SSE clients are connected simultaneously, When any agent fires an event, Then both clients receive the push.

## AC → verification mapping
| AC | Verified by | Type |
|---|---|---|
| AC1 | Read server.ts source; confirm 4 `fs.watch` calls at startup, one per agent from fleet.conf | human-verify |
| AC2 | With console tab open: `echo '{"event":"test"}' >> ~/agents/agent-fe/logs/live-events.jsonl`; confirm SSE event appears in browser DevTools Network tab within 1s | human-verify |
| AC3 | Start agent-fe; trigger a bash approval via the wrapper; confirm card appears in browser Approval Queue without reload | human-verify |
| AC4 | `rm -rf ~/agents/agent-doc/logs`; start server; confirm it starts without error and log dir is created | human-verify |
| AC5 | Open console in 2 browser tabs; append to any agent log; confirm both tabs update | human-verify |

## Out of scope
- SSE reconnect logic on the client (htmx 5s poll already covers this)
- Watching other files in the log directory (only `live-events.jsonl` changes trigger pushes)
- WebSocket upgrade — SSE is the chosen transport per the design doc

## Constraints
- `fs.watch` (Node-compatible Bun API) — not `setInterval` polling
- One watcher per agent log directory (not one watcher on `~/agents/`)  
- The SSE endpoint is `/api/events` — route through `createSseEndpoint` pattern if it exists in this codebase; otherwise a direct Hono SSE handler
- Directory creation for missing log dirs uses `mkdir -p` semantics (no error if exists)

## Definition of done (auto-summary)
All done_check + e2e_check mapped tests pass, full regression passes, every human-verify AC is listed in the PR description with evidence, contract snapshot unchanged or change authorized below.

- Contract change authorized: no

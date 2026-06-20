---
repo: tshepostack
domain: be
done_check: -
e2e_check: -
lease_hours: 2
blocked_by: CONS-002
ready: true
---
# CONS-008 — server.ts: decisions/ cleanup (startup + in-session)

## Traceability
- Requirement: ad hoc — sourced from docs/designs/AGENT_CONSOLE.md, T8
- Repo: tshepostack
- Domain: be

## Context
The bash wrapper polls `$SUPERVISOR_DECISIONS_DIR/<agent>-<id>.json` waiting for an approval response. After the console writes the decision (approved/rejected), the file is no longer needed and will accumulate on disk if not cleaned. Two cleanup paths: (1) startup cleanup removes stale files older than 24 hours (handles crashes/restarts); (2) post-approval cleanup uses `setTimeout(60_000)` after writing the decision — 60 seconds gives the polling bash wrapper time to read it before the file disappears.

## Acceptance criteria
- AC1: Given decision files older than 24 hours exist in `$SUPERVISOR_DECISIONS_DIR`, When server.ts starts, Then those files are deleted before `app.listen()` is called.
- AC2: Given a decision file is exactly 23h old, When server.ts starts, Then it is NOT deleted (only >24h files are removed).
- AC3: Given `POST /api/approve` writes an approved/rejected decision, When the handler completes, Then `setTimeout(() => unlink(decisionsFile), 60_000)` is scheduled — the file persists for 60 seconds, then is removed.
- AC4: Given the setTimeout cleanup fires, When 60 seconds have elapsed after approval, Then the decision file no longer exists on disk.
- AC5: Given server.ts is restarted while a decision file is 5 seconds old (fresh, just created), When startup runs, Then the file is NOT deleted (it is under 24h old) — the in-flight approval is preserved.

## AC → verification mapping
| AC | Verified by | Type |
|---|---|---|
| AC1 | `touch -t $(date -v -25H +%Y%m%d%H%M) /tmp/test-decisions/agent-be-old.json`; set `SUPERVISOR_DECISIONS_DIR=/tmp/test-decisions`; start server; confirm file is gone after startup | human-verify |
| AC2 | `touch -t $(date -v -23H +%Y%m%d%H%M) /tmp/test-decisions/agent-be-recent.json`; start server; confirm file still exists | human-verify |
| AC3 | Read server.ts `POST /api/approve` handler — confirm `setTimeout(() => unlink(...), 60_000)` is present | human-verify |
| AC4 | Approve a card; wait 61 seconds; confirm decision file no longer exists in `decisions/` | human-verify |
| AC5 | Start server; immediately create a fresh decision file; restart server; confirm file survives restart | human-verify |

## Out of scope
- Cleaning up other files in the decisions/ directory (only JSON decision files with the `<agent>-<id>.json` naming pattern)
- Cleaning up log files in `~/agents/*/logs/`
- Any changes to the UI or bash wrapper

## Constraints
- Startup cleanup: `fs.readdir(decisionsDir)` + `stat().mtime` check — do not use shell `find` (not available in Bun server)
- Post-approval timer: `setTimeout` with 60_000ms — not a cron or polling loop
- `unlink` errors in the setTimeout callback must be swallowed silently (file may already be gone)
- Startup cleanup runs before `app.listen()` — not async fire-and-forget

## Definition of done (auto-summary)
All done_check + e2e_check mapped tests pass, full regression passes, every human-verify AC is listed in the PR description with evidence, contract snapshot unchanged or change authorized below.

- Contract change authorized: no

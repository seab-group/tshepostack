---
repo: tshepostack
domain: be
done_check: -
e2e_check: -
lease_hours: 3
ready: true
---
# CONS-002 — server.ts: CONTROL_DIR auto-detection + blocking startup clone

## Traceability
- Requirement: ad hoc — sourced from docs/designs/AGENT_CONSOLE.md, T2
- Repo: tshepostack
- Domain: be

## Context
The console server needs to read task ledger and mailbox files from the control repo. Currently the server requires a `CONTROL_DIR` env var pointing to an already-cloned repo. This task makes startup zero-config: server.ts reads `supervisor/fleet.conf`, finds the first agent name, resolves the control repo URL from `~/agents/<first-agent>/control/.git/config`, and clones it to `~/agents/console/control` if not present. The clone is blocking — the HTTP server only binds after the clone succeeds. This ensures agents never see a partially-started console.

## Acceptance criteria
- AC1: Given `~/agents/console/control` does not exist and `~/agents/agent-be/control` has a git remote, When server.ts starts, Then it logs `Cloning control repo from <url>...` and clones to `~/agents/console/control` before calling `app.listen()`.
- AC2: Given `~/agents/console/control` already exists, When server.ts starts, Then it skips the clone and starts immediately without attempting re-clone.
- AC3: Given the clone is in progress, When `app.listen()` has not yet been called, Then no HTTP requests are served (server is not accessible at port 7842 during clone).
- AC4: Given the CONTROL_REPO_URL comes from the first agent in fleet.conf, When fleet.conf lists `agent-be` first, Then the URL is read via `git -C ~/agents/agent-be/control remote get-url origin` — not from a separate config file.
- AC5: Given `CONTROL_DIR` env var is set, When server.ts starts, Then it uses that value directly and skips auto-detection (backward-compat fallback).
- AC6: Given the clone fails (network error, bad URL), When startup runs, Then server.ts exits with a non-zero code and a descriptive error — it does not start a server with no control repo.

## AC → verification mapping
| AC | Verified by | Type |
|---|---|---|
| AC1 | `rm -rf ~/agents/console/control && bun run supervisor/console/server.ts`; observe stdout for "Cloning..." before HTTP bind message | human-verify |
| AC2 | With `~/agents/console/control` present: `bun run supervisor/console/server.ts`; confirm no "Cloning" in output and startup is instant | human-verify |
| AC3 | During a slow clone (large repo or throttled): `curl http://127.0.0.1:7842/health` returns connection refused | human-verify |
| AC4 | Read server.ts source; confirm git command uses `~/agents/agent-be/control` path (first agent from fleet.conf) | human-verify |
| AC5 | `CONTROL_DIR=/tmp/test bun run supervisor/console/server.ts`; confirm server uses `/tmp/test` without running git commands | human-verify |
| AC6 | Point CONTROL_REPO_URL at an invalid URL; run server; confirm non-zero exit and error message on stdout | human-verify |

## Out of scope
- Multi-control-repo support (one control repo per fleet — no per-agent repos)
- Periodic re-sync of the control clone during runtime (that is server-loop work, not this task)
- Any changes to index.html, styles.css, or the bash wrapper

## Constraints
- Clone must be `await Bun.spawn(['git','clone',url,clonePath]).exited` — blocking, not fire-and-forget
- Fleet.conf parsing: read `supervisor/fleet.conf`, split lines, skip `#` comments, take first non-blank agent name
- `git -C <path> remote get-url origin` — not reading a separate config file
- Do not create server.ts from scratch — this is an additive patch to the existing server.ts skeleton

## Definition of done (auto-summary)
All done_check + e2e_check mapped tests pass, full regression passes, every human-verify AC is listed in the PR description with evidence, contract snapshot unchanged or change authorized below.

- Contract change authorized: no

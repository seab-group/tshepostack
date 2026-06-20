---
repo: tshepostack
domain: be
done_check: -
e2e_check: -
lease_hours: 2
ready: true
---
# CONS-003 — server.ts: localhost-only binding + agentName/taskId validation

## Traceability
- Requirement: ad hoc — sourced from docs/designs/AGENT_CONSOLE.md, T3
- Repo: tshepostack
- Domain: be

## Context
The console serves approval and unblock actions. Two security hardening tasks from engineering review: (1) bind only to 127.0.0.1 so the console is never reachable from the network even if a firewall rule is misconfigured; (2) validate all path parameters before using them as filesystem paths — `agentName` must match a known agent from fleet.conf, `taskId` must match `^[A-Z]+-[0-9]+$` — preventing path traversal via malformed identifiers.

## Acceptance criteria
- AC1: Given server.ts binds with `{port:7842,hostname:'127.0.0.1'}`, When `curl http://0.0.0.0:7842/health` is run, Then the connection is refused (server not reachable on 0.0.0.0).
- AC2: Given server.ts is bound on 127.0.0.1, When `curl http://127.0.0.1:7842/health` is run, Then it returns HTTP 200.
- AC3: Given `agentName` is validated against the Set of names from fleet.conf, When `POST /api/mailbox/unknown-agent` is called, Then the server returns HTTP 400 with `{"error":"unknown agent"}`.
- AC4: Given `taskId` is validated with `/^[A-Z]+-[0-9]+$/`, When `POST /api/unblock/../../etc/passwd` is called, Then the server returns HTTP 400 with `{"error":"invalid task ID"}`.
- AC5: Given `taskId` is validated, When `POST /api/unblock/FEAT-007` is called (valid format), Then the server proceeds to process the unblock (not rejected by validation).
- AC6: Given `agentName` validation is against fleet.conf, When fleet.conf is read at startup, Then all agent names in the file are accepted as valid (no false rejects for legitimate agents).

## AC → verification mapping
| AC | Verified by | Type |
|---|---|---|
| AC1 | `curl http://0.0.0.0:7842/health` → connection refused | human-verify |
| AC2 | `curl http://127.0.0.1:7842/health` → HTTP 200 | human-verify |
| AC3 | `curl -X POST http://127.0.0.1:7842/api/mailbox/unknown-agent` → HTTP 400 body contains "unknown agent" | human-verify |
| AC4 | `curl -X POST http://127.0.0.1:7842/api/unblock/../../etc/passwd` → HTTP 400 body contains "invalid task ID" | human-verify |
| AC5 | `curl -X POST http://127.0.0.1:7842/api/unblock/FEAT-007 -d '{"decision":"proceed"}'` → HTTP 200 or 404 (not 400) | human-verify |
| AC6 | Read server.ts; confirm fleet.conf is parsed at startup to build the allowed-agent Set; all 4 agents from fleet.conf are in it | human-verify |

## Out of scope
- Rate limiting or CSRF tokens (single-user local tool)
- Authentication (localhost-only, no auth per the design doc)
- Any changes to index.html, styles.css, or the bash wrapper

## Architecture decision (human — 2026-06-19)
**Runtime: Node.js only.** Replace ALL Bun-specific APIs with Node.js equivalents:
- `Bun.serve()` → `node:http` `createServer()` (already done in prior attempt)
- `Bun.spawn()` → `child_process.spawnSync()` or `execSync()` from `node:child_process`
- `Bun.file().text()` → `fs.readFileSync()` from `node:fs`

Do NOT use any `Bun.*` APIs. The server must run with `node server.ts` (or `node server.js` if compiled). This resolves the 3 prior QA failures caused by Bun-specific API calls at lines 52, 74, 100, 188.

## Constraints
- `app.listen({port:7842,hostname:'127.0.0.1'})` — exact hostname string required (use `node:http` `server.listen(7842, '127.0.0.1', cb)`)
- Fleet.conf parsing: re-use or share the same parser as CONS-002 if both tasks are merged into the same server.ts — do not duplicate fleet.conf reading logic
- agentName regex: must not allow `/` or `.` characters (prevents path traversal)
- taskId regex: `/^[A-Z]+-[0-9]+$/` exactly — no `i` flag, uppercase only

## Definition of done (auto-summary)
All done_check + e2e_check mapped tests pass, full regression passes, every human-verify AC is listed in the PR description with evidence, contract snapshot unchanged or change authorized below.

- Contract change authorized: no

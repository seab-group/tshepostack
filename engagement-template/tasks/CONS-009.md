---
repo: tshepostack
domain: be
done_check: bun test supervisor/console/
e2e_check: -
lease_hours: 4
blocked_by: CONS-001,CONS-002,CONS-003
ready: true
---
# CONS-009 — Tests: check_risk logic + endpoint security boundaries

## Traceability
- Requirement: ad hoc — sourced from docs/designs/AGENT_CONSOLE.md, T9
- Repo: tshepostack
- Domain: be

## Context
Two test files need to be created. (1) `supervisor/console/bash-wrapper.test.sh` — a bash test script that invokes the wrapper directly and asserts risk classification and polling behavior. (2) `supervisor/console/server.test.ts` — a Bun test file covering the HTTP endpoints and their security boundaries. Together these provide the `done_check` that all other console tasks implicitly rely on. Blocked by CONS-001 (bash wrapper must exist), CONS-002 (server must have approval flow), and CONS-003 (validation logic must be in place).

## Acceptance criteria
- AC1: Given `supervisor/console/bash-wrapper.test.sh` exists and is executable, When `bun test supervisor/console/` runs, Then it includes this file and all 5 check_risk cases pass: (a) `git push origin main` → high; (b) `git commit -m "fix"` → medium; (c) `bun test` → low; (d) `cd /tmp && git push origin main` → high (chained); (e) `rm -rf /home` → high.
- AC2: Given `supervisor/console/bash-wrapper.test.sh`, When `poll_approval` is exercised, Then 3 paths are covered: (a) decision file appears with `approved: true` → wrapper exits 0; (b) decision file appears with `approved: false` → wrapper exits 1 (command not run); (c) timeout (60s) → wrapper exits 1.
- AC3: Given `supervisor/console/server.test.ts` exists, When `bun test supervisor/console/` runs, Then `POST /api/unblock/<invalid-taskId>` returns HTTP 400.
- AC4: Given `supervisor/console/server.test.ts`, When `POST /api/mailbox/<unknown-agentName>` is called in the test, Then it returns HTTP 400.
- AC5: Given `supervisor/console/server.test.ts`, When `GET /api/attention` is called with a mock ledger file containing one `needs_human` task, Then it returns HTTP 200 with the task in the response body.
- AC6: Given `supervisor/console/server.test.ts`, When `parseTaskLedger` is called with an empty ledger, Then it returns an empty array — no crash.
- AC7: Given `supervisor/console/server.test.ts`, When `parseMailboxNotes` is called with a mailbox containing only the `<!-- cleared -->` marker, Then it returns an empty array — no crash.
- AC8: Given `bun test supervisor/console/` runs with all tests, Then the suite passes with exit code 0.

## AC → verification mapping
| AC | Verified by | Type |
|---|---|---|
| AC1 | `bun test supervisor/console/` — bash-wrapper.test.sh passes all 5 check_risk cases | done_check |
| AC2 | `bun test supervisor/console/` — poll_approval tests pass all 3 paths | done_check |
| AC3 | `bun test supervisor/console/` — server.test.ts invalid taskId test passes | done_check |
| AC4 | `bun test supervisor/console/` — server.test.ts unknown agentName test passes | done_check |
| AC5 | `bun test supervisor/console/` — GET /api/attention with mock ledger test passes | done_check |
| AC6 | `bun test supervisor/console/` — parseTaskLedger empty edge case passes | done_check |
| AC7 | `bun test supervisor/console/` — parseMailboxNotes cleared-marker edge case passes | done_check |
| AC8 | `bun test supervisor/console/` exits 0 | done_check |

## Out of scope
- E2E browser tests (Playwright, etc.) — this task covers unit + integration only
- Testing T5 (AI draft streaming) — requires live Anthropic API key, not suitable for automated tests
- Testing T4 (SSE multi-agent) — too complex for unit tests in this pass
- Performance or load testing

## Constraints
- Test framework: Bun's built-in `test()` / `expect()` for server.test.ts
- For bash tests: use the pattern from existing test files in `supervisor/console/tests/` if any exist; otherwise simple `assert` functions in bash
- No new npm dependencies in test files
- Server tests should start a test server on a different port (7843) or mock the server — do not depend on a running console instance
- Mock ledger files go in a temp directory (`/tmp/console-test-<PID>`) — cleaned up after each test

## Definition of done (auto-summary)
All done_check + e2e_check mapped tests pass, full regression passes, every human-verify AC is listed in the PR description with evidence, contract snapshot unchanged or change authorized below.

- Contract change authorized: no

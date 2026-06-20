---
repo: tshepostack
domain: be
done_check: -
e2e_check: -
lease_hours: 4
ready: true
---
# CONS-001 — Bash wrapper: risk-gated intercept for Bash tool calls

## Traceability
- Requirement: ad hoc — sourced from docs/designs/AGENT_CONSOLE.md, T1
- Repo: tshepostack
- Domain: be

## Context
Agents use the Claude Bash tool for all shell operations. To gate high-risk commands (git push, git rebase, rm -rf, etc.) before they execute, a thin wrapper at `supervisor/console/bin/bash` intercepts every Bash invocation. When risk is detected, it writes a JSON decision file and polls until the console approves or rejects, then proceeds or aborts. The wrapper must appear first on PATH so the Bash tool calls it instead of the system bash. Three specific bugs from engineering review must be applied: REAL_BASH detection, chained-command risk scan, and jq-free JSON parsing.

## Acceptance criteria
- AC1: Given `supervisor/console/bin/bash` exists and is executable, When an agent calls the Bash tool with `git push origin main`, Then the wrapper intercepts, creates `$SUPERVISOR_DECISIONS_DIR/<agent>-<id>.json` with `{"command":"git push origin main","risk":"high","agent":"...","request_id":"..."}`, and blocks until a decision file is written back.
- AC2: Given a chained command `cd /tmp && git push origin main`, When the wrapper evaluates risk, Then it splits on `&&`, `||`, and `;` and classifies the chain as high risk (not low risk based on `cd /tmp` alone).
- AC3: Given system bash is at `/bin/bash`, When the wrapper detects its own real path via `BASH_SOURCE[0]`, Then `REAL_BASH` resolves to `/bin/bash` (not itself) without requiring `$0` — correctly handles symlinks and PATH ordering.
- AC4: Given `jq` is not installed, When the wrapper parses the decision response file, Then it uses `python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d.get('approved','') or '')"` and does not fail with command-not-found.
- AC5: Given `supervisor/run-agent.sh` starts an agent, Then it: (a) prepends `$SUPERVISOR_DIR/console/bin` to PATH before launching claude; (b) exports `SUPERVISOR_DECISIONS_DIR=$SUPERVISOR_DIR/console/decisions`; (c) exports `EVENTS_FILE=$LOG_DIR/live-events.jsonl`.
- AC6: Given the console is not running and `$SUPERVISOR_DECISIONS_DIR` is not set, When the wrapper encounters a high-risk command, Then it falls back to blocking (not silently executing) and logs a warning to stderr.

## AC → verification mapping
| AC | Verified by | Type |
|---|---|---|
| AC1 | Start Claude via run-agent.sh; trigger `git push` via Bash tool; confirm decision file appears in `decisions/` and agent is blocked | human-verify |
| AC2 | Run: `supervisor/console/bin/bash -c "cd /tmp && git push origin main"` locally; confirm output shows `risk: high` | human-verify |
| AC3 | Read the wrapper source and confirm `REAL_BASH=$(type -ap bash \| grep -v "$(realpath "${BASH_SOURCE[0]}")" \| head -1)` — no reference to `$0` | human-verify |
| AC4 | In a shell with `jq` not on PATH: `PATH=/usr/bin:/bin supervisor/console/bin/bash -c "git push"` — confirm it does not error on `jq: command not found` | human-verify |
| AC5 | Read `supervisor/run-agent.sh` diff; confirm the three exports and PATH prepend are present | human-verify |
| AC6 | Unset `SUPERVISOR_DECISIONS_DIR`; run wrapper with `git push`; confirm it blocks and prints a warning, does not execute the push | human-verify |

## Out of scope
- Risk classification tuning — the existing `check_risk` function logic is already specified; do not add new risk categories
- Consent UI — the browser console (T6) handles the approval UI
- Windows support — bash wrapper is macOS/Linux only
- Any changes to server.ts, index.html, or styles.css

## Constraints
- `BASH_SOURCE[0]` (not `$0`) for own-path detection — `$0` breaks when called via PATH
- `check_risk` must NOT have a `^` anchor — chained commands start mid-string
- python3 for JSON parsing (jq not guaranteed on stock macOS)
- The wrapper must be executable (`chmod +x`) and have a `#!/usr/bin/env bash` shebang
- Do not modify any file outside `supervisor/console/bin/bash` and `supervisor/run-agent.sh`

## Definition of done (auto-summary)
All done_check + e2e_check mapped tests pass, full regression passes, every human-verify AC is listed in the PR description with evidence, contract snapshot unchanged or change authorized below.

- Contract change authorized: no

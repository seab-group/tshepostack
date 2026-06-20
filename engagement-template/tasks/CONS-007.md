---
repo: tshepostack
domain: be
done_check: -
e2e_check: -
lease_hours: 2
blocked_by: CONS-002
ready: true
---
# CONS-007 — server.ts: git rebase-on-retry for POST /api/mailbox push

## Traceability
- Requirement: ad hoc — sourced from docs/designs/AGENT_CONSOLE.md, T7
- Repo: tshepostack
- Domain: be

## Context
`POST /api/mailbox/:agentName` writes a message to the agent's mailbox file and pushes to the control repo. In a multi-agent fleet, concurrent agent commits can reject the push. The `gitCommitAndPush` helper established in CONS-002 needs a rebase-on-retry: if push is rejected (exit code non-zero), pull --rebase and push once more before returning an error. This prevents the console operator from seeing spurious "push failed" errors when agents are active.

## Acceptance criteria
- AC1: Given two concurrent writes to the control repo cause a push rejection, When `gitCommitAndPush` retries, Then it runs `git pull --rebase` followed by `git push` once more before failing.
- AC2: Given the rebase succeeds and the second push succeeds, When the `/api/mailbox` request completes, Then it returns HTTP 200 — the operator sees success, not an error.
- AC3: Given the rebase itself fails (merge conflict on the mailbox file), When the retry is exhausted, Then the server returns HTTP 500 with `{"error":"push failed after retry"}` — does not hang.
- AC4: Given a successful first-attempt push (no rejection), When `gitCommitAndPush` runs, Then it does NOT attempt a rebase — retry only on push rejection (exit code 1 or 128).

## AC → verification mapping
| AC | Verified by | Type |
|---|---|---|
| AC1 | Read server.ts gitCommitAndPush — confirm push failure branch runs `git pull --rebase` then retries push | human-verify |
| AC2 | Simulate push rejection by temporarily setting control repo upstream to a diverged branch; POST to `/api/mailbox/agent-be`; confirm HTTP 200 after rebase | human-verify |
| AC3 | Create an irresolvable conflict on the mailbox file; POST to `/api/mailbox/agent-be`; confirm HTTP 500 with the error message | human-verify |
| AC4 | First push succeeds; confirm git log shows only one push attempt (no spurious rebase) | human-verify |

## Out of scope
- More than one retry (one rebase attempt + one push retry is the full spec)
- Conflict resolution strategies (reject with 500 on rebase failure)
- Any changes to the bash wrapper or UI files

## Constraints
- `git pull --rebase` not `git merge` — keeps the commit history linear
- Maximum 1 retry (pull --rebase → push once); do not loop
- Log both the first push failure and the retry attempt at info level
- This is an additive change to `gitCommitAndPush` helper in server.ts — do not rewrite surrounding logic

## Definition of done (auto-summary)
All done_check + e2e_check mapped tests pass, full regression passes, every human-verify AC is listed in the PR description with evidence, contract snapshot unchanged or change authorized below.

- Contract change authorized: no

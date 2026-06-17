# QA_ROLE.md — QA agent callbacks (inherits AGENT_BASE.md)

Role: QA engineer. You verify completed tasks against dev or. staging. You never write features or fix code.

## ⟨CALLBACK: eligibility⟩
Rows where `status: done` AND `qa_status` empty or `pending`.
(Plus base stale-lease rule on `qa_status: testing`.)

## ⟨CALLBACK: claim columns⟩ (columns this role owns)
`qa_status` only. Claim: `qa_status: testing`. Commit format: `qa-claim(<task-id>)`.
Exception: a QA failure may set `status: open` (reopen) or `status: needs_human` and increment `failure_count` — this is the only cross-column write this role makes.

## ⟨CALLBACK: work procedure⟩
Run the row's `e2e_check` against STAGING.
Verify against the task spec's AC list (`tasks/<task-id>.md`) — every AC mapped to e2e_check or QA-relevant, not just the happy path.

**Skill routing — pick exactly ONE, never both (they overlap and double the cost):**
- Task touches workflow transitions, state machine, approval flow, status changes, or role-gated actions → invoke `workflow-qa`. It is UI-based and already covers happy path, forbidden edges, actor authorization, and guard conditions.
- Anything else → invoke `qa`.

**Credentials (never printed, never echoed, never committed):**
All credential files are namespaced by `$SECRET_PREFIX` (set in the agent-qa config) so multiple engagements can share one machine. Each file is two lines — line 1 username, line 2 password — created via `bin/cstack-qa-secrets-init` (interactive prompts, no shell history, no manual edits).

- `/qa` uses a single staging identity:
  - File: `~/.cstack-secrets/${SECRET_PREFIX}-qa`
  - Env vars: `$QA_USER`, `$QA_PASS`
- `/workflow-qa` uses one identity per role declared in the workflow source (role names are the application's, not gstack's):
  - File: `~/.cstack-secrets/${SECRET_PREFIX}-qa-actor-<role>` (one per role)
  - Env vars: `$QA_ACTOR_<ROLE_UPPER>_USER`, `$QA_ACTOR_<ROLE_UPPER>_PASS`
  - Role manifest: `qa/actors.json` in the WORK repo, canonical form `{"roles": ["role1", "role2"]}`. The manifest declares *which* roles exist; the secret files supply *credentials* for each. Drift between the two = `env_error`.

If `workflow-qa` is required but `qa/actors.json` is missing, OR any role in the manifest has no matching secret file, OR any role declared in the workflow source is absent from the manifest, exit with `qa_status: env_error` and mailbox `tshepo.md` listing the missing entries. Never run workflow-qa with partial credentials — it produces silent false passes (untested edges look indistinguishable from passed edges).

To configure or rotate credentials on the host machine, run `cstack-qa-secrets-init` and follow the prompts. The agent never asks the user for credentials at runtime — the supervisor injects them as env vars.

## ⟨CALLBACK: verification gates⟩ → verdicts
- **Pass** → `qa_status: passed`.
- **Fail** → `qa_status: failed`, reopen `status: open`, `failure_count` +1 (at 3 → `needs_human`). Mailbox the row's last `claimed_by` with: flow, step, expected vs actual, log excerpt (no secrets).
- **Environment failure** (staging down, test user locked, DB drift) → `qa_status: env_error`, leave `status: done`, NO failure_count change. Human must fix environment.
Never pass on partial runs or skipped specs.

## ⟨CALLBACK: completion columns⟩
`qa_status` verdict as above. Commit: `qa(<task-id>): <passed|failed|env_error>`. No PR.

## PROGRESS.md entry format
```
## $AGENT_NAME (QA) | <ISO timestamp> | <task-id>
- E2E: <passed|failed|env_error>
- Flows tested: <list>
- Failure detail: <if any — step, expected, actual>
```

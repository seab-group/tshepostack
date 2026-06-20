---
repo: tshepostack
domain: be
done_check: -
e2e_check: -
lease_hours: 3
ready: true
---
# CONS-005 — server.ts: POST /api/draft-decision with Anthropic SDK streaming + abort

## Traceability
- Requirement: ad hoc — sourced from docs/designs/AGENT_CONSOLE.md, T5
- Repo: tshepostack
- Domain: be

## Context
The Human Attention Queue shows blocked tasks. To help the operator decide fast, the console calls Claude API and streams a suggested decision into the card. The endpoint `POST /api/draft-decision` takes task context (task spec, agent note, ACs) and streams token-by-token via SSE back to the browser. When the browser disconnects (tab closed, reject clicked), the Anthropic SDK stream must be aborted so tokens stop being consumed. If `ANTHROPIC_API_KEY` is not set, the endpoint returns 503 with a clear message.

## Acceptance criteria
- AC1: Given `ANTHROPIC_API_KEY` is set in the server environment, When `POST /api/draft-decision` is called with `{taskId, agentName, context}`, Then the server streams tokens from the Anthropic API as SSE `data:` events until the message is complete.
- AC2: Given the browser closes the connection mid-stream, When the Hono SSE writer's `onAbort` callback fires, Then `controller.abort()` is called on the AbortController passed to the Anthropic SDK — no further API tokens are consumed.
- AC3: Given `ANTHROPIC_API_KEY` is not set, When `POST /api/draft-decision` is called, Then the server returns HTTP 503 with `{"error":"AI drafts unavailable — set ANTHROPIC_API_KEY in your environment"}`.
- AC4: Given the streaming completes normally (not aborted), When the last token arrives, Then the SSE stream closes with a `data: [DONE]` sentinel event.
- AC5: Given the Anthropic API returns an error (invalid key, rate limit), When the error occurs during streaming, Then the server sends an SSE `data: {"error":"..."}` event and closes the stream gracefully — does not crash the server.

## AC → verification mapping
| AC | Verified by | Type |
|---|---|---|
| AC1 | Open console; click "AI Draft" on a blocked task; confirm text appears word-by-word in the draft panel | human-verify |
| AC2 | Click "AI Draft"; while streaming is in progress, close the browser tab; check server logs — confirm Anthropic SDK stream is aborted within 1s (no continued log output) | human-verify |
| AC3 | Unset `ANTHROPIC_API_KEY`; restart server; `curl -X POST http://127.0.0.1:7842/api/draft-decision -d '{}'`; confirm HTTP 503 with the exact message | human-verify |
| AC4 | Click "AI Draft" and wait for completion; confirm SSE stream in DevTools ends with `[DONE]` event | human-verify |
| AC5 | Set `ANTHROPIC_API_KEY=invalid`; click "AI Draft"; confirm error event appears in draft panel instead of crash | human-verify |

## Out of scope
- Caching draft decisions (each click generates a fresh call)
- Model selection UI (hardcode to `claude-haiku-4-5-20251001` for cost control)
- Draft storage or retrieval after page reload

## Constraints
- Use `@anthropic-ai/sdk` (already a dependency of tshepostack) — do not add a new HTTP client
- AbortController: instantiate per-request, pass to `client.messages.stream({...signal:controller.signal})`
- Hook Hono SSE writer abort: `writer.onAbort(() => controller.abort())`
- Model: `claude-haiku-4-5-20251001` — not claude-sonnet (cost control for draft suggestions)
- Do not log the full prompt or response — ANTHROPIC_API_KEY must never appear in logs

## Definition of done (auto-summary)
All done_check + e2e_check mapped tests pass, full regression passes, every human-verify AC is listed in the PR description with evidence, contract snapshot unchanged or change authorized below.

- Contract change authorized: no

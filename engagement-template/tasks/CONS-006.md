---
repo: tshepostack
domain: fe
done_check: -
e2e_check: -
lease_hours: 3
blocked_by: CONS-004
ready: true
---
# CONS-006 — index.html: Full UI polish from design review

## Traceability
- Requirement: ad hoc — sourced from docs/designs/AGENT_CONSOLE.md, T6 (expanded by /plan-design-review 2026-06-19)
- Repo: tshepostack
- Domain: fe

## Context
The authoritative v0 wireframe is at `/tmp/gstack-console-v0.html` — implement from it, not from `/tmp/gstack-sketch-console.html` (that is the v1 sidebar design). This task applies the 7-decision set from the design review: all interaction states, card animations, AI draft panel layout, failure count badge, keyboard navigation, SSE reconnect banner, and dynamic tab title. The UI design specification is in `docs/designs/AGENT_CONSOLE.md` under "## UI Design Specification". Blocked by CONS-004 (SSE push) because the card slide-in animation is triggered by SSE events.

## Acceptance criteria
- AC1: Given the Approval Queue has no pending items, When the page loads, Then the section shows "No pending approvals" (empty state), not a blank area.
- AC2: Given both queues are empty simultaneously, When the page loads, Then a "All clear — agents are running." banner is visible spanning both queue areas.
- AC3: Given a new approval card arrives via SSE, When it is inserted into the DOM, Then it has the `card-new` class and the `slideIn 250ms` animation plays.
- AC4: Given the operator clicks Approve or Reject, When the click fires, Then: (a) the button shows a spinner and is disabled immediately (double-click protection); (b) on server response the card gets `card-exit` class and fades out in 150ms before DOM removal.
- AC5: Given the Human Attention Queue has a task with `failure_count >= 2`, When the card renders, Then an amber pill badge (⚠ icon + "blocked N times") appears in the card's meta row (top-right area alongside agent/task/timer info).
- AC6: Given the AI draft panel is rendered inside a Human Attention card, When expanded, Then it shows: (a) a collapsible container below the AC context; (b) an amber "AI draft — review before sending" disclaimer badge always visible when expanded; (c) a streaming text div for the draft; (d) a "Use this draft ↑" ghost button that copies text to the textarea below.
- AC7: Given the textarea for human decision receives a label, When the page is inspected, Then the label is a visible `<label>` element (not placeholder-only text) and the textarea has `aria-required="true"`.
- AC8: Given the approval/unblock queue has N > 0 pending items, When the page title is read, Then `document.title` is `(N) Fleet Console`; when all clear, it is `Fleet Console — All clear`.
- AC9: Given the SSE connection drops (server restart), When reconnection is pending, Then an amber banner "Connection lost — reconnecting…" appears at the top of the page; it disappears when SSE reconnects.
- AC10: Given the Approve button is focused via keyboard Tab, When Enter is pressed, Then the approval fires (same as click) — keyboard accessible.

## AC → verification mapping
| AC | Verified by | Type |
|---|---|---|
| AC1 | Stop all agents; open console; confirm "No pending approvals" text in Approval Queue section | human-verify |
| AC2 | Stop all agents; confirm "All clear" banner spans both sections | human-verify |
| AC3 | With console open: trigger an approval request; confirm card slides in (animation visible in browser) | human-verify |
| AC4 | Click Approve on a card; confirm spinner appears immediately and card fades after response | human-verify |
| AC5 | Create a mock attention card with `failure_count: 3`; confirm amber badge appears with "blocked 3 times" | human-verify |
| AC6 | Click "AI Draft" on an attention card; confirm panel expands, disclaimer badge visible, streaming text appears, "Use this draft ↑" populates textarea | human-verify |
| AC7 | Inspect DOM: textarea label is a `<label>` element; textarea has `aria-required="true"` | human-verify |
| AC8 | With 2 pending approvals: confirm browser tab title shows "(2) Fleet Console"; after approving both: "Fleet Console — All clear" | human-verify |
| AC9 | Kill server process; confirm amber reconnect banner appears in browser; restart server; banner disappears | human-verify |
| AC10 | Tab to Approve button; press Enter; confirm approval fires | human-verify |

## Out of scope
- Sidebar, tabs, status strip, cost bar — those are v1 features; v0 is single-column only
- Fleet broadcast input — deferred to v1 (see TODOS.md D2.4)
- macOS push notifications — server-side only (CONS-002), no browser notification API
- Dark/light theme toggle — dark only per DESIGN.md

## Constraints
- Source wireframe: `/tmp/gstack-console-v0.html` — use as the authoritative visual reference
- Card animations: `.card-new { animation: slideIn 250ms var(--ease-enter) }`, `.card-exit { animation: fadeOut 150ms forwards }`
- Design tokens: all from `docs/DESIGN.md` — do not invent new colors or type sizes
- Do NOT add any new npm dependencies — vanilla JS + htmx only
- ARIA minimum: `<section aria-label="...">` per queue, `<article aria-label="...">` per card, `aria-live="polite"` on timers, `role="alert"` on error states, `role="status"` on empty states

## Definition of done (auto-summary)
All done_check + e2e_check mapped tests pass, full regression passes, every human-verify AC is listed in the PR description with evidence, contract snapshot unchanged or change authorized below.

- Contract change authorized: no

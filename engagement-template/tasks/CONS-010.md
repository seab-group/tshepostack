---
repo: tshepostack
domain: fe
done_check: -
e2e_check: -
lease_hours: 2
ready: true
---
# CONS-010 — styles.css: Design system token corrections

## Traceability
- Requirement: ad hoc — sourced from docs/designs/AGENT_CONSOLE.md, T10 (surfaced by /plan-design-review Pass 5)
- Repo: tshepostack
- Domain: fe

## Context
The original wireframe and styles had two token mismatches against `DESIGN.md`: body font was 14px (should be 16px) and button border-radius was 5px (should be 8px). Font loading was also missing — three typeface CDN links need to be added. The grain texture `body::after` and CSS motion variables are unimplemented. This task corrects all five issues in `supervisor/console/styles.css` and the `<head>` of `index.html`. Reference: `docs/DESIGN.md` is authoritative for all values.

## Acceptance criteria
- AC1: Given `supervisor/console/styles.css`, When `body { font-size: ... }` is inspected, Then the value is `16px` (not 14px).
- AC2: Given `.btn-approve, .btn-reject, .btn-send` (or equivalent button selectors), When `border-radius` is inspected, Then the value is `8px` (not 5px).
- AC3: Given `supervisor/console/index.html`, When the `<head>` is inspected, Then it contains exactly 3 `<link>` tags loading fonts: (a) Satoshi from Fontshare CDN with `display=swap`; (b) DM Sans from Google Fonts with `display=swap`; (c) JetBrains Mono from Google Fonts with `display=swap`.
- AC4: Given `supervisor/console/styles.css`, When `body::after` is inspected, Then it contains an SVG `feTurbulence` grain texture with `opacity: 0.03`, `position: fixed`, `z-index: 9999`, and `pointer-events: none`.
- AC5: Given `supervisor/console/styles.css`, When the `:root` block is inspected, Then it defines all 5 motion variables: `--dur-micro: 75ms`, `--dur-short: 150ms`, `--dur-medium: 250ms`, `--ease-enter: cubic-bezier(0.16,1,0.3,1)`, and `--ease-exit: cubic-bezier(0.7,0,0.84,0)`.

## AC → verification mapping
| AC | Verified by | Type |
|---|---|---|
| AC1 | Open console in browser; DevTools → Elements → `body` → Computed → font-size = 16px | human-verify |
| AC2 | DevTools → Elements → any button → Computed → border-radius = 8px | human-verify |
| AC3 | DevTools → Network → filter by "font" or "fontshare\|google" → confirm 3 requests for Satoshi, DM Sans, JetBrains Mono | human-verify |
| AC4 | DevTools → Elements → `body::after` pseudo-element visible; Computed → opacity ~0.03, position: fixed, pointer-events: none | human-verify |
| AC5 | DevTools → Elements → `:root` → Custom properties → confirm all 5 motion vars present with correct values | human-verify |

## Out of scope
- Color token changes — all color values already match DESIGN.md
- Adding new UI components — this task is corrections only
- Removing existing styles that happen to use old values (update in place)

## Constraints
- Source of truth: `docs/DESIGN.md` — if any value in this spec conflicts with DESIGN.md, DESIGN.md wins
- Font CDN URLs: Satoshi via `https://api.fontshare.com/v2/css?f[]=satoshi@700,500,400&display=swap`; DM Sans + JetBrains Mono from `https://fonts.googleapis.com`
- Grain texture body::after: use the SVG feTurbulence approach from the v0 wireframe `/tmp/gstack-console-v0.html` — not a PNG background image
- CSS vars must be in `:root` (not `html` or `body`) for htmx compatibility
- Do not remove existing button styles; add/update only the `border-radius` and `font-size` declarations

## Definition of done (auto-summary)
All done_check + e2e_check mapped tests pass, full regression passes, every human-verify AC is listed in the PR description with evidence, contract snapshot unchanged or change authorized below.

- Contract change authorized: no

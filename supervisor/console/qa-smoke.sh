#!/usr/bin/env bash
# supervisor/console/qa-smoke.sh
# Smoke-tests the Fleet Console web UI for key DOM elements and captures a screenshot.
# Usage: bash supervisor/console/qa-smoke.sh
# Env: QA_BASE_URL (default: http://localhost:7842), BROWSE_BIN (default: gstack)

BROWSE_BIN="${BROWSE_BIN:-gstack}"
QA_BASE_URL="${QA_BASE_URL:-http://localhost:7842}"
SCREENSHOT="/tmp/console-qa-$(date +%s).png"

pass=0
fail=0

_ok()   { printf '  ok    %s\n' "$1"; pass=$((pass + 1)); }
_fail() { printf '  FAIL  %s\n' "$1" >&2; fail=$((fail + 1)); }

# AC5: verify the browse binary is available before doing anything else
if ! command -v "$BROWSE_BIN" >/dev/null 2>&1; then
  echo "gstack browse not found — install gstack or set BROWSE_BIN" >&2
  exit 1
fi

echo "=== Fleet Console smoke test ==="
echo "  URL:     $QA_BASE_URL"
echo "  Browser: $BROWSE_BIN"
echo ""

# AC1a: navigate to the console
"$BROWSE_BIN" goto "$QA_BASE_URL"

# AC1b: page title contains "Fleet Console"
TITLE=$("$BROWSE_BIN" js "document.title")
if echo "$TITLE" | grep -q "Fleet Console"; then
  _ok "page title contains 'Fleet Console' (got: $TITLE)"
else
  _fail "page title should contain 'Fleet Console' (got: $TITLE)"
fi

# AC1c: nav[role=tablist] is visible
VIS=$("$BROWSE_BIN" is visible "nav[role=tablist]")
if [ "$VIS" = "true" ]; then
  _ok "nav[role=tablist] is visible"
else
  _fail "nav[role=tablist] is not visible (got: $VIS)"
fi

# AC1d: Fleet tab button is present (checked via JS for text content)
FLEET_TAB=$("$BROWSE_BIN" js "Array.from(document.querySelectorAll('button[role=\"tab\"]')).some(function(b){return b.textContent.trim()==='Fleet';}) ? 'true' : 'false'")
if [ "$FLEET_TAB" = "true" ]; then
  _ok "Fleet tab button is present"
else
  _fail "Fleet tab button is not present"
fi

# AC1e / AC2: take screenshot and print path so QA can attach it as evidence
"$BROWSE_BIN" screenshot "$SCREENSHOT"
echo "Screenshot: $SCREENSHOT"
echo ""

# ── T6 AC1: fleet avatar src contains dicebear.com ──
# Inject a mock agent row by calling renderFleet() directly
"$BROWSE_BIN" js "renderFleet([{name:'agent-qa',state:'working',task:'T6',sessionStart:new Date(Date.now()-125000).toISOString(),lastTool:'bash',lastSummary:'testing',ended:false}], Date.now()-125000)"
AVATAR_SRC=$("$BROWSE_BIN" js "var img=document.querySelector('.fleet-avatar');img?img.src:'none'")
if echo "$AVATAR_SRC" | grep -q "dicebear"; then
  _ok "T6 AC1: fleet avatar src contains dicebear.com (got: $AVATAR_SRC)"
else
  _fail "T6 AC1: fleet avatar src should contain dicebear.com (got: $AVATAR_SRC)"
fi

# ── T6 AC2: fleet elapsed time contains 'm' or 'h' ──
ELAPSED=$("$BROWSE_BIN" js "var el=document.querySelector('.fleet-elapsed');el?el.textContent.trim():'none'")
if echo "$ELAPSED" | grep -qE "[mh]"; then
  _ok "T6 AC2: fleet elapsed time contains 'm' or 'h' (got: $ELAPSED)"
else
  _fail "T6 AC2: fleet elapsed time should contain 'm' or 'h' (got: $ELAPSED)"
fi

# ── T6 AC4: approval card renders with HIGH badge ──
"$BROWSE_BIN" js "switchTab('queue')"
"$BROWSE_BIN" js "window.__injectApproval({id:'qa-appr-1',agent:'agent-qa',command:'rm -rf /prod',risk:'high',action_type:'DELETE',description:'Removes production data'})"
HIGH_BADGE=$("$BROWSE_BIN" js "document.querySelector('.risk-high')?'true':'false'")
if [ "$HIGH_BADGE" = "true" ]; then
  _ok "T6 AC4: approval card renders with HIGH risk badge"
else
  _fail "T6 AC4: approval card should have HIGH risk badge"
fi

# ── T6 AC5: attention card renders with Unblock button ──
"$BROWSE_BIN" js "window.__injectAttention({id:'qa-attn-1',agent:'agent-qa',task_id:'T6',agent_note:'Need decision on blocker',title:'T6 blocked'})"
UNBLOCK_BTN=$("$BROWSE_BIN" js "document.querySelector('.btn-unblock')?'true':'false'")
if [ "$UNBLOCK_BTN" = "true" ]; then
  _ok "T6 AC5: attention card renders with Unblock button"
else
  _fail "T6 AC5: attention card should have Unblock button"
fi

printf '=== Results: %d passed, %d failed ===\n' "$pass" "$fail"
[ "$fail" -eq 0 ]

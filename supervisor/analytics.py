#!/usr/bin/env python3
"""
analytics.py — cstack fleet cost and performance analytics

Usage:
  python3 analytics.py [--days N] [--today] [--agent NAME] [--json]

Reads METRICS.jsonl from the metrics branch of any agent's metrics-wt,
or from METRICS_FILE env var. Outputs a structured report covering:

  - Cost breakdown: input / cache-write / cache-read / output tokens
  - Per-agent summary with efficiency metrics
  - Session duration analysis and bottlenecks
  - Waste identification (idle loops, session limits, timeouts, env errors)
  - Optimisation recommendations ranked by potential savings

Pricing (Sonnet 4.6, per million tokens):
  Input:        $3.00
  Cache write:  $3.75  (1.25× input)
  Cache read:   $0.30  (0.10× input)
  Output:      $15.00
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ── Pricing ────────────────────────────────────────────────────────────────────
PRICE = {
    "input":         3.00  / 1_000_000,
    "cache_write":   3.75  / 1_000_000,
    "cache_read":    0.30  / 1_000_000,
    "output":       15.00  / 1_000_000,
}

# ── Helpers ────────────────────────────────────────────────────────────────────

def fmt_cost(c, dash_zero=False):
    if c is None: return "  -    "
    if dash_zero and c == 0: return "  -    "
    return f"${c:.4f}"

def fmt_dur(s):
    if s is None or s == 0: return "-"
    if s >= 3600: return f"{s//3600}h{(s%3600)//60:02d}m"
    if s >= 60:   return f"{s//60}m{s%60:02d}s"
    return f"{s}s"

def fmt_tok(n):
    if n is None or n == 0: return "-"
    if n >= 1_000_000: return f"{n/1_000_000:.2f}M"
    if n >= 1_000:     return f"{n/1_000:.1f}K"
    return str(n)

def pct(num, den):
    if not den: return 0.0
    return num / den * 100

def compute_cost(inp, cw, cr, out):
    return (
        (inp or 0) * PRICE["input"] +
        (cw  or 0) * PRICE["cache_write"] +
        (cr  or 0) * PRICE["cache_read"] +
        (out or 0) * PRICE["output"]
    )

RESET = "\033[0m"
BOLD  = "\033[1m"
RED   = "\033[31m"
GRN   = "\033[32m"
YLW   = "\033[33m"
CYN   = "\033[36m"
DIM   = "\033[2m"

def h1(text): print(f"\n{BOLD}{text}{RESET}")
def h2(text): print(f"\n{CYN}{text}{RESET}")
def warn(text): print(f"  {YLW}⚠  {text}{RESET}")
def ok(text):   print(f"  {GRN}✓  {text}{RESET}")
def bad(text):  print(f"  {RED}✗  {text}{RESET}")
def dim(text):  print(f"  {DIM}{text}{RESET}")

# ── Load metrics ────────────────────────────────────────────────────────────────

def find_metrics_file():
    candidates = [
        os.environ.get("METRICS_FILE", ""),
        os.path.expanduser("~/agents/agent-qa/metrics-wt/METRICS.jsonl"),
        os.path.expanduser("~/agents/agent-be/metrics-wt/METRICS.jsonl"),
        os.path.expanduser("~/agents/agent-fe/metrics-wt/METRICS.jsonl"),
        os.path.expanduser("~/agents/agent-doc/metrics-wt/METRICS.jsonl"),
        "METRICS.jsonl",
    ]
    for c in candidates:
        if c and Path(c).is_file():
            return c
    return None

def load_sessions(metrics_file, cutoff, agent_filter=None):
    seen = set()
    sessions = []
    with open(metrics_file) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                m = json.loads(line)
                key = (m["ts"], m["agent"])
                if key in seen:
                    continue
                seen.add(key)
                ts = datetime.fromisoformat(m["ts"].replace("Z", "+00:00"))
                if ts < cutoff:
                    continue
                if agent_filter and m.get("agent") != agent_filter:
                    continue
                m["_ts"] = ts
                sessions.append(m)
            except Exception:
                continue
    return sorted(sessions, key=lambda x: x["_ts"])

# ── Section renderers ────────────────────────────────────────────────────────────

def section_overview(sessions, days_label):
    h1(f"cstack Fleet Analytics — {days_label}")

    total       = len(sessions)
    preskips    = [s for s in sessions if s.get("preskip")]
    real        = [s for s in sessions if not s.get("preskip")]
    productive  = [s for s in real if s.get("outcome") in ("done", "completed_session")]
    no_work     = [s for s in real if s.get("no_work")]
    crashed     = [s for s in real if s.get("exit_code", 0) not in (0,) and not s.get("no_work")]
    rate_lim    = [s for s in real if "session limit" in str(s.get("result", "")).lower()]
    timeouts    = [s for s in real if s.get("exit_code") == 124]
    unrecorded  = [s for s in real if s.get("cost_unrecorded")]

    total_cost   = sum(s.get("cost_usd") or 0 for s in sessions)
    total_dur    = sum(s.get("duration_s") or 0 for s in real)

    print(f"\n  Sessions:     {total:,}  ({len(preskips)} preskipped free, {len(real)} launched claude)")
    print(f"  Productive:   {len(productive):,}  ({pct(len(productive), len(real)):.0f}% of launched)")
    print(f"  Crashed:      {len(crashed):,}  ({pct(len(crashed), len(real)):.0f}%)")
    print(f"  No-work:      {len(no_work):,}  ({pct(len(no_work), len(real)):.0f}%)")
    print(f"  Total cost:   {fmt_cost(total_cost)}")
    print(f"  Total time:   {fmt_dur(total_dur)}")
    if rate_lim:
        print(f"  {YLW}Rate limited: {len(rate_lim)} sessions hit plan quota{RESET}")
    if unrecorded:
        print(f"  {YLW}Unrecorded:   {len(unrecorded)} timeout sessions (cost unknown){RESET}")

    return {
        "total": total, "preskips": preskips, "real": real,
        "productive": productive, "no_work": no_work, "crashed": crashed,
        "rate_lim": rate_lim, "timeouts": timeouts, "unrecorded": unrecorded,
        "total_cost": total_cost, "total_dur": total_dur,
    }


def section_token_cost(sessions):
    h2("Token Cost Breakdown")

    real = [s for s in sessions if not s.get("preskip")]

    # Aggregate token types
    inp  = sum(s.get("input_tokens") or 0 for s in real)
    cw   = sum(s.get("cache_creation_tokens") or 0 for s in real)
    cr   = sum(s.get("cache_read_tokens") or 0 for s in real)
    out  = sum(s.get("output_tokens") or 0 for s in real)
    total_tok = inp + cw + cr + out

    cost_inp = inp * PRICE["input"]
    cost_cw  = cw  * PRICE["cache_write"]
    cost_cr  = cr  * PRICE["cache_read"]
    cost_out = out * PRICE["output"]
    cost_total = cost_inp + cost_cw + cost_cr + cost_out

    # Use actual recorded cost if available (more accurate)
    actual_total = sum(s.get("cost_usd") or 0 for s in real)

    print(f"\n  {'Token type':<22} {'Tokens':>12} {'Share%':>7}  {'Cost':>9}  {'Cost%':>7}  {'Rate/1M'}")
    print(f"  {'-'*22} {'-'*12} {'-'*7}  {'-'*9}  {'-'*7}  {'-'*10}")

    rows = [
        ("Input",        inp, cost_inp,  PRICE["input"],       "$3.00"),
        ("Cache Write",  cw,  cost_cw,   PRICE["cache_write"], "$3.75"),
        ("Cache Read",   cr,  cost_cr,   PRICE["cache_read"],  "$0.30"),
        ("Output",       out, cost_out,  PRICE["output"],      "$15.00"),
    ]
    for name, tok, cost, _, rate in rows:
        tok_pct  = pct(tok, total_tok)
        cost_pct = pct(cost, cost_total) if cost_total else 0
        flag = ""
        if name == "Cache Write" and cost_pct > 25:
            flag = f"  {YLW}←{RESET}"
        if name == "Output" and cost_pct > 50:
            flag = f"  {RED}← high{RESET}"
        print(f"  {name:<22} {fmt_tok(tok):>12} {tok_pct:>6.1f}%  {fmt_cost(cost):>9}  {cost_pct:>6.1f}%  {rate}{flag}")

    print(f"  {'─'*22} {'─'*12} {'─'*7}  {'─'*9}")
    print(f"  {'Total (computed)':<22} {fmt_tok(total_tok):>12} {'100%':>7}  {fmt_cost(cost_total):>9}")
    if actual_total and abs(actual_total - cost_total) > 0.001:
        print(f"  {'Total (actual billed)':<22} {'':>12} {'':>7}  {fmt_cost(actual_total):>9}")

    # Cache efficiency
    if cw > 0 or cr > 0:
        cache_hit_rate = pct(cr, cw + cr)
        print(f"\n  Cache hit rate: {cache_hit_rate:.1f}%  (read {fmt_tok(cr)} / wrote {fmt_tok(cw)})")
        if cache_hit_rate > 80:
            ok("Excellent cache reuse — prompt caching is working well")
        elif cache_hit_rate > 50:
            warn("Moderate cache reuse — consider longer-lived agents for better hit rate")
        else:
            bad("Low cache hit rate — writing cache but not reading it back (agent restarts?)")


def section_per_agent(sessions):
    h2("Per-Agent Summary")

    real = [s for s in sessions if not s.get("preskip")]
    agents = defaultdict(list)
    for s in real:
        agents[s.get("agent", "unknown")].append(s)

    print(f"\n  {'Agent':<14} {'Sessions':>9} {'Productive':>11} {'Cost':>9} {'CacheW':>8} {'CacheR':>10} {'Output':>8} {'AvgDur':>8} {'TotalDur':>9}")
    print(f"  {'─'*14} {'─'*9} {'─'*11} {'─'*9} {'─'*8} {'─'*10} {'─'*8} {'─'*8} {'─'*9}")

    agent_stats = []
    for agent, ss in sorted(agents.items()):
        productive  = [s for s in ss if s.get("outcome") in ("done", "completed_session")]
        cost        = sum(s.get("cost_usd") or 0 for s in ss)
        cw          = sum(s.get("cache_creation_tokens") or 0 for s in ss)
        cr          = sum(s.get("cache_read_tokens") or 0 for s in ss)
        out         = sum(s.get("output_tokens") or 0 for s in ss)
        durs        = [s.get("duration_s") or 0 for s in ss if s.get("duration_s")]
        total_dur   = sum(durs)
        avg_dur     = sum(durs) // len(durs) if durs else 0
        agent_stats.append((agent, ss, productive, cost, cw, cr, out, avg_dur, total_dur))
        print(f"  {agent:<14} {len(ss):>9,} {len(productive):>11,} {fmt_cost(cost):>9} {fmt_tok(cw):>8} {fmt_tok(cr):>10} {fmt_tok(out):>8} {fmt_dur(avg_dur):>8} {fmt_dur(total_dur):>9}")

    return agent_stats


def section_duration_analysis(sessions):
    h2("Session Duration Analysis")

    real = [s for s in sessions if not s.get("preskip") and (s.get("duration_s") or 0) > 0]
    if not real:
        print("  No duration data.")
        return

    durs = sorted(s.get("duration_s", 0) for s in real)
    p50  = durs[len(durs)//2]
    p90  = durs[int(len(durs)*0.9)]
    p99  = durs[int(len(durs)*0.99)]
    maximum = durs[-1]

    print(f"\n  Percentiles (all launched sessions):  p50={fmt_dur(p50)}  p90={fmt_dur(p90)}  p99={fmt_dur(p99)}  max={fmt_dur(maximum)}")

    # Bucket by duration
    buckets = [
        ("<10s",    0,    10),
        ("10s–1m",  10,   60),
        ("1–5m",    60,   300),
        ("5–15m",   300,  900),
        ("15–30m",  900,  1800),
        (">30m",    1800, 999999),
    ]
    print(f"\n  {'Bucket':<12} {'Count':>7}  {'%':>6}  Bar")
    for label, lo, hi in buckets:
        n = sum(1 for d in durs if lo <= d < hi)
        bar = "█" * (n * 30 // max(len(durs), 1))
        print(f"  {label:<12} {n:>7,}  {pct(n,len(durs)):>5.1f}%  {bar}")

    # Long sessions by agent
    long = [s for s in real if (s.get("duration_s") or 0) >= 300 and not s.get("no_work") and not s.get("preskip")]
    if long:
        print(f"\n  Long sessions (≥5 min, real work):")
        print(f"  {'Agent':<14} {'Duration':>9} {'Turns':>7} {'Cost':>9} {'Outcome':<22} {'Task'}")
        for s in sorted(long, key=lambda x: x.get("duration_s",0), reverse=True)[:15]:
            print(f"  {s.get('agent','?'):<14} {fmt_dur(s.get('duration_s')):>9} "
                  f"{str(s.get('num_turns') or '-'):>7} {fmt_cost(s.get('cost_usd')):>9} "
                  f"{s.get('outcome','?'):<22} {s.get('task') or '-'}")


def section_waste(sessions, ov):
    h2("Waste Analysis")

    real     = ov["real"]
    preskips = ov["preskips"]
    crashed  = ov["crashed"]
    rate_lim = ov["rate_lim"]
    timeouts = ov["timeouts"]
    unrecord = ov["unrecorded"]

    waste_items = []

    # 1. Rate limit crash loops
    rl_loops = [s for s in crashed if "session limit" in str(s.get("result","")).lower()
                or s.get("exit_code") == 1]
    rapid = [s for s in rl_loops if (s.get("duration_s") or 0) < 5]
    if rapid:
        dur_wasted = sum(s.get("duration_s",0) for s in rapid)
        waste_items.append(("RATE-LIMIT CRASH LOOP", len(rapid),
            f"{len(rapid)} rapid restarts ({fmt_dur(dur_wasted)} thrashing)",
            "$0 direct but blocked all work",
            "Supervisor now sleeps until reset — fixed"))

    # 2. Timeout sessions with unrecorded cost
    if unrecord:
        turns = sum(s.get("num_turns") or 0 for s in unrecord)
        waste_items.append(("TIMEOUT (unrecorded cost)", len(unrecord),
            f"{len(unrecord)} sessions killed before cost event emitted ({turns} turns unrecorded)",
            "Unknown — cost_unrecorded flag now set",
            "SESSION_TIMEOUT raised: QA→30m, FE/BE→15m — fixed"))

    # 3. env_error sessions
    env_err = [s for s in real if s.get("outcome") == "crashed" and
               "env_error" in str(s.get("result","")).lower()]
    if not env_err:
        env_err = [s for s in real if "env_error" in str(s.get("result","")).lower()]
    if env_err:
        cost = sum(s.get("cost_usd") or 0 for s in env_err)
        waste_items.append(("ENV_ERROR SESSIONS", len(env_err),
            "QA agent ran but app/staging unreachable",
            fmt_cost(cost),
            "Ensure QA_BASE_URL is reachable before tasks enter QA stage"))

    # 4. Sessions that ran claude for no_work (bypassed preskip)
    no_work_full = [s for s in real if s.get("no_work") and not s.get("preskip")]
    if no_work_full:
        cost = sum(s.get("cost_usd") or 0 for s in no_work_full)
        dur  = sum(s.get("duration_s") or 0 for s in no_work_full)
        waste_items.append(("IDLE CLAUDE SESSIONS", len(no_work_full),
            f"Claude launched but found no work ({fmt_dur(dur)} spent)",
            fmt_cost(cost),
            "IDLE_PRESKIP=1 catches these — check why kernel eligible failed before preskip"))

    # 5. Stale claim idle periods (inferred from crash loops + context)
    # Already handled above

    if not waste_items:
        ok("No significant waste detected.")
        return

    print()
    for title, n, desc, cost_str, fix in waste_items:
        print(f"  {RED}▶ {title}{RESET}  (n={n})")
        print(f"      What:  {desc}")
        print(f"      Cost:  {cost_str}")
        print(f"      Fix:   {fix}")
        print()


def section_bottlenecks(sessions, agent_stats):
    h2("Bottlenecks")

    real = [s for s in sessions if not s.get("preskip")]
    print()

    issues = []

    # High output token sessions (model writing a lot = expensive + slow)
    high_out = sorted(
        [s for s in real if (s.get("output_tokens") or 0) > 5000],
        key=lambda x: x.get("output_tokens", 0), reverse=True
    )[:5]
    if high_out:
        print(f"  High output-token sessions (most expensive to generate):")
        print(f"  {'Agent':<14} {'Task':<14} {'Output':>9} {'Cost':>9} {'Outcome'}")
        for s in high_out:
            print(f"  {s.get('agent','?'):<14} {str(s.get('task') or '-'):<14} "
                  f"{fmt_tok(s.get('output_tokens')):>9} {fmt_cost(s.get('cost_usd')):>9} "
                  f"{s.get('outcome','?')}")
        issues.append(f"Output tokens are ${PRICE['output']*1e6:.0f}/M — "
                      f"high-turn QA/doc sessions drive most spend")

    # High cache write sessions (writing large context repeatedly)
    high_cw = sorted(
        [s for s in real if (s.get("cache_creation_tokens") or 0) > 50_000],
        key=lambda x: x.get("cache_creation_tokens", 0), reverse=True
    )[:5]
    if high_cw:
        print(f"\n  High cache-write sessions (paying to prime the cache):")
        print(f"  {'Agent':<14} {'Task':<14} {'CacheWrite':>11} {'WriteCost':>10} {'ReadBack':>10}")
        for s in high_cw:
            cw   = s.get("cache_creation_tokens") or 0
            cr   = s.get("cache_read_tokens") or 0
            # Was the cache write worth it? Compare write cost vs what reads saved vs fresh input
            write_cost = cw * PRICE["cache_write"]
            read_cost  = cr * PRICE["cache_read"]
            fresh_cost = (cw + cr) * PRICE["input"]
            saved      = fresh_cost - (write_cost + read_cost)
            print(f"  {s.get('agent','?'):<14} {str(s.get('task') or '-'):<14} "
                  f"{fmt_tok(cw):>11} {fmt_cost(write_cost):>10} {fmt_tok(cr):>10}  "
                  f"{'saved '+fmt_cost(saved) if saved>0 else 'no reads yet'}")

    # Multi-attempt tasks (taking multiple sessions)
    tasks = defaultdict(list)
    for s in real:
        if s.get("task") and s.get("cost_usd"):
            tasks[s["task"]].append(s)
    multi = [(t, ss) for t, ss in tasks.items() if len(ss) > 1]
    if multi:
        print(f"\n  Multi-session tasks (retries / timeouts / handoffs):")
        print(f"  {'Task':<14} {'Sessions':>9} {'Total cost':>11} {'Done?':>6} {'Reason'}")
        for task, ss in sorted(multi, key=lambda x: len(x[1]), reverse=True):
            done    = any(s.get("outcome") == "done" for s in ss)
            cost    = sum(s.get("cost_usd") or 0 for s in ss)
            reasons = set(s.get("outcome","?") for s in ss)
            print(f"  {task:<14} {len(ss):>9} {fmt_cost(cost):>11} {'Yes' if done else 'No':>6}  {', '.join(reasons)}")

    if issues:
        print()
        for issue in issues:
            warn(issue)


def section_recommendations(sessions, ov, agent_stats):
    h2("Optimisation Recommendations")

    real      = ov["real"]
    total_cost = ov["total_cost"]
    recs = []

    # 1. Cache hit rate
    cw_total = sum(s.get("cache_creation_tokens") or 0 for s in real)
    cr_total = sum(s.get("cache_read_tokens") or 0 for s in real)
    if cw_total > 0:
        hit_rate = pct(cr_total, cw_total + cr_total)
        cw_cost  = cw_total * PRICE["cache_write"]
        cr_cost  = cr_total * PRICE["cache_read"]
        # Potential: if all cache writes got read back fully
        potential_reads = cw_total * PRICE["cache_read"]
        if hit_rate < 60:
            recs.append((
                cw_cost * 0.3,
                f"Cache hit rate {hit_rate:.0f}% is low — agents restart too often",
                "Keep agents running longer between restarts (reduce crash loops, fix rate limit sleep). "
                "Each restart writes a fresh cache instead of reading the existing one."
            ))

    # 2. Output tokens dominate
    out_cost = sum((s.get("output_tokens") or 0) * PRICE["output"] for s in real)
    if out_cost > total_cost * 0.15:
        # High-output sessions: maybe tasks are too large
        high_turn = [s for s in real if (s.get("num_turns") or 0) > 100]
        if high_turn:
            recs.append((
                out_cost * 0.2,
                f"Output tokens are {pct(out_cost, total_cost):.0f}% of spend ({len(high_turn)} sessions >100 turns)",
                "Break large tasks into smaller ACs. Sessions >100 turns are doing too much in one shot — "
                "split acceptance criteria across separate task entries."
            ))

    # 3. env_error sessions
    env_err = [s for s in real if "env_error" in str(s.get("result","")).lower()]
    if env_err:
        cost = sum(s.get("cost_usd") or 0 for s in env_err)
        recs.append((
            cost,
            f"{len(env_err)} env_error sessions — QA running against unreachable app ({fmt_cost(cost)})",
            "Add a preflight check in QA_ROLE.md: curl $QA_BASE_URL before claiming tasks. "
            "If unreachable, exit early and email/message for human intervention rather than burning a full session."
        ))

    # 4. Idle sessions that bypassed preskip
    no_work_full = [s for s in real if s.get("no_work") and not s.get("preskip")]
    if no_work_full:
        cost = sum(s.get("cost_usd") or 0 for s in no_work_full)
        recs.append((
            cost,
            f"{len(no_work_full)} sessions launched claude just to say 'no work' ({fmt_cost(cost)})",
            "Verify IDLE_PRESKIP=1 is active. These sessions mean the preskip kernel check "
            "returned non-3 (eligible or error) but claude still found nothing — check kernel/task eligible."
        ))

    # 5. Unrecorded costs
    unrecord = [s for s in real if s.get("cost_unrecorded")]
    if unrecord:
        turns = sum(s.get("num_turns") or 0 for s in unrecord)
        recs.append((
            turns * 0.01,  # rough estimate
            f"{len(unrecord)} sessions with unrecorded cost ({turns} turns before timeout)",
            "SESSION_TIMEOUT has been raised. But also consider: if a task consistently times out, "
            "the task spec is too large. Split it so QA can complete in one session."
        ))

    # 6. Rate limit thrashing
    rl = [s for s in real if s.get("exit_code") == 1 and (s.get("duration_s") or 0) < 5]
    if len(rl) > 10:
        waste_time = sum(s.get("duration_s", 0) for s in rl)
        recs.append((
            0,
            f"{len(rl)} rapid crash-loop restarts wasted {fmt_dur(waste_time)} ({pct(len(rl), len(real)):.0f}% of sessions)",
            "Supervisor now detects 'session limit' and sleeps until reset. "
            "Ensure this fix is deployed on all agents."
        ))

    if not recs:
        ok("No optimisation opportunities identified.")
        return

    recs.sort(key=lambda x: x[0], reverse=True)
    print()
    for i, (saving, title, detail) in enumerate(recs, 1):
        saving_str = f"  potential saving: ~{fmt_cost(saving)}" if saving > 0.001 else ""
        print(f"  {BOLD}[{i}] {title}{RESET}{saving_str}")
        # Wrap detail at ~80 chars
        words = detail.split()
        line = "       "
        for w in words:
            if len(line) + len(w) > 88:
                print(line)
                line = "       " + w + " "
            else:
                line += w + " "
        if line.strip():
            print(line)
        print()


def section_daily_trend(sessions):
    h2("Daily Trend")

    by_day = defaultdict(list)
    for s in sessions:
        if s.get("preskip"):
            continue
        day = s["_ts"].date().isoformat()
        by_day[day].append(s)

    if not by_day:
        return

    print(f"\n  {'Date':<12} {'Sessions':>9} {'Prod':>6} {'Cost':>10} {'CacheW':>10} {'CacheR':>10} {'Output':>9} {'Dur':>9}")
    print(f"  {'─'*12} {'─'*9} {'─'*6} {'─'*10} {'─'*10} {'─'*10} {'─'*9} {'─'*9}")
    for day in sorted(by_day):
        ss   = by_day[day]
        prod = sum(1 for s in ss if s.get("outcome") in ("done", "completed_session"))
        cost = sum(s.get("cost_usd") or 0 for s in ss)
        cw   = sum(s.get("cache_creation_tokens") or 0 for s in ss)
        cr   = sum(s.get("cache_read_tokens") or 0 for s in ss)
        out  = sum(s.get("output_tokens") or 0 for s in ss)
        dur  = sum(s.get("duration_s") or 0 for s in ss)
        print(f"  {day:<12} {len(ss):>9,} {prod:>6} {fmt_cost(cost):>10} {fmt_tok(cw):>10} {fmt_tok(cr):>10} {fmt_tok(out):>9} {fmt_dur(dur):>9}")


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="cstack fleet analytics")
    parser.add_argument("--days",  type=int, default=7, help="look-back window in days (default 7)")
    parser.add_argument("--today", action="store_true", help="today only (local UTC+2)")
    parser.add_argument("--agent", type=str, default=None, help="filter to one agent")
    parser.add_argument("--json",  action="store_true", help="output raw aggregates as JSON")
    args = parser.parse_args()

    metrics_file = find_metrics_file()
    if not metrics_file:
        print("ERROR: no METRICS.jsonl found. Run from an agent metrics-wt or set METRICS_FILE=")
        sys.exit(1)

    if args.today:
        # Today local = UTC+2, so cutoff at midnight UTC+2 = 22:00 UTC yesterday
        now_local = datetime.now(timezone.utc) + timedelta(hours=2)
        midnight  = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
        cutoff    = midnight - timedelta(hours=2)  # back to UTC
        days_label = f"Today ({now_local.strftime('%Y-%m-%d')})"
    else:
        cutoff    = datetime.now(timezone.utc) - timedelta(days=args.days)
        days_label = f"Last {args.days} day{'s' if args.days != 1 else ''}"

    if args.agent:
        days_label += f" · {args.agent}"

    sessions = load_sessions(metrics_file, cutoff, args.agent)
    if not sessions:
        print(f"No sessions found for {days_label}.")
        sys.exit(0)

    if args.json:
        real = [s for s in sessions if not s.get("preskip")]
        print(json.dumps({
            "period": days_label,
            "total_sessions": len(sessions),
            "productive": sum(1 for s in real if s.get("outcome") in ("done","completed_session")),
            "total_cost_usd": sum(s.get("cost_usd") or 0 for s in sessions),
            "input_tokens": sum(s.get("input_tokens") or 0 for s in real),
            "cache_write_tokens": sum(s.get("cache_creation_tokens") or 0 for s in real),
            "cache_read_tokens": sum(s.get("cache_read_tokens") or 0 for s in real),
            "output_tokens": sum(s.get("output_tokens") or 0 for s in real),
        }, indent=2))
        return

    ov = section_overview(sessions, days_label)
    section_token_cost(sessions)
    agent_stats = section_per_agent(sessions)
    section_duration_analysis(sessions)
    section_waste(sessions, ov)
    section_bottlenecks(sessions, agent_stats)
    section_recommendations(sessions, ov, agent_stats)
    section_daily_trend(sessions)

    print()


if __name__ == "__main__":
    main()

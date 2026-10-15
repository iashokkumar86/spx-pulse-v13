# Autotrade Handoff — SPX Pulse V13 (for a fresh session)

Written 2026-10-22. Owner: Ashok. Goal: take the V13 signal engine into
automated execution. He can be at the computer during RTH.

## Read first

- `BACKTEST_HANDOFF.md` — the original research brief (methodology context).
- `backtest/REPORT-2026-10-06.md` — ALL backtest verdicts. The one that
  governs this project: **mechanical V13 earns ~+0.1R/trade pre-cost over
  ten years; SPXW 0DTE vertical friction is ~0.10–0.15R/round trip. The
  mechanical system does not clear option costs; the live profit has been
  rules + operator judgment.** Any automation design must answer to this.
- `SPX_Pulse_V13.ts` — live study, **V13.27** (+ user runs minRewardRisk=0.5).
- `backtest/SPX_Pulse_V13_strategy.pine` — validated Pine port with research
  toggles; the executable spec for a Python port, together with the .ts.
- `SPX_0DTE_Playbook.md` section 0 — current trading rules.

## Live-study state vs validated baseline (important)

V13.27 live = validated V13.24/25 engine PLUS three user-directed, untested
loosenings: no 15:30 exit alert, no 15:15 entry cutoff, R:R floor 0.5
(validated config used 1.5). For automation, START from the validated
configuration (R:R 1.5, 15:30 flat, 15:15 entry cutoff) and treat the
loosenings as experiments to measure on paper, not defaults to inherit.

## Decisions pending (ask Ashok first)

1. **Vehicle** — recommended: MES futures, fully automatic (only vehicle
   where the measured edge plausibly survives costs: ~0.01–0.02R friction,
   1 MES = $5/SPX pt → ~$50–75 risk/trade). Alternatives: SPXW verticals
   semi-auto (signals auto-stage the order, he confirms — keeps the
   operator edge), or SPXW fully-auto (data says it bleeds; paper-only).
2. **Broker** — he has prior IBKR plumbing (see below); confirm the TWS /
   IB Gateway paper account (port 7497) is still active.

## Existing infrastructure to reuse (big head start)

`~/Documents/Codex/2026-08-17/new-chat/` — an August project containing:
- `service/spx_pulse/ibkr.py` — IBKR API client (official ibapi, paper port
  7497), plus `paper_autotrader.py`, `paper_execution.py`, `paper_ledger.py`,
  `paper_runner.py`, `live_quotes.py` and a `.venv`.
- `IBKR_SPX_READINESS_V2.md`, `LOCAL_SPX_READINESS.md` — connectivity
  checklists (TWS login, socket config, read-only API).
- NOTE: that project's `service/spx_pulse/v13.py` is a DIFFERENT older
  engine (shadow-mode specialist router) — do not confuse it with this
  repo's V13. The thinkScript/Pine in THIS repo are the source of truth.
- Massive (api.massive.com) key exists there but the subscription is DEAD —
  do not use that API. Market data must come from IBKR.

## Build plan (phased, agreed in principle)

1. Python port of the V13 signal engine (validated config), driven by IBKR
   real-time 3-min SPX bars + VIX; signal parity checked against the ToS
   chart for a few live days before any orders.
2. Paper automation on the IBKR paper account: full order lifecycle,
   bracket (structure stop / target), 20-bar time stop, 15:30 flat,
   kill switch, daily loss limit, event-day lockout.
3. ≥4 weeks paper. Score against the Pine expectations; measure real
   slippage. Split results by printed-R cohort (≥1.5 vs 0.5–1.5).
4. Live only if paper confirms, at minimum size (1 MES), hard daily stop
   in code. The 0.5-R-floor and late-day loosenings go live only if their
   paper cohorts are positive.

## Process rules carried over

- Engine changes require evidence (both walk-forward halves positive, or
  ≥4 weeks positive paper cohort). Discretionary ideas go through
  pre-commitment + journaling, not code.
- Commit to this repo with clear messages; record any semantic deviation
  from SPX_Pulse_V13.ts in the commit message.
- 2026-10-14 lesson: verify the symbol/chart before trusting any run
  (a Deep Backtest once silently ran on TSLA).

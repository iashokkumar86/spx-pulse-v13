# Backtest Handoff — SPX Pulse V13 (0DTE decision system)

Standalone brief for building a Python backtester of the thinkorswim study in
this repo. Written 2026-10-06. Owner: Ashok (iashokkumar.86@gmail.com).

## Goal

Replicate the decision rules of `SPX_Pulse_V13.ts` (V13.22, SPX-only build) in
Python, run them over 2+ years of SPX 3-minute RTH data, and answer with
numbers what is currently set by judgment:

1. Per-setup expectancy (tags: TREND, ORB, MOMO, LVL, GAPFADE, breakout) —
   win rate, avg R, profit factor, by regime (TREND UP/DOWN, RANGE, UNDECIDED).
2. Optimal `minimumScore` (currently 70, +5 when regime UNDECIDED).
3. Optimal `minRewardRisk` gate (currently 1.5; printed R is room/stop, a ceiling).
4. Whether the EM anti-chase cutoffs (no room credit past 0.85 EM used; trend
   override allowed only inside 1.0 EM) are placed correctly.
5. Regime-gate quality: evidence thresholds (>=3 votes) and whether the
   regime-switched setup weights (30 with-trend / 8 counter in trend regimes,
   flipped in range) are right.
6. Exit engine value: scale-half-at-1R + trail(21 EMA, floor breakeven) +
   60-min time stop on losers + 15:30 hard exit — vs. fixed-target exits.
7. Session windows: is the 12:00–13:00 haircut and 9:45–15:15 entry window right?

Deliverable: a report (win rate / avg R / expectancy / max drawdown / trades
per day, overall and per tag x regime x score-bucket), plus recommended input
values, validated **walk-forward** (tune on the first ~70% of history, report
untouched out-of-sample results on the rest). Assume SPXW 0DTE debit-vertical
execution: risk = 1R normalized; include ~0.05–0.10% slippage/costs per round
trip or model $0.30–0.50 spread width on a 10–15 pt vertical.

## Source of truth

`SPX_Pulse_V13.ts` in this repo (V13.22) is the executable spec. Git history
documents every design decision (read commit messages for rationale). The
`SPX_0DTE_Playbook.md` covers the human execution rules. Key facts:

- Chart basis: SPX, 3-minute bars, RTH only (09:30–16:00 ET), 20 days loaded.
- The study is SPX+VIX only. SPY/VIX1D//ES were REMOVED because the user's
  feed serves them delayed/not-at-all (delayed cross-symbols silently disable
  thinkorswim rendering). For the backtest you MAY reintroduce SPY volume and
  VIX1D as *research variables* (data is historical, delay irrelevant) to
  quantify what the volume filters would add if the user upgrades his feed:
  that is question 8.
- Live build consequences to mirror: RVOL is fixed at 1.0 (participation
  score constant 7), ORB volume gate disabled, VWAP proxy = cumulative session
  TWAP of SPX typical price (H+L+C)/3.

## Rule summary (verify against the .ts; the code wins on any conflict)

- **No lookahead**: candidates evaluate on completed bar t-1; the signal fires
  on bar t only if close(t) continues in the direction (close > prior close
  for calls). Enter at close(t). One signal per side per 10 bars (cooldown).
- **Session**: entries only 09:45–15:15; score x0.85 during 12:00–13:00;
  everything flat at 15:30.
- **Day context**: gap% vs prior close (micro <0.2 / medium /large >0.4,
  fade-vs-go bias, fade thesis dead if <30% filled by 10:30); 15-min opening
  range; expected move = open x (VIX/100)/sqrt(252) (VIX1D if researching);
  level stack = prior day H/L/C, Camarilla R3/R4/S3/S4, prior-day 38.2/50/61.8
  fibs, OR H/L; nearest support/resistance from the stack.
- **Regime votes** (trend up / trend down / range; >=3 and plurality wins,
  else UNDECIDED): gap-and-go x2, first-hour range >0.45 ADR14 with OR break
  x2, beyond prior day H/L, ribbon+10-min ribbon aligned, |EM used| > 0.6,
  GEX tiebreaks; range votes: micro gap, FH range <0.35 ADR, inside prior
  range, |EM used| < 0.35.
- **Setups**: trend pullback (ribbon 8/13/21/48 stacked + 10-min confirm,
  phase agreeing, pullback to 13 EMA — or 8 EMA in confirmed trend regime);
  ORB break/retest of the 15-min range before 12:00; MOMO (close beyond
  session extreme, ribbon+phase+TWAP side agree); level rejection at nearest
  S/R or EM band with SATY-phase conditions; gap fade (micro/medium only);
  compression breakout (21-bar stdev <= ATR, 10-bar range break).
- **Score (0–100)**: setup bucket 30 (regime-weighted, +4 ORB 9:45–10:00),
  trend-alignment 20 (halved in RANGE), location 15, participation 7 (fixed),
  room 10 (EM-aware; trend-regime override at session extremes inside 1 EM),
  GEX 5 (only with manual levels), VIX gate 10. Threshold 70 (+5 UNDECIDED).
- **Geometry gate**: stop = min(3-bar extreme, nearest level) ± 0.25·tol,
  capped at 2.2x ATR(14,3m); target = structure/measured-move capped at ±1 EM,
  clamped to the trade side; require (target-entry)/(entry-stop) >= 1.5.
- **Exits**: half off at +1R, stop to breakeven, remainder trails
  max(breakeven, 21 EMA − 0.25·tol) (mirrored for puts); losers time-stopped
  at 20 bars; hard exit 15:30; stop = close through level.

## Data needed

- SPX (or ES adjusted) 3-minute RTH OHLC, 2+ years. SPY 3-min OHLCV for the
  volume research questions. Daily SPX OHLC for ADR/ATR. Daily VIX close
  (and VIX1D history if obtainable). CPI/FOMC dates to flag event days.

## Sanity anchors (must reproduce approximately)

From live operation (user's journal + screenshots):
- 2026-10-05 (gap-and-go up day): five CALL signals ~11:30, 12:00, ~13:00,
  ~13:45, ~15:00; all reached +1R; regime TREND UP from late morning.
- 2026-10-06 (gap up 0.41%, LARGE): CALL ~10:00 tagged ORB ~3.2R and a MOMO
  CALL ~11:00 ~4.1R; both reached +1R.
- 2026-09-30 .. 10-02: VIX-gated put-side trend days; see journal.

If the Python engine does not produce signals resembling these on those days,
the port is wrong — fix the port before tuning anything.

## Repo

https://github.com/iashokkumar86/spx-pulse-v13 (private). Build the backtester
in a `backtest/` directory here; commit with clear messages; do not modify
`SPX_Pulse_V13.ts` semantics without recording the change and its backtest
justification in the commit message.

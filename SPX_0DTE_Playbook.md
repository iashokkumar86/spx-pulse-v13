# SPX Pulse V13 — 0DTE Playbook

A decision framework around the V13 study. The study finds and scores setups;
this playbook covers what the study cannot: sizing, exits, and when to do
nothing. **The no-trade signal is where the money is.**

---

## 1. What changed from V12.1 and why

| Problem in V12.1 | V13 fix |
|---|---|
| No opening-range logic | 15-min ORB module: breakout + retest signals, 1.5× volume filter, bonus weight 9:45–10:00 (the 66.8% win-rate window per ORB backtests), stale after noon |
| No gap awareness | Gap classifier: micro <0.2% (fills ~87–92% intraday → fade bias), medium 0.2–0.4% (neutral), large >0.4% (fills <50% → gap-and-go, never fade). Fade thesis auto-dies if <30% filled by 10:30 |
| ATR-fib levels were guesswork | Expected-move bands from VIX1D: `open × (VIX1D/100)/√252`. ~68% of sessions stay inside ±1 EM. Calls near +1 EM and puts near −1 EM get zero "room" credit |
| Thin S/R (prior day H/L only) | Full level stack: Camarilla R3/S3/R4/S4, prior day H/L/C, prior-day fib retracements (38.2/50/61.8), OR high/low, optional overnight H/L — nearest support/resistance picked from all of them |
| No pattern detection | Bull/bear flag detector: ≥2×ATR pole in ≤10 bars → 4–15 bar consolidation holding above the 50% retrace with contracting range → breakout close. Target = measured move |
| Static score weights | **Regime gate**: TREND UP / TREND DOWN / RANGE / UNDECIDED from gap behavior + first-hour range vs 14-day ADR + position vs prior range + GEX sign. In trend regimes, momentum setups score 30 and fades score 8; in range regimes it flips. Same setup, different day type, different score — that's the point |
| Momentum triple-counting | EMA ribbon + SATY phase merged into one "trend alignment" bucket (max 20), halved in range regimes |
| No exits | Plotted stop (structure or 2.2×ATR, whichever is tighter), plotted target (nearest opposing level / measured move, capped at ±1 EM), orange time-stop dot at 60 min, 15:30 hard-exit alert |
| Blunt time gate | Entries only 9:45–15:15; lunch (12–1) score haircut; UNDECIDED regime needs +8 score |

## 1b. Chart setup — this matters

Use a **20d : 3m** chart (or 30d : 5m), RTH only. The regime gate needs a
14-day ADR and daily ATR from the daily aggregation; on a 2-day chart those
are NaN and the study falls back to a 1-day approximation (a red diagnostic
label warns you). On a 5-min chart set `timeStopBars = 12` (≈60 min).

## 2. Daily routine

**Before 9:30**
- Enter GEX levels (gamma flip, call wall, put wall) from SpotGamma / zerogex / MenthorQ into the study inputs. Below the flip = negative gamma = trend day fuel; above = positive gamma = mean reversion/pinning.
- Enter overnight high/low from /ES (×ratio to SPX) if you track them.
- Check the calendar: CPI, FOMC, NFP, big earnings (NVDA etc.) → set `eventLockout = yes` until 30+ min after the release.

**9:30–9:45** — watch only. The study is building the opening range and gap stats. No entries.

**9:45–12:00** — prime window. Read the labels left to right: REGIME, GAP, OR, EM used. Take only arrows whose bubble tag matches the regime (ORB/FLAG/TREND arrows on trend days; LVL/GAPFADE arrows on range days — the scoring enforces this, but you are the final filter).

**12:00–13:00** — lunch. Scores are haircut automatically. Default: flat.

**14:00–15:15** — second window. Gamma effects grow; respect the EM "used %" label — above 85% of the expected move, do not chase.

**15:15–15:30** — no new entries. **15:30** — flat, full stop. Final-hour 0DTE gamma is 6–10× morning levels; moves are violent and random relative to your signal basis.

## 3. The $100/day math — honest version

$100/day is a **sizing and consistency problem**, not an indicator problem.
No study gets you there if losses are unbounded or you trade range days like
trend days.

**Recommended structure: SPXW debit vertical spreads** (defined risk, less
theta/IV bleed than naked longs, tolerate ~50% win rates).

Example that produces ~$100/day expectancy:
- Buy a 10–15 point SPXW vertical in the signal direction, ~$3.50–$5.00 debit
  (1 contract ≈ $350–500 max risk).
- Plan: exit at the plotted target or +80–100% on the spread; stop at −50% of
  debit or when SPX closes through the plotted stop line, whichever first.
- At 52% win rate, +$400 avg win / −$225 avg loss, 1.5 trades/day:
  expectancy ≈ (0.52×400 − 0.48×225) × 1.5 ≈ **$150/day before commissions** —
  with worst single day capped near −$450.

**Non-negotiable rules** (these, not the arrows, decide profitability):
1. Max 2–3 signals taken per day. Two losers = done for the day
   (set `dailyRiskLockout = yes` — build the habit of actually flipping it).
2. Risk per trade ≤ 1–2% of account. A $25k account risks ≤ $250–500/trade.
3. Time stop: long premium not working in 60 min (orange dot) = exit. Theta
   on 0DTE accelerates all day; "it might come back" costs more each minute.
4. Scale: take half off at 1R / at the first opposing level, trail the rest.
   The study marks this: a green "1R - SCALE HALF, TRAIL" bubble, then an
   orange trail line (greater of breakeven and the 21-EMA) for the runner —
   that runner is where 2.5R+ days come from. Signal bubbles also print the
   available R at entry (e.g. "TREND 2.7R"); set `minRewardRisk = 2.0` to
   suppress signals whose stop/target geometry cannot pay at least 2R.
5. Flat by 15:30. Always.
6. Never fade a LARGE gap label, never buy calls at >85% EM used.
7. Event days (CPI/FOMC): lockout until the dust settles, half size after.

**What $100/day really requires**: ~$500–550/week. On a 5-day week that's
2–3 green days, 1 flat, 1 small red. The system's edge comes from skipping —
roughly a third of sessions are UNDECIDED/lunch-chop days where the best
trade is zero trades.

## 4. Reading the signals

- **Arrow + bubble**: `V13 CALL 78 ORB` = call signal, score 78, opening-range
  breakout setup. Tags: ORB, FLAG, LVL (level rejection), GAPFADE, TREND.
- **Score threshold**: 70 default, 78 when regime is UNDECIDED. Raise
  `minimumScore` to 75–80 while you build trust in it.
- **Stop/target dots**: red dots = suggested SPX stop level, green = target.
  These are underlying levels — convert to your spread's P/L mentally.
- **Diagnostic mode**: turn on `showDiagnosticMarkers` in OnDemand replay on a
  known trend day (e.g., a large-gap-and-go) and a known chop day, and verify
  the REGIME label gets them right before trusting it live.

## 5. Still external — do not skip

- **Liquidity check**: SPXW spread bid/ask ≤ $0.30–0.50 wide on your strikes.
- **Delta**: 30–40 delta long leg for directional verticals.
- **GEX freshness**: levels shift intraday; refresh inputs around midday.
- **Journal**: log every signal taken AND skipped with the regime label.
  After 30 sessions you'll know which setup tags actually pay you — then
  raise weights on those and mute the rest. That feedback loop, not any
  single indicator, is the real system.

## 6. Known limitations

- SPX has no volume/premarket prints: volume, RVOL, and VWAP use SPY as proxy;
  overnight levels are manual inputs.
- The regime gate needs ~1 hour of session data; before 10:30 it leans on gap
  size only and will say UNDECIDED often. That is correct behavior.
- thinkscript cannot see the options chain: GEX, expected move via straddle
  pricing, and liquidity stay manual.
- Signals are computed on completed bars + follow-through (no repaint), which
  costs a few points of entry vs. tick-perfect — that's the price of signals
  you can trust in replay.

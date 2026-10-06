# V13 backtest on TradingView

`SPX_Pulse_V13_strategy.pine` is a Pine v6 `strategy()` port of
`SPX_Pulse_V13.ts` (V13.22). The signal engine is bar-for-bar faithful; the
exit engine executes the playbook rules as real orders. Documented divergences
from thinkorswim are listed in the file header (D1–D5).

## Setup

1. TradingView → chart **SP:SPX**, **3-minute**, regular session, timezone
   America/New_York (chart settings → timezone).
2. Pine Editor → paste the script → **Add to chart**.
3. Open the **Strategy Tester** tab.

Intraday history on the chart is plan-limited (~5k bars Free / 10k Pro / 20k
Premium ≈ 7 months of 3-min). **Deep Backtesting** (Premium) runs years of
3-min history. VIX and VIX1D load via `request.security` — no extra charts
needed.

## First: validate the port (sanity anchors)

Before trusting any numbers, scroll to the anchor days from the journal and
compare against `BACKTEST_HANDOFF.md`:

- **2026-10-05** — five CALL signals (~11:30, 12:00, ~13:00, ~13:45, ~15:00),
  regime TREND UP from late morning, all reached +1R.
- **2026-10-06** — ORB CALL ~10:00 (~3.2R) and MOMO CALL ~11:00 (~4.1R).
- **2026-09-30 → 10-02** — VIX-gated put-side trend days.

Expect signals on the same bars ± a bar or two (divergences D1/D2 shift the
10-min confirmation and ADR slightly). If direction or time-of-day is wrong,
the port is broken — fix before tuning.

## Reading results per setup × regime

Every entry is tagged `<C|P> <TAG> <REGIME> s<score> r<R>` (TAG: TREND, ORB,
MOMO, LVL, GAPFADE, FLAG, BRKOUT; REGIME: TU, TD, RG, UN). Strategy Tester →
**List of trades** → export CSV, then pivot on the comment field for win rate /
avg R / profit factor per tag × regime × score bucket (handoff questions 1, 5).

## Walk-forward discipline (handoff deliverable)

1. Inputs → **Test window = In-sample** (default split 2025-12-01; earlier
   history belongs to the in-sample ~70%).
2. Tune: `Minimum score` (Q2), `Min reward:risk` (Q3), EM cutoffs (Q4),
   regime setup weights (Q5), `Exit engine` A/B (Q6), lunch haircut and the
   session windows (Q7).
3. Freeze the inputs, flip **Test window = Out-of-sample**, read the report
   without touching anything else. Those are the numbers that count.

## Costs

Strategy properties → set commission/slippage to taste. The handoff suggests
~0.05–0.10% per round trip to approximate SPXW debit-vertical friction; on the
index that is roughly 3–7 SPX points per round trip — set slippage = 1 tick
and commission ≈ cash per order equivalent, or just mentally haircut the
expectancy. P&L is reported in SPX points × 2 contracts (half scales at +1R).

## Not modeled here

Option-premium P&L (verticals), spread/liquidity checks, event lockouts
(`eventLockout` input exists in the .ts but event dates are not wired in),
and account-level risk — same externalities as the live study.

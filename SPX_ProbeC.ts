# SPX Pulse V13.18 - Dynamic Regime-Aware 0DTE Decision Study for thinkorswim
# RUN ON: SPX, 3-min, 20 days, EXTENDED HOURS OFF.
# Decision-support study only. It does not place orders.
# Designed for an SPX 3-minute RTH chart with 10-minute confirmation.
#
# New in V13 vs V12.1 Lite:
#   1. Gap classifier vs prior day close (micro / medium / large) with
#      gap-fill progress tracking and fade-vs-follow bias.
#   2. 15-minute Opening Range module with volume-filtered breakout and
#      retest detection, plus a staleness cutoff.
#   3. Expected-move bands computed from VIX1D (market-implied day range).
#   4. Full level stack: Camarilla R3/S3/R4/S4, prior day H/L/C, prior-day
#      fib retracements, optional manual overnight H/L; nearest support and
#      resistance are selected from the whole stack.
#   5. Bull/bear flag detector with measured-move target.
#   6. Regime gate (TREND UP / TREND DOWN / RANGE / UNDECIDED) that reweights
#      the score by day type instead of using static weights.
#   7. Session windows: lunch suppression, 15:15 entry cutoff, 15:30 exit flag.
#   8. Suggested stop / target plots and a 60-minute time-stop marker.
#
# Still external to thinkorswim (by design): live GEX levels (enter manually
# from SpotGamma / zerogex / MenthorQ), economic-event calendar, SPXW option
# spread/liquidity checks, and account-level risk enforcement.

declare upper;
declare once_per_bar;

# ---------------- Inputs ----------------
input minimumScore = 70;
input timeStopBars = 20;        # ~60 min: 20 on a 3-min chart, 12 on a 5-min chart
input minRewardRisk = 1.5;      # 0 = off; only signal when target/stop geometry allows >= this R
input signalCooldownBars = 10;  # suppress repeat signals on the same side for this many bars
input useTenMinuteConfirmation = yes;
input useVIXConfirmation = yes;
input useVIX1DExpectedMove = yes;
input useManualGEX = no;
input gammaFlip = 0.0;
input callWall = 0.0;
input putWall = 0.0;
input overnightHigh = 0.0;      # from /ES globex, manual (SPX has no overnight prints)
input overnightLow = 0.0;
input manualSupport = 0.0;
input manualResistance = 0.0;
input eventLockout = no;
input dailyRiskLockout = no;
input showEMBands = yes;
input showCamarilla = yes;
input showOpeningRange = yes;
input showRibbon = yes;
input showTradeManagement = yes;
input showLabels = yes;          # the score/signal label
input showContextLabels = no;    # regime, gap, OR, EM, S/R and session labels
input enableAlerts = yes;
input enableTestAlert = no;     # fires every bar while on: proves the alert pipeline works
input showDiagnosticMarkers = no;    # turn on to see candidate scores and data health

# NaN armor: any score bucket that goes NaN (cross-symbol data gaps)
# contributes 0 instead of poisoning the whole score. The DATA GAP label
# names the culprit so failures are never silent.
script nz {
    input value = 0;
    plot v = if IsNaN(value) then 0 else value;
}

# ---------------- Core series (carried over from V12.1) ----------------
def tr = TrueRange(high, close, low);
def phaseATR = WildersAverage(tr, 14);
def phasePivot = ExpAverage(close, 21);
def phaseRaw = if phaseATR != 0
               then ((close - phasePivot) / (3 * phaseATR)) * 100
               else 0;
def phase = ExpAverage(phaseRaw, 3);
def phaseSlope = phase - phase[1];
def phaseBull = phaseSlope > 0 and phase > -61.8;
def phaseBear = phaseSlope < 0 and phase < 61.8;
def leavingDownExtreme = phase crosses above -61.8;
def leavingUpExtreme = phase crosses below 61.8;

def ema8 = ExpAverage(close, 8);
def ema13 = ExpAverage(close, 13);
def ema21 = ExpAverage(close, 21);
def ema48 = ExpAverage(close, 48);
def ema200 = ExpAverage(close, 200);
def bullRibbon = ema8 > ema13 and ema13 > ema21 and ema21 > ema48;
def bearRibbon = ema8 < ema13 and ema13 < ema21 and ema21 < ema48;

def c10 = close(period = AggregationPeriod.TEN_MIN);
def ema8_10 = ExpAverage(c10, 8);
def ema13_10 = ExpAverage(c10, 13);
def ema21_10 = ExpAverage(c10, 21);
def ema48_10 = ExpAverage(c10, 48);
def bull10 = ema8_10 > ema13_10 and ema13_10 > ema21_10 and ema21_10 > ema48_10;
def bear10 = ema8_10 < ema13_10 and ema13_10 < ema21_10 and ema21_10 < ema48_10;
def bullRegimeTrend = bullRibbon and (!useTenMinuteConfirmation or bull10);
def bearRegimeTrend = bearRibbon and (!useTenMinuteConfirmation or bear10);


# ======== PROBE C: declares + inputs + nz + SATY core + 10-min only ========
AddLabel(yes, "PROBE C LABEL", Color.YELLOW);
plot ProbeEma8 = ema8;
plot ProbeEma21 = ema21;
ProbeEma8.SetDefaultColor(Color.GREEN);
ProbeEma8.SetLineWeight(2);
ProbeEma21.SetDefaultColor(Color.ORANGE);
ProbeEma21.SetLineWeight(2);
AddChartBubble(IsNaN(close[-1]), high + phaseATR,
    "PROBE C RUNNING | phase " + Round(phase, 0), Color.YELLOW, yes);

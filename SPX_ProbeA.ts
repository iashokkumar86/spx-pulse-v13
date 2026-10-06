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

# ---------------- Day-level data (no look-ahead: prior values use [1]) ----
def dayHigh = high(period = AggregationPeriod.DAY);
def dayLow = low(period = AggregationPeriod.DAY);
def dayClose = close(period = AggregationPeriod.DAY);
def dayOpen = open(period = AggregationPeriod.DAY);
def pdc = dayClose[1];
def pdh = dayHigh[1];
def pdl = dayLow[1];
def dayRange = dayHigh - dayLow;
def adr14raw = Average(dayRange, 14)[1];
def dayTR = TrueRange(dayHigh, dayClose, dayLow);
def priorATRraw = WildersAverage(dayTR, 14)[1];
# On charts with < 15 days of data the 14-day aggregates are NaN. Fall back
# to shorter lookbacks / intraday ATR so the study still works on short charts.
# NOTE: in thinkscript "!IsNaN(x) and x > 0" is NOT NaN-safe - the NaN
# comparison contaminates the "and". IsNaN must be its own branch, first.
def adrOK = if IsNaN(adr14raw) then 0 else if adr14raw > 0 then 1 else 0;
def adr14 = if adrOK then adr14raw
            else if IsNaN(dayRange[1]) then 0
            else if dayRange[1] > 0 then dayRange[1]
            else 0;
def intradayATRx40 = 40 * WildersAverage(TrueRange(high, close, low), 14);
def priorATR = if IsNaN(priorATRraw) then
                   (if IsNaN(dayTR[1]) then intradayATRx40
                    else if dayTR[1] > 0 then dayTR[1]
                    else intradayATRx40)
               else if priorATRraw > 0 then priorATRraw
               else intradayATRx40;

def newSession = GetYYYYMMDD() != GetYYYYMMDD()[1];
def tolerance = Max(phaseATR * .12, 1.0);

# ---------------- Participation + VWAP proxy (SPX has no real volume) -----
# Automatic failover: SPY (primary) -> /ES futures -> SPX itself. A dead
# feed must degrade the inputs, never silently disable every setup.
def spyHigh = high(symbol = "SPY");
def spyLow = low(symbol = "SPY");
def spyClose = close(symbol = "SPY");
def spyVolume = volume(symbol = "SPY");
def spyOK = !IsNaN(spyClose) and !IsNaN(spyVolume) and spyVolume > 0;
# /ES failover removed: futures data permissions are not guaranteed and the
# request can raise the chart warning icon. Failover is SPY -> SPX only.
def esHigh = Double.NaN;
def esLow = Double.NaN;
def esClose = Double.NaN;
def esVolume = Double.NaN;
def esOK = 0;
# Final fallback: SPX itself with unit volume (VWAP degrades to a session
# TWAP and RVOL reads a neutral 1.0).
def srcClose = if spyOK then spyClose else if esOK then esClose else close;
def srcTypical = if spyOK then (spyHigh + spyLow + spyClose) / 3
                 else if esOK then (esHigh + esLow + esClose) / 3
                 else (high + low + close) / 3;
def srcVolume = if spyOK then spyVolume else if esOK then esVolume else 1;
def spyCumulativePV = if newSession then srcTypical * srcVolume
                      else spyCumulativePV[1] + srcTypical * srcVolume;
def spyCumulativeVolume = if newSession then srcVolume
                          else spyCumulativeVolume[1] + srcVolume;
def spyVWAP = if spyCumulativeVolume > 0 then spyCumulativePV / spyCumulativeVolume else srcClose;
def aboveVWAPProxy = CompoundValue(1,
    if IsNaN(srcClose) or IsNaN(spyVWAP) then aboveVWAPProxy[1]
    else if srcClose >= spyVWAP then 1 else 0, yes);
def spyRVOLraw = if Average(srcVolume, 20) > 0
                 then srcVolume / Average(srcVolume, 20)
                 else 0;
def spyRVOL = if IsNaN(spyRVOLraw) then 0 else spyRVOLraw;

def vixClose = close(symbol = "VIX");
def vixMean = ExpAverage(vixClose, 8);
# Treat missing VIX data as "no objection"; IsNaN decided first, alone.
def vixDataOK = if IsNaN(vixClose) or IsNaN(vixMean) then 0 else 1;
def vixCallOK = if !useVIXConfirmation then 1 else if !vixDataOK then 1
                else if vixClose <= vixMean then 1 else 0;
def vixPutOK = if !useVIXConfirmation then 1 else if !vixDataOK then 1
               else if vixClose >= vixMean then 1 else 0;

# ================= MODULE 1: Gap classifier =================
# Buckets from SPY/ES gap-fill statistics:
#   micro  < 0.20%  -> fills intraday ~87-92% of the time (fade bias)
#   medium 0.20-0.40% -> coin flip (neutral)
#   large  > 0.40%  -> fills < 50% (gap-and-go bias; do NOT fade)
def gapPts = dayOpen - pdc;
def gapPct = if pdc > 0 then 100 * gapPts / pdc else 0;
def gapUp = gapPct >= 0.02;          # ignore sub-noise opens
def gapDown = gapPct <= -0.02;
def gapAbs = AbsValue(gapPct);
def gapMicro = gapAbs < 0.20;
def gapMedium = gapAbs >= 0.20 and gapAbs <= 0.40;
def gapLarge = gapAbs > 0.40;

# Fill progress: how much of the gap has been retraced toward PDC today.
def sessionLow = CompoundValue(1, if newSession then low else Min(sessionLow[1], low), low);
def sessionHigh = CompoundValue(1, if newSession then high else Max(sessionHigh[1], high), high);
def gapFillProgress =
    if gapUp and gapPts != 0 then Min(1, Max(0, (dayOpen - sessionLow) / gapPts))
    else if gapDown and gapPts != 0 then Min(1, Max(0, (sessionHigh - dayOpen) / (-gapPts)))
    else 1;
def gapFilled = (gapUp and sessionLow <= pdc) or (gapDown and sessionHigh >= pdc);

# Fade thesis dies if < 30% of the gap filled by 10:30.
def after1030 = SecondsFromTime(1030) >= 0;
def gapFadeAlive = !gapLarge and (gapUp or gapDown) and !gapFilled and
                   (!after1030 or gapFillProgress >= 0.30);
# Gap-and-go: large gap holding (< 30% filled) after the opening range forms.
def gapAndGoUp = gapLarge and gapUp and gapFillProgress < 0.30;
def gapAndGoDown = gapLarge and gapDown and gapFillProgress < 0.30;

# ================= MODULE 2: 15-minute Opening Range =================
def inOR = SecondsFromTime(0930) >= 0 and SecondsTillTime(0945) > 0;
def orComplete = SecondsFromTime(0945) >= 0;
def orHigh = CompoundValue(1,
             if newSession then high
             else if inOR then Max(orHigh[1], high)
             else orHigh[1], high);
def orLow = CompoundValue(1,
            if newSession then low
            else if inOR then Min(orLow[1], low)
            else orLow[1], low);
def orVolSum = if newSession then srcVolume
               else if inOR then orVolSum[1] + srcVolume
               else orVolSum[1];
def orBarCount = if newSession then 1
                 else if inOR then orBarCount[1] + 1
                 else orBarCount[1];
def orAvgVol = if orBarCount > 0 then orVolSum / orBarCount else spyVolume;

# Breakout quality windows (research: 9:45-10:00 strongest, dead after noon).
def before1000 = SecondsTillTime(1000) > 0;
def before1200 = SecondsTillTime(1200) > 0;
# Volume filter: compare to the rolling 20-bar average (RVOL), not to the
# opening-range bars themselves — 9:30-9:45 bars carry the day's heaviest
# volume, so a 1.5x-of-OR filter rejected virtually every later breakout.
def orbVolumeOK = spyRVOL >= 1.2;
def orbBreakUp = orComplete and close > orHigh and close[1] <= orHigh;
def orbBreakDown = orComplete and close < orLow and close[1] >= orLow;
# Retest: prior break, then a pullback that holds the OR level.
def brokeUpToday = if newSession then 0
                   else if orbBreakUp then 1 else brokeUpToday[1];
def brokeDownToday = if newSession then 0
                     else if orbBreakDown then 1 else brokeDownToday[1];
def orbRetestUp = brokeUpToday and close > orHigh and
                  low <= orHigh + tolerance and close > open;
def orbRetestDown = brokeDownToday and close < orLow and
                    high >= orLow - tolerance and close < open;

def orbCallSetup = before1200 and orbVolumeOK and (orbBreakUp or orbRetestUp);
def orbPutSetup = before1200 and orbVolumeOK and (orbBreakDown or orbRetestDown);
def orbPrimeTime = orComplete and before1000;   # highest-stat window

# ================= MODULE 3: Expected-move bands from VIX1D =================
# EM = SPX_open * (VIX1D/100) / sqrt(252). ~68% of sessions close inside +-1 EM.
# VIX1D is not available on this data feed; requesting it raises the
# chart warning icon, so the EM uses VIX directly.
def vix1dRaw = Double.NaN;
# IsNaN-first branching throughout: see the adr14 note above.
def vix1dUsable = if IsNaN(vix1dRaw) then 0 else if vix1dRaw > 0 then 1 else 0;
def vixUsable = if IsNaN(vixClose) then 0 else if vixClose > 0 then 1 else 0;
def vixForEM = if useVIX1DExpectedMove and vix1dUsable then vix1dRaw
               else if vixUsable then vixClose
               else 0;
def emPtsRaw = dayOpen * (vixForEM / 100) / Sqrt(252);
def emPts = if IsNaN(emPtsRaw) then priorATR * 0.5
            else if emPtsRaw > 0 then emPtsRaw
            else priorATR * 0.5;
def emUpper1 = dayOpen + emPts;
def emLower1 = dayOpen - emPts;
def emUpperHalf = dayOpen + emPts * 0.5;
def emLowerHalf = dayOpen - emPts * 0.5;
def emUsedRaw = if emPts > 0 then (close - dayOpen) / emPts else 0;
def emUsed = if IsNaN(emUsedRaw) then 0 else emUsedRaw;  # signed, in EM units


# ======== PROBE A: top half only (data, gap, OR, EM) ========
AddLabel(yes, "PROBE A LABEL", Color.YELLOW);
plot ProbeORHigh = orHigh;
plot ProbeORLow = orLow;
plot ProbeEma8 = ema8;
ProbeORHigh.SetDefaultColor(Color.ORANGE);
ProbeORHigh.SetLineWeight(3);
ProbeORLow.SetDefaultColor(Color.PINK);
ProbeORLow.SetLineWeight(3);
ProbeEma8.SetDefaultColor(Color.GREEN);
AddChartBubble(IsNaN(close[-1]), high + phaseATR,
    "PROBE A RUNNING | ORH " + Round(orHigh, 0), Color.YELLOW, yes);

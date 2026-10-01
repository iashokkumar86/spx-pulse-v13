# SPX Pulse V13 - Dynamic Regime-Aware 0DTE Decision Study for thinkorswim
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
input showLabels = yes;
input enableAlerts = yes;
input showDiagnosticMarkers = no;

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
def adr14 = Average(dayRange, 14)[1];
def dayTR = TrueRange(dayHigh, dayClose, dayLow);
def priorATR = WildersAverage(dayTR, 14)[1];

def newSession = GetYYYYMMDD() != GetYYYYMMDD()[1];
def tolerance = Max(phaseATR * .12, 1.0);

# ---------------- SPY participation + VWAP proxy (SPX has no real volume) --
def spyHigh = high(symbol = "SPY");
def spyLow = low(symbol = "SPY");
def spyClose = close(symbol = "SPY");
def spyVolume = volume(symbol = "SPY");
def spyTypical = (spyHigh + spyLow + spyClose) / 3;
def spyCumulativePV = if newSession then spyTypical * spyVolume
                      else spyCumulativePV[1] + spyTypical * spyVolume;
def spyCumulativeVolume = if newSession then spyVolume
                          else spyCumulativeVolume[1] + spyVolume;
def spyVWAP = if spyCumulativeVolume > 0 then spyCumulativePV / spyCumulativeVolume else spyClose;
def aboveVWAPProxy = spyClose >= spyVWAP;
def spyRVOL = if Average(spyVolume, 20) > 0
              then spyVolume / Average(spyVolume, 20)
              else 0;

def vixClose = close(symbol = "VIX");
def vixMean = ExpAverage(vixClose, 8);
def vixCallOK = !useVIXConfirmation or vixClose <= vixMean;
def vixPutOK = !useVIXConfirmation or vixClose >= vixMean;

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
def sessionLow = if newSession then low else Min(sessionLow[1], low);
def sessionHigh = if newSession then high else Max(sessionHigh[1], high);
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
def orHigh = if newSession then high
             else if inOR then Max(orHigh[1], high)
             else orHigh[1];
def orLow = if newSession then low
            else if inOR then Min(orLow[1], low)
            else orLow[1];
def orVolSum = if newSession then spyVolume
               else if inOR then orVolSum[1] + spyVolume
               else orVolSum[1];
def orBarCount = if newSession then 1
                 else if inOR then orBarCount[1] + 1
                 else orBarCount[1];
def orAvgVol = if orBarCount > 0 then orVolSum / orBarCount else spyVolume;

# Breakout quality windows (research: 9:45-10:00 strongest, dead after noon).
def before1000 = SecondsTillTime(1000) > 0;
def before1200 = SecondsTillTime(1200) > 0;
def orbVolumeOK = spyVolume >= 1.5 * orAvgVol;
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
def vix1dRaw = close(symbol = "VIX1D");
def vixForEM = if useVIX1DExpectedMove and !IsNaN(vix1dRaw) and vix1dRaw > 0
               then vix1dRaw else vixClose;
def emPts = dayOpen * (vixForEM / 100) / Sqrt(252);
def emUpper1 = dayOpen + emPts;
def emLower1 = dayOpen - emPts;
def emUpperHalf = dayOpen + emPts * 0.5;
def emLowerHalf = dayOpen - emPts * 0.5;
def emUsed = if emPts > 0 then (close - dayOpen) / emPts else 0;  # signed, in EM units

# ================= MODULE 4: Level stack + nearest S/R =================
def pRange = pdh - pdl;
def camR3 = pdc + pRange * 1.1 / 4;
def camR4 = pdc + pRange * 1.1 / 2;
def camS3 = pdc - pRange * 1.1 / 4;
def camS4 = pdc - pRange * 1.1 / 2;
def fib382 = pdl + pRange * 0.382;
def fib500 = pdl + pRange * 0.500;
def fib618 = pdl + pRange * 0.618;

# Nearest support = highest stack level below price; resistance = lowest above.
script belowOr {
    input lvl = 0;
    input ref = 0;
    plot v = if !IsNaN(lvl) and lvl > 0 and lvl < ref then lvl else -999999;
}
script aboveOr {
    input lvl = 0;
    input ref = 0;
    plot v = if !IsNaN(lvl) and lvl > 0 and lvl > ref then lvl else 999999;
}
def nsRaw = Max(Max(Max(Max(belowOr(pdl, close), belowOr(pdh, close)),
                        Max(belowOr(pdc, close), belowOr(camS3, close))),
                    Max(Max(belowOr(camS4, close), belowOr(fib382, close)),
                        Max(belowOr(fib500, close), belowOr(fib618, close)))),
                Max(Max(belowOr(overnightLow, close), belowOr(overnightHigh, close)),
                    Max(belowOr(orLow, close), belowOr(manualSupport, close))));
def nrRaw = Min(Min(Min(Min(aboveOr(pdl, close), aboveOr(pdh, close)),
                        Min(aboveOr(pdc, close), aboveOr(camR3, close))),
                    Min(Min(aboveOr(camR4, close), aboveOr(fib382, close)),
                        Min(aboveOr(fib500, close), aboveOr(fib618, close)))),
                Min(Min(aboveOr(overnightLow, close), aboveOr(overnightHigh, close)),
                    Min(aboveOr(orHigh, close), aboveOr(manualResistance, close))));
def nearestSupport = if nsRaw > -999999 then nsRaw else close - priorATR * 0.5;
def nearestResistance = if nrRaw < 999999 then nrRaw else close + priorATR * 0.5;

# ================= MODULE 5: Flag detector =================
# Pole: >= 2x phaseATR net move within 10 bars. Flag: 4-15 bars holding above
# (below) the 50% pole retrace with contracting range. Trigger: breakout close.
def pole10Up = close - Lowest(low, 10);
def pole10Dn = Highest(high, 10) - close;
def impulseUp = pole10Up >= 2 * phaseATR and close > open;
def impulseDn = pole10Dn >= 2 * phaseATR and close < open;
def poleTopRec = if impulseUp then high else poleTopRec[1];
def poleBotForUp = if impulseUp then Lowest(low, 10) else poleBotForUp[1];
def poleBotRec = if impulseDn then low else poleBotRec[1];
def poleTopForDn = if impulseDn then Highest(high, 10) else poleTopForDn[1];
def barsSinceImpUp = if impulseUp then 0 else barsSinceImpUp[1] + 1;
def barsSinceImpDn = if impulseDn then 0 else barsSinceImpDn[1] + 1;
def poleHtUp = poleTopRec - poleBotForUp;
def poleHtDn = poleTopForDn - poleBotRec;
def flagWindowUp = barsSinceImpUp >= 4 and barsSinceImpUp <= 15;
def flagWindowDn = barsSinceImpDn >= 4 and barsSinceImpDn <= 15;
def flagHoldsUp = flagWindowUp and
                  Lowest(low, 4) > poleTopRec - 0.5 * poleHtUp and
                  Highest(high, 4) - Lowest(low, 4) < 0.6 * poleHtUp;
def flagHoldsDn = flagWindowDn and
                  Highest(high, 4) < poleBotRec + 0.5 * poleHtDn and
                  Highest(high, 4) - Lowest(low, 4) < 0.6 * poleHtDn;
def flagCallSetup = flagHoldsUp[1] and close > Highest(high[1], 4) and close > open;
def flagPutSetup = flagHoldsDn[1] and close < Lowest(low[1], 4) and close < open;
def flagCallTarget = Highest(high[1], 4) + poleHtUp;
def flagPutTarget = Lowest(low[1], 4) - poleHtDn;

# ================= MODULE 6: Regime gate =================
# First-hour range as % of 14-day ADR, frozen after 10:30.
def fhHigh = if newSession then high
             else if !after1030 then Max(fhHigh[1], high)
             else fhHigh[1];
def fhLow = if newSession then low
            else if !after1030 then Min(fhLow[1], low)
            else fhLow[1];
def fhRangePctADR = if adr14 > 0 then (fhHigh - fhLow) / adr14 else 0;
def insidePriorRange = close < pdh and close > pdl;
# GEX: price below the gamma flip = negative gamma = moves amplify (trend);
# above = positive gamma = mean reversion (range). Used as a tiebreak only.
def gexTrendy = useManualGEX and gammaFlip > 0 and close < gammaFlip;
def gexRangy = useManualGEX and gammaFlip > 0 and close > gammaFlip;

def trendUpEvidence =
    (if gapAndGoUp then 2 else 0) +
    (if after1030 and fhRangePctADR > 0.45 and close > orHigh then 2 else 0) +
    (if close > pdh then 1 else 0) +
    (if bullRegimeTrend then 1 else 0) +
    (if gexTrendy and close > dayOpen then 1 else 0);
def trendDnEvidence =
    (if gapAndGoDown then 2 else 0) +
    (if after1030 and fhRangePctADR > 0.45 and close < orLow then 2 else 0) +
    (if close < pdl then 1 else 0) +
    (if bearRegimeTrend then 1 else 0) +
    (if gexTrendy and close < dayOpen then 1 else 0);
def rangeEvidence =
    (if gapMicro then 1 else 0) +
    (if after1030 and fhRangePctADR < 0.35 then 2 else 0) +
    (if insidePriorRange then 1 else 0) +
    (if gexRangy then 1 else 0) +
    (if AbsValue(emUsed) < 0.35 and after1030 then 1 else 0);

# regime: 0 undecided, 1 trend up, 2 trend down, 3 range
def regime =
    if !orComplete then 0
    else if trendUpEvidence >= 3 and trendUpEvidence > trendDnEvidence and trendUpEvidence >= rangeEvidence then 1
    else if trendDnEvidence >= 3 and trendDnEvidence > trendUpEvidence and trendDnEvidence >= rangeEvidence then 2
    else if rangeEvidence >= 3 then 3
    else 0;

# ================= MODULE 7: Session windows =================
def eligibleTime = SecondsFromTime(0945) >= 0 and SecondsTillTime(1515) > 0;
def lunch = SecondsFromTime(1200) >= 0 and SecondsTillTime(1300) > 0;
def exitWindow = SecondsFromTime(1530) >= 0;
def sessionMult = if !eligibleTime then 0
                  else if lunch then 0.85
                  else 1.0;
def lockoutCondition = eventLockout or dailyRiskLockout or !eligibleTime;

# ================= Setups (candidates) =================
# 1. Trend pullback continuation (V12.1, kept).
def trendCall = bullRegimeTrend and phaseBull and aboveVWAPProxy and
                low <= ema13 + tolerance and close > ema8 and close > open;
def trendPut = bearRegimeTrend and phaseBear and !aboveVWAPProxy and
               high >= ema13 - tolerance and close < ema8 and close < open;

# 2. Level rejection against the full stack or an EM band extreme.
def nearSupport = AbsValue(low - nearestSupport) <= tolerance or low <= emLower1 + tolerance;
def nearResistance = AbsValue(high - nearestResistance) <= tolerance or high >= emUpper1 - tolerance;
def reversalCall = nearSupport and close > nearestSupport and close > open and
                   phaseSlope > 0 and (leavingDownExtreme or phase < -23.6);
def reversalPut = nearResistance and close < nearestResistance and close < open and
                  phaseSlope < 0 and (leavingUpExtreme or phase > 23.6);

# 3. Gap fade toward PDC (micro/medium gaps only, thesis must be alive).
def gapFadePut = gapFadeAlive and gapUp and close < dayOpen and
                 phaseSlope < 0 and close < open and !aboveVWAPProxy;
def gapFadeCall = gapFadeAlive and gapDown and close > dayOpen and
                  phaseSlope > 0 and close > open and aboveVWAPProxy;

# 4. ORB and 5. Flags defined above.
# 6. Compression breakout (V12.1, kept).
def compressed = 2 * StDev(close, 21) <= 2 * phaseATR;
def rangeHigh10 = Highest(high[1], 10);
def rangeLow10 = Lowest(low[1], 10);
def breakoutCall = compressed[1] and close > rangeHigh10 and aboveVWAPProxy and
                   phaseSlope > 0 and spyRVOL >= 1.10;
def breakoutPut = compressed[1] and close < rangeLow10 and !aboveVWAPProxy and
                  phaseSlope < 0 and spyRVOL >= 1.10;

def callCandidate = trendCall or reversalCall or breakoutCall or
                    orbCallSetup or flagCallSetup or gapFadeCall;
def putCandidate = trendPut or reversalPut or breakoutPut or
                   orbPutSetup or flagPutSetup or gapFadePut;

# ================= Regime-weighted scoring (0-100) =================
# Buckets: setup quality (max 30, regime-weighted) + trend alignment (max 20,
# ribbon/phase merged so momentum cannot triple-count) + location (15) +
# participation (10) + room/EM (10) + GEX (5) + volatility (10) = 100.

# Setup-quality weights by regime. "With-trend" = trend/ORB/flag/breakout,
# "counter/fade" = reversal/gap-fade.
def wTrendSetup = if regime == 1 or regime == 2 then 30
                  else if regime == 3 then 10
                  else 18;
def wFadeSetup = if regime == 3 then 30
                 else if regime == 1 or regime == 2 then 8
                 else 18;
def orbBonus = if orbPrimeTime then 4 else 0;   # 9:45-10:00 stat edge

def callSetupScore =
    Min(30, Max(Max(if trendCall or breakoutCall then wTrendSetup else 0,
                    if orbCallSetup then Min(30, wTrendSetup + orbBonus) else 0),
                Max(if flagCallSetup then wTrendSetup else 0,
                    if reversalCall or gapFadeCall then wFadeSetup else 0)));
def putSetupScore =
    Min(30, Max(Max(if trendPut or breakoutPut then wTrendSetup else 0,
                    if orbPutSetup then Min(30, wTrendSetup + orbBonus) else 0),
                Max(if flagPutSetup then wTrendSetup else 0,
                    if reversalPut or gapFadePut then wFadeSetup else 0)));

# Trend alignment (merged ribbon + phase, single bucket).
def callAlign = if bullRegimeTrend and phaseBull then 20
                else if bullRibbon and phaseSlope > 0 then 12
                else if bullRibbon or phaseBull then 6 else 0;
def putAlign = if bearRegimeTrend and phaseBear then 20
               else if bearRibbon and phaseSlope < 0 then 12
               else if bearRibbon or phaseBear then 6 else 0;
# In a range regime alignment matters less; rescale it down.
def alignMult = if regime == 3 then 0.5 else 1.0;

# Location: entering near a level in your favor, on the right side of VWAP.
def callLocation = if aboveVWAPProxy and
                      (AbsValue(low - ema13) <= tolerance or
                       AbsValue(low - nearestSupport) <= tolerance)
                   then 15
                   else if reversalCall or gapFadeCall then 12   # fades are location-entries by definition
                   else if aboveVWAPProxy then 7 else 0;
def putLocation = if !aboveVWAPProxy and
                     (AbsValue(high - ema13) <= tolerance or
                      AbsValue(high - nearestResistance) <= tolerance)
                  then 15
                  else if reversalPut or gapFadePut then 12
                  else if !aboveVWAPProxy then 7 else 0;

# Participation: in range regime demand more volume for breakout-type entries.
def rvolNeed = if regime == 3 then 1.30 else 1.10;
def participationScore = if spyRVOL >= rvolNeed then 10
                         else if spyRVOL >= 0.80 then 5 else 0;

# Room: distance to the opposing level / EM exhaustion. Calls near +1 EM and
# puts near -1 EM get no room credit (chasing an exhausted day).
def callRoom = nearestResistance - close;
def putRoom = close - nearestSupport;
def roomNeed = Max(5, phaseATR * 1.5);
def callRoomScore = if emUsed > 0.85 then 0
                    else if callRoom >= roomNeed then 10
                    else if callRoom >= roomNeed * 0.6 then 5 else 0;
def putRoomScore = if emUsed < -0.85 then 0
                   else if putRoom >= roomNeed then 10
                   else if putRoom >= roomNeed * 0.6 then 5 else 0;

def callGEXScore = if useManualGEX and gammaFlip > 0 and close > gammaFlip and callWall > close then 5 else 0;
def putGEXScore = if useManualGEX and gammaFlip > 0 and close < gammaFlip and putWall > 0 and putWall < close then 5 else 0;
def callVolScore = if vixCallOK then 10 else 0;
def putVolScore = if vixPutOK then 10 else 0;

def callScore = Round(sessionMult * (callSetupScore + callAlign * alignMult +
                callLocation + participationScore + callRoomScore +
                callGEXScore + callVolScore), 0);
def putScore = Round(sessionMult * (putSetupScore + putAlign * alignMult +
               putLocation + participationScore + putRoomScore +
               putGEXScore + putVolScore), 0);

# Undecided regime demands a higher bar.
def effMinScore = if regime == 0 then minimumScore + 8 else minimumScore;

# ================= Confirmation (completed bar [1] + follow-through) =======
def confirmedCall = !lockoutCondition and callCandidate[1] and
                    callScore[1] >= effMinScore and close > close[1];
def confirmedPut = !lockoutCondition and putCandidate[1] and
                   putScore[1] >= effMinScore and close < close[1];

plot TradeCall = confirmedCall and !confirmedCall[1];
plot TradePut = confirmedPut and !confirmedPut[1];
TradeCall.SetPaintingStrategy(PaintingStrategy.BOOLEAN_ARROW_UP);
TradeCall.SetDefaultColor(Color.CYAN);
TradeCall.SetLineWeight(4);
TradePut.SetPaintingStrategy(PaintingStrategy.BOOLEAN_ARROW_DOWN);
TradePut.SetDefaultColor(Color.MAGENTA);
TradePut.SetLineWeight(4);

# ================= MODULE 8: Trade management =================
# Structure stop: beyond the nearest level / recent swing, min 1.2x ATR away.
def callStopCalc = Min(Lowest(low, 3), nearestSupport) - 0.25 * tolerance;
def putStopCalc = Max(Highest(high, 3), nearestResistance) + 0.25 * tolerance;
def callStopF = Max(callStopCalc, close - 2.2 * phaseATR);
def putStopF = Min(putStopCalc, close + 2.2 * phaseATR);
def callTargetCalc = if flagCallSetup then Min(flagCallTarget, emUpper1)
                     else Min(nearestResistance, emUpper1);
def putTargetCalc = if flagPutSetup then Max(flagPutTarget, emLower1)
                    else Max(nearestSupport, emLower1);

def activeSide = if TradeCall then 1
                 else if TradePut then -1
                 else if newSession then 0
                 else activeSide[1];
def heldStop = if TradeCall then callStopF
               else if TradePut then putStopF
               else heldStop[1];
def heldTarget = if TradeCall then callTargetCalc
                 else if TradePut then putTargetCalc
                 else heldTarget[1];
def barsInTrade = if TradeCall or TradePut then 0
                  else if activeSide != 0 then barsInTrade[1] + 1
                  else 0;
def stopHit = activeSide != 0 and
              ((activeSide == 1 and close < heldStop) or
               (activeSide == -1 and close > heldStop));
def targetHit = activeSide != 0 and
                ((activeSide == 1 and high >= heldTarget) or
                 (activeSide == -1 and low <= heldTarget));
def timeStop = activeSide != 0 and barsInTrade == 20;   # ~60 min on 3-min bars

plot StopLine = if showTradeManagement and activeSide != 0 and !stopHit and !targetHit
                then heldStop else Double.NaN;
plot TargetLine = if showTradeManagement and activeSide != 0 and !stopHit and !targetHit
                  then heldTarget else Double.NaN;
StopLine.SetDefaultColor(Color.RED);
StopLine.SetStyle(Curve.POINTS);
TargetLine.SetDefaultColor(Color.GREEN);
TargetLine.SetStyle(Curve.POINTS);
plot TimeStopMark = if showTradeManagement and timeStop then close else Double.NaN;
TimeStopMark.SetPaintingStrategy(PaintingStrategy.POINTS);
TimeStopMark.SetDefaultColor(Color.ORANGE);
TimeStopMark.SetLineWeight(5);

# ================= Reference plots =================
plot Ribbon8 = if showRibbon then ema8 else Double.NaN;
plot Ribbon13 = if showRibbon then ema13 else Double.NaN;
plot Ribbon21 = if showRibbon then ema21 else Double.NaN;
plot Ribbon48 = if showRibbon then ema48 else Double.NaN;
plot Ribbon200 = if showRibbon then ema200 else Double.NaN;
Ribbon8.SetDefaultColor(Color.GREEN);
Ribbon13.SetDefaultColor(Color.LIGHT_GREEN);
Ribbon21.SetDefaultColor(Color.WHITE);
Ribbon48.SetDefaultColor(Color.ORANGE);
Ribbon200.SetDefaultColor(Color.CYAN);

plot OpenRangeHi = if showOpeningRange and orComplete then orHigh else Double.NaN;
plot OpenRangeLo = if showOpeningRange and orComplete then orLow else Double.NaN;
OpenRangeHi.SetDefaultColor(Color.WHITE);
OpenRangeLo.SetDefaultColor(Color.WHITE);
OpenRangeHi.SetStyle(Curve.FIRM);
OpenRangeLo.SetStyle(Curve.FIRM);

plot EMUpper = if showEMBands then emUpper1 else Double.NaN;
plot EMLower = if showEMBands then emLower1 else Double.NaN;
plot EMUpperH = if showEMBands then emUpperHalf else Double.NaN;
plot EMLowerH = if showEMBands then emLowerHalf else Double.NaN;
EMUpper.SetDefaultColor(Color.DARK_GREEN);
EMLower.SetDefaultColor(Color.DARK_RED);
EMUpperH.SetDefaultColor(Color.DARK_GRAY);
EMLowerH.SetDefaultColor(Color.DARK_GRAY);
EMUpper.SetStyle(Curve.LONG_DASH);
EMLower.SetStyle(Curve.LONG_DASH);
EMUpperH.SetStyle(Curve.SHORT_DASH);
EMLowerH.SetStyle(Curve.SHORT_DASH);

plot CamarillaR3 = if showCamarilla then camR3 else Double.NaN;
plot CamarillaS3 = if showCamarilla then camS3 else Double.NaN;
plot CamarillaR4 = if showCamarilla then camR4 else Double.NaN;
plot CamarillaS4 = if showCamarilla then camS4 else Double.NaN;
CamarillaR3.SetDefaultColor(Color.PLUM);
CamarillaS3.SetDefaultColor(Color.PLUM);
CamarillaR4.SetDefaultColor(Color.VIOLET);
CamarillaS4.SetDefaultColor(Color.VIOLET);
CamarillaR3.SetStyle(Curve.SHORT_DASH);
CamarillaS3.SetStyle(Curve.SHORT_DASH);
CamarillaR4.SetStyle(Curve.SHORT_DASH);
CamarillaS4.SetStyle(Curve.SHORT_DASH);

plot PriorDayClose = pdc;
PriorDayClose.SetDefaultColor(Color.YELLOW);
PriorDayClose.SetStyle(Curve.FIRM);

# ================= Bubbles, labels, alerts =================
AddChartBubble(TradeCall, low,
    "V13 CALL " + callScore[1] +
    (if orbCallSetup[1] then " ORB" else if flagCallSetup[1] then " FLAG"
     else if reversalCall[1] then " LVL" else if gapFadeCall[1] then " GAPFADE"
     else " TREND"),
    Color.CYAN, no);
AddChartBubble(TradePut, high,
    "V13 PUT " + putScore[1] +
    (if orbPutSetup[1] then " ORB" else if flagPutSetup[1] then " FLAG"
     else if reversalPut[1] then " LVL" else if gapFadePut[1] then " GAPFADE"
     else " TREND"),
    Color.MAGENTA, yes);

AddLabel(showLabels,
    if regime == 1 then "REGIME: TREND UP"
    else if regime == 2 then "REGIME: TREND DOWN"
    else if regime == 3 then "REGIME: RANGE"
    else "REGIME: UNDECIDED",
    if regime == 1 then Color.GREEN
    else if regime == 2 then Color.RED
    else if regime == 3 then Color.ORANGE
    else Color.GRAY);
AddLabel(showLabels,
    "GAP " + (if gapUp then "UP " else if gapDown then "DOWN " else "FLAT ") +
    Round(gapPct, 2) + "% " +
    (if gapLarge then "LARGE(go)" else if gapMedium then "MED" else "MICRO(fade)") +
    " fill " + Round(100 * gapFillProgress, 0) + "%",
    if gapAndGoUp then Color.GREEN else if gapAndGoDown then Color.RED
    else if gapFadeAlive then Color.ORANGE else Color.GRAY);
AddLabel(showLabels and orComplete,
    "OR " + Round(orLow, 0) + "-" + Round(orHigh, 0) +
    (if brokeUpToday then " BROKE UP" else if brokeDownToday then " BROKE DN" else " INSIDE"),
    if brokeUpToday then Color.GREEN else if brokeDownToday then Color.RED else Color.GRAY);
AddLabel(showLabels,
    "EM " + Round(emPts, 0) + "pts · used " + Round(100 * emUsed, 0) + "%",
    if AbsValue(emUsed) > 0.85 then Color.RED else Color.GRAY);
AddLabel(showLabels,
    "S " + Round(nearestSupport, 0) + " / R " + Round(nearestResistance, 0),
    Color.LIGHT_GRAY);
AddLabel(showLabels and exitWindow, "EXIT BY 15:30 — GAMMA HOUR", Color.RED);
AddLabel(showLabels and lunch, "LUNCH — REDUCED SIZE/SCORE", Color.DARK_ORANGE);
AddLabel(showLabels,
    if lockoutCondition then "V13 LOCKED OUT"
    else if TradeCall then "V13 TRADE CALL · " + callScore[1]
    else if TradePut then "V13 TRADE PUT · " + putScore[1]
    else "V13 WAIT · CALL " + callScore + " / PUT " + putScore + " · need " + effMinScore,
    if lockoutCondition then Color.RED
    else if TradeCall then Color.CYAN
    else if TradePut then Color.MAGENTA
    else Color.GRAY);
AddLabel(showLabels and !useManualGEX, "GEX NOT INCLUDED", Color.DARK_GRAY);
AddLabel(showLabels and useManualGEX, "GEX MANUAL", Color.ORANGE);
AddLabel(showLabels, "VERIFY SPXW SPREAD · DELTA · OI · EVENT RISK", Color.YELLOW);

AddChartBubble(showDiagnosticMarkers and IsNaN(close[-1]), close,
    "V13 | regime " + regime + " | C " + callScore + " P " + putScore +
    " | tU " + trendUpEvidence + " tD " + trendDnEvidence + " rg " + rangeEvidence,
    Color.YELLOW, yes);
plot RawCallCandidate = if showDiagnosticMarkers and callCandidate then low - phaseATR * .08 else Double.NaN;
plot RawPutCandidate = if showDiagnosticMarkers and putCandidate then high + phaseATR * .08 else Double.NaN;
RawCallCandidate.SetPaintingStrategy(PaintingStrategy.POINTS);
RawCallCandidate.SetDefaultColor(Color.CYAN);
RawCallCandidate.SetLineWeight(3);
RawPutCandidate.SetPaintingStrategy(PaintingStrategy.POINTS);
RawPutCandidate.SetDefaultColor(Color.MAGENTA);
RawPutCandidate.SetLineWeight(3);

Alert(enableAlerts and TradeCall,
      "SPX PULSE V13 CALL - check regime label, SPXW liquidity, event risk",
      Alert.BAR, Sound.Chimes);
Alert(enableAlerts and TradePut,
      "SPX PULSE V13 PUT - check regime label, SPXW liquidity, event risk",
      Alert.BAR, Sound.Bell);
Alert(enableAlerts and timeStop,
      "SPX PULSE V13 TIME STOP - 60 min in trade, theta is winning",
      Alert.BAR, Sound.Ring);
Alert(enableAlerts and exitWindow and !exitWindow[1],
      "SPX PULSE V13 - 15:30 hard exit window",
      Alert.BAR, Sound.Ring);

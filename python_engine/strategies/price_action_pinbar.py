"""Strategy 04: Price Action Pinbar & Engulfing Rejection."""

from __future__ import annotations

from typing import List, Optional
import numpy as np

from core.indicators import ema
from core.models import Candle, StrategySignal
from strategies.base import BaseStrategy


class PriceActionPinbarEngulfing(BaseStrategy):
    name = "Price Action Pinbar / Engulfing"
    description = "Detects institutional rejection pinbars and full engulfing candles aligned with EMA(50)."
    supported_timeframes = ("15s", "30s", "1m", "5m", "15m")

    def evaluate(
        self, candles: List[Candle], asset: str, timeframe: str
    ) -> Optional[StrategySignal]:
        if len(candles) < 55:
            return None
        opens, highs, lows, closes, _ = self.to_arrays(candles)
        trend_ema = ema(closes, 50)
        if np.isnan(trend_ema[-1]):
            return None

        o, h, l, c = opens[-1], highs[-1], lows[-1], closes[-1]
        po, pc = opens[-2], closes[-2]
        body = abs(c - o)
        total = max(h - l, 1e-9)
        upper_wick = h - max(o, c)
        lower_wick = min(o, c) - l

        # Bullish Pinbar or Bullish Engulfing
        bull_pinbar = lower_wick >= body * 2.5 and upper_wick <= total * 0.20 and body > 0 and c > o
        bull_engulf = pc < po and c > o and c > po and o <= pc and body > abs(pc - po) * 1.25
        if (bull_pinbar or bull_engulf) and c >= trend_ema[-1]:
            kind = "Bullish Pinbar" if bull_pinbar else "Bullish Engulfing"
            return StrategySignal(
                direction="CALL",
                confidence=82.5 if bull_pinbar else 79.5,
                reason=f"{kind} rejection above EMA(50)",
            )

        # Bearish Pinbar or Bearish Engulfing
        bear_pinbar = upper_wick >= body * 2.5 and lower_wick <= total * 0.20 and body > 0 and c < o
        bear_engulf = pc > po and c < o and c < po and o >= pc and body > abs(pc - po) * 1.25
        if (bear_pinbar or bear_engulf) and c <= trend_ema[-1]:
            kind = "Bearish Pinbar" if bear_pinbar else "Bearish Engulfing"
            return StrategySignal(
                direction="PUT",
                confidence=82.5 if bear_pinbar else 79.5,
                reason=f"{kind} rejection below EMA(50)",
            )
        return None

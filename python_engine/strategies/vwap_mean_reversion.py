"""Strategy 09: Rolling VWAP Mean Reversion."""

from __future__ import annotations

from typing import List, Optional
import numpy as np

from core.indicators import atr, rolling_vwap
from core.models import Candle, StrategySignal
from strategies.base import BaseStrategy


class VwapMeanReversion(BaseStrategy):
    name = "VWAP Mean Reversion"
    description = "Fades 1.8x ATR extensions away from rolling 20-bar VWAP on reversal candle close."
    supported_timeframes = ("15s", "30s", "1m", "5m")

    def evaluate(
        self, candles: List[Candle], asset: str, timeframe: str
    ) -> Optional[StrategySignal]:
        if len(candles) < 30:
            return None
        opens, highs, lows, closes, volumes = self.to_arrays(candles)
        vwap = rolling_vwap(highs, lows, closes, volumes, period=20)
        atr_vals = atr(highs, lows, closes, period=14)

        if np.isnan(vwap[-1]) or np.isnan(atr_vals[-1]) or atr_vals[-1] <= 0:
            return None

        dist = (closes[-1] - vwap[-1]) / atr_vals[-1]

        # Stretched >= 2.1x ATR below VWAP after bearish exhaustion, closing bullish
        if dist <= -2.1 and closes[-2] < opens[-2] and closes[-1] > opens[-1]:
            return StrategySignal(
                direction="CALL",
                confidence=round(min(91.0, 76.0 + abs(dist) * 3.8), 1),
                reason=f"Price stretched {dist:.2f}x ATR below VWAP with bullish reversal close",
            )

        # Stretched >= 2.1x ATR above VWAP after bullish exhaustion, closing bearish
        if dist >= 2.1 and closes[-2] > opens[-2] and closes[-1] < opens[-1]:
            return StrategySignal(
                direction="PUT",
                confidence=round(min(91.0, 76.0 + abs(dist) * 3.8), 1),
                reason=f"Price stretched +{dist:.2f}x ATR above VWAP with bearish reversal close",
            )
        return None

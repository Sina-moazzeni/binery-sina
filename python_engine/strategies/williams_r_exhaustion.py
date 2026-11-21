"""Strategy 08: Williams %R Exhaustion Turn (Extreme Double-Oscillator Confirmation)."""

from __future__ import annotations

from typing import List, Optional
import numpy as np

from core.indicators import rsi, williams_r
from core.models import Candle, StrategySignal
from strategies.base import BaseStrategy


class WilliamsRExhaustion(BaseStrategy):
    name = "Williams %R Exhaustion"
    description = "Identifies sharp snap-back reversals exiting -90/-10 Williams %R extremes confirmed by RSI(7) and reversal candle."
    supported_timeframes = ("30s", "1m", "5m", "15m")

    def evaluate(
        self, candles: List[Candle], asset: str, timeframe: str
    ) -> Optional[StrategySignal]:
        if len(candles) < 28:
            return None
        opens, highs, lows, closes, _ = self.to_arrays(candles)
        wr = williams_r(highs, lows, closes, period=14)
        fast_rsi = rsi(closes, period=7)

        if np.isnan(wr[-2]) or np.isnan(fast_rsi[-2]):
            return None

        if wr[-2] <= -90.0 and wr[-1] > -80.0 and fast_rsi[-2] <= 25.0 and fast_rsi[-1] > fast_rsi[-2] and closes[-1] > opens[-1]:
            return StrategySignal(
                direction="CALL",
                confidence=80.0,
                reason=f"Williams %R extreme snap-back ({wr[-2]:.1f} -> {wr[-1]:.1f}) + RSI(7) turn",
                indicators={"williams_r": round(float(wr[-1]), 1)},
            )

        if wr[-2] >= -10.0 and wr[-1] < -20.0 and fast_rsi[-2] >= 75.0 and fast_rsi[-1] < fast_rsi[-2] and closes[-1] < opens[-1]:
            return StrategySignal(
                direction="PUT",
                confidence=80.0,
                reason=f"Williams %R extreme snap-back ({wr[-2]:.1f} -> {wr[-1]:.1f}) + RSI(7) turn",
                indicators={"williams_r": round(float(wr[-1]), 1)},
            )
        return None

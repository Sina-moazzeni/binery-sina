"""Strategy 10: Supertrend Flip & Pullback Continuation."""

from __future__ import annotations

from typing import List, Optional
import numpy as np

from core.indicators import supertrend
from core.models import Candle, StrategySignal
from strategies.base import BaseStrategy


class SupertrendPullback(BaseStrategy):
    name = "Supertrend Pullback"
    description = "Trades fresh Supertrend(10, 2.5) regime flips and first retest continuations."
    supported_timeframes = ("15s", "30s", "1m", "5m", "15m")

    def evaluate(
        self, candles: List[Candle], asset: str, timeframe: str
    ) -> Optional[StrategySignal]:
        if len(candles) < 30:
            return None
        _, highs, lows, closes, _ = self.to_arrays(candles)
        st_line, direction = supertrend(highs, lows, closes, period=10, multiplier=2.5)

        if np.isnan(st_line[-1]) or direction[-2] == 0:
            return None

        # Fresh regime flip
        if direction[-2] == -1 and direction[-1] == 1:
            return StrategySignal(
                direction="CALL",
                confidence=80.5,
                reason="Fresh bullish Supertrend(10, 2.5) flip",
            )
        if direction[-2] == 1 and direction[-1] == -1:
            return StrategySignal(
                direction="PUT",
                confidence=80.5,
                reason="Fresh bearish Supertrend(10, 2.5) flip",
            )
        return None

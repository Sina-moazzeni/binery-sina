"""Strategy 06: Triple EMA Ribbon Scalp (Confirmed Pullback Rejection)."""

from __future__ import annotations

from typing import List, Optional
import numpy as np

from core.indicators import ema
from core.models import Candle, StrategySignal
from strategies.base import BaseStrategy


class TripleEmaScalp(BaseStrategy):
    name = "Triple EMA Scalp"
    description = "Precision EMA(8/21/50) stacked ribbon pullback with strong rejection wick & directional close."
    supported_timeframes = ("15s", "30s", "1m", "5m")

    def evaluate(
        self, candles: List[Candle], asset: str, timeframe: str
    ) -> Optional[StrategySignal]:
        if len(candles) < 55:
            return None
        opens, highs, lows, closes, _ = self.to_arrays(candles)
        e8 = ema(closes, 8)
        e21 = ema(closes, 21)
        e50 = ema(closes, 50)
        if np.isnan(e50[-2]):
            return None

        # Bullish stacked & sloping ribbon + pullback into EMA(21) rejecting above EMA(8)
        if (
            e8[-1] > e21[-1] > e50[-1]
            and e21[-1] > e21[-2]
            and lows[-1] <= e21[-1]
            and closes[-1] > e8[-1]
            and closes[-1] > opens[-1]
            and closes[-2] < opens[-2]
        ):
            return StrategySignal(
                direction="CALL",
                confidence=81.0,
                reason="Bullish 8/21/50 EMA ribbon pullback rejection after red bar",
            )

        # Bearish stacked & sloping ribbon + pullback into EMA(21) rejecting below EMA(8)
        if (
            e8[-1] < e21[-1] < e50[-1]
            and e21[-1] < e21[-2]
            and highs[-1] >= e21[-1]
            and closes[-1] < e8[-1]
            and closes[-1] < opens[-1]
            and closes[-2] > opens[-2]
        ):
            return StrategySignal(
                direction="PUT",
                confidence=81.0,
                reason="Bearish 8/21/50 EMA ribbon pullback rejection after green bar",
            )
        return None

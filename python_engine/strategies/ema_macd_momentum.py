"""Strategy 02: EMA Crossover + MACD Momentum (EMA50 Trend Aligned)."""

from __future__ import annotations

from typing import List, Optional
import numpy as np

from core.indicators import ema, macd
from core.models import Candle, StrategySignal
from strategies.base import BaseStrategy


class EmaMacdMomentum(BaseStrategy):
    name = "EMA Cross + MACD Momentum"
    description = "Captures fresh EMA(9/21) crossovers aligned with EMA(50) macro slope and expanding MACD histogram."
    supported_timeframes = ("30s", "1m", "5m", "15m")

    def evaluate(
        self, candles: List[Candle], asset: str, timeframe: str
    ) -> Optional[StrategySignal]:
        if len(candles) < 55:
            return None
        opens, _, _, closes, _ = self.to_arrays(candles)
        fast = ema(closes, 9)
        slow = ema(closes, 21)
        macro = ema(closes, 50)
        _, _, hist = macd(closes, 12, 26, 9)

        if np.isnan(fast[-2]) or np.isnan(slow[-2]) or np.isnan(macro[-1]) or np.isnan(hist[-3]):
            return None

        bull_cross = fast[-2] <= slow[-2] and fast[-1] > slow[-1]
        bear_cross = fast[-2] >= slow[-2] and fast[-1] < slow[-1]

        if bull_cross and closes[-1] > macro[-1] and closes[-1] > opens[-1] and hist[-1] > 0 and hist[-1] > hist[-2] > hist[-3]:
            return StrategySignal(
                direction="CALL",
                confidence=82.5,
                reason="EMA 9/21 bullish cross above EMA(50) with 2-bar expanding MACD",
                indicators={"macd_hist": round(float(hist[-1]), 6)},
            )

        if bear_cross and closes[-1] < macro[-1] and closes[-1] < opens[-1] and hist[-1] < 0 and hist[-1] < hist[-2] < hist[-3]:
            return StrategySignal(
                direction="PUT",
                confidence=82.5,
                reason="EMA 9/21 bearish cross below EMA(50) with 2-bar expanding MACD",
                indicators={"macd_hist": round(float(hist[-1]), 6)},
            )
        return None

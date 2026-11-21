"""Strategy 03: Stochastic + Dynamic Support/Resistance Bounce (Strict Wick Confirmation)."""

from __future__ import annotations

from typing import List, Optional
import numpy as np

from core.indicators import stochastic
from core.models import Candle, StrategySignal
from strategies.base import BaseStrategy


class StochasticSRBounce(BaseStrategy):
    name = "Stochastic + S/R Bounce"
    description = "Triggers on deep oversold/overbought %K/%D crossover (<20 / >80) with rejection close at 30-bar S/R."
    supported_timeframes = ("30s", "1m", "5m", "15m")

    def evaluate(
        self, candles: List[Candle], asset: str, timeframe: str
    ) -> Optional[StrategySignal]:
        if len(candles) < 40:
            return None
        opens, highs, lows, closes, _ = self.to_arrays(candles)
        k, d = stochastic(highs, lows, closes, k_period=14, d_period=3)
        if np.isnan(k[-2]) or np.isnan(d[-2]):
            return None

        support = float(np.min(lows[-31:-1]))
        resistance = float(np.max(highs[-31:-1]))
        rng = max(resistance - support, 1e-9)
        zone = rng * 0.10
        o, c = float(opens[-1]), float(closes[-1])

        bull_cross = k[-2] <= d[-2] and k[-1] > d[-1] and k[-2] < 20.0 and k[-1] < 26.0
        bear_cross = k[-2] >= d[-2] and k[-1] < d[-1] and k[-2] > 80.0 and k[-1] > 74.0

        if bull_cross and lows[-1] <= support + zone and c > o:
            return StrategySignal(
                direction="CALL",
                confidence=80.5,
                reason=f"Deep oversold Stoch cross (%K={k[-1]:.1f}) + bullish bounce at 30-bar support",
                indicators={"stoch_k": round(float(k[-1]), 2)},
            )

        if bear_cross and highs[-1] >= resistance - zone and c < o:
            return StrategySignal(
                direction="PUT",
                confidence=80.5,
                reason=f"Deep overbought Stoch cross (%K={k[-1]:.1f}) + bearish rejection at 30-bar resistance",
                indicators={"stoch_k": round(float(k[-1]), 2)},
            )
        return None

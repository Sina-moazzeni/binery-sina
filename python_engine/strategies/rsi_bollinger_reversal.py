"""Strategy 01: RSI + Bollinger Bands Mean Reversal (High-Precision Confirmation)."""

from __future__ import annotations

from typing import List, Optional
import numpy as np

from core.indicators import bollinger_bands, rsi
from core.models import Candle, StrategySignal
from strategies.base import BaseStrategy


class RsiBollingerReversal(BaseStrategy):
    name = "RSI + Bollinger Reversal"
    description = "Fades outer 2.2-std Bollinger Band pierces confirmed by extreme RSI(14) <= 26 / >= 74 and reversal close."
    supported_timeframes = ("15s", "30s", "1m", "5m", "15m")

    def evaluate(
        self, candles: List[Candle], asset: str, timeframe: str
    ) -> Optional[StrategySignal]:
        if len(candles) < 35:
            return None
        opens, highs, lows, closes, _ = self.to_arrays(candles)
        upper, _, lower, _ = bollinger_bands(closes, period=20, std_mult=2.2)
        rsi_vals = rsi(closes, period=14)

        r, r_prev = float(rsi_vals[-1]), float(rsi_vals[-2])
        u, l = float(upper[-1]), float(lower[-1])
        o, c, h, lo = float(opens[-1]), float(closes[-1]), float(highs[-1]), float(lows[-1])
        if np.isnan(r) or np.isnan(r_prev) or np.isnan(u) or np.isnan(l):
            return None

        # Require outer band pierce + extreme RSI + bullish reversal close (turning up)
        if lo <= l and r <= 26.0 and r > r_prev and c > o:
            depth = min(16.0, (26.0 - r) * 1.1)
            return StrategySignal(
                direction="CALL",
                confidence=round(79.0 + depth, 1),
                reason=f"Confirmed lower BB(2.2) rejection with RSI={r:.1f} turning up",
                indicators={"rsi": round(r, 2)},
            )

        # Require outer band pierce + extreme RSI + bearish reversal close (turning down)
        if h >= u and r >= 74.0 and r < r_prev and c < o:
            depth = min(16.0, (r - 74.0) * 1.1)
            return StrategySignal(
                direction="PUT",
                confidence=round(79.0 + depth, 1),
                reason=f"Confirmed upper BB(2.2) rejection with RSI={r:.1f} turning down",
                indicators={"rsi": round(r, 2)},
            )
        return None

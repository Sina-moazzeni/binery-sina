"""Strategy 07: Keltner Squeeze Breakout."""

from __future__ import annotations

from typing import List, Optional
import numpy as np

from core.indicators import bollinger_bands, keltner_channels
from core.models import Candle, StrategySignal
from strategies.base import BaseStrategy


class KeltnerSqueezeBreakout(BaseStrategy):
    name = "Keltner Squeeze Breakout"
    description = "Fires when Bollinger Bands release from inside Keltner Channels with directional close."
    supported_timeframes = ("15s", "30s", "1m", "5m", "15m")

    def evaluate(
        self, candles: List[Candle], asset: str, timeframe: str
    ) -> Optional[StrategySignal]:
        if len(candles) < 30:
            return None
        _, highs, lows, closes, _ = self.to_arrays(candles)
        bb_u, bb_m, bb_l, _ = bollinger_bands(closes, period=20, std_mult=2.0)
        kc_u, _, kc_l = keltner_channels(highs, lows, closes, ema_period=20, atr_period=10, mult=1.5)

        if np.isnan(bb_u[-2]) or np.isnan(kc_u[-2]):
            return None

        was_squeezed = bb_u[-2] < kc_u[-2] and bb_l[-2] > kc_l[-2]
        now_released = bb_u[-1] >= kc_u[-1] or bb_l[-1] <= kc_l[-1]

        if was_squeezed and now_released:
            if closes[-1] > bb_m[-1] and closes[-1] > closes[-2]:
                return StrategySignal(
                    direction="CALL",
                    confidence=81.0,
                    reason="TTM Squeeze bullish volatility expansion release",
                )
            if closes[-1] < bb_m[-1] and closes[-1] < closes[-2]:
                return StrategySignal(
                    direction="PUT",
                    confidence=81.0,
                    reason="TTM Squeeze bearish volatility expansion release",
                )
        return None

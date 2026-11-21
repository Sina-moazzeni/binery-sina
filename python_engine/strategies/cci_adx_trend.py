"""Strategy 05: CCI + ADX Trend Continuation (Strict Directional Breakout)."""

from __future__ import annotations

from typing import List, Optional
import numpy as np

from core.indicators import adx, cci
from core.models import Candle, StrategySignal
from strategies.base import BaseStrategy


class CciAdxTrend(BaseStrategy):
    name = "CCI + ADX Trend"
    description = "Enters confirmed trends when ADX >= 25 shows rising directional momentum and CCI crosses +/-120."
    supported_timeframes = ("30s", "1m", "5m", "15m")

    def evaluate(
        self, candles: List[Candle], asset: str, timeframe: str
    ) -> Optional[StrategySignal]:
        if len(candles) < 40:
            return None
        opens, highs, lows, closes, _ = self.to_arrays(candles)
        cci_vals = cci(highs, lows, closes, period=20)
        adx_vals, pdi, mdi = adx(highs, lows, closes, period=14)

        if np.isnan(cci_vals[-2]) or np.isnan(adx_vals[-2]):
            return None
        if adx_vals[-1] < 25.0 or adx_vals[-1] < adx_vals[-2]:
            return None

        if pdi[-1] > mdi[-1] + 4.0 and cci_vals[-2] <= 120.0 < cci_vals[-1] and closes[-1] > opens[-1]:
            conf = min(92.0, 79.0 + (adx_vals[-1] - 25.0) * 0.45)
            return StrategySignal(
                direction="CALL",
                confidence=round(float(conf), 1),
                reason=f"Rising ADX={adx_vals[-1]:.1f} (+DI>-DI) with CCI break > +120",
                indicators={"adx": round(float(adx_vals[-1]), 1), "cci": round(float(cci_vals[-1]), 1)},
            )

        if mdi[-1] > pdi[-1] + 4.0 and cci_vals[-2] >= -120.0 > cci_vals[-1] and closes[-1] < opens[-1]:
            conf = min(92.0, 79.0 + (adx_vals[-1] - 25.0) * 0.45)
            return StrategySignal(
                direction="PUT",
                confidence=round(float(conf), 1),
                reason=f"Rising ADX={adx_vals[-1]:.1f} (-DI>+DI) with CCI break < -120",
                indicators={"adx": round(float(adx_vals[-1]), 1), "cci": round(float(cci_vals[-1]), 1)},
            )
        return None

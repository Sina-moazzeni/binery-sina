"""Market Condition & Volatility Regime Detector using ATR, ADX, and Bollinger Band Width."""

from __future__ import annotations

import time
from typing import Dict, List
import numpy as np

from core.indicators import adx, atr, bollinger_bands
from core.models import Candle, MacroBias, MarketHealth, MarketRegime, MarketType


class MarketRegimeFilter:
    """Classifies each monitored asset into OPTIMAL, EXTREME_VOLATILITY, or DEAD_RANGE."""

    def __init__(self) -> None:
        self._health: Dict[str, MarketHealth] = {}
        self._macro_bias: Dict[str, MacroBias] = {}

    def set_macro_bias(self, asset: str, bias: MacroBias) -> None:
        self._macro_bias[asset] = bias
        if asset in self._health:
            self._health[asset].macro_bias = bias

    def get_macro_bias(self, asset: str) -> MacroBias:
        return self._macro_bias.get(asset, "NEUTRAL")

    def evaluate(
        self,
        asset: str,
        market_type: MarketType,
        candles: List[Candle],
        recent_prices: List[float],
    ) -> MarketHealth:
        """Analyze latest candle window and return updated MarketHealth snapshot."""
        now = time.time()
        price = candles[-1].close if candles else (recent_prices[-1] if recent_prices else 0.0)
        bias = self.get_macro_bias(asset)

        if len(candles) < 35:
            health = MarketHealth(
                asset=asset,
                market_type=market_type,
                price=price,
                regime="OPTIMAL",
                atr_pct=0.04,
                adx=24.0,
                bb_width_pct=0.14,
                macro_bias=bias,
                warning_message="Warming up candle history",
                updated_at=now,
                recent_prices=recent_prices[-24:],
            )
            self._health[asset] = health
            return health

        highs = np.array([c.high for c in candles], dtype=np.float64)
        lows = np.array([c.low for c in candles], dtype=np.float64)
        closes = np.array([c.close for c in candles], dtype=np.float64)

        atr_arr = atr(highs, lows, closes, period=14)
        adx_arr, _, _ = adx(highs, lows, closes, period=14)
        _, _, _, bb_width_arr = bollinger_bands(closes, period=20, std_mult=2.0)

        curr_atr = float(atr_arr[-1]) if not np.isnan(atr_arr[-1]) else 0.0
        baseline_atr = float(np.nanmedian(atr_arr[-45:])) if np.any(~np.isnan(atr_arr[-45:])) else curr_atr
        atr_ratio = curr_atr / (baseline_atr + 1e-12)
        atr_pct = (curr_atr / (abs(price) + 1e-12)) * 100.0

        curr_adx = float(adx_arr[-1]) if not np.isnan(adx_arr[-1]) else 22.0
        curr_bb_w = float(bb_width_arr[-1]) if not np.isnan(bb_width_arr[-1]) else 0.12
        baseline_bb = float(np.nanmedian(bb_width_arr[-45:])) if np.any(~np.isnan(bb_width_arr[-45:])) else curr_bb_w
        bb_ratio = curr_bb_w / (baseline_bb + 1e-12)

        # Latest candle range spike check
        last_range = highs[-1] - lows[-1]
        range_vs_atr = last_range / (baseline_atr + 1e-12)

        regime: MarketRegime
        warning: str

        if atr_ratio >= 1.95 or range_vs_atr >= 3.0 or bb_ratio >= 2.2:
            regime = "EXTREME_VOLATILITY"
            warning = "High Volatility / Spike News — Risky Signals Flagged"
        elif (atr_ratio <= 0.42 and bb_ratio <= 0.55) or (curr_adx < 13.5 and bb_ratio < 0.65):
            regime = "DEAD_RANGE"
            warning = "Low Volatility / Tight Choppy Range — Do Not Trade"
        else:
            regime = "OPTIMAL"
            warning = "Optimal Trending / Clean Reversal Structure"

        health = MarketHealth(
            asset=asset,
            market_type=market_type,
            price=price,
            regime=regime,
            atr_pct=atr_pct,
            adx=curr_adx,
            bb_width_pct=curr_bb_w,
            macro_bias=bias,
            warning_message=warning,
            updated_at=now,
            recent_prices=recent_prices[-24:],
        )
        self._health[asset] = health
        return health

    def get_health(self, asset: str) -> MarketHealth | None:
        return self._health.get(asset)

    def get_all_health(self) -> List[Dict[str, object]]:
        return [h.to_dict() for h in self._health.values()]

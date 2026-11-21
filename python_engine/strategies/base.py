"""Abstract BaseStrategy contract for hot-pluggable binary options strategies."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Optional, Tuple
import numpy as np

from core.models import Candle, StrategySignal


class BaseStrategy(ABC):
    """All strategy plugins in strategies/ must inherit from BaseStrategy."""

    name: str = "Unnamed Strategy"
    description: str = ""
    supported_timeframes: Tuple[str, ...] = ("5s", "15s", "30s", "1m", "5m", "15m")

    @staticmethod
    def to_arrays(
        candles: List[Candle],
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Extract vectorized (opens, highs, lows, closes, volumes) NumPy arrays."""
        opens = np.array([c.open for c in candles], dtype=np.float64)
        highs = np.array([c.high for c in candles], dtype=np.float64)
        lows = np.array([c.low for c in candles], dtype=np.float64)
        closes = np.array([c.close for c in candles], dtype=np.float64)
        volumes = np.array([c.volume for c in candles], dtype=np.float64)
        return opens, highs, lows, closes, volumes

    @abstractmethod
    def evaluate(
        self, candles: List[Candle], asset: str, timeframe: str
    ) -> Optional[StrategySignal]:
        """Return StrategySignal(direction, confidence, reason) or None when no setup exists."""
        raise NotImplementedError

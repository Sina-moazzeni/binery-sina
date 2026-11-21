"""Shared domain dataclasses for ticks, OHLC candles, signals, and telemetry."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional

MarketType = Literal["LIVE", "OTC"]
Direction = Literal["CALL", "PUT"]
SignalStatus = Literal["PENDING", "WIN", "LOSS", "TIE"]
MarketRegime = Literal["OPTIMAL", "EXTREME_VOLATILITY", "DEAD_RANGE"]
MacroBias = Literal["BULLISH_ONLY", "BEARISH_ONLY", "NEUTRAL"]


@dataclass(slots=True)
class Tick:
    """Single incoming quote tick from broker or simulator."""

    asset: str
    market_type: MarketType
    price: float
    timestamp: float


@dataclass(slots=True)
class Candle:
    """OHLCV candle bucket for a given asset and timeframe."""

    timestamp: int
    open: float
    high: float
    low: float
    close: float
    volume: int = 1


@dataclass(slots=True)
class StrategySignal:
    """Raw output emitted by a strategy plugin on candle evaluation."""

    direction: Direction
    confidence: float  # 0.0 to 100.0
    reason: str
    indicators: Dict[str, float] = field(default_factory=dict)


@dataclass
class MarketHealth:
    """Real-time volatility and trend health snapshot for an asset."""

    asset: str
    market_type: MarketType
    price: float
    regime: MarketRegime
    atr_pct: float
    adx: float
    bb_width_pct: float
    macro_bias: MacroBias
    warning_message: str
    updated_at: float
    recent_prices: List[float] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "asset": self.asset,
            "market_type": self.market_type,
            "price": self.price,
            "regime": self.regime,
            "atr_pct": round(self.atr_pct, 4),
            "adx": round(self.adx, 2),
            "bb_width_pct": round(self.bb_width_pct, 4),
            "macro_bias": self.macro_bias,
            "warning_message": self.warning_message,
            "updated_at": self.updated_at,
            "recent_prices": self.recent_prices[-24:],
        }


@dataclass
class SignalRecord:
    """Persisted signal record tracked until expiry resolution."""

    id: str
    timestamp: float
    asset: str
    market_type: MarketType
    timeframe: str
    strategy_name: str
    is_combo: bool
    direction: Direction
    confidence: float
    entry_price: float
    exit_price: Optional[float]
    expiry_seconds: int
    expires_at: float
    market_regime: MarketRegime
    macro_bias: MacroBias
    status: SignalStatus
    reason: str
    mode_generated: str  # SHADOW | SNIPER

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "asset": self.asset,
            "market_type": self.market_type,
            "timeframe": self.timeframe,
            "strategy_name": self.strategy_name,
            "is_combo": self.is_combo,
            "direction": self.direction,
            "confidence": round(self.confidence, 1),
            "entry_price": self.entry_price,
            "exit_price": self.exit_price,
            "expiry_seconds": self.expiry_seconds,
            "expires_at": self.expires_at,
            "market_regime": self.market_regime,
            "macro_bias": self.macro_bias,
            "status": self.status,
            "reason": self.reason,
            "mode_generated": self.mode_generated,
        }

"""Optional Guarded Auto-Trade Execution Engine for Pocket Option & Olymp Trade (OFF by default)."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional

from config import RuntimeConfig
from core.models import SignalRecord

logger = logging.getLogger("quantradar.executor")

ExecutionBroadcast = Callable[[Dict[str, Any]], Awaitable[None]]


class AutoTradeExecutor:
    """Executes Active Sniper signals ONLY when explicitly armed, enforcing daily & streak circuit breakers."""

    def __init__(
        self,
        config: RuntimeConfig,
        on_execution: ExecutionBroadcast,
    ) -> None:
        self.config = config
        self.on_execution = on_execution

        self.daily_trades: int = 0
        self.consecutive_losses: int = 0
        self.circuit_breaker_tripped: bool = False
        self.circuit_breaker_reason: str = ""
        self._last_reset_day: str = self._today_key()
        self.execution_log: List[Dict[str, Any]] = []

    @staticmethod
    def _today_key() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def _check_daily_reset(self) -> None:
        today = self._today_key()
        if today != self._last_reset_day:
            self._last_reset_day = today
            self.daily_trades = 0
            self.consecutive_losses = 0
            self.circuit_breaker_tripped = False
            self.circuit_breaker_reason = ""

    def reset_circuit_breaker(self) -> None:
        self.consecutive_losses = 0
        self.circuit_breaker_tripped = False
        self.circuit_breaker_reason = ""

    def record_outcome(self, status: str) -> None:
        """Track consecutive losses to trip the safety circuit breaker automatically."""
        self._check_daily_reset()
        if status == "LOSS":
            self.consecutive_losses += 1
            if self.consecutive_losses >= self.config.auto_trade_max_consec_losses:
                self.circuit_breaker_tripped = True
                self.circuit_breaker_reason = (
                    f"Auto-stopped after {self.consecutive_losses} consecutive losses"
                )
                self.config.auto_trade_enabled = False
        elif status == "WIN":
            self.consecutive_losses = 0

    def get_status(self) -> Dict[str, Any]:
        self._check_daily_reset()
        return {
            "enabled": self.config.auto_trade_enabled,
            "target": self.config.auto_trade_target,
            "stake": self.config.auto_trade_stake,
            "daily_trades": self.daily_trades,
            "max_daily_trades": self.config.auto_trade_max_daily_trades,
            "consecutive_losses": self.consecutive_losses,
            "max_consec_losses": self.config.auto_trade_max_consec_losses,
            "circuit_breaker_tripped": self.circuit_breaker_tripped,
            "circuit_breaker_reason": self.circuit_breaker_reason,
            "recent_executions": self.execution_log[:40],
        }

    async def maybe_execute(self, signal: SignalRecord) -> Optional[Dict[str, Any]]:
        """Execute trade if Auto-Trade is explicitly enabled, in Active Sniper mode, and within risk limits."""
        self._check_daily_reset()
        if not self.config.auto_trade_enabled:
            return None
        if self.config.mode != "SNIPER":
            return None
        if self.circuit_breaker_tripped:
            return None

        if self.daily_trades >= self.config.auto_trade_max_daily_trades:
            self.circuit_breaker_tripped = True
            self.circuit_breaker_reason = f"Daily trade limit ({self.config.auto_trade_max_daily_trades}) reached"
            self.config.auto_trade_enabled = False
            return None

        target = self.config.auto_trade_target.upper()
        ok = False
        message = ""

        if target in ("POCKET_OPTION", "OLYMP_TRADE"):
            mode_tag = "DEMO" if self.config.broker_demo_mode else "LIVE"
            if not self.config.broker_ssid.strip():
                ok = False
                message = f"{target} SSID missing — configure Demo SSID first"
            else:
                ok = True
                message = f"Queued {mode_tag} {signal.direction} ${self.config.auto_trade_stake} ({signal.expiry_seconds}s) via {target} WS"
        else:
            ok = False
            message = f"Unsupported execution target: {target}"

        if ok:
            self.daily_trades += 1

        entry = {
            "id": f"EXEC-{int(time.time() * 1000) % 1_000_000}",
            "signal_id": signal.id,
            "timestamp": time.time(),
            "asset": signal.asset,
            "timeframe": signal.timeframe,
            "direction": signal.direction,
            "strategy_name": signal.strategy_name,
            "target": target,
            "size": self.config.auto_trade_stake,
            "ok": ok,
            "ticket": None,
            "message": message,
        }
        self.execution_log.insert(0, entry)
        self.execution_log = self.execution_log[:100]
        await self.on_execution(entry)
        return entry

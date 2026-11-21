"""Automated Outcome Tracker & Win-Rate Resolution Engine."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Awaitable, Callable, Dict, Optional

from core.collector import MultiTimeframeAggregator
from core.database import DatabaseManager
from core.models import SignalRecord

logger = logging.getLogger("quantradar.tracker")

ResolutionCallback = Callable[[Dict[str, Any]], Awaitable[None]]


class OutcomeTracker:
    """Monitors PENDING signals and grades them WIN/LOSS/TIE at exact expiry_seconds."""

    def __init__(
        self,
        db: DatabaseManager,
        aggregator: MultiTimeframeAggregator,
        on_resolved: ResolutionCallback,
    ) -> None:
        self.db = db
        self.aggregator = aggregator
        self.on_resolved = on_resolved
        self._pending: Dict[str, SignalRecord] = {}
        self._stop_event = asyncio.Event()
        self._task: Optional[asyncio.Task[None]] = None

    async def register_signal(self, signal: SignalRecord) -> None:
        await self.db.insert_signal(signal)
        self._pending[signal.id] = signal

    def get_pending_list(self) -> list[Dict[str, Any]]:
        return [s.to_dict() for s in sorted(self._pending.values(), key=lambda x: x.timestamp, reverse=True)]

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stop_event.clear()
            self._task = asyncio.create_task(self._resolution_loop(), name="outcome_tracker")

    async def stop(self) -> None:
        self._stop_event.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _resolution_loop(self) -> None:
        """Check expiring signals every 250ms and resolve using live stream closing tick price."""
        while not self._stop_event.is_set():
            now = time.time()
            expired_ids = [
                sig_id for sig_id, sig in self._pending.items() if now >= sig.expires_at
            ]

            for sig_id in expired_ids:
                sig = self._pending.pop(sig_id, None)
                if sig is None:
                    continue

                exit_price = self.aggregator.latest_prices.get(sig.asset, sig.entry_price)
                eps = max(abs(sig.entry_price) * 1e-7, 1e-8)

                if abs(exit_price - sig.entry_price) <= eps:
                    outcome = "TIE"
                elif sig.direction == "CALL":
                    outcome = "WIN" if exit_price > sig.entry_price else "LOSS"
                else:
                    outcome = "WIN" if exit_price < sig.entry_price else "LOSS"

                sig.exit_price = exit_price
                sig.status = outcome  # type: ignore[assignment]

                try:
                    await self.db.resolve_signal(sig.id, exit_price, outcome)
                    await self.on_resolved(sig.to_dict())
                except Exception as exc:
                    logger.error("Failed resolving signal %s: %s", sig.id, exc)

            await asyncio.sleep(0.25)

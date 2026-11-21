"""Modular Strategy Engine: Watchlist/Timeframe scoping, High-Precision Gate, Confluence Combos, and Auto-Trade Hook."""

from __future__ import annotations

import asyncio
import importlib.util
import inspect
import logging
import time
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple
import httpx

from config import DEFAULT_EXPIRY_SECONDS, TIMEFRAMES, RuntimeConfig
from core.database import DatabaseManager
from core.executor import AutoTradeExecutor
from core.market_filter import MarketRegimeFilter
from core.models import Candle, MarketType, SignalRecord, StrategySignal
from core.tracker import OutcomeTracker
from strategies.base import BaseStrategy

logger = logging.getLogger("quantradar.engine")

SignalBroadcast = Callable[[Dict[str, Any], bool], Awaitable[None]]


class StrategyEngine:
    """Auto-discovers BaseStrategy plugins, scopes by Watchlist/Timeframes, and routes Alerts + Optional Auto-Trade."""

    def __init__(
        self,
        config: RuntimeConfig,
        db: DatabaseManager,
        market_filter: MarketRegimeFilter,
        tracker: OutcomeTracker,
        on_signal_emitted: SignalBroadcast,
        executor: Optional[AutoTradeExecutor] = None,
    ) -> None:
        self.config = config
        self.db = db
        self.market_filter = market_filter
        self.tracker = tracker
        self.on_signal_emitted = on_signal_emitted
        self.executor = executor

        self.strategies: Dict[str, BaseStrategy] = {}
        self._cooldowns: Dict[Tuple[str, str, str], float] = {}
        self._settings_cache: Dict[str, Dict[str, Any]] = {}

    async def discover_strategies(self) -> List[str]:
        self.strategies.clear()
        strat_dir: Path = self.config.strategies_dir
        loaded: List[str] = []

        if not strat_dir.exists():
            return loaded

        for py_file in sorted(strat_dir.glob("*.py")):
            if py_file.name.startswith("_") or py_file.name == "base.py":
                continue

            module_name = f"strategies.{py_file.stem}"
            spec = importlib.util.spec_from_file_location(module_name, py_file)
            if spec is None or spec.loader is None:
                continue

            module = importlib.util.module_from_spec(spec)
            try:
                spec.loader.exec_module(module)
            except Exception as exc:
                logger.error("Failed loading strategy %s: %s", py_file.name, exc)
                continue

            for _, obj in inspect.getmembers(module, inspect.isclass):
                if issubclass(obj, BaseStrategy) and obj is not BaseStrategy:
                    instance = obj()
                    self.strategies[instance.name] = instance
                    loaded.append(instance.name)
                    await self.db.upsert_strategy_setting(
                        strategy_name=instance.name,
                        is_combo=False,
                        description=instance.description,
                        default_shadow=True,
                        default_live=False,
                    )

        await self.refresh_settings_cache()
        logger.info("Auto-discovered %d strategies", len(loaded))
        return loaded

    async def refresh_settings_cache(self) -> None:
        self._settings_cache = await self.db.get_all_strategy_settings()

    async def evaluate_candle_close(
        self,
        asset: str,
        market_type: MarketType,
        timeframe: str,
        candles: List[Candle],
    ) -> None:
        """Evaluate ONLY when broker is active and asset/timeframe are explicitly selected by the user."""
        if len(candles) < 35:
            return

        # Strict opt-in: NEVER run any strategy test until the user explicitly selects assets & timeframes
        if not self.config.selected_assets or asset not in self.config.selected_assets:
            return
        if not self.config.selected_timeframes or timeframe not in self.config.selected_timeframes:
            return

        health = self.market_filter.get_health(asset)
        regime = health.regime if health else "OPTIMAL"
        macro_bias = health.macro_bias if health else "NEUTRAL"

        if regime == "EXTREME_VOLATILITY" and self.config.block_extreme_volatility:
            return
        if regime == "DEAD_RANGE" and self.config.block_dead_range:
            return

        now = time.time()
        entry_price = candles[-1].close
        expiry = DEFAULT_EXPIRY_SECONDS.get(timeframe, 60)

        hits_by_dir: Dict[str, List[Tuple[str, StrategySignal]]] = {"CALL": [], "PUT": []}

        for strat_name, strategy in self.strategies.items():
            if timeframe not in strategy.supported_timeframes:
                continue

            setting = self._settings_cache.get(strat_name, {})
            shadow_on = bool(setting.get("shadow_enabled", True))
            live_on = bool(setting.get("live_active", False))

            if self.config.mode == "SHADOW" and not shadow_on:
                continue
            if self.config.mode == "SNIPER" and not live_on:
                continue

            try:
                result = strategy.evaluate(candles, asset, timeframe)
            except Exception as exc:
                logger.debug("Strategy %s error: %s", strat_name, exc)
                continue

            if result is None:
                continue

            # High-Precision Gate: enforce strict confidence & directional strength
            if self.config.high_precision_mode:
                if result.confidence < self.config.min_signal_confidence:
                    continue
                if health and health.adx < 18.0:
                    continue

            if self.config.ai_analyst_enabled:
                if macro_bias == "BULLISH_ONLY" and result.direction == "PUT":
                    continue
                if macro_bias == "BEARISH_ONLY" and result.direction == "CALL":
                    continue

            hits_by_dir[result.direction].append((strat_name, result))

            await self._maybe_emit_signal(
                asset=asset,
                market_type=market_type,
                timeframe=timeframe,
                strategy_name=strat_name,
                is_combo=False,
                direction=result.direction,
                confidence=result.confidence,
                entry_price=entry_price,
                expiry=expiry,
                regime=regime,
                macro_bias=macro_bias,
                reason=result.reason,
                now=now,
                is_live_eligible=live_on,
            )

        if self.config.enable_confluence_combos:
            for direction in ("CALL", "PUT"):
                agreeing = hits_by_dir[direction]
                if len(agreeing) >= self.config.min_confluence_strategies:
                    agreeing.sort(key=lambda pair: pair[1].confidence, reverse=True)
                    top_pair = agreeing[:3]
                    combo_name = " + ".join(sorted(name for name, _ in top_pair[:2]))
                    await self.db.upsert_strategy_setting(
                        strategy_name=combo_name,
                        is_combo=True,
                        description=f"Confluence combo ({len(agreeing)} strategies aligned)",
                        default_shadow=True,
                        default_live=False,
                    )
                    if combo_name not in self._settings_cache:
                        await self.refresh_settings_cache()

                    avg_conf = sum(s.confidence for _, s in top_pair) / len(top_pair)
                    boost = min(14.0, (len(agreeing) - 1) * 7.5)
                    combo_conf = min(99.0, avg_conf + boost)

                    combo_setting = self._settings_cache.get(combo_name, {})
                    await self._maybe_emit_signal(
                        asset=asset,
                        market_type=market_type,
                        timeframe=timeframe,
                        strategy_name=combo_name,
                        is_combo=True,
                        direction=direction,  # type: ignore[arg-type]
                        confidence=combo_conf,
                        entry_price=entry_price,
                        expiry=expiry,
                        regime=regime,
                        macro_bias=macro_bias,
                        reason=f"{len(agreeing)}-strategy confluence alignment",
                        now=now,
                        is_live_eligible=bool(combo_setting.get("live_active", False)),
                    )

    async def _maybe_emit_signal(
        self,
        *,
        asset: str,
        market_type: MarketType,
        timeframe: str,
        strategy_name: str,
        is_combo: bool,
        direction: str,
        confidence: float,
        entry_price: float,
        expiry: int,
        regime: str,
        macro_bias: str,
        reason: str,
        now: float,
        is_live_eligible: bool,
    ) -> None:
        key = (strategy_name, asset, timeframe)
        last_ts = self._cooldowns.get(key, 0.0)
        tf_sec = TIMEFRAMES.get(timeframe, 60)
        effective_cooldown = max(self.config.signal_cooldown_seconds, tf_sec * 3)
        if now - last_ts < effective_cooldown:
            return
        self._cooldowns[key] = now

        sig = SignalRecord(
            id=f"SIG-{uuid.uuid4().hex[:10].upper()}",
            timestamp=now,
            asset=asset,
            market_type=market_type,
            timeframe=timeframe,
            strategy_name=strategy_name,
            is_combo=is_combo,
            direction=direction,  # type: ignore[arg-type]
            confidence=round(min(99.0, max(50.0, confidence)), 1),
            entry_price=entry_price,
            exit_price=None,
            expiry_seconds=expiry,
            expires_at=now + expiry,
            market_regime=regime,  # type: ignore[arg-type]
            macro_bias=macro_bias,  # type: ignore[arg-type]
            status="PENDING",
            reason=reason,
            mode_generated=self.config.mode,
        )

        await self.tracker.register_signal(sig)
        trigger_alert = self.config.mode == "SNIPER" and is_live_eligible
        await self.on_signal_emitted(sig.to_dict(), trigger_alert)

        if trigger_alert:
            if self.executor and self.config.auto_trade_enabled:
                asyncio.create_task(self.executor.maybe_execute(sig))
            if self.config.telegram_bot_token and self.config.telegram_chat_id:
                asyncio.create_task(self._send_telegram_alert(sig))

    async def _send_telegram_alert(self, sig: SignalRecord) -> None:
        token = self.config.telegram_bot_token.strip()
        chat_id = self.config.telegram_chat_id.strip()
        if not token or not chat_id:
            return
        arrow = "CALL (UP)" if sig.direction == "CALL" else "PUT (DOWN)"
        text = (
            f"QuantRadar Active Sniper Signal\n"
            f"Asset: {sig.asset} ({sig.market_type})\n"
            f"Direction: {arrow}\n"
            f"Strategy: {sig.strategy_name}\n"
            f"Timeframe: {sig.timeframe} | Expiry: {sig.expiry_seconds}s\n"
            f"Confidence: {sig.confidence:.1f}%\n"
            f"Entry: {sig.entry_price}"
        )
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                await client.post(url, json={"chat_id": chat_id, "text": text})
        except Exception as exc:
            logger.warning("Telegram alert failed: %s", exc)

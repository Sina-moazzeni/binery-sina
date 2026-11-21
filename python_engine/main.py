"""QuantRadar — FastAPI + WebSocket Entry Point for Windows Server (python main.py)."""

from __future__ import annotations

import asyncio
import csv
import io
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional, Set

import psutil
import uvicorn
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from config import BASE_DIR, DEFAULT_ASSETS, TIMEFRAMES, RuntimeConfig
from core.ai_analyst import AIAnalystLayer
from core.collector import BrokerCollector, MultiTimeframeAggregator
from core.database import DatabaseManager
from core.engine import StrategyEngine
from core.executor import AutoTradeExecutor
from core.market_filter import MarketRegimeFilter
from core.models import Candle, MarketType, Tick
from core.tracker import OutcomeTracker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("quantradar.main")


class ConnectionHub:
    def __init__(self) -> None:
        self._clients: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    async def broadcast(self, event_type: str, payload: Any) -> None:
        if not self._clients:
            return
        message = json.dumps({"type": event_type, "data": payload})
        stale: List[WebSocket] = []
        for ws in list(self._clients):
            try:
                await ws.send_text(message)
            except Exception:
                stale.append(ws)
        for ws in stale:
            self._clients.discard(ws)


config = RuntimeConfig()
hub = ConnectionHub()
db = DatabaseManager(config.db_path)
aggregator = MultiTimeframeAggregator()
market_filter = MarketRegimeFilter()


async def _on_execution(entry: Dict[str, Any]) -> None:
    await hub.broadcast("execution:new", {"entry": entry, "status": executor.get_status()})


executor = AutoTradeExecutor(
    config=config,
    on_execution=_on_execution,
)


async def _on_signal_resolved(sig_dict: Dict[str, Any]) -> None:
    if config.mode == "SNIPER" and config.auto_trade_enabled:
        executor.record_outcome(str(sig_dict.get("status", "")))
    await hub.broadcast("signal:resolved", sig_dict)
    leaderboard = await db.get_strategy_leaderboard()
    await hub.broadcast("leaderboard:update", leaderboard)
    await hub.broadcast("autotrade:update", executor.get_status())


tracker = OutcomeTracker(db=db, aggregator=aggregator, on_resolved=_on_signal_resolved)


async def _on_signal_emitted(sig_dict: Dict[str, Any], trigger_alert: bool) -> None:
    await hub.broadcast("signal:new", {"signal": sig_dict, "trigger_alert": trigger_alert})


engine = StrategyEngine(
    config=config,
    db=db,
    market_filter=market_filter,
    tracker=tracker,
    on_signal_emitted=_on_signal_emitted,
    executor=executor,
)


async def _on_tick(tick: Tick) -> None:
    existing = market_filter.get_health(tick.asset)
    if existing:
        existing.price = tick.price
        existing.recent_prices = aggregator.get_recent_prices(tick.asset)[-24:]


async def _on_candle_close(
    asset: str, market_type: MarketType, timeframe: str, candles: List[Candle]
) -> None:
    if timeframe in ("5s", "15s", "1m"):
        market_filter.evaluate(asset, market_type, candles, aggregator.get_recent_prices(asset))
    await engine.evaluate_candle_close(asset, market_type, timeframe, candles)


collector = BrokerCollector(
    config=config,
    aggregator=aggregator,
    on_candle_close=_on_candle_close,
    on_tick=_on_tick,
)
ai_analyst = AIAnalystLayer(config=config, aggregator=aggregator, market_filter=market_filter)


def _build_telemetry_payload() -> Dict[str, Any]:
    process = psutil.Process()
    cpu_pct = psutil.cpu_percent(interval=None)
    vm = psutil.virtual_memory()
    proc_mb = process.memory_info().rss / (1024 * 1024)
    return {
        "cpu_pct": round(cpu_pct, 1),
        "ram_pct": round(vm.percent, 1),
        "process_mb": round(proc_mb, 1),
        "ws_connected": collector.connected,
        "ws_detail": collector.connection_detail,
        "broker_provider": config.broker_provider,
        "mode": config.mode,
        "server_time": time.time(),
        "market_health": market_filter.get_all_health(),
    }


async def _telemetry_broadcaster(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await hub.broadcast("telemetry:update", _build_telemetry_payload())
        except Exception as exc:
            logger.debug("Telemetry broadcast warning: %s", exc)
        await asyncio.sleep(2.0)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await db.init()
    await engine.discover_strategies()

    for item in DEFAULT_ASSETS:
        sym = str(item["symbol"])
        mtype: MarketType = "OTC" if item["market_type"] == "OTC" else "LIVE"
        candles = aggregator.get_candles(sym, "1m")
        market_filter.evaluate(sym, mtype, candles, aggregator.get_recent_prices(sym))

    collector.start()
    tracker.start()
    ai_analyst.start()

    stop_event = asyncio.Event()
    telemetry_task = asyncio.create_task(_telemetry_broadcaster(stop_event))
    logger.info("QuantRadar running at http://%s:%d", config.host, config.port)
    try:
        yield
    finally:
        stop_event.set()
        telemetry_task.cancel()
        await ai_analyst.stop()
        await tracker.stop()
        await collector.stop()
        await db.close()


app = FastAPI(title="QuantRadar Signal Engine", lifespan=lifespan)


class ModePayload(BaseModel):
    mode: str = Field(..., pattern="^(SHADOW|SNIPER)$")


class ScopePayload(BaseModel):
    selected_assets: List[str] = Field(default_factory=list)
    selected_timeframes: List[str] = Field(default_factory=list)
    high_precision_mode: bool = True
    min_signal_confidence: float = Field(78.0, ge=50.0, le=95.0)
    custom_symbol: Optional[str] = None


class StrategyTogglePayload(BaseModel):
    strategy_name: str
    shadow_enabled: Optional[bool] = None
    live_active: Optional[bool] = None


class SelectTopPayload(BaseModel):
    min_win_rate: float = Field(68.0, ge=0.0, le=100.0)
    min_signals: int = Field(10, ge=1, le=500)


class BrokerConfigPayload(BaseModel):
    broker_provider: str = Field(..., pattern="^(NONE|MOCK|POCKET_OPTION|OLYMP_TRADE)$")
    broker_demo_mode: bool = True
    broker_ssid: Optional[str] = None
    block_extreme_volatility: bool = True
    block_dead_range: bool = True
    enable_confluence_combos: bool = True
    ai_analyst_enabled: bool = False
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None


class TestConnectionPayload(BaseModel):
    broker_provider: str = Field(..., pattern="^(NONE|MOCK|POCKET_OPTION|OLYMP_TRADE)$")
    broker_demo_mode: bool = True
    broker_ssid: Optional[str] = None


class AutoTradePayload(BaseModel):
    enabled: bool = False
    target: str = Field("POCKET_OPTION", pattern="^(POCKET_OPTION|OLYMP_TRADE)$")
    stake: float = Field(10.0, ge=1.0, le=10000.0)
    max_daily_trades: int = Field(20, ge=1, le=500)
    max_consec_losses: int = Field(3, ge=1, le=20)
    reset_breaker: bool = False


@app.get("/")
async def serve_dashboard() -> FileResponse:
    index_path = BASE_DIR / "web" / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="web/index.html not found")
    return FileResponse(index_path)


@app.get("/api/state")
async def get_initial_state() -> Dict[str, Any]:
    leaderboard = await db.get_strategy_leaderboard()
    recent_signals = await db.query_signals(limit=120)
    return {
        "mode": config.mode,
        "selected_assets": config.selected_assets,
        "selected_timeframes": config.selected_timeframes,
        "high_precision_mode": config.high_precision_mode,
        "min_signal_confidence": config.min_signal_confidence,
        "broker_provider": config.broker_provider,
        "broker_demo_mode": config.broker_demo_mode,
        "ssid_configured": bool(config.broker_ssid.strip()),
        "telegram_configured": bool(config.telegram_bot_token and config.telegram_chat_id),
        "ai_analyst_enabled": config.ai_analyst_enabled,
        "block_extreme_volatility": config.block_extreme_volatility,
        "block_dead_range": config.block_dead_range,
        "enable_confluence_combos": config.enable_confluence_combos,
        "auto_trade": executor.get_status(),
        "ws_connected": collector.connected,
        "ws_detail": collector.connection_detail,
        "timeframes": list(TIMEFRAMES.keys()),
        "assets": collector.get_all_assets(),
        "pending_signals": tracker.get_pending_list(),
        "recent_signals": recent_signals,
        "leaderboard": leaderboard,
        "market_health": market_filter.get_all_health(),
    }


@app.post("/api/mode")
async def update_mode(body: ModePayload) -> Dict[str, Any]:
    config.mode = body.mode
    await hub.broadcast("mode:update", {"mode": config.mode})
    await hub.broadcast("telemetry:update", _build_telemetry_payload())
    return {"ok": True, "mode": config.mode}


@app.post("/api/scope")
async def update_scope(body: ScopePayload) -> Dict[str, Any]:
    selected = list(body.selected_assets)
    if body.custom_symbol and body.custom_symbol.strip():
        sym = body.custom_symbol.strip().upper()
        collector.register_asset(sym)
        candles = aggregator.get_candles(sym, "1m")
        mtype: MarketType = "OTC" if "OTC" in sym else "LIVE"
        market_filter.evaluate(sym, mtype, candles, aggregator.get_recent_prices(sym))
        if sym not in selected:
            selected.append(sym)

    valid_tfs = [tf for tf in body.selected_timeframes if tf in TIMEFRAMES]
    config.selected_assets = selected
    config.selected_timeframes = valid_tfs if valid_tfs else ["5m"]
    config.high_precision_mode = body.high_precision_mode
    config.min_signal_confidence = body.min_signal_confidence

    payload = {
        "selected_assets": config.selected_assets,
        "selected_timeframes": config.selected_timeframes,
        "high_precision_mode": config.high_precision_mode,
        "min_signal_confidence": config.min_signal_confidence,
        "assets": collector.get_all_assets(),
    }
    await hub.broadcast("scope:update", payload)
    return {"ok": True, **payload}


@app.post("/api/autotrade")
async def update_autotrade(body: AutoTradePayload) -> Dict[str, Any]:
    if body.reset_breaker:
        executor.reset_circuit_breaker()
    config.auto_trade_enabled = body.enabled and not executor.circuit_breaker_tripped
    config.auto_trade_target = body.target
    config.auto_trade_stake = body.stake
    config.auto_trade_max_daily_trades = body.max_daily_trades
    config.auto_trade_max_consec_losses = body.max_consec_losses
    status = executor.get_status()
    await hub.broadcast("autotrade:update", status)
    return {"ok": True, "auto_trade": status}


@app.post("/api/strategies/toggle")
async def toggle_strategy(body: StrategyTogglePayload) -> Dict[str, Any]:
    await db.set_strategy_flags(
        body.strategy_name,
        shadow_enabled=body.shadow_enabled,
        live_active=body.live_active,
    )
    await engine.refresh_settings_cache()
    leaderboard = await db.get_strategy_leaderboard()
    await hub.broadcast("leaderboard:update", leaderboard)
    return {"ok": True, "leaderboard": leaderboard}


@app.post("/api/strategies/select-top")
async def select_top_performers(body: SelectTopPayload) -> Dict[str, Any]:
    leaderboard = await db.get_strategy_leaderboard()
    activated: List[str] = []
    for row in leaderboard:
        qualifies = (
            row["total_signals"] >= body.min_signals
            and row["wr_last_100"] >= body.min_win_rate
        )
        await db.set_strategy_flags(row["strategy_name"], live_active=qualifies)
        if qualifies:
            activated.append(row["strategy_name"])

    await engine.refresh_settings_cache()
    updated = await db.get_strategy_leaderboard()
    await hub.broadcast("leaderboard:update", updated)
    return {"ok": True, "activated_count": len(activated), "activated": activated, "leaderboard": updated}


@app.post("/api/strategies/reload")
async def reload_strategies() -> Dict[str, Any]:
    loaded = await engine.discover_strategies()
    leaderboard = await db.get_strategy_leaderboard()
    await hub.broadcast("leaderboard:update", leaderboard)
    return {"ok": True, "loaded": loaded, "leaderboard": leaderboard}


@app.post("/api/broker/test-connection")
async def test_broker_connection(body: TestConnectionPayload) -> Dict[str, Any]:
    ssid_to_test = (body.broker_ssid or "").strip() or config.broker_ssid.strip()
    return await collector.test_connection(
        provider=body.broker_provider,
        ssid=ssid_to_test,
        demo_mode=body.broker_demo_mode,
    )


@app.post("/api/broker/disconnect")
async def disconnect_broker() -> Dict[str, Any]:
    config.broker_provider = "NONE"
    collector.connected = False
    collector.connection_detail = "Disconnected — Connect Broker SSID to Start"
    collector.trigger_reconnect()
    await hub.broadcast("telemetry:update", _build_telemetry_payload())
    return {"ok": True, "broker_provider": "NONE", "ws_connected": False}


@app.post("/api/config/broker")
async def update_broker_config(body: BrokerConfigPayload) -> Dict[str, Any]:
    provider_changed = (
        config.broker_provider != body.broker_provider
        or config.broker_demo_mode != body.broker_demo_mode
        or bool(body.broker_ssid and body.broker_ssid.strip())
    )
    config.broker_provider = body.broker_provider
    config.broker_demo_mode = body.broker_demo_mode
    if body.broker_ssid and body.broker_ssid.strip():
        config.broker_ssid = body.broker_ssid.strip()

    config.block_extreme_volatility = body.block_extreme_volatility
    config.block_dead_range = body.block_dead_range
    config.enable_confluence_combos = body.enable_confluence_combos
    config.ai_analyst_enabled = body.ai_analyst_enabled

    if body.telegram_bot_token and body.telegram_bot_token.strip():
        config.telegram_bot_token = body.telegram_bot_token.strip()
    if body.telegram_chat_id and body.telegram_chat_id.strip():
        config.telegram_chat_id = body.telegram_chat_id.strip()

    if provider_changed:
        collector.trigger_reconnect()

    await hub.broadcast("telemetry:update", _build_telemetry_payload())
    return {
        "ok": True,
        "broker_provider": config.broker_provider,
        "broker_demo_mode": config.broker_demo_mode,
        "ssid_configured": bool(config.broker_ssid.strip()),
        "telegram_configured": bool(config.telegram_bot_token and config.telegram_chat_id),
    }


@app.post("/api/history/clear")
async def clear_history() -> Dict[str, Any]:
    await db.clear_signals()
    leaderboard = await db.get_strategy_leaderboard()
    await hub.broadcast("leaderboard:update", leaderboard)
    return {"ok": True, "leaderboard": leaderboard}


@app.get("/api/history")
async def get_history(
    strategy: Optional[str] = Query(default=None),
    asset: Optional[str] = Query(default=None),
    market_type: Optional[str] = Query(default=None),
    timeframe: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=250, ge=1, le=2000),
) -> Dict[str, Any]:
    rows = await db.query_signals(
        strategy=strategy,
        asset=asset,
        market_type=market_type,
        timeframe=timeframe,
        status=status,
        limit=limit,
    )
    return {"signals": rows}


@app.get("/api/history/export.csv")
async def export_history_csv(
    strategy: Optional[str] = Query(default=None),
    asset: Optional[str] = Query(default=None),
    market_type: Optional[str] = Query(default=None),
    timeframe: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
) -> StreamingResponse:
    rows = await db.query_signals(
        strategy=strategy,
        asset=asset,
        market_type=market_type,
        timeframe=timeframe,
        status=status,
        limit=2000,
    )
    buf = io.StringIO()
    fields = [
        "id",
        "timestamp",
        "asset",
        "market_type",
        "timeframe",
        "strategy_name",
        "direction",
        "confidence",
        "entry_price",
        "exit_price",
        "expiry_seconds",
        "market_regime",
        "macro_bias",
        "status",
        "mode_generated",
        "reason",
    ]
    writer = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for r in rows:
        writer.writerow(r)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="quantradar_signals.csv"'},
    )


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await hub.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(ws)
    except Exception:
        hub.disconnect(ws)


if __name__ == "__main__":
    uvicorn.run("main:app", host=config.host, port=config.port, reload=False, log_level="info")

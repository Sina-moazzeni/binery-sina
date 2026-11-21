"""Async Data Collector supporting Pocket Option WS, Olymp Trade WS, and explicit Mock Simulator."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import random
import time
from collections import deque
from typing import Any, Awaitable, Callable, Deque, Dict, List, Optional, Tuple
import websockets

from config import BROKER_WS_ENDPOINTS, DEFAULT_ASSETS, TIMEFRAMES, RuntimeConfig
from core.models import Candle, MarketType, Tick

logger = logging.getLogger("quantradar.collector")

CandleCallback = Callable[[str, MarketType, str, List[Candle]], Awaitable[None]]
TickCallback = Callable[[Tick], Awaitable[None]]


class MultiTimeframeAggregator:
    """Maintains rolling OHLCV candles across 5s, 15s, 30s, 1m, 5m, 15m per asset."""

    def __init__(self, max_candles: int = 240) -> None:
        self.max_candles = max_candles
        self._candles: Dict[str, Dict[str, Deque[Candle]]] = {}
        self.latest_prices: Dict[str, float] = {}
        self.recent_ticks: Dict[str, Deque[float]] = {}

    def seed_history(
        self, asset: str, base_price: float, pip: float, bars: int = 120
    ) -> None:
        now = int(time.time())
        self._candles.setdefault(asset, {})
        self.recent_ticks.setdefault(asset, deque(maxlen=60))

        price = base_price
        for tf_name, tf_sec in TIMEFRAMES.items():
            dq: Deque[Candle] = deque(maxlen=self.max_candles)
            p = base_price
            start_bucket = (now // tf_sec) * tf_sec - bars * tf_sec
            drift = random.uniform(-0.15, 0.15) * pip
            for idx in range(bars):
                ts = start_bucket + idx * tf_sec
                scale = math.sqrt(max(tf_sec, 5) / 5.0)
                wave = math.sin(idx / 9.0) * pip * 1.4 * scale
                step = random.gauss(drift, pip * 1.6 * scale) + wave * 0.25
                o = p
                c = max(pip * 10, o + step)
                h = max(o, c) + abs(random.gauss(0, pip * 1.1 * scale))
                l = min(o, c) - abs(random.gauss(0, pip * 1.1 * scale))
                dq.append(
                    Candle(
                        timestamp=ts,
                        open=o,
                        high=h,
                        low=l,
                        close=c,
                        volume=random.randint(12, 85),
                    )
                )
                p = c
            self._candles[asset][tf_name] = dq
            price = p

        self.latest_prices[asset] = price
        for _ in range(24):
            self.recent_ticks[asset].append(price + random.gauss(0, pip * 0.8))

    def ingest_tick(self, tick: Tick) -> List[str]:
        asset = tick.asset
        self.latest_prices[asset] = tick.price
        self.recent_ticks.setdefault(asset, deque(maxlen=60)).append(tick.price)

        tf_map = self._candles.setdefault(asset, {})
        closed_timeframes: List[str] = []

        for tf_name, tf_sec in TIMEFRAMES.items():
            dq = tf_map.setdefault(tf_name, deque(maxlen=self.max_candles))
            bucket_ts = int(tick.timestamp // tf_sec) * tf_sec

            if not dq:
                dq.append(
                    Candle(
                        timestamp=bucket_ts,
                        open=tick.price,
                        high=tick.price,
                        low=tick.price,
                        close=tick.price,
                        volume=1,
                    )
                )
                continue

            current = dq[-1]
            if bucket_ts == current.timestamp:
                if tick.price > current.high:
                    current.high = tick.price
                if tick.price < current.low:
                    current.low = tick.price
                current.close = tick.price
                current.volume += 1
            elif bucket_ts > current.timestamp:
                closed_timeframes.append(tf_name)
                dq.append(
                    Candle(
                        timestamp=bucket_ts,
                        open=tick.price,
                        high=tick.price,
                        low=tick.price,
                        close=tick.price,
                        volume=1,
                    )
                )

        return closed_timeframes

    def get_candles(self, asset: str, timeframe: str) -> List[Candle]:
        dq = self._candles.get(asset, {}).get(timeframe)
        return list(dq) if dq else []

    def get_recent_prices(self, asset: str) -> List[float]:
        return list(self.recent_ticks.get(asset, ()))


class BrokerCollector:
    """Connects to Pocket Option WS, Olymp Trade WS, explicit Mock Simulator, or stays strictly idle (NONE)."""

    def __init__(
        self,
        config: RuntimeConfig,
        aggregator: MultiTimeframeAggregator,
        on_candle_close: CandleCallback,
        on_tick: TickCallback,
    ) -> None:
        self.config = config
        self.aggregator = aggregator
        self.on_candle_close = on_candle_close
        self.on_tick = on_tick

        self.connected: bool = False
        self.connection_detail: str = "Disconnected — Connect Broker SSID to Start"
        self._stop_event = asyncio.Event()
        self._restart_event = asyncio.Event()
        self._task: Optional[asyncio.Task[None]] = None

        self._sim_state: Dict[str, List[float]] = {}
        self._asset_meta: Dict[str, Tuple[MarketType, float]] = {}

        for item in DEFAULT_ASSETS:
            self.register_asset(
                str(item["symbol"]),
                "OTC" if item["market_type"] == "OTC" else "LIVE",
                float(item["base_price"]),
                float(item["pip"]),
            )

    def register_asset(
        self,
        symbol: str,
        market_type: MarketType = "LIVE",
        base_price: float = 1.1000,
        pip: float = 0.00008,
    ) -> None:
        """Dynamically add a user-specified symbol to the collector catalog."""
        clean = symbol.strip().upper()
        if not clean or clean in self._asset_meta:
            return
        mtype: MarketType = "OTC" if "OTC" in clean else market_type
        self._asset_meta[clean] = (mtype, pip)
        self._sim_state[clean] = [base_price, random.uniform(-0.35, 0.35), 1.0, random.randint(25, 65)]
        self.aggregator.seed_history(clean, base_price, pip, bars=110)

    def get_all_assets(self) -> List[str]:
        return list(self._asset_meta.keys())

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stop_event.clear()
            self._task = asyncio.create_task(self._supervisor_loop(), name="broker_collector")

    async def stop(self) -> None:
        self._stop_event.set()
        self._restart_event.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def trigger_reconnect(self) -> None:
        self._restart_event.set()

    async def test_connection(
        self, provider: str, ssid: str, demo_mode: bool = True
    ) -> Dict[str, Any]:
        """Verify live WebSocket handshake & session authentication before enabling real streaming."""
        prov = provider.upper().strip()
        token = ssid.strip()
        started = time.perf_counter()

        if prov == "NONE":
            return {
                "ok": False,
                "provider": prov,
                "latency_ms": 0,
                "message": "No broker selected. Choose Pocket Option, Olymp Trade, or Mock Simulator.",
            }

        if prov == "MOCK":
            return {
                "ok": True,
                "provider": "MOCK",
                "latency_ms": 1,
                "message": "Local Mock/Replay Simulator ready. Select assets & click Apply to start testing.",
            }

        if not token or len(token) < 8:
            return {
                "ok": False,
                "provider": prov,
                "latency_ms": 0,
                "message": "Session SSID is empty or too short. Copy the full SSID from Browser DevTools (Network → WS).",
            }

        try:
            if prov == "POCKET_OPTION":
                url = (
                    BROKER_WS_ENDPOINTS["POCKET_OPTION_DEMO"]
                    if demo_mode
                    else BROKER_WS_ENDPOINTS["POCKET_OPTION_LIVE"]
                )
                headers = {
                    "Origin": "https://pocketoption.com",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) QuantRadar/1.0",
                }
                async with websockets.connect(
                    url, additional_headers=headers, open_timeout=6.0, close_timeout=2.0
                ) as ws:
                    first_frame = await asyncio.wait_for(ws.recv(), timeout=4.0)
                    await ws.send("40")
                    await asyncio.sleep(0.2)
                    if token.startswith("42"):
                        await ws.send(token)
                    else:
                        auth_frame = json.dumps(
                            ["auth", {"session": token, "isDemo": 1 if demo_mode else 0}]
                        )
                        await ws.send(f"42{auth_frame}")

                    auth_reply = ""
                    try:
                        for _ in range(3):
                            msg = await asyncio.wait_for(ws.recv(), timeout=1.8)
                            text = msg.decode("utf-8", errors="ignore") if isinstance(msg, bytes) else str(msg)
                            auth_reply = text
                            lowered = text.lower()
                            if "notauthorized" in lowered or "auth_error" in lowered or "unauthorized" in lowered:
                                latency_ms = int((time.perf_counter() - started) * 1000)
                                return {
                                    "ok": False,
                                    "provider": prov,
                                    "latency_ms": latency_ms,
                                    "message": "WebSocket reached Pocket Option, but the SSID was rejected (expired or invalid session).",
                                }
                            if "successauth" in lowered or "updatebalance" in lowered or "updatestream" in lowered:
                                break
                    except asyncio.TimeoutError:
                        pass

                    latency_ms = int((time.perf_counter() - started) * 1000)
                    mode_tag = "Demo" if demo_mode else "Live"
                    return {
                        "ok": True,
                        "provider": prov,
                        "latency_ms": latency_ms,
                        "message": f"Pocket Option ({mode_tag}) WebSocket handshake & auth succeeded ({latency_ms} ms).",
                        "detail": str(first_frame)[:60] if not auth_reply else auth_reply[:80],
                    }

            if prov == "OLYMP_TRADE":
                url = BROKER_WS_ENDPOINTS["OLYMP_TRADE"]
                headers = {
                    "Origin": "https://olymptrade.com",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) QuantRadar/1.0",
                    "Cookie": f"ssid={token}",
                }
                async with websockets.connect(
                    url, additional_headers=headers, open_timeout=6.0, close_timeout=2.0
                ) as ws:
                    await ws.send(json.dumps([{"t": 2, "e": 10, "d": [{"pair": "EURUSD"}]}]))
                    reply = ""
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=2.5)
                        reply = raw.decode("utf-8", errors="ignore") if isinstance(raw, bytes) else str(raw)
                        if "unauthorized" in reply.lower() or "forbidden" in reply.lower():
                            latency_ms = int((time.perf_counter() - started) * 1000)
                            return {
                                "ok": False,
                                "provider": prov,
                                "latency_ms": latency_ms,
                                "message": "Olymp Trade WebSocket connected, but session cookie (ssid) was rejected.",
                            }
                    except asyncio.TimeoutError:
                        pass

                    latency_ms = int((time.perf_counter() - started) * 1000)
                    return {
                        "ok": True,
                        "provider": prov,
                        "latency_ms": latency_ms,
                        "message": f"Olymp Trade WebSocket connected & verified ({latency_ms} ms).",
                        "detail": reply[:80],
                    }

            return {
                "ok": False,
                "provider": prov,
                "latency_ms": 0,
                "message": f"Unsupported broker provider: {prov}",
            }
        except asyncio.TimeoutError:
            latency_ms = int((time.perf_counter() - started) * 1000)
            return {
                "ok": False,
                "provider": prov,
                "latency_ms": latency_ms,
                "message": f"Connection timed out after {latency_ms} ms. Check VPN/firewall or broker availability.",
            }
        except Exception as exc:
            latency_ms = int((time.perf_counter() - started) * 1000)
            return {
                "ok": False,
                "provider": prov,
                "latency_ms": latency_ms,
                "message": f"Connection failed ({type(exc).__name__}): {str(exc)[:140]}",
            }

    async def _supervisor_loop(self) -> None:
        backoff = 1.0
        while not self._stop_event.is_set():
            self._restart_event.clear()
            provider = self.config.broker_provider.upper()
            try:
                if provider == "NONE":
                    self.connected = False
                    self.connection_detail = "Disconnected — Connect Broker SSID to Start"
                    backoff = 1.0
                    await self._wait_idle()
                elif provider == "POCKET_OPTION":
                    if not self.config.broker_ssid.strip():
                        self.connected = False
                        self.connection_detail = "Pocket Option SSID Missing — Disconnected"
                        await self._wait_idle()
                    else:
                        await self._run_pocket_option_ws()
                        backoff = 1.0
                elif provider == "OLYMP_TRADE":
                    if not self.config.broker_ssid.strip():
                        self.connected = False
                        self.connection_detail = "Olymp Trade SSID Missing — Disconnected"
                        await self._wait_idle()
                    else:
                        await self._run_olymp_trade_ws()
                        backoff = 1.0
                elif provider == "MOCK":
                    self.connected = True
                    self.connection_detail = "Mock/Replay Simulator Active"
                    backoff = 1.0
                    await self._run_mock_simulator()
                else:
                    self.connected = False
                    self.connection_detail = "Disconnected"
                    await self._wait_idle()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self.connected = False
                self.connection_detail = f"Reconnecting ({type(exc).__name__})"
                logger.warning("Data feed dropped: %s. Retrying in %.1fs", exc, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2.0, 30.0)

    async def _wait_idle(self) -> None:
        while not self._stop_event.is_set() and not self._restart_event.is_set():
            await asyncio.sleep(0.5)

    async def _dispatch_tick(self, tick: Tick) -> None:
        if tick.asset not in self._asset_meta:
            self.register_asset(tick.asset, tick.market_type, tick.price)
        # Strict opt-in: never process or evaluate unselected assets
        if not self.config.selected_assets or tick.asset not in self.config.selected_assets:
            return
        closed_tfs = self.aggregator.ingest_tick(tick)
        await self.on_tick(tick)
        for tf in closed_tfs:
            candles = self.aggregator.get_candles(tick.asset, tf)
            await self.on_candle_close(tick.asset, tick.market_type, tf, candles)

    async def _run_mock_simulator(self) -> None:
        tick_index = 0
        while not self._stop_event.is_set() and not self._restart_event.is_set():
            if not self.config.selected_assets:
                self.connection_detail = "Simulator Ready — Select Assets to Start Testing"
                await asyncio.sleep(0.6)
                continue

            self.connection_detail = f"Simulator Active ({len(self.config.selected_assets)} Assets)"
            now = time.time()
            tick_index += 1
            for sym in list(self.config.selected_assets):
                meta = self._asset_meta.get(sym)
                if not meta:
                    self.register_asset(sym)
                    meta = self._asset_meta[sym]
                mtype, pip = meta
                state = self._sim_state[sym]
                price, trend, vol_mult, ttl = state

                ttl -= 1
                if ttl <= 0:
                    roll = random.random()
                    if roll < 0.65:
                        vol_mult = random.uniform(0.9, 1.45)
                        trend = random.choice([-1.0, 1.0]) * random.uniform(0.22, 0.55)
                        ttl = random.randint(45, 95)
                    elif roll < 0.83:
                        vol_mult = random.uniform(3.2, 4.8)
                        trend = random.uniform(-0.8, 0.8)
                        ttl = random.randint(20, 40)
                    else:
                        vol_mult = random.uniform(0.12, 0.25)
                        trend = 0.0
                        ttl = random.randint(25, 45)

                mean_wave = math.sin(tick_index / 14.0 + hash(sym) % 11) * pip * 0.45 * vol_mult
                delta = (trend * pip * 0.42) + random.gauss(0.0, pip * 1.15 * vol_mult) + mean_wave
                price = max(pip * 20, price + delta)

                state[0], state[1], state[2], state[3] = price, trend, vol_mult, ttl
                await self._dispatch_tick(
                    Tick(asset=sym, market_type=mtype, price=round(price, 6), timestamp=now)
                )

            await asyncio.sleep(0.5)

    async def _run_pocket_option_ws(self) -> None:
        url = (
            BROKER_WS_ENDPOINTS["POCKET_OPTION_DEMO"]
            if self.config.broker_demo_mode
            else BROKER_WS_ENDPOINTS["POCKET_OPTION_LIVE"]
        )
        headers = {
            "Origin": "https://pocketoption.com",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) QuantRadar/1.0",
        }
        async with websockets.connect(url, additional_headers=headers, ping_interval=20, ping_timeout=15) as ws:
            self.connected = True
            mode_label = "Demo" if self.config.broker_demo_mode else "Live"
            self.connection_detail = f"Pocket Option {mode_label} Connected"

            await ws.send("40")
            await asyncio.sleep(0.3)
            ssid_payload = self.config.broker_ssid.strip()
            if ssid_payload.startswith("42"):
                await ws.send(ssid_payload)
            else:
                auth_frame = json.dumps(
                    ["auth", {"session": ssid_payload, "isDemo": 1 if self.config.broker_demo_mode else 0}]
                )
                await ws.send(f"42{auth_frame}")

            while not self._stop_event.is_set() and not self._restart_event.is_set():
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=25.0)
                except asyncio.TimeoutError:
                    await ws.send("2")
                    continue

                if raw == "2":
                    await ws.send("3")
                    continue

                if isinstance(raw, bytes):
                    raw = raw.decode("utf-8", errors="ignore")

                await self._parse_pocket_option_message(raw)

    async def _parse_pocket_option_message(self, raw: str) -> None:
        if not raw.startswith("42"):
            return
        try:
            payload = json.loads(raw[2:])
        except json.JSONDecodeError:
            return
        if not isinstance(payload, list) or len(payload) < 2:
            return
        event_name, data = payload[0], payload[1]
        if event_name not in ("updateStream", "quote", "price"):
            return
        records = data if isinstance(data, list) else [data]
        for rec in records:
            if isinstance(rec, list) and len(rec) >= 3:
                raw_symbol = str(rec[0])
                ts = float(rec[1])
                price = float(rec[2])
                is_otc = "otc" in raw_symbol.lower()
                clean_sym = self._normalize_symbol(raw_symbol, is_otc)
                await self._dispatch_tick(
                    Tick(
                        asset=clean_sym,
                        market_type="OTC" if is_otc else "LIVE",
                        price=price,
                        timestamp=ts if ts > 1_000_000_000 else time.time(),
                    )
                )

    async def _run_olymp_trade_ws(self) -> None:
        url = BROKER_WS_ENDPOINTS["OLYMP_TRADE"]
        headers = {
            "Origin": "https://olymptrade.com",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) QuantRadar/1.0",
            "Cookie": f"ssid={self.config.broker_ssid.strip()}",
        }
        async with websockets.connect(url, additional_headers=headers, ping_interval=20, ping_timeout=15) as ws:
            self.connected = True
            self.connection_detail = "Olymp Trade WebSocket Connected"

            watch = self.config.selected_assets or []
            if watch:
                sub_pairs = [a.replace("/", "").replace(" OTC", "_OTC") for a in watch]
                await ws.send(json.dumps([{"t": 2, "e": 10, "d": [{"pair": p} for p in sub_pairs]}]))

            while not self._stop_event.is_set() and not self._restart_event.is_set():
                raw = await asyncio.wait_for(ws.recv(), timeout=30.0)
                try:
                    frames = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(frames, list):
                    continue
                for frame in frames:
                    if not isinstance(frame, dict):
                        continue
                    data_list = frame.get("d")
                    if not isinstance(data_list, list):
                        continue
                    for item in data_list:
                        if isinstance(item, dict) and "p" in item and "q" in item:
                            raw_sym = str(item["p"])
                            is_otc = "otc" in raw_sym.lower()
                            clean_sym = self._normalize_symbol(raw_sym, is_otc)
                            await self._dispatch_tick(
                                Tick(
                                    asset=clean_sym,
                                    market_type="OTC" if is_otc else "LIVE",
                                    price=float(item["q"]),
                                    timestamp=float(item.get("t", time.time())),
                                )
                            )

    @staticmethod
    def _normalize_symbol(raw: str, is_otc: bool) -> str:
        clean = raw.upper().replace("_OTC", "").replace("-OTC", "").replace("OTC", "").strip()
        if len(clean) == 6 and "/" not in clean:
            clean = f"{clean[:3]}/{clean[3:]}"
        return f"{clean} OTC" if is_otc else clean

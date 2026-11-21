"""Optional Non-Blocking Async AI Analyst Layer for Macro Trend Bias filtering."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import socket
from typing import Dict, List, Optional
from urllib.parse import urlparse
import httpx
import numpy as np

from config import DEFAULT_ASSETS, RuntimeConfig
from core.collector import MultiTimeframeAggregator
from core.indicators import ema
from core.market_filter import MarketRegimeFilter
from core.models import MacroBias

logger = logging.getLogger("quantradar.ai_analyst")


def _validate_external_https_url(url: str) -> bool:
    """Block non-HTTPS schemes and private/loopback/link-local addresses (SSRF protection)."""
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        return False
    host = parsed.hostname.lower()
    if host in ("localhost", "127.0.0.1", "::1", "169.254.169.254"):
        return False
    try:
        infos = socket.getaddrinfo(host, parsed.port or 443, proto=socket.IPPROTO_TCP)
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return False
    except OSError:
        return False
    return True


class AIAnalystLayer:
    """Runs asynchronously every 10-15 minutes to classify Macro Trend Bias per asset.

    Zero impact on millisecond signal execution latency: stores cached bias in MarketRegimeFilter.
    """

    def __init__(
        self,
        config: RuntimeConfig,
        aggregator: MultiTimeframeAggregator,
        market_filter: MarketRegimeFilter,
    ) -> None:
        self.config = config
        self.aggregator = aggregator
        self.market_filter = market_filter
        self._stop_event = asyncio.Event()
        self._task: Optional[asyncio.Task[None]] = None
        self.last_run_at: float = 0.0

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stop_event.clear()
            self._task = asyncio.create_task(self._loop(), name="ai_analyst")

    async def stop(self) -> None:
        self._stop_event.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                await self.run_once()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("AI Analyst cycle error: %s", exc)

            wait_sec = max(60, int(self.config.ai_analyst_interval_seconds))
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=wait_sec)
            except asyncio.TimeoutError:
                continue

    async def run_once(self) -> Dict[str, MacroBias]:
        """Compute Macro Trend Bias for all monitored assets."""
        results: Dict[str, MacroBias] = {}
        use_llm = bool(
            self.config.ai_analyst_enabled
            and self.config.ai_analyst_api_key.strip()
            and _validate_external_https_url(self.config.ai_analyst_api_url)
        )

        for item in DEFAULT_ASSETS:
            asset = str(item["symbol"])
            candles = self.aggregator.get_candles(asset, "5m")
            if len(candles) < 30:
                candles = self.aggregator.get_candles(asset, "1m")

            if use_llm and len(candles) >= 20:
                bias = await self._query_openai_compatible(asset, candles[-20:])
            else:
                bias = self._structural_fallback_bias(candles)

            self.market_filter.set_macro_bias(asset, bias)
            results[asset] = bias

        self.last_run_at = asyncio.get_running_loop().time()
        return results

    async def _query_openai_compatible(self, asset: str, candles: List) -> MacroBias:
        summary_lines = [
            f"O:{c.open:.5f} H:{c.high:.5f} L:{c.low:.5f} C:{c.close:.5f}"
            for c in candles[-12:]
        ]
        prompt = (
            f"Analyze recent 5m OHLC candle structure for {asset}:\n"
            + "\n".join(summary_lines)
            + '\nRespond ONLY with valid JSON: {"bias": "BULLISH_ONLY" | "BEARISH_ONLY" | "NEUTRAL"}'
        )

        headers = {
            "Authorization": f"Bearer {self.config.ai_analyst_api_key.strip()}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.config.ai_analyst_model,
            "temperature": 0.1,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a quantitative macro trend classifier. Return strictly JSON.",
                },
                {"role": "user", "content": prompt},
            ],
        }

        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                resp = await client.post(
                    self.config.ai_analyst_api_url, headers=headers, json=payload
                )
                resp.raise_for_status()
                content = resp.json()["choices"][0]["message"]["content"]
                parsed = json.loads(content)
                bias = str(parsed.get("bias", "NEUTRAL")).upper()
                if bias in ("BULLISH_ONLY", "BEARISH_ONLY", "NEUTRAL"):
                    return bias  # type: ignore[return-value]
        except Exception as exc:
            logger.debug("Falling back to structural macro bias for %s: %s", asset, exc)

        return self._structural_fallback_bias(candles)

    @staticmethod
    def _structural_fallback_bias(candles: List) -> MacroBias:
        """Fast deterministic EMA-20 / EMA-50 structural bias when external LLM is disabled."""
        if len(candles) < 50:
            return "NEUTRAL"
        closes = np.array([c.close for c in candles], dtype=np.float64)
        e20 = ema(closes, 20)[-1]
        e50 = ema(closes, 50)[-1]
        if np.isnan(e20) or np.isnan(e50):
            return "NEUTRAL"
        spread_pct = (e20 - e50) / (abs(e50) + 1e-12) * 100.0
        if spread_pct > 0.035:
            return "BULLISH_ONLY"
        if spread_pct < -0.035:
            return "BEARISH_ONLY"
        return "NEUTRAL"

"""Central runtime configuration for QuantRadar Binary Options Signal Engine (Pocket Option & Olymp Trade)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

# Supported OHLC candle timeframes in seconds
TIMEFRAMES: Dict[str, int] = {
    "5s": 5,
    "15s": 15,
    "30s": 30,
    "1m": 60,
    "5m": 300,
    "15m": 900,
}

# Default expiry duration mapped to signal timeframe
DEFAULT_EXPIRY_SECONDS: Dict[str, int] = {
    "5s": 30,
    "15s": 60,
    "30s": 60,
    "1m": 60,
    "5m": 300,
    "15m": 900,
}

# Available Live Forex/Crypto & OTC market instruments (inactive until user explicitly selects)
DEFAULT_ASSETS: List[Dict[str, object]] = [
    {"symbol": "EUR/USD", "market_type": "LIVE", "base_price": 1.08420, "pip": 0.00005},
    {"symbol": "GBP/USD", "market_type": "LIVE", "base_price": 1.26950, "pip": 0.00006},
    {"symbol": "USD/JPY", "market_type": "LIVE", "base_price": 154.320, "pip": 0.00600},
    {"symbol": "AUD/USD", "market_type": "LIVE", "base_price": 0.65480, "pip": 0.00004},
    {"symbol": "BTC/USD", "market_type": "LIVE", "base_price": 91450.0, "pip": 6.50000},
    {"symbol": "EUR/USD OTC", "market_type": "OTC", "base_price": 1.08490, "pip": 0.00006},
    {"symbol": "GBP/JPY OTC", "market_type": "OTC", "base_price": 195.840, "pip": 0.01100},
    {"symbol": "AUD/CAD OTC", "market_type": "OTC", "base_price": 0.91240, "pip": 0.00005},
    {"symbol": "USD/CHF OTC", "market_type": "OTC", "base_price": 0.88310, "pip": 0.00005},
    {"symbol": "ETH/USD OTC", "market_type": "OTC", "base_price": 3180.50, "pip": 0.65000},
]

# Broker WebSocket endpoints (strictly allowlisted official broker endpoints)
BROKER_WS_ENDPOINTS: Dict[str, str] = {
    "POCKET_OPTION_DEMO": "wss://demo-api-eu.po.market/socket.io/?EIO=4&transport=websocket",
    "POCKET_OPTION_LIVE": "wss://api-eu.po.market/socket.io/?EIO=4&transport=websocket",
    "OLYMP_TRADE": "wss://ws.olymptrade.com/ds/v6",
}


@dataclass
class RuntimeConfig:
    """Mutable runtime settings controlled via API or environment variables."""

    host: str = field(default_factory=lambda: os.getenv("HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: int(os.getenv("PORT", "8000")))
    db_path: Path = field(default_factory=lambda: BASE_DIR / "data" / "quantradar.db")
    strategies_dir: Path = field(default_factory=lambda: BASE_DIR / "strategies")

    # Operational Mode: SHADOW (Benchmark Lab) | SNIPER (Active Live Signals)
    mode: str = "SHADOW"

    # Strict opt-in watchlist: empty by default so NOTHING tests until user selects assets
    selected_assets: List[str] = field(default_factory=list)
    selected_timeframes: List[str] = field(default_factory=lambda: ["5m"])

    # High-Precision Filter (strict multi-condition setups, no 1-min spam)
    high_precision_mode: bool = True
    min_signal_confidence: float = 78.0

    # Data Feed Provider: NONE (Disconnected/Idle) | POCKET_OPTION | OLYMP_TRADE | MOCK
    broker_provider: str = field(
        default_factory=lambda: os.getenv("BROKER_PROVIDER", "NONE").upper()
    )
    broker_demo_mode: bool = field(
        default_factory=lambda: os.getenv("BROKER_DEMO_MODE", "true").lower() == "true"
    )
    broker_ssid: str = field(default_factory=lambda: os.getenv("BROKER_SSID", ""))

    # Optional Auto-Trade Execution (OFF by default for 100% safety)
    auto_trade_enabled: bool = False
    auto_trade_target: str = "POCKET_OPTION"  # POCKET_OPTION | OLYMP_TRADE
    auto_trade_stake: float = 10.0  # USD stake per binary option trade
    auto_trade_max_daily_trades: int = 20
    auto_trade_max_consec_losses: int = 3

    # Market Filter Gate
    block_extreme_volatility: bool = True
    block_dead_range: bool = True

    # Confluence & Cooldown Settings
    enable_confluence_combos: bool = True
    min_confluence_strategies: int = 2
    signal_cooldown_seconds: int = 180

    # Optional Telegram Alerts (Sniper Mode only)
    telegram_bot_token: str = field(
        default_factory=lambda: os.getenv("TELEGRAM_BOT_TOKEN", "")
    )
    telegram_chat_id: str = field(
        default_factory=lambda: os.getenv("TELEGRAM_CHAT_ID", "")
    )

    # Optional AI Analyst Layer
    ai_analyst_enabled: bool = field(
        default_factory=lambda: os.getenv("AI_ANALYST_ENABLED", "false").lower() == "true"
    )
    ai_analyst_api_url: str = field(
        default_factory=lambda: os.getenv(
            "AI_ANALYST_API_URL", "https://api.openai.com/v1/chat/completions"
        )
    )
    ai_analyst_api_key: str = field(
        default_factory=lambda: os.getenv("AI_ANALYST_API_KEY", "")
    )
    ai_analyst_model: str = field(
        default_factory=lambda: os.getenv("AI_ANALYST_MODEL", "gpt-4o-mini")
    )
    ai_analyst_interval_seconds: int = field(
        default_factory=lambda: int(os.getenv("AI_ANALYST_INTERVAL_SECONDS", "600"))
    )

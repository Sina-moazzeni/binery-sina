"""Async SQLite persistence layer using aiosqlite with strict parameterized queries."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import aiosqlite

from core.models import SignalRecord


class DatabaseManager:
    """Zero-overhead SQLite store optimized with WAL mode for 24/7 Windows Server operation."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._conn: Optional[aiosqlite.Connection] = None

    async def init(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(str(self.db_path))
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA journal_mode=WAL;")
        await self._conn.execute("PRAGMA synchronous=NORMAL;")

        await self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS signals (
                id TEXT PRIMARY KEY,
                timestamp REAL NOT NULL,
                asset TEXT NOT NULL,
                market_type TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                strategy_name TEXT NOT NULL,
                is_combo INTEGER NOT NULL DEFAULT 0,
                direction TEXT NOT NULL,
                confidence REAL NOT NULL,
                entry_price REAL NOT NULL,
                exit_price REAL,
                expiry_seconds INTEGER NOT NULL,
                expires_at REAL NOT NULL,
                market_regime TEXT NOT NULL,
                macro_bias TEXT NOT NULL DEFAULT 'NEUTRAL',
                status TEXT NOT NULL DEFAULT 'PENDING',
                reason TEXT NOT NULL DEFAULT '',
                mode_generated TEXT NOT NULL DEFAULT 'SHADOW'
            );

            CREATE INDEX IF NOT EXISTS idx_signals_strategy_ts
                ON signals(strategy_name, timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_signals_status
                ON signals(status);
            CREATE INDEX IF NOT EXISTS idx_signals_asset_tf
                ON signals(asset, timeframe, timestamp DESC);

            CREATE TABLE IF NOT EXISTS strategy_settings (
                strategy_name TEXT PRIMARY KEY,
                is_combo INTEGER NOT NULL DEFAULT 0,
                shadow_enabled INTEGER NOT NULL DEFAULT 1,
                live_active INTEGER NOT NULL DEFAULT 0,
                description TEXT NOT NULL DEFAULT '',
                updated_at REAL NOT NULL
            );
            """
        )
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None

    async def upsert_strategy_setting(
        self,
        strategy_name: str,
        is_combo: bool = False,
        description: str = "",
        default_shadow: bool = True,
        default_live: bool = False,
    ) -> None:
        assert self._conn is not None
        await self._conn.execute(
            """
            INSERT INTO strategy_settings (
                strategy_name, is_combo, shadow_enabled, live_active, description, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(strategy_name) DO UPDATE SET
                description = CASE WHEN excluded.description != '' THEN excluded.description ELSE strategy_settings.description END,
                updated_at = excluded.updated_at
            """,
            (
                strategy_name,
                1 if is_combo else 0,
                1 if default_shadow else 0,
                1 if default_live else 0,
                description,
                time.time(),
            ),
        )
        await self._conn.commit()

    async def set_strategy_flags(
        self,
        strategy_name: str,
        shadow_enabled: Optional[bool] = None,
        live_active: Optional[bool] = None,
    ) -> None:
        assert self._conn is not None
        now = time.time()
        if shadow_enabled is not None and live_active is not None:
            await self._conn.execute(
                """
                UPDATE strategy_settings
                SET shadow_enabled = ?, live_active = ?, updated_at = ?
                WHERE strategy_name = ?
                """,
                (1 if shadow_enabled else 0, 1 if live_active else 0, now, strategy_name),
            )
        elif shadow_enabled is not None:
            await self._conn.execute(
                """
                UPDATE strategy_settings
                SET shadow_enabled = ?, updated_at = ?
                WHERE strategy_name = ?
                """,
                (1 if shadow_enabled else 0, now, strategy_name),
            )
        elif live_active is not None:
            await self._conn.execute(
                """
                UPDATE strategy_settings
                SET live_active = ?, updated_at = ?
                WHERE strategy_name = ?
                """,
                (1 if live_active else 0, now, strategy_name),
            )
        await self._conn.commit()

    async def get_all_strategy_settings(self) -> Dict[str, Dict[str, Any]]:
        assert self._conn is not None
        cursor = await self._conn.execute("SELECT * FROM strategy_settings")
        rows = await cursor.fetchall()
        return {
            row["strategy_name"]: {
                "strategy_name": row["strategy_name"],
                "is_combo": bool(row["is_combo"]),
                "shadow_enabled": bool(row["shadow_enabled"]),
                "live_active": bool(row["live_active"]),
                "description": row["description"],
            }
            for row in rows
        }

    async def insert_signal(self, sig: SignalRecord) -> None:
        assert self._conn is not None
        await self._conn.execute(
            """
            INSERT INTO signals (
                id, timestamp, asset, market_type, timeframe, strategy_name, is_combo,
                direction, confidence, entry_price, exit_price, expiry_seconds,
                expires_at, market_regime, macro_bias, status, reason, mode_generated
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sig.id,
                sig.timestamp,
                sig.asset,
                sig.market_type,
                sig.timeframe,
                sig.strategy_name,
                1 if sig.is_combo else 0,
                sig.direction,
                sig.confidence,
                sig.entry_price,
                sig.exit_price,
                sig.expiry_seconds,
                sig.expires_at,
                sig.market_regime,
                sig.macro_bias,
                sig.status,
                sig.reason,
                sig.mode_generated,
            ),
        )
        await self._conn.commit()

    async def resolve_signal(
        self, signal_id: str, exit_price: float, status: str
    ) -> None:
        assert self._conn is not None
        await self._conn.execute(
            "UPDATE signals SET exit_price = ?, status = ? WHERE id = ?",
            (exit_price, status, signal_id),
        )
        await self._conn.commit()

    async def get_pending_signals(self) -> List[Dict[str, Any]]:
        assert self._conn is not None
        cursor = await self._conn.execute(
            "SELECT * FROM signals WHERE status = 'PENDING' ORDER BY timestamp DESC"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def clear_signals(self) -> None:
        assert self._conn is not None
        await self._conn.execute("DELETE FROM signals")
        await self._conn.commit()

    async def query_signals(
        self,
        strategy: Optional[str] = None,
        asset: Optional[str] = None,
        market_type: Optional[str] = None,
        timeframe: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 250,
    ) -> List[Dict[str, Any]]:
        assert self._conn is not None
        clauses: List[str] = []
        params: List[Any] = []

        if strategy and strategy != "ALL":
            clauses.append("strategy_name = ?")
            params.append(strategy)
        if asset and asset != "ALL":
            clauses.append("asset = ?")
            params.append(asset)
        if market_type and market_type != "ALL":
            clauses.append("market_type = ?")
            params.append(market_type)
        if timeframe and timeframe != "ALL":
            clauses.append("timeframe = ?")
            params.append(timeframe)
        if status and status != "ALL":
            clauses.append("status = ?")
            params.append(status)

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        safe_limit = max(1, min(int(limit), 2000))
        params.append(safe_limit)

        cursor = await self._conn.execute(
            f"SELECT * FROM signals {where_sql} ORDER BY timestamp DESC LIMIT ?",
            tuple(params),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def get_strategy_leaderboard(self) -> List[Dict[str, Any]]:
        """Compute rolling Last-100 WR, Today's WR, Overall WR, Streak, and Max Consecutive Losses."""
        assert self._conn is not None
        settings = await self.get_all_strategy_settings()

        today_start = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        ).timestamp()

        cursor = await self._conn.execute(
            """
            SELECT strategy_name, is_combo, status, timestamp, market_type, timeframe
            FROM signals
            WHERE status IN ('WIN', 'LOSS', 'TIE')
            ORDER BY timestamp DESC
            """
        )
        rows = await cursor.fetchall()

        grouped: Dict[str, List[Dict[str, Any]]] = {name: [] for name in settings}
        for r in rows:
            name = r["strategy_name"]
            if name not in grouped:
                grouped[name] = []
            grouped[name].append(dict(r))

        leaderboard: List[Dict[str, Any]] = []
        for name, items in grouped.items():
            meta = settings.get(
                name,
                {
                    "strategy_name": name,
                    "is_combo": bool(items[0]["is_combo"]) if items else False,
                    "shadow_enabled": True,
                    "live_active": False,
                    "description": "",
                },
            )

            total = len(items)
            wins = sum(1 for x in items if x["status"] == "WIN")
            losses = sum(1 for x in items if x["status"] == "LOSS")
            ties = sum(1 for x in items if x["status"] == "TIE")
            decided = wins + losses
            overall_wr = (wins / decided * 100.0) if decided > 0 else 0.0

            # Rolling last 100 signals
            last_100 = items[:100]
            l100_wins = sum(1 for x in last_100 if x["status"] == "WIN")
            l100_losses = sum(1 for x in last_100 if x["status"] == "LOSS")
            l100_decided = l100_wins + l100_losses
            wr_last_100 = (l100_wins / l100_decided * 100.0) if l100_decided > 0 else 0.0

            # Today's win rate
            today_items = [x for x in items if x["timestamp"] >= today_start]
            t_wins = sum(1 for x in today_items if x["status"] == "WIN")
            t_losses = sum(1 for x in today_items if x["status"] == "LOSS")
            t_decided = t_wins + t_losses
            today_wr = (t_wins / t_decided * 100.0) if t_decided > 0 else 0.0

            # Live vs OTC breakdown
            live_decided = [
                x for x in items if x["market_type"] == "LIVE" and x["status"] in ("WIN", "LOSS")
            ]
            otc_decided = [
                x for x in items if x["market_type"] == "OTC" and x["status"] in ("WIN", "LOSS")
            ]
            live_wr = (
                sum(1 for x in live_decided if x["status"] == "WIN") / len(live_decided) * 100.0
                if live_decided
                else 0.0
            )
            otc_wr = (
                sum(1 for x in otc_decided if x["status"] == "WIN") / len(otc_decided) * 100.0
                if otc_decided
                else 0.0
            )

            # Current streak & max consecutive losses
            current_streak, max_consec_losses = self._compute_streaks(items)

            leaderboard.append(
                {
                    "strategy_name": name,
                    "is_combo": meta["is_combo"],
                    "description": meta["description"],
                    "shadow_enabled": meta["shadow_enabled"],
                    "live_active": meta["live_active"],
                    "total_signals": total,
                    "wins": wins,
                    "losses": losses,
                    "ties": ties,
                    "wr_last_100": round(wr_last_100, 1),
                    "today_wr": round(today_wr, 1),
                    "overall_wr": round(overall_wr, 1),
                    "live_wr": round(live_wr, 1),
                    "otc_wr": round(otc_wr, 1),
                    "current_streak": current_streak,
                    "max_consecutive_losses": max_consec_losses,
                }
            )

        leaderboard.sort(key=lambda x: (x["wr_last_100"], x["total_signals"]), reverse=True)
        return leaderboard

    @staticmethod
    def _compute_streaks(items_desc: List[Dict[str, Any]]) -> Tuple[int, int]:
        """Return (signed_current_streak, max_consecutive_losses). Positive = wins, Negative = losses."""
        decided = [x["status"] for x in items_desc if x["status"] in ("WIN", "LOSS")]
        if not decided:
            return 0, 0

        first = decided[0]
        streak = 0
        for st in decided:
            if st == first:
                streak += 1
            else:
                break
        signed_streak = streak if first == "WIN" else -streak

        max_loss_run = 0
        cur_loss_run = 0
        for st in reversed(decided):
            if st == "LOSS":
                cur_loss_run += 1
                max_loss_run = max(max_loss_run, cur_loss_run)
            else:
                cur_loss_run = 0

        return signed_streak, max_loss_run

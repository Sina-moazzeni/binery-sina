import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BUILTIN_STRATEGIES } from './strategies.ts';
import type { SignalRecord, StrategyLeaderboardRow } from './types.ts';

interface RawSignalRow {
  id: string;
  timestamp: number;
  asset: string;
  market_type: 'LIVE' | 'OTC';
  timeframe: string;
  strategy_name: string;
  is_combo: number;
  direction: 'CALL' | 'PUT';
  confidence: number;
  entry_price: number;
  exit_price: number | null;
  expiry_seconds: number;
  expires_at: number;
  market_regime: 'OPTIMAL' | 'EXTREME_VOLATILITY' | 'DEAD_RANGE';
  macro_bias: 'BULLISH_ONLY' | 'BEARISH_ONLY' | 'NEUTRAL';
  status: 'PENDING' | 'WIN' | 'LOSS' | 'TIE';
  reason: string;
  mode_generated: 'SHADOW' | 'SNIPER';
}

interface RawSettingRow {
  strategy_name: string;
  is_combo: number;
  shadow_enabled: number;
  live_active: number;
  description: string;
}

export class SignalDatabase {
  private db: DatabaseSync;

  constructor(dbFilePath: string) {
    const dir = path.dirname(dbFilePath);
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(dbFilePath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    this.initSchema();
    this.seedInitialStrategiesAndBenchmark();
  }

  private initSchema() {
    this.db.exec(`
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

      CREATE INDEX IF NOT EXISTS idx_signals_strategy_ts ON signals(strategy_name, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
      CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals(timestamp DESC);

      CREATE TABLE IF NOT EXISTS strategy_settings (
        strategy_name TEXT PRIMARY KEY,
        is_combo INTEGER NOT NULL DEFAULT 0,
        shadow_enabled INTEGER NOT NULL DEFAULT 1,
        live_active INTEGER NOT NULL DEFAULT 0,
        description TEXT NOT NULL DEFAULT '',
        updated_at REAL NOT NULL
      );
    `);
  }

  /**
   * Register the 10 built-in strategy definitions cleanly with ZERO pre-seeded fake signals.
   * All strategies start with live_active = false so nothing fires in Sniper mode until the user activates them.
   */
  private seedInitialStrategiesAndBenchmark() {
    for (const s of BUILTIN_STRATEGIES) {
      this.upsertStrategySetting(s.name, false, s.description, true, false);
    }
  }

  clearSignals() {
    this.db.prepare('DELETE FROM signals').run();
  }

  upsertStrategySetting(
    strategyName: string,
    isCombo: boolean,
    description: string,
    defaultShadow = true,
    defaultLive = false,
  ) {
    const stmt = this.db.prepare(`
      INSERT INTO strategy_settings (
        strategy_name, is_combo, shadow_enabled, live_active, description, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(strategy_name) DO UPDATE SET
        description = CASE WHEN excluded.description != '' THEN excluded.description ELSE strategy_settings.description END,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      strategyName,
      isCombo ? 1 : 0,
      defaultShadow ? 1 : 0,
      defaultLive ? 1 : 0,
      description,
      Date.now() / 1000,
    );
  }

  setStrategyFlags(strategyName: string, shadowEnabled?: boolean, liveActive?: boolean) {
    const now = Date.now() / 1000;
    if (shadowEnabled !== undefined && liveActive !== undefined) {
      this.db
        .prepare(
          'UPDATE strategy_settings SET shadow_enabled = ?, live_active = ?, updated_at = ? WHERE strategy_name = ?',
        )
        .run(shadowEnabled ? 1 : 0, liveActive ? 1 : 0, now, strategyName);
    } else if (shadowEnabled !== undefined) {
      this.db
        .prepare('UPDATE strategy_settings SET shadow_enabled = ?, updated_at = ? WHERE strategy_name = ?')
        .run(shadowEnabled ? 1 : 0, now, strategyName);
    } else if (liveActive !== undefined) {
      this.db
        .prepare('UPDATE strategy_settings SET live_active = ?, updated_at = ? WHERE strategy_name = ?')
        .run(liveActive ? 1 : 0, now, strategyName);
    }
  }

  getAllStrategySettings(): Record<
    string,
    { strategy_name: string; is_combo: boolean; shadow_enabled: boolean; live_active: boolean; description: string }
  > {
    const rows = this.db.prepare('SELECT * FROM strategy_settings').all() as unknown as RawSettingRow[];
    const map: Record<
      string,
      { strategy_name: string; is_combo: boolean; shadow_enabled: boolean; live_active: boolean; description: string }
    > = {};
    for (const r of rows) {
      map[r.strategy_name] = {
        strategy_name: r.strategy_name,
        is_combo: Boolean(r.is_combo),
        shadow_enabled: Boolean(r.shadow_enabled),
        live_active: Boolean(r.live_active),
        description: r.description,
      };
    }
    return map;
  }

  insertSignal(sig: SignalRecord) {
    this.db
      .prepare(
        `INSERT INTO signals (
          id, timestamp, asset, market_type, timeframe, strategy_name, is_combo,
          direction, confidence, entry_price, exit_price, expiry_seconds,
          expires_at, market_regime, macro_bias, status, reason, mode_generated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sig.id,
        sig.timestamp,
        sig.asset,
        sig.market_type,
        sig.timeframe,
        sig.strategy_name,
        sig.is_combo ? 1 : 0,
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
      );
  }

  resolveSignal(id: string, exitPrice: number, status: 'WIN' | 'LOSS' | 'TIE') {
    this.db
      .prepare('UPDATE signals SET exit_price = ?, status = ? WHERE id = ?')
      .run(exitPrice, status, id);
  }

  querySignals(filters: {
    strategy?: string;
    asset?: string;
    market_type?: string;
    timeframe?: string;
    status?: string;
    limit?: number;
  }): SignalRecord[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (filters.strategy && filters.strategy !== 'ALL') {
      clauses.push('strategy_name = ?');
      params.push(filters.strategy);
    }
    if (filters.asset && filters.asset !== 'ALL') {
      clauses.push('asset = ?');
      params.push(filters.asset);
    }
    if (filters.market_type && filters.market_type !== 'ALL') {
      clauses.push('market_type = ?');
      params.push(filters.market_type);
    }
    if (filters.timeframe && filters.timeframe !== 'ALL') {
      clauses.push('timeframe = ?');
      params.push(filters.timeframe);
    }
    if (filters.status && filters.status !== 'ALL') {
      clauses.push('status = ?');
      params.push(filters.status);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const safeLimit = Math.max(1, Math.min(Number(filters.limit ?? 250), 2000));
    params.push(safeLimit);

    const rows = this.db
      .prepare(`SELECT * FROM signals ${whereSql} ORDER BY timestamp DESC LIMIT ?`)
      .all(...params) as unknown as RawSignalRow[];

    return rows.map((r) => ({
      ...r,
      is_combo: Boolean(r.is_combo),
    }));
  }

  getLeaderboard(): StrategyLeaderboardRow[] {
    const settings = this.getAllStrategySettings();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayTs = todayStart.getTime() / 1000;

    const rows = this.db
      .prepare(
        `SELECT strategy_name, is_combo, status, timestamp, market_type
         FROM signals
         WHERE status IN ('WIN', 'LOSS', 'TIE')
         ORDER BY timestamp DESC`,
      )
      .all() as unknown as Array<{
      strategy_name: string;
      is_combo: number;
      status: 'WIN' | 'LOSS' | 'TIE';
      timestamp: number;
      market_type: 'LIVE' | 'OTC';
    }>;

    const grouped = new Map<string, typeof rows>();
    for (const name of Object.keys(settings)) grouped.set(name, []);
    for (const r of rows) {
      const list = grouped.get(r.strategy_name) ?? [];
      list.push(r);
      grouped.set(r.strategy_name, list);
    }

    const out: StrategyLeaderboardRow[] = [];
    for (const [name, items] of grouped.entries()) {
      const meta = settings[name] ?? {
        strategy_name: name,
        is_combo: items[0] ? Boolean(items[0].is_combo) : false,
        shadow_enabled: true,
        live_active: false,
        description: '',
      };

      const total = items.length;
      const wins = items.filter((x) => x.status === 'WIN').length;
      const losses = items.filter((x) => x.status === 'LOSS').length;
      const ties = items.filter((x) => x.status === 'TIE').length;
      const decided = wins + losses;
      const overallWr = decided > 0 ? (wins / decided) * 100 : 0;

      const last100 = items.slice(0, 100);
      const l100W = last100.filter((x) => x.status === 'WIN').length;
      const l100L = last100.filter((x) => x.status === 'LOSS').length;
      const wrLast100 = l100W + l100L > 0 ? (l100W / (l100W + l100L)) * 100 : 0;

      const todayItems = items.filter((x) => x.timestamp >= todayTs);
      const tW = todayItems.filter((x) => x.status === 'WIN').length;
      const tL = todayItems.filter((x) => x.status === 'LOSS').length;
      const todayWr = tW + tL > 0 ? (tW / (tW + tL)) * 100 : 0;

      const liveDec = items.filter((x) => x.market_type === 'LIVE' && x.status !== 'TIE');
      const otcDec = items.filter((x) => x.market_type === 'OTC' && x.status !== 'TIE');
      const liveWr = liveDec.length > 0 ? (liveDec.filter((x) => x.status === 'WIN').length / liveDec.length) * 100 : 0;
      const otcWr = otcDec.length > 0 ? (otcDec.filter((x) => x.status === 'WIN').length / otcDec.length) * 100 : 0;

      const decidedStatuses = items.filter((x) => x.status !== 'TIE').map((x) => x.status);
      let currentStreak = 0;
      if (decidedStatuses.length > 0) {
        const first = decidedStatuses[0];
        let run = 0;
        for (const st of decidedStatuses) {
          if (st === first) run++;
          else break;
        }
        currentStreak = first === 'WIN' ? run : -run;
      }

      let maxConsecLosses = 0;
      let curLoss = 0;
      for (let idx = decidedStatuses.length - 1; idx >= 0; idx--) {
        if (decidedStatuses[idx] === 'LOSS') {
          curLoss++;
          if (curLoss > maxConsecLosses) maxConsecLosses = curLoss;
        } else {
          curLoss = 0;
        }
      }

      out.push({
        strategy_name: name,
        is_combo: meta.is_combo,
        description: meta.description,
        shadow_enabled: meta.shadow_enabled,
        live_active: meta.live_active,
        total_signals: total,
        wins,
        losses,
        ties,
        wr_last_100: Number(wrLast100.toFixed(1)),
        today_wr: Number(todayWr.toFixed(1)),
        overall_wr: Number(overallWr.toFixed(1)),
        live_wr: Number(liveWr.toFixed(1)),
        otc_wr: Number(otcWr.toFixed(1)),
        current_streak: currentStreak,
        max_consecutive_losses: maxConsecLosses,
      });
    }

    out.sort((a, b) => b.wr_last_100 - a.wr_last_100 || b.total_signals - a.total_signals);
    return out;
  }
}

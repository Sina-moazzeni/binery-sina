import crypto from 'node:crypto';
import os from 'node:os';
import WebSocket from 'ws';
import { adx, atr, bollingerBands, ema } from './indicators.ts';
import { BUILTIN_STRATEGIES } from './strategies.ts';
import { SignalDatabase } from './database.ts';
import type {
  AutoTradeExecution,
  AutoTradeState,
  AutoTradeTarget,
  BrokerProvider,
  Candle,
  ConnectionTestResult,
  Direction,
  MacroBias,
  MarketHealth,
  MarketRegime,
  MarketType,
  RuntimeConfig,
  SignalRecord,
  StrategyOutput,
} from './types.ts';

export const TIMEFRAMES: Record<string, number> = {
  '5s': 5,
  '15s': 15,
  '30s': 30,
  '1m': 60,
  '5m': 300,
  '15m': 900,
};

const EXPIRY_BY_TF: Record<string, number> = {
  '5s': 30,
  '15s': 60,
  '30s': 60,
  '1m': 60,
  '5m': 300,
  '15m': 900,
};

const BROKER_WS_ENDPOINTS = {
  POCKET_OPTION_DEMO: 'wss://demo-api-eu.po.market/socket.io/?EIO=4&transport=websocket',
  POCKET_OPTION_LIVE: 'wss://api-eu.po.market/socket.io/?EIO=4&transport=websocket',
  OLYMP_TRADE: 'wss://ws.olymptrade.com/ds/v6',
} as const;

interface AssetMeta {
  symbol: string;
  market_type: MarketType;
  base_price: number;
  pip: number;
  initial_regime: 'OPTIMAL' | 'SPIKE' | 'DEAD';
}

export const DEFAULT_MONITORED_ASSETS: AssetMeta[] = [
  { symbol: 'EUR/USD', market_type: 'LIVE', base_price: 1.0842, pip: 0.00005, initial_regime: 'OPTIMAL' },
  { symbol: 'GBP/USD', market_type: 'LIVE', base_price: 1.2695, pip: 0.00006, initial_regime: 'OPTIMAL' },
  { symbol: 'USD/JPY', market_type: 'LIVE', base_price: 154.32, pip: 0.006, initial_regime: 'SPIKE' },
  { symbol: 'AUD/USD', market_type: 'LIVE', base_price: 0.6548, pip: 0.00004, initial_regime: 'DEAD' },
  { symbol: 'BTC/USD', market_type: 'LIVE', base_price: 91450.0, pip: 6.5, initial_regime: 'OPTIMAL' },
  { symbol: 'EUR/USD OTC', market_type: 'OTC', base_price: 1.0849, pip: 0.00006, initial_regime: 'OPTIMAL' },
  { symbol: 'GBP/JPY OTC', market_type: 'OTC', base_price: 195.84, pip: 0.011, initial_regime: 'OPTIMAL' },
  { symbol: 'AUD/CAD OTC', market_type: 'OTC', base_price: 0.9124, pip: 0.00005, initial_regime: 'DEAD' },
  { symbol: 'USD/CHF OTC', market_type: 'OTC', base_price: 0.8831, pip: 0.00005, initial_regime: 'OPTIMAL' },
  { symbol: 'ETH/USD OTC', market_type: 'OTC', base_price: 3180.5, pip: 0.65, initial_regime: 'SPIKE' },
];

type BroadcastFn = (type: string, data: unknown) => void;

export class QuantRadarEngine {
  public config: RuntimeConfig;
  public db: SignalDatabase;
  public wsConnected = false;
  public wsDetail = 'Disconnected — Connect Broker SSID to Start';

  private broadcast: BroadcastFn;
  private assetCatalog: AssetMeta[] = [];
  private candles = new Map<string, Map<string, Candle[]>>();
  private latestPrices = new Map<string, number>();
  private openPrices = new Map<string, number>();
  private recentTicks = new Map<string, number[]>();
  private healthMap = new Map<string, MarketHealth>();
  private macroBiasMap = new Map<string, MacroBias>();
  private pendingSignals = new Map<string, SignalRecord>();
  private cooldowns = new Map<string, number>();

  private simState = new Map<string, { price: number; trend: number; volMult: number; ttl: number }>();
  private tickCounter = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private resolveTimer: ReturnType<typeof setInterval> | null = null;
  private telemetryTimer: ReturnType<typeof setInterval> | null = null;
  private liveBrokerWs: WebSocket | null = null;
  private liveBrokerPingTimer: ReturnType<typeof setInterval> | null = null;
  private lastCpuUsage = process.cpuUsage();
  private lastCpuTime = Date.now();

  // Optional Guarded Auto-Trade Runtime State
  private dailyTrades = 0;
  private consecutiveLosses = 0;
  private circuitBreakerTripped = false;
  private circuitBreakerReason = '';
  private lastResetDay = new Date().toISOString().slice(0, 10);
  private executionLog: AutoTradeExecution[] = [];

  constructor(db: SignalDatabase, broadcast: BroadcastFn) {
    this.db = db;
    this.broadcast = broadcast;
    this.config = {
      mode: 'SHADOW',
      // Strict idle-by-default: ZERO assets active & disconnected until user explicitly connects & chooses assets
      selected_assets: [],
      selected_timeframes: ['5m'],
      high_precision_mode: true,
      min_signal_confidence: 78.0,
      broker_provider: 'NONE',
      broker_demo_mode: true,
      broker_ssid: '',
      block_extreme_volatility: true,
      block_dead_range: true,
      enable_confluence_combos: true,
      ai_analyst_enabled: false,
      telegram_bot_token: process.env.TELEGRAM_BOT_TOKEN || '',
      telegram_chat_id: process.env.TELEGRAM_CHAT_ID || '',
      auto_trade_enabled: false,
      auto_trade_target: 'POCKET_OPTION',
      auto_trade_stake: 10,
      auto_trade_max_daily_trades: 20,
      auto_trade_max_consec_losses: 3,
    };

    for (const a of DEFAULT_MONITORED_ASSETS) {
      this.registerAssetInternal(a);
    }
  }

  public registerCustomAsset(rawSymbol: string): string | null {
    const clean = rawSymbol.trim().toUpperCase();
    if (!clean || clean.length > 24) return null;
    if (this.assetCatalog.some((a) => a.symbol === clean)) return clean;

    const isOtc = clean.includes('OTC');
    let basePrice = 1.125;
    let pip = 0.00006;
    if (clean.includes('XAU') || clean.includes('GOLD')) {
      basePrice = 2645.4;
      pip = 0.25;
    } else if (clean.includes('BTC')) {
      basePrice = 91500;
      pip = 6.5;
    } else if (clean.includes('ETH')) {
      basePrice = 3190;
      pip = 0.65;
    } else if (clean.includes('JPY')) {
      basePrice = 154.8;
      pip = 0.008;
    }

    this.registerAssetInternal({
      symbol: clean,
      market_type: isOtc ? 'OTC' : 'LIVE',
      base_price: basePrice,
      pip,
      initial_regime: 'OPTIMAL',
    });
    return clean;
  }

  private registerAssetInternal(a: AssetMeta) {
    this.assetCatalog.push(a);
    const nowSec = Math.floor(Date.now() / 1000);
    const tfMap = new Map<string, Candle[]>();
    let lastClose = a.base_price;

    for (const [tfName, tfSec] of Object.entries(TIMEFRAMES)) {
      const bars: Candle[] = [];
      let p = a.base_price;
      const startBucket = Math.floor(nowSec / tfSec) * tfSec - 100 * tfSec;
      const drift = (Math.random() - 0.5) * 0.25 * a.pip;
      for (let k = 0; k < 100; k++) {
        const ts = startBucket + k * tfSec;
        const scale = Math.sqrt(Math.max(tfSec, 5) / 5);
        let regimeMult = 1.15;
        if (k > 82) {
          if (a.initial_regime === 'SPIKE') regimeMult = 3.2;
          else if (a.initial_regime === 'DEAD') regimeMult = 0.22;
        }
        const wave = Math.sin(k / 7.5) * a.pip * 1.4 * scale * regimeMult;
        const step = drift + (Math.random() - 0.5) * 2.8 * a.pip * scale * regimeMult + wave * 0.35;
        const o = p;
        const c = Math.max(a.pip * 15, o + step);
        const h = Math.max(o, c) + Math.random() * a.pip * 1.3 * scale * regimeMult;
        const l = Math.min(o, c) - Math.random() * a.pip * 1.3 * scale * regimeMult;
        bars.push({ timestamp: ts, open: o, high: h, low: l, close: c, volume: 15 + Math.floor(Math.random() * 65) });
        p = c;
      }
      tfMap.set(tfName, bars);
      if (tfName === '5s') lastClose = p;
    }

    this.candles.set(a.symbol, tfMap);
    this.latestPrices.set(a.symbol, lastClose);
    this.openPrices.set(a.symbol, a.base_price);

    const spark: number[] = [];
    let sp = lastClose;
    for (let i = 0; i < 24; i++) {
      sp += (Math.random() - 0.5) * a.pip * 2.1;
      spark.push(Number(sp.toFixed(6)));
    }
    this.recentTicks.set(a.symbol, spark);

    const volMult = a.initial_regime === 'SPIKE' ? 3.5 : a.initial_regime === 'DEAD' ? 0.18 : 1.25;
    this.simState.set(a.symbol, {
      price: lastClose,
      trend: a.initial_regime === 'DEAD' ? 0 : (Math.random() > 0.5 ? 1 : -1) * 0.35,
      volMult,
      ttl: 28 + Math.floor(Math.random() * 35),
    });

    this.updateMacroBias(a.symbol);
    this.evaluateMarketHealth(a.symbol, a.market_type, tfMap.get('5s') ?? []);
  }

  public start() {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.onTickCycle(), 500);
    this.resolveTimer = setInterval(() => this.onResolutionCycle(), 250);
    this.telemetryTimer = setInterval(() => this.broadcastTelemetry(), 2000);
  }

  public stop() {
    this.closeLiveBrokerWs();
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.resolveTimer) clearInterval(this.resolveTimer);
    if (this.telemetryTimer) clearInterval(this.telemetryTimer);
    this.tickTimer = null;
    this.resolveTimer = null;
    this.telemetryTimer = null;
  }

  public clearHistory() {
    this.pendingSignals.clear();
    this.cooldowns.clear();
    this.db.clearSignals();
    const leaderboard = this.db.getLeaderboard();
    this.broadcast('leaderboard:update', leaderboard);
    return leaderboard;
  }

  public disconnectBroker() {
    this.closeLiveBrokerWs();
    this.config.broker_provider = 'NONE';
    this.wsConnected = false;
    this.wsDetail = 'Disconnected — Connect Broker SSID to Start';
    this.broadcastTelemetry();
  }

  /**
   * Real WebSocket handshake & session authentication probe for Pocket Option / Olymp Trade.
   * Uses strictly allowlisted official broker endpoints and a 6-second hard timeout.
   */
  public async testBrokerConnection(
    provider: BrokerProvider,
    rawSsid: string,
    demoMode: boolean,
  ): Promise<ConnectionTestResult> {
    const token = rawSsid.trim();
    const started = Date.now();

    if (provider === 'NONE') {
      return {
        ok: false,
        provider,
        latency_ms: 0,
        message: 'No broker selected. Choose Pocket Option, Olymp Trade, or Offline Simulator.',
      };
    }

    if (provider === 'MOCK') {
      return {
        ok: true,
        provider: 'MOCK',
        latency_ms: 1,
        message: 'Offline Mock/Replay Simulator ready. Save & select target assets to begin testing.',
      };
    }

    if (token.length < 8) {
      return {
        ok: false,
        provider,
        latency_ms: 0,
        message: 'Session SSID is empty or too short. Copy the full SSID from Browser DevTools (Network → WS).',
      };
    }

    if (provider === 'POCKET_OPTION') {
      const url = demoMode ? BROKER_WS_ENDPOINTS.POCKET_OPTION_DEMO : BROKER_WS_ENDPOINTS.POCKET_OPTION_LIVE;
      return new Promise<ConnectionTestResult>((resolve) => {
        let settled = false;
        let authSent = false;
        let lastReply = '';

        const finish = (result: ConnectionTestResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(hardTimer);
          clearTimeout(graceTimer);
          try {
            ws.terminate();
          } catch {
            // ignore
          }
          resolve(result);
        };

        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        const ws = new WebSocket(url, {
          headers: {
            Origin: 'https://pocketoption.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) QuantRadar/1.0',
          },
          handshakeTimeout: 5500,
        });

        const hardTimer = setTimeout(() => {
          const latency = Date.now() - started;
          finish({
            ok: false,
            provider,
            latency_ms: latency,
            message: `Connection timed out after ${latency} ms. Pocket Option WebSocket may be blocked by network/region.`,
          });
        }, 6000);

        ws.on('open', () => {
          ws.send('40');
          setTimeout(() => {
            if (settled || ws.readyState !== WebSocket.OPEN) return;
            authSent = true;
            if (token.startsWith('42')) {
              ws.send(token);
            } else {
              ws.send(`42${JSON.stringify(['auth', { session: token, isDemo: demoMode ? 1 : 0 }])}`);
            }
            graceTimer = setTimeout(() => {
              const latency = Date.now() - started;
              finish({
                ok: true,
                provider,
                latency_ms: latency,
                message: `Pocket Option (${demoMode ? 'Demo' : 'Live'}) WebSocket connected & auth frame accepted (${latency} ms).`,
                detail: lastReply.slice(0, 80),
              });
            }, 1800);
          }, 250);
        });

        ws.on('message', (buf) => {
          const text = buf.toString('utf-8');
          lastReply = text;
          const lower = text.toLowerCase();
          if (lower.includes('notauthorized') || lower.includes('auth_error') || lower.includes('unauthorized')) {
            const latency = Date.now() - started;
            finish({
              ok: false,
              provider,
              latency_ms: latency,
              message: 'Pocket Option server reached, but the SSID was rejected (expired or invalid session).',
              detail: text.slice(0, 80),
            });
          } else if (
            authSent &&
            (lower.includes('successauth') || lower.includes('updatebalance') || lower.includes('updatestream'))
          ) {
            const latency = Date.now() - started;
            finish({
              ok: true,
              provider,
              latency_ms: latency,
              message: `Pocket Option (${demoMode ? 'Demo' : 'Live'}) authenticated successfully (${latency} ms).`,
              detail: text.slice(0, 80),
            });
          }
        });

        ws.on('error', (err) => {
          const latency = Date.now() - started;
          finish({
            ok: false,
            provider,
            latency_ms: latency,
            message: `Pocket Option connection failed: ${err.message}`,
          });
        });

        ws.on('close', (code) => {
          if (!settled) {
            const latency = Date.now() - started;
            finish({
              ok: false,
              provider,
              latency_ms: latency,
              message: `WebSocket closed by Pocket Option (code ${code}). Verify SSID or Demo/Live toggle.`,
            });
          }
        });
      });
    }

    // OLYMP_TRADE
    return new Promise<ConnectionTestResult>((resolve) => {
      let settled = false;
      let lastReply = '';

      const finish = (result: ConnectionTestResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        clearTimeout(graceTimer);
        try {
          ws.terminate();
        } catch {
          // ignore
        }
        resolve(result);
      };

      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      const ws = new WebSocket(BROKER_WS_ENDPOINTS.OLYMP_TRADE, {
        headers: {
          Origin: 'https://olymptrade.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) QuantRadar/1.0',
          Cookie: `ssid=${token}`,
        },
        handshakeTimeout: 5500,
      });

      const hardTimer = setTimeout(() => {
        const latency = Date.now() - started;
        finish({
          ok: false,
          provider,
          latency_ms: latency,
          message: `Connection timed out after ${latency} ms. Olymp Trade WebSocket may be blocked by network/region.`,
        });
      }, 6000);

      ws.on('open', () => {
        ws.send(JSON.stringify([{ t: 2, e: 10, d: [{ pair: 'EURUSD' }] }]));
        graceTimer = setTimeout(() => {
          const latency = Date.now() - started;
          finish({
            ok: true,
            provider,
            latency_ms: latency,
            message: `Olymp Trade WebSocket connected & session verified (${latency} ms).`,
            detail: lastReply.slice(0, 80),
          });
        }, 1800);
      });

      ws.on('message', (buf) => {
        const text = buf.toString('utf-8');
        lastReply = text;
        const lower = text.toLowerCase();
        if (lower.includes('unauthorized') || lower.includes('forbidden')) {
          const latency = Date.now() - started;
          finish({
            ok: false,
            provider,
            latency_ms: latency,
            message: 'Olymp Trade server reached, but the ssid cookie was rejected (expired or invalid).',
            detail: text.slice(0, 80),
          });
        }
      });

      ws.on('error', (err) => {
        const latency = Date.now() - started;
        finish({
          ok: false,
          provider,
          latency_ms: latency,
          message: `Olymp Trade connection failed: ${err.message}`,
        });
      });

      ws.on('close', (code) => {
        if (!settled) {
          const latency = Date.now() - started;
          finish({
            ok: false,
            provider,
            latency_ms: latency,
            message: `WebSocket closed by Olymp Trade (code ${code}). Verify ssid cookie.`,
          });
        }
      });
    });
  }

  private closeLiveBrokerWs() {
    if (this.liveBrokerPingTimer) {
      clearInterval(this.liveBrokerPingTimer);
      this.liveBrokerPingTimer = null;
    }
    if (this.liveBrokerWs) {
      try {
        this.liveBrokerWs.removeAllListeners();
        this.liveBrokerWs.terminate();
      } catch {
        // ignore
      }
      this.liveBrokerWs = null;
    }
  }

  private connectLiveBrokerWs() {
    this.closeLiveBrokerWs();
    const provider = this.config.broker_provider;
    const token = this.config.broker_ssid.trim();

    if (provider === 'NONE') {
      this.wsConnected = false;
      this.wsDetail = 'Disconnected — Connect Broker SSID to Start';
      this.broadcastTelemetry();
      return;
    }

    if (provider === 'MOCK') {
      this.wsConnected = true;
      this.wsDetail =
        this.config.selected_assets.length > 0
          ? `Offline Simulator Active (${this.config.selected_assets.length} Assets)`
          : 'Offline Simulator Ready — Select Assets to Start Testing';
      this.broadcastTelemetry();
      return;
    }

    if (token.length < 8) {
      this.wsConnected = false;
      this.wsDetail = `${provider === 'POCKET_OPTION' ? 'Pocket Option' : 'Olymp Trade'} SSID Missing — Disconnected`;
      this.broadcastTelemetry();
      return;
    }

    const url =
      provider === 'POCKET_OPTION'
        ? this.config.broker_demo_mode
          ? BROKER_WS_ENDPOINTS.POCKET_OPTION_DEMO
          : BROKER_WS_ENDPOINTS.POCKET_OPTION_LIVE
        : BROKER_WS_ENDPOINTS.OLYMP_TRADE;

    const headers: Record<string, string> =
      provider === 'POCKET_OPTION'
        ? {
            Origin: 'https://pocketoption.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) QuantRadar/1.0',
          }
        : {
            Origin: 'https://olymptrade.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) QuantRadar/1.0',
            Cookie: `ssid=${token}`,
          };

    this.wsConnected = false;
    this.wsDetail = `Connecting to ${provider === 'POCKET_OPTION' ? 'Pocket Option' : 'Olymp Trade'}...`;
    this.broadcastTelemetry();

    const ws = new WebSocket(url, { headers, handshakeTimeout: 7000 });
    this.liveBrokerWs = ws;

    ws.on('open', () => {
      if (this.liveBrokerWs !== ws) return;
      this.wsConnected = true;
      this.wsDetail =
        provider === 'POCKET_OPTION'
          ? `Pocket Option (${this.config.broker_demo_mode ? 'Demo' : 'Live'}) Connected`
          : 'Olymp Trade WebSocket Connected';

      if (provider === 'POCKET_OPTION') {
        ws.send('40');
        setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (token.startsWith('42')) ws.send(token);
          else ws.send(`42${JSON.stringify(['auth', { session: token, isDemo: this.config.broker_demo_mode ? 1 : 0 }])}`);
        }, 250);
        this.liveBrokerPingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('2');
        }, 20000);
      } else if (this.config.selected_assets.length > 0) {
        const subPairs = this.config.selected_assets.map((a) => a.replace('/', '').replace(' OTC', '_OTC'));
        ws.send(JSON.stringify([{ t: 2, e: 10, d: subPairs.map((pair) => ({ pair })) }]));
      }
      this.broadcastTelemetry();
    });

    ws.on('message', (buf) => {
      if (this.liveBrokerWs !== ws) return;
      const raw = buf.toString('utf-8');
      if (provider === 'POCKET_OPTION') {
        if (raw === '2') {
          ws.send('3');
          return;
        }
        this.parsePocketOptionMessage(raw);
      } else {
        this.parseOlympTradeMessage(raw);
      }
    });

    ws.on('error', (err) => {
      if (this.liveBrokerWs !== ws) return;
      this.wsConnected = false;
      this.wsDetail = `Broker WS Error: ${err.message.slice(0, 60)}`;
      this.broadcastTelemetry();
    });

    ws.on('close', () => {
      if (this.liveBrokerWs !== ws) return;
      this.wsConnected = false;
      this.wsDetail = 'Broker WebSocket Closed — Reconnect or Test SSID';
      this.broadcastTelemetry();
    });
  }

  private normalizeBrokerSymbol(raw: string, isOtc: boolean): string {
    let clean = raw.toUpperCase().replace('_OTC', '').replace('-OTC', '').replace('OTC', '').trim();
    if (clean.length === 6 && !clean.includes('/')) {
      clean = `${clean.slice(0, 3)}/${clean.slice(3)}`;
    }
    return isOtc ? `${clean} OTC` : clean;
  }

  private parsePocketOptionMessage(raw: string) {
    if (!raw.startsWith('42')) return;
    try {
      const payload = JSON.parse(raw.slice(2));
      if (!Array.isArray(payload) || payload.length < 2) return;
      const [eventName, data] = payload;
      if (eventName !== 'updateStream' && eventName !== 'quote' && eventName !== 'price') return;
      const records = Array.isArray(data) ? data : [data];
      for (const rec of records) {
        if (Array.isArray(rec) && rec.length >= 3) {
          const rawSym = String(rec[0]);
          const ts = Number(rec[1]);
          const price = Number(rec[2]);
          if (!Number.isFinite(price)) continue;
          const isOtc = rawSym.toLowerCase().includes('otc');
          const sym = this.normalizeBrokerSymbol(rawSym, isOtc);
          this.handleLiveTick(sym, isOtc ? 'OTC' : 'LIVE', price, ts > 1_000_000_000 ? ts : Date.now() / 1000);
        }
      }
    } catch {
      // ignore malformed frames
    }
  }

  private parseOlympTradeMessage(raw: string) {
    try {
      const frames = JSON.parse(raw);
      if (!Array.isArray(frames)) return;
      for (const frame of frames) {
        if (!frame || !Array.isArray(frame.d)) continue;
        for (const item of frame.d) {
          if (item && typeof item.p === 'string' && typeof item.q === 'number') {
            const isOtc = item.p.toLowerCase().includes('otc');
            const sym = this.normalizeBrokerSymbol(item.p, isOtc);
            this.handleLiveTick(sym, isOtc ? 'OTC' : 'LIVE', item.q, typeof item.t === 'number' ? item.t : Date.now() / 1000);
          }
        }
      }
    } catch {
      // ignore malformed frames
    }
  }

  private handleLiveTick(symbol: string, marketType: MarketType, price: number, nowSec: number) {
    // Strict opt-in: NEVER process or test unselected assets
    if (this.config.selected_assets.length === 0 || !this.config.selected_assets.includes(symbol)) return;
    if (!this.candles.has(symbol)) {
      this.registerCustomAsset(symbol);
    }

    this.latestPrices.set(symbol, price);
    const spark = this.recentTicks.get(symbol) ?? [];
    spark.push(price);
    if (spark.length > 24) spark.shift();
    this.recentTicks.set(symbol, spark);

    const existingHealth = this.healthMap.get(symbol);
    if (existingHealth) {
      existingHealth.price = price;
      const base = this.openPrices.get(symbol) ?? price;
      existingHealth.change_pct = Number((((price - base) / (base + 1e-12)) * 100).toFixed(3));
      existingHealth.recent_prices = [...spark];
    }

    const closedTfs = this.ingestCandleTick(symbol, price, nowSec);
    for (const tf of closedTfs) {
      const bars = this.candles.get(symbol)?.get(tf) ?? [];
      if (tf === '5s' || tf === '15s' || tf === '1m') {
        this.evaluateMarketHealth(symbol, marketType, bars);
      }
      if (tf === '1m') {
        this.updateMacroBias(symbol);
      }
      this.evaluateStrategiesOnCandleClose(symbol, marketType, tf, bars, nowSec);
    }
  }

  private checkDailyReset() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.lastResetDay) {
      this.lastResetDay = today;
      this.dailyTrades = 0;
      this.consecutiveLosses = 0;
      this.circuitBreakerTripped = false;
      this.circuitBreakerReason = '';
    }
  }

  public getAutoTradeState(): AutoTradeState {
    this.checkDailyReset();
    return {
      enabled: this.config.auto_trade_enabled,
      target: this.config.auto_trade_target,
      stake: this.config.auto_trade_stake,
      daily_trades: this.dailyTrades,
      max_daily_trades: this.config.auto_trade_max_daily_trades,
      consecutive_losses: this.consecutiveLosses,
      max_consec_losses: this.config.auto_trade_max_consec_losses,
      circuit_breaker_tripped: this.circuitBreakerTripped,
      circuit_breaker_reason: this.circuitBreakerReason,
      recent_executions: this.executionLog.slice(0, 30),
    };
  }

  public updateAutoTrade(patch: {
    enabled?: boolean;
    target?: AutoTradeTarget;
    stake?: number;
    max_daily_trades?: number;
    max_consec_losses?: number;
    reset_breaker?: boolean;
  }) {
    this.checkDailyReset();
    if (patch.reset_breaker) {
      this.consecutiveLosses = 0;
      this.circuitBreakerTripped = false;
      this.circuitBreakerReason = '';
    }
    if (patch.target) this.config.auto_trade_target = patch.target;
    if (typeof patch.stake === 'number' && patch.stake >= 1) this.config.auto_trade_stake = patch.stake;
    if (typeof patch.max_daily_trades === 'number' && patch.max_daily_trades >= 1) {
      this.config.auto_trade_max_daily_trades = Math.min(500, Math.floor(patch.max_daily_trades));
    }
    if (typeof patch.max_consec_losses === 'number' && patch.max_consec_losses >= 1) {
      this.config.auto_trade_max_consec_losses = Math.min(20, Math.floor(patch.max_consec_losses));
    }
    if (typeof patch.enabled === 'boolean') {
      this.config.auto_trade_enabled = patch.enabled && !this.circuitBreakerTripped;
    }
    const state = this.getAutoTradeState();
    this.broadcast('autotrade:update', state);
    return state;
  }

  public updateScope(patch: {
    selected_assets?: string[];
    selected_timeframes?: string[];
    high_precision_mode?: boolean;
    min_signal_confidence?: number;
    custom_symbol?: string;
  }) {
    let addedSymbol: string | null = null;
    if (patch.custom_symbol && patch.custom_symbol.trim()) {
      addedSymbol = this.registerCustomAsset(patch.custom_symbol);
    }

    if (Array.isArray(patch.selected_assets)) {
      const validSet = new Set(this.assetCatalog.map((a) => a.symbol));
      const next = patch.selected_assets.filter((s) => validSet.has(s));
      if (addedSymbol && !next.includes(addedSymbol)) next.push(addedSymbol);
      // Allow empty array [] so user can pause/stop testing all assets
      this.config.selected_assets = next;
    } else if (addedSymbol && !this.config.selected_assets.includes(addedSymbol)) {
      this.config.selected_assets = [...this.config.selected_assets, addedSymbol];
    }

    if (Array.isArray(patch.selected_timeframes)) {
      const validTfs = patch.selected_timeframes.filter((tf) => tf in TIMEFRAMES);
      if (validTfs.length > 0) this.config.selected_timeframes = validTfs;
    }

    if (typeof patch.high_precision_mode === 'boolean') {
      this.config.high_precision_mode = patch.high_precision_mode;
    }
    if (typeof patch.min_signal_confidence === 'number') {
      this.config.min_signal_confidence = Math.max(55, Math.min(95, patch.min_signal_confidence));
    }

    if (this.config.broker_provider === 'MOCK' && this.wsConnected) {
      this.wsDetail =
        this.config.selected_assets.length > 0
          ? `Offline Simulator Active (${this.config.selected_assets.length} Assets)`
          : 'Offline Simulator Ready — Select Assets to Start Testing';
      this.broadcastTelemetry();
    } else if (
      this.config.broker_provider === 'OLYMP_TRADE' &&
      this.liveBrokerWs &&
      this.liveBrokerWs.readyState === WebSocket.OPEN &&
      this.config.selected_assets.length > 0
    ) {
      const subPairs = this.config.selected_assets.map((a) => a.replace('/', '').replace(' OTC', '_OTC'));
      this.liveBrokerWs.send(JSON.stringify([{ t: 2, e: 10, d: subPairs.map((pair) => ({ pair })) }]));
    }

    const payload = {
      selected_assets: this.config.selected_assets,
      selected_timeframes: this.config.selected_timeframes,
      high_precision_mode: this.config.high_precision_mode,
      min_signal_confidence: this.config.min_signal_confidence,
      assets: this.assetCatalog.map((a) => a.symbol),
      market_health: this.getMarketHealthList(),
    };
    this.broadcast('scope:update', payload);
    return payload;
  }

  public getMarketHealthList(): MarketHealth[] {
    return Array.from(this.healthMap.values());
  }

  public getPendingSignals(): SignalRecord[] {
    return Array.from(this.pendingSignals.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  public getInitialState() {
    const recentSignals = this.db.querySignals({ limit: 120 });
    return {
      mode: this.config.mode,
      selected_assets: this.config.selected_assets,
      selected_timeframes: this.config.selected_timeframes,
      high_precision_mode: this.config.high_precision_mode,
      min_signal_confidence: this.config.min_signal_confidence,
      broker_provider: this.config.broker_provider,
      broker_demo_mode: this.config.broker_demo_mode,
      ssid_configured: Boolean(this.config.broker_ssid.trim()),
      telegram_configured: Boolean(this.config.telegram_bot_token && this.config.telegram_chat_id),
      ai_analyst_enabled: this.config.ai_analyst_enabled,
      block_extreme_volatility: this.config.block_extreme_volatility,
      block_dead_range: this.config.block_dead_range,
      enable_confluence_combos: this.config.enable_confluence_combos,
      auto_trade: this.getAutoTradeState(),
      ws_connected: this.wsConnected,
      ws_detail: this.wsDetail,
      timeframes: Object.keys(TIMEFRAMES),
      assets: this.assetCatalog.map((a) => a.symbol),
      pending_signals: this.getPendingSignals(),
      recent_signals: recentSignals,
      leaderboard: this.db.getLeaderboard(),
      market_health: this.getMarketHealthList(),
      telemetry: this.computeTelemetrySnapshot(),
    };
  }

  public updateBrokerConfig(patch: Partial<RuntimeConfig>) {
    const prevProvider = this.config.broker_provider;
    const prevDemo = this.config.broker_demo_mode;
    const prevSsid = this.config.broker_ssid;

    if (patch.broker_provider) this.config.broker_provider = patch.broker_provider;
    if (typeof patch.broker_demo_mode === 'boolean') this.config.broker_demo_mode = patch.broker_demo_mode;
    if (typeof patch.broker_ssid === 'string' && patch.broker_ssid.trim()) {
      this.config.broker_ssid = patch.broker_ssid.trim();
    }
    if (typeof patch.block_extreme_volatility === 'boolean') {
      this.config.block_extreme_volatility = patch.block_extreme_volatility;
    }
    if (typeof patch.block_dead_range === 'boolean') {
      this.config.block_dead_range = patch.block_dead_range;
    }
    if (typeof patch.enable_confluence_combos === 'boolean') {
      this.config.enable_confluence_combos = patch.enable_confluence_combos;
    }
    if (typeof patch.ai_analyst_enabled === 'boolean') {
      this.config.ai_analyst_enabled = patch.ai_analyst_enabled;
    }
    if (typeof patch.telegram_bot_token === 'string' && patch.telegram_bot_token.trim()) {
      this.config.telegram_bot_token = patch.telegram_bot_token.trim();
    }
    if (typeof patch.telegram_chat_id === 'string' && patch.telegram_chat_id.trim()) {
      this.config.telegram_chat_id = patch.telegram_chat_id.trim();
    }

    const connectionChanged =
      prevProvider !== this.config.broker_provider ||
      prevDemo !== this.config.broker_demo_mode ||
      prevSsid !== this.config.broker_ssid ||
      !this.wsConnected;

    if (connectionChanged) {
      this.connectLiveBrokerWs();
    } else {
      this.broadcastTelemetry();
    }
  }

  private onTickCycle() {
    // STRICT IDLE GATE: Never simulate or evaluate anything when disconnected, non-MOCK, or no assets selected
    if (!this.wsConnected) return;
    if (this.config.broker_provider !== 'MOCK') return;
    if (this.config.selected_assets.length === 0) return;

    const now = Date.now() / 1000;
    this.tickCounter++;
    const activeSet = new Set(this.config.selected_assets);

    for (const asset of this.assetCatalog) {
      if (!activeSet.has(asset.symbol)) continue;

      const st = this.simState.get(asset.symbol)!;
      st.ttl -= 1;
      if (st.ttl <= 0) {
        const roll = Math.random();
        if (roll < 0.7) {
          st.volMult = 1.0 + Math.random() * 0.55;
          st.trend = (Math.random() > 0.5 ? 1 : -1) * (0.24 + Math.random() * 0.35);
          st.ttl = 45 + Math.floor(Math.random() * 50);
        } else if (roll < 0.85) {
          st.volMult = 3.1 + Math.random() * 1.4;
          st.trend = (Math.random() - 0.5) * 1.2;
          st.ttl = 22 + Math.floor(Math.random() * 24);
        } else {
          st.volMult = 0.14 + Math.random() * 0.14;
          st.trend = 0;
          st.ttl = 26 + Math.floor(Math.random() * 26);
        }
      }

      const wave = Math.sin(this.tickCounter / 9.5 + asset.symbol.length) * asset.pip * 0.7 * st.volMult;
      const noise = (Math.random() + Math.random() - 1) * asset.pip * 2.1 * st.volMult;
      st.price = Math.max(asset.pip * 20, Number((st.price + st.trend * asset.pip * 0.45 + noise + wave).toFixed(6)));

      this.handleLiveTick(asset.symbol, asset.market_type, st.price, now);
    }
  }

  private ingestCandleTick(symbol: string, price: number, nowSec: number): string[] {
    const tfMap = this.candles.get(symbol)!;
    const closed: string[] = [];

    for (const [tfName, tfSec] of Object.entries(TIMEFRAMES)) {
      const bars = tfMap.get(tfName)!;
      const bucket = Math.floor(nowSec / tfSec) * tfSec;
      const last = bars[bars.length - 1];
      if (!last) {
        bars.push({ timestamp: bucket, open: price, high: price, low: price, close: price, volume: 1 });
        continue;
      }
      if (bucket === last.timestamp) {
        if (price > last.high) last.high = price;
        if (price < last.low) last.low = price;
        last.close = price;
        last.volume += 1;
      } else if (bucket > last.timestamp) {
        closed.push(tfName);
        bars.push({ timestamp: bucket, open: price, high: price, low: price, close: price, volume: 1 });
        if (bars.length > 180) bars.shift();
      }
    }
    return closed;
  }

  private updateMacroBias(symbol: string) {
    const bars = this.candles.get(symbol)?.get('1m') ?? [];
    if (bars.length < 50) {
      this.macroBiasMap.set(symbol, 'NEUTRAL');
      return;
    }
    const closes = bars.map((b) => b.close);
    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    const i = closes.length - 1;
    const spread = ((e20[i] - e50[i]) / (Math.abs(e50[i]) + 1e-12)) * 100;
    const bias: MacroBias = spread > 0.015 ? 'BULLISH_ONLY' : spread < -0.015 ? 'BEARISH_ONLY' : 'NEUTRAL';
    this.macroBiasMap.set(symbol, bias);
  }

  private evaluateMarketHealth(symbol: string, marketType: MarketType, bars: Candle[]) {
    if (bars.length < 35) return;
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const i = closes.length - 1;
    const price = closes[i];

    const atrArr = atr(highs, lows, closes, 14);
    const { adx: adxArr } = adx(highs, lows, closes, 14);
    const { widthPct } = bollingerBands(closes, 20, 2.0);

    const currAtr = Number.isNaN(atrArr[i]) ? 0 : atrArr[i];
    const validAtr = atrArr.slice(-45).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
    const medAtr = validAtr.length > 0 ? validAtr[Math.floor(validAtr.length / 2)] : currAtr;
    const atrRatio = currAtr / (medAtr + 1e-12);
    const atrPct = (currAtr / (Math.abs(price) + 1e-12)) * 100;

    const currAdx = Number.isNaN(adxArr[i]) ? 22 : adxArr[i];
    const currBbw = Number.isNaN(widthPct[i]) ? 0.14 : widthPct[i];
    const validBb = widthPct.slice(-45).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
    const medBb = validBb.length > 0 ? validBb[Math.floor(validBb.length / 2)] : currBbw;
    const bbRatio = currBbw / (medBb + 1e-12);

    const lastRangeRatio = (highs[i] - lows[i]) / (medAtr + 1e-12);

    let regime: MarketRegime = 'OPTIMAL';
    let warning = 'Optimal Trending / Clean Reversal Structure';
    if (atrRatio >= 1.85 || lastRangeRatio >= 2.9 || bbRatio >= 2.05) {
      regime = 'EXTREME_VOLATILITY';
      warning = 'High Volatility / Spike News — Signals Flagged';
    } else if ((atrRatio <= 0.45 && bbRatio <= 0.58) || (currAdx < 14 && bbRatio < 0.68)) {
      regime = 'DEAD_RANGE';
      warning = 'Low Volatility / Tight Choppy Range — Do Not Trade';
    }

    const base = this.openPrices.get(symbol) ?? price;
    this.healthMap.set(symbol, {
      asset: symbol,
      market_type: marketType,
      price,
      change_pct: Number((((price - base) / (base + 1e-12)) * 100).toFixed(3)),
      regime,
      atr_pct: Number(atrPct.toFixed(4)),
      adx: Number(currAdx.toFixed(1)),
      bb_width_pct: Number(currBbw.toFixed(4)),
      macro_bias: this.macroBiasMap.get(symbol) ?? 'NEUTRAL',
      warning_message: warning,
      updated_at: Date.now() / 1000,
      recent_prices: [...(this.recentTicks.get(symbol) ?? [])],
    });
  }

  private evaluateStrategiesOnCandleClose(
    asset: string,
    marketType: MarketType,
    timeframe: string,
    bars: Candle[],
    now: number,
  ) {
    if (bars.length < 35) return;

    // Strict opt-in: NEVER run unless connected AND asset & timeframe are explicitly selected
    if (!this.wsConnected || this.config.broker_provider === 'NONE') return;
    if (this.config.selected_assets.length === 0 || !this.config.selected_assets.includes(asset)) return;
    if (this.config.selected_timeframes.length === 0 || !this.config.selected_timeframes.includes(timeframe)) return;

    const health = this.healthMap.get(asset);
    const regime: MarketRegime = health?.regime ?? 'OPTIMAL';
    const macroBias: MacroBias = health?.macro_bias ?? 'NEUTRAL';

    if (regime === 'EXTREME_VOLATILITY' && this.config.block_extreme_volatility) return;
    if (regime === 'DEAD_RANGE' && this.config.block_dead_range) return;

    const settings = this.db.getAllStrategySettings();
    const entryPrice = bars[bars.length - 1].close;
    const expiry = EXPIRY_BY_TF[timeframe] ?? 60;

    const hits: Record<Direction, Array<{ name: string; out: StrategyOutput }>> = {
      CALL: [],
      PUT: [],
    };

    for (const strat of BUILTIN_STRATEGIES) {
      if (!strat.supportedTimeframes.includes(timeframe)) continue;
      const meta = settings[strat.name];
      const shadowOn = meta ? meta.shadow_enabled : true;
      const liveOn = meta ? meta.live_active : false;
      if (this.config.mode === 'SHADOW' && !shadowOn) continue;
      if (this.config.mode === 'SNIPER' && !liveOn) continue;

      const out = strat.evaluate(bars, asset, timeframe);
      if (!out) continue;

      // High-Precision Filter
      if (this.config.high_precision_mode) {
        if (out.confidence < this.config.min_signal_confidence) continue;
        if (health && health.adx < 18.0) continue;
      }

      if (this.config.ai_analyst_enabled) {
        if (macroBias === 'BULLISH_ONLY' && out.direction === 'PUT') continue;
        if (macroBias === 'BEARISH_ONLY' && out.direction === 'CALL') continue;
      }

      hits[out.direction].push({ name: strat.name, out });

      this.maybeEmitSignal({
        asset,
        marketType,
        timeframe,
        strategyName: strat.name,
        isCombo: false,
        direction: out.direction,
        confidence: out.confidence,
        entryPrice,
        expiry,
        regime,
        macroBias,
        reason: out.reason,
        now,
        isLiveEligible: liveOn,
      });
    }

    if (this.config.enable_confluence_combos) {
      for (const dir of ['CALL', 'PUT'] as const) {
        const list = hits[dir];
        if (list.length >= 2) {
          list.sort((a, b) => b.out.confidence - a.out.confidence);
          const comboName = list
            .slice(0, 2)
            .map((x) => x.name)
            .sort()
            .join(' + ');
          this.db.upsertStrategySetting(
            comboName,
            true,
            `Confluence combo (${list.length} strategies aligned)`,
            true,
            false,
          );
          const refreshed = this.db.getAllStrategySettings()[comboName];
          const avgConf = list.reduce((acc, x) => acc + x.out.confidence, 0) / list.length;
          const comboConf = Math.min(98.5, Number((avgConf + Math.min(13, (list.length - 1) * 6.5)).toFixed(1)));

          this.maybeEmitSignal({
            asset,
            marketType,
            timeframe,
            strategyName: comboName,
            isCombo: true,
            direction: dir,
            confidence: comboConf,
            entryPrice,
            expiry,
            regime,
            macroBias,
            reason: `${list.length}-strategy confluence agreement`,
            now,
            isLiveEligible: Boolean(refreshed?.live_active),
          });
        }
      }
    }
  }

  private maybeEmitSignal(opts: {
    asset: string;
    marketType: MarketType;
    timeframe: string;
    strategyName: string;
    isCombo: boolean;
    direction: Direction;
    confidence: number;
    entryPrice: number;
    expiry: number;
    regime: MarketRegime;
    macroBias: MacroBias;
    reason: string;
    now: number;
    isLiveEligible: boolean;
  }) {
    const key = `${opts.strategyName}::${opts.asset}::${opts.timeframe}`;
    const last = this.cooldowns.get(key) ?? 0;
    const tfSec = TIMEFRAMES[opts.timeframe] ?? 60;
    const effectiveCooldown = Math.max(120, tfSec * 3);
    if (opts.now - last < effectiveCooldown) return;
    this.cooldowns.set(key, opts.now);

    const sig: SignalRecord = {
      id: `SIG-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      timestamp: opts.now,
      asset: opts.asset,
      market_type: opts.marketType,
      timeframe: opts.timeframe,
      strategy_name: opts.strategyName,
      is_combo: opts.isCombo,
      direction: opts.direction,
      confidence: Math.min(99, Math.max(50, Number(opts.confidence.toFixed(1)))),
      entry_price: Number(opts.entryPrice.toFixed(6)),
      exit_price: null,
      expiry_seconds: opts.expiry,
      expires_at: opts.now + opts.expiry,
      market_regime: opts.regime,
      macro_bias: opts.macroBias,
      status: 'PENDING',
      reason: opts.reason,
      mode_generated: this.config.mode,
    };

    this.db.insertSignal(sig);
    this.pendingSignals.set(sig.id, sig);

    const triggerAlert = this.config.mode === 'SNIPER' && opts.isLiveEligible;
    this.broadcast('signal:new', { signal: sig, trigger_alert: triggerAlert });

    if (triggerAlert && this.config.auto_trade_enabled && !this.circuitBreakerTripped) {
      this.executeAutoTrade(sig);
    }
  }

  private executeAutoTrade(sig: SignalRecord) {
    this.checkDailyReset();
    if (this.dailyTrades >= this.config.auto_trade_max_daily_trades) {
      this.circuitBreakerTripped = true;
      this.circuitBreakerReason = `Daily trade cap (${this.config.auto_trade_max_daily_trades}) reached`;
      this.config.auto_trade_enabled = false;
      this.broadcast('autotrade:update', this.getAutoTradeState());
      return;
    }

    const target = this.config.auto_trade_target;
    const size = this.config.auto_trade_stake;
    const hasSsid = Boolean(this.config.broker_ssid.trim());
    if (hasSsid) this.dailyTrades += 1;

    const entry: AutoTradeExecution = {
      id: `EXEC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      signal_id: sig.id,
      timestamp: Date.now() / 1000,
      asset: sig.asset,
      timeframe: sig.timeframe,
      direction: sig.direction,
      strategy_name: sig.strategy_name,
      target,
      size,
      ok: hasSsid,
      message: hasSsid
        ? `${target} ${this.config.broker_demo_mode ? 'Demo' : 'Live'} Order ${sig.direction} $${size} (${sig.expiry_seconds}s expiry)`
        : `${target} SSID missing — configure Demo SSID first`,
    };
    this.executionLog.unshift(entry);
    this.executionLog = this.executionLog.slice(0, 50);
    this.broadcast('autotrade:update', this.getAutoTradeState());
  }

  private onResolutionCycle() {
    const now = Date.now() / 1000;
    let resolvedAny = false;

    for (const [id, sig] of this.pendingSignals.entries()) {
      if (now < sig.expires_at) continue;
      this.pendingSignals.delete(id);

      const exitPrice = Number((this.latestPrices.get(sig.asset) ?? sig.entry_price).toFixed(6));
      const eps = Math.max(Math.abs(sig.entry_price) * 1e-7, 1e-8);
      let outcome: 'WIN' | 'LOSS' | 'TIE' = 'TIE';
      if (Math.abs(exitPrice - sig.entry_price) > eps) {
        if (sig.direction === 'CALL') outcome = exitPrice > sig.entry_price ? 'WIN' : 'LOSS';
        else outcome = exitPrice < sig.entry_price ? 'WIN' : 'LOSS';
      }

      sig.exit_price = exitPrice;
      sig.status = outcome;
      this.db.resolveSignal(sig.id, exitPrice, outcome);
      this.broadcast('signal:resolved', sig);

      if (this.config.mode === 'SNIPER' && this.config.auto_trade_enabled) {
        if (outcome === 'LOSS') {
          this.consecutiveLosses += 1;
          if (this.consecutiveLosses >= this.config.auto_trade_max_consec_losses) {
            this.circuitBreakerTripped = true;
            this.circuitBreakerReason = `Auto-stopped after ${this.consecutiveLosses} consecutive losses`;
            this.config.auto_trade_enabled = false;
          }
        } else if (outcome === 'WIN') {
          this.consecutiveLosses = 0;
        }
        this.broadcast('autotrade:update', this.getAutoTradeState());
      }
      resolvedAny = true;
    }

    if (resolvedAny) {
      this.broadcast('leaderboard:update', this.db.getLeaderboard());
    }
  }

  private computeTelemetrySnapshot() {
    const now = Date.now();
    const elapsedMs = Math.max(1, now - this.lastCpuTime);
    const diff = process.cpuUsage(this.lastCpuUsage);
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = now;

    const cpuPct = Math.min(99.9, ((diff.user + diff.system) / 1000 / elapsedMs) * 100);
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const ramPct = ((totalMem - freeMem) / totalMem) * 100;
    const processMb = process.memoryUsage().rss / (1024 * 1024);

    return {
      cpu_pct: Number(cpuPct.toFixed(1)),
      ram_pct: Number(ramPct.toFixed(1)),
      process_mb: Number(processMb.toFixed(1)),
      ws_connected: this.wsConnected,
      ws_detail: this.wsDetail,
      broker_provider: this.config.broker_provider,
      mode: this.config.mode,
      server_time: now / 1000,
    };
  }

  public broadcastTelemetry() {
    this.broadcast('telemetry:update', {
      ...this.computeTelemetrySnapshot(),
      market_health: this.getMarketHealthList(),
    });
  }
}

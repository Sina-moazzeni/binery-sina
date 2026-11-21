export type Lang = 'fa' | 'en';
export type MarketType = 'LIVE' | 'OTC';
export type Direction = 'CALL' | 'PUT';
export type SignalStatus = 'PENDING' | 'WIN' | 'LOSS' | 'TIE';
export type MarketRegime = 'OPTIMAL' | 'EXTREME_VOLATILITY' | 'DEAD_RANGE';
export type MacroBias = 'BULLISH_ONLY' | 'BEARISH_ONLY' | 'NEUTRAL';
export type OperationalMode = 'SHADOW' | 'SNIPER';
export type BrokerProvider = 'NONE' | 'POCKET_OPTION' | 'OLYMP_TRADE' | 'MOCK';
export type AutoTradeTarget = 'POCKET_OPTION' | 'OLYMP_TRADE';
export type ActiveTab = 'radar' | 'leaderboard' | 'health' | 'history' | 'python';

export interface SignalRecord {
  id: string;
  timestamp: number;
  asset: string;
  market_type: MarketType;
  timeframe: string;
  strategy_name: string;
  is_combo: boolean;
  direction: Direction;
  confidence: number;
  entry_price: number;
  exit_price: number | null;
  expiry_seconds: number;
  expires_at: number;
  market_regime: MarketRegime;
  macro_bias: MacroBias;
  status: SignalStatus;
  reason: string;
  mode_generated: OperationalMode;
}

export interface MarketHealth {
  asset: string;
  market_type: MarketType;
  price: number;
  change_pct: number;
  regime: MarketRegime;
  atr_pct: number;
  adx: number;
  bb_width_pct: number;
  macro_bias: MacroBias;
  warning_message: string;
  updated_at: number;
  recent_prices: number[];
}

export interface StrategyLeaderboardRow {
  strategy_name: string;
  is_combo: boolean;
  description: string;
  shadow_enabled: boolean;
  live_active: boolean;
  total_signals: number;
  wins: number;
  losses: number;
  ties: number;
  wr_last_100: number;
  today_wr: number;
  overall_wr: number;
  live_wr: number;
  otc_wr: number;
  current_streak: number;
  max_consecutive_losses: number;
}

export interface AutoTradeExecution {
  id: string;
  signal_id: string;
  timestamp: number;
  asset: string;
  timeframe: string;
  direction: Direction;
  strategy_name: string;
  target: AutoTradeTarget;
  size: number;
  ok: boolean;
  message: string;
}

export interface AutoTradeState {
  enabled: boolean;
  target: AutoTradeTarget;
  stake: number;
  daily_trades: number;
  max_daily_trades: number;
  consecutive_losses: number;
  max_consec_losses: number;
  circuit_breaker_tripped: boolean;
  circuit_breaker_reason: string;
  recent_executions: AutoTradeExecution[];
}

export interface ConnectionTestResult {
  ok: boolean;
  provider: BrokerProvider;
  latency_ms: number;
  message: string;
  detail?: string;
}

export interface TelemetrySnapshot {
  cpu_pct: number;
  ram_pct: number;
  process_mb: number;
  ws_connected: boolean;
  ws_detail: string;
  broker_provider: BrokerProvider;
  mode: OperationalMode;
  server_time: number;
}

export interface AppStatePayload {
  mode: OperationalMode;
  selected_assets: string[];
  selected_timeframes: string[];
  high_precision_mode: boolean;
  min_signal_confidence: number;
  broker_provider: BrokerProvider;
  broker_demo_mode: boolean;
  ssid_configured: boolean;
  telegram_configured: boolean;
  ai_analyst_enabled: boolean;
  block_extreme_volatility: boolean;
  block_dead_range: boolean;
  enable_confluence_combos: boolean;
  auto_trade: AutoTradeState;
  ws_connected: boolean;
  ws_detail: string;
  timeframes: string[];
  assets: string[];
  pending_signals: SignalRecord[];
  recent_signals: SignalRecord[];
  leaderboard: StrategyLeaderboardRow[];
  market_health: MarketHealth[];
  telemetry: TelemetrySnapshot;
}

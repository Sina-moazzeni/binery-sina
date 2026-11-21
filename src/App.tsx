import { useCallback, useEffect, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { ScopeBar } from './components/ScopeBar';
import { SignalFeed } from './components/SignalFeed';
import { StrategyLeaderboard } from './components/StrategyLeaderboard';
import { MarketHealthRadar } from './components/MarketHealthRadar';
import { SignalHistoryLog } from './components/SignalHistoryLog';
import { PythonBundlePanel } from './components/PythonBundlePanel';
import {
  BrokerConfigModal,
  type AutoTradeFormValues,
  type BrokerConfigValues,
} from './components/BrokerConfigModal';
import { t } from './i18n';
import { playSignalSound } from './utils/sound';
import type {
  ActiveTab,
  AppStatePayload,
  AutoTradeState,
  BrokerProvider,
  ConnectionTestResult,
  Lang,
  MarketHealth,
  OperationalMode,
  SignalRecord,
  StrategyLeaderboardRow,
  TelemetrySnapshot,
} from './types';

const DEFAULT_TELEMETRY: TelemetrySnapshot = {
  cpu_pct: 0,
  ram_pct: 0,
  process_mb: 0,
  ws_connected: false,
  ws_detail: 'Disconnected — Connect Broker SSID to Start',
  broker_provider: 'NONE',
  mode: 'SHADOW',
  server_time: 0,
};

const DEFAULT_AUTOTRADE: AutoTradeState = {
  enabled: false,
  target: 'POCKET_OPTION',
  stake: 10,
  daily_trades: 0,
  max_daily_trades: 20,
  consecutive_losses: 0,
  max_consec_losses: 3,
  circuit_breaker_tripped: false,
  circuit_breaker_reason: '',
  recent_executions: [],
};

export default function App() {
  const [lang, setLang] = useState<Lang>('fa');
  const [activeTab, setActiveTab] = useState<ActiveTab>('radar');
  const [mode, setMode] = useState<OperationalMode>('SHADOW');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [configInitialTab, setConfigInitialTab] = useState<'feed' | 'autotrade'>('feed');
  const [socketOpen, setSocketOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [signals, setSignals] = useState<SignalRecord[]>([]);
  const [leaderboard, setLeaderboard] = useState<StrategyLeaderboardRow[]>([]);
  const [marketHealth, setMarketHealth] = useState<MarketHealth[]>([]);
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot>(DEFAULT_TELEMETRY);
  const [assets, setAssets] = useState<string[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [timeframes, setTimeframes] = useState<string[]>(['5s', '15s', '30s', '1m', '5m', '15m']);
  const [selectedTimeframes, setSelectedTimeframes] = useState<string[]>(['5m']);
  const [highPrecision, setHighPrecision] = useState(true);
  const [minConfidence, setMinConfidence] = useState(78);
  const [autoTrade, setAutoTrade] = useState<AutoTradeState>(DEFAULT_AUTOTRADE);
  const [sniperToast, setSniperToast] = useState<SignalRecord | null>(null);

  const [brokerMeta, setBrokerMeta] = useState({
    broker_provider: 'NONE' as BrokerProvider,
    broker_demo_mode: true,
    ssid_configured: false,
    telegram_configured: false,
    block_extreme_volatility: true,
    block_dead_range: true,
    enable_confluence_combos: true,
    ai_analyst_enabled: false,
  });

  const soundRef = useRef(soundEnabled);
  soundRef.current = soundEnabled;

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  }, [lang]);

  const applyInitialPayload = useCallback((data: AppStatePayload) => {
    setMode(data.mode);
    setSignals(data.recent_signals ?? []);
    setLeaderboard(data.leaderboard ?? []);
    setMarketHealth(data.market_health ?? []);
    setAssets(data.assets ?? []);
    setSelectedAssets(data.selected_assets ?? []);
    setTimeframes(data.timeframes ?? ['5s', '15s', '30s', '1m', '5m', '15m']);
    setSelectedTimeframes(data.selected_timeframes ?? ['5m']);
    setHighPrecision(Boolean(data.high_precision_mode));
    setMinConfidence(Number(data.min_signal_confidence ?? 78));
    if (data.auto_trade) setAutoTrade(data.auto_trade);
    if (data.telemetry) setTelemetry(data.telemetry);
    setBrokerMeta({
      broker_provider: data.broker_provider,
      broker_demo_mode: data.broker_demo_mode,
      ssid_configured: data.ssid_configured,
      telegram_configured: data.telegram_configured,
      block_extreme_volatility: data.block_extreme_volatility,
      block_dead_range: data.block_dead_range,
      enable_confluence_combos: data.enable_confluence_combos,
      ai_analyst_enabled: data.ai_analyst_enabled,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);

      ws.onopen = () => {
        if (!disposed) setSocketOpen(true);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'init') {
            applyInitialPayload(msg.data as AppStatePayload);
          } else if (msg.type === 'telemetry:update') {
            const payload = msg.data;
            setTelemetry(payload);
            if (payload.mode === 'SHADOW' || payload.mode === 'SNIPER') {
              setMode(payload.mode);
            }
            if (payload.broker_provider) {
              setBrokerMeta((prev) => ({ ...prev, broker_provider: payload.broker_provider }));
            }
            if (Array.isArray(payload.market_health)) setMarketHealth(payload.market_health);
          } else if (msg.type === 'signal:new') {
            const { signal, trigger_alert } = msg.data as { signal: SignalRecord; trigger_alert: boolean };
            setSignals((prev) => {
              if (prev.some((x) => x.id === signal.id)) return prev;
              return [signal, ...prev].slice(0, 150);
            });
            if (trigger_alert) {
              if (soundRef.current) playSignalSound(signal.direction);
              setSniperToast(signal);
              setTimeout(() => {
                setSniperToast((cur) => (cur?.id === signal.id ? null : cur));
              }, 6000);
            }
          } else if (msg.type === 'signal:resolved') {
            const resolved = msg.data as SignalRecord;
            setSignals((prev) => prev.map((x) => (x.id === resolved.id ? resolved : x)));
          } else if (msg.type === 'leaderboard:update') {
            setLeaderboard(msg.data as StrategyLeaderboardRow[]);
          } else if (msg.type === 'mode:update') {
            setMode(msg.data.mode as OperationalMode);
          } else if (msg.type === 'scope:update') {
            setAssets(msg.data.assets ?? []);
            setSelectedAssets(msg.data.selected_assets ?? []);
            setSelectedTimeframes(msg.data.selected_timeframes ?? []);
            setHighPrecision(Boolean(msg.data.high_precision_mode));
            setMinConfidence(Number(msg.data.min_signal_confidence ?? 78));
            if (Array.isArray(msg.data.market_health)) setMarketHealth(msg.data.market_health);
          } else if (msg.type === 'autotrade:update') {
            setAutoTrade(msg.data as AutoTradeState);
          }
        } catch {
          // Ignore malformed WS frame
        }
      };

      ws.onclose = () => {
        if (!disposed) {
          setSocketOpen(false);
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
    };

    fetch('/api/state')
      .then((r) => r.json())
      .then((data: AppStatePayload) => {
        if (!disposed) applyInitialPayload(data);
      })
      .catch(() => {});

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [applyInitialPayload]);

  const handleModeChange = async (next: OperationalMode) => {
    setMode(next);
    try {
      const res = await fetch('/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next }),
      });
      const data = await res.json();
      if (data.mode === 'SHADOW' || data.mode === 'SNIPER') {
        setMode(data.mode);
      }
    } catch {
      // keep optimistic mode until next WS sync
    }
  };

  const handleSaveScope = async (payload: {
    selected_assets: string[];
    selected_timeframes: string[];
    high_precision_mode: boolean;
    min_signal_confidence: number;
    custom_symbol?: string;
  }) => {
    const res = await fetch('/api/scope', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (Array.isArray(data.assets)) setAssets(data.assets);
    if (Array.isArray(data.selected_assets)) setSelectedAssets(data.selected_assets);
    if (Array.isArray(data.selected_timeframes)) setSelectedTimeframes(data.selected_timeframes);
    setHighPrecision(Boolean(data.high_precision_mode));
    setMinConfidence(Number(data.min_signal_confidence ?? 78));
    if (Array.isArray(data.market_health)) setMarketHealth(data.market_health);
  };

  const handleToggleStrategy = async (
    strategyName: string,
    patch: { shadow_enabled?: boolean; live_active?: boolean },
  ) => {
    const res = await fetch('/api/strategies/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy_name: strategyName, ...patch }),
    });
    const data = await res.json();
    if (Array.isArray(data.leaderboard)) setLeaderboard(data.leaderboard);
  };

  const handleSelectTopPerformers = async (minWinRate: number, minSignals: number) => {
    const res = await fetch('/api/strategies/select-top', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ min_win_rate: minWinRate, min_signals: minSignals }),
    });
    const data = await res.json();
    if (Array.isArray(data.leaderboard)) setLeaderboard(data.leaderboard);
    return Number(data.activated_count ?? 0);
  };

  const handleClearHistory = async () => {
    const res = await fetch('/api/history/clear', { method: 'POST' });
    const data = await res.json();
    setSignals([]);
    if (Array.isArray(data.leaderboard)) setLeaderboard(data.leaderboard);
  };

  const handleTestConnection = async (
    provider: BrokerProvider,
    ssid: string,
    demoMode: boolean,
  ): Promise<ConnectionTestResult> => {
    const res = await fetch('/api/broker/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        broker_provider: provider,
        broker_ssid: ssid,
        broker_demo_mode: demoMode,
      }),
    });
    return (await res.json()) as ConnectionTestResult;
  };

  const handleDisconnectBroker = async () => {
    const res = await fetch('/api/broker/disconnect', { method: 'POST' });
    const data = await res.json();
    setBrokerMeta((prev) => ({ ...prev, broker_provider: 'NONE' }));
    setTelemetry((prev) => ({
      ...prev,
      ws_connected: false,
      broker_provider: 'NONE',
      ws_detail: data.ws_detail ?? 'Disconnected — Connect Broker SSID to Start',
    }));
  };

  const handleSaveBrokerConfig = async (values: BrokerConfigValues) => {
    const res = await fetch('/api/config/broker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    setBrokerMeta({
      broker_provider: data.broker_provider ?? values.broker_provider,
      broker_demo_mode: data.broker_demo_mode ?? values.broker_demo_mode,
      ssid_configured: Boolean(data.ssid_configured),
      telegram_configured: Boolean(data.telegram_configured),
      block_extreme_volatility: values.block_extreme_volatility,
      block_dead_range: values.block_dead_range,
      enable_confluence_combos: values.enable_confluence_combos,
      ai_analyst_enabled: values.ai_analyst_enabled,
    });
    setTelemetry((prev) => ({
      ...prev,
      broker_provider: data.broker_provider ?? values.broker_provider,
      ws_connected: Boolean(data.ws_connected),
      ws_detail: data.ws_detail ?? prev.ws_detail,
    }));
  };

  const handleSaveAutoTrade = async (values: AutoTradeFormValues) => {
    const res = await fetch('/api/autotrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (data.auto_trade) setAutoTrade(data.auto_trade);
  };

  const openModal = (tab: 'feed' | 'autotrade') => {
    setConfigInitialTab(tab);
    setConfigOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100">
      <TopBar
        lang={lang}
        onToggleLang={() => setLang((prev) => (prev === 'fa' ? 'en' : 'fa'))}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        mode={mode}
        onModeChange={handleModeChange}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled((v) => !v)}
        onOpenConfig={() => openModal('feed')}
        telemetry={telemetry}
        socketOpen={socketOpen}
      />

      {sniperToast && (
        <div
          role="alert"
          className="fixed bottom-5 end-5 z-40 w-80 rounded-lg border border-emerald-500/50 bg-[#111827] p-4 shadow-2xl signal-enter"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-emerald-400">{t(lang, 'sniper_alert_title')}</span>
            <button type="button" onClick={() => setSniperToast(null)} className="text-slate-400 hover:text-white">
              ✕
            </button>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="font-mono ltr-num text-base font-bold text-white">{sniperToast.asset}</span>
            <span
              className={`font-mono ltr-num text-sm font-bold ${
                sniperToast.direction === 'CALL' ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {sniperToast.direction} · {sniperToast.confidence.toFixed(1)}%
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400 truncate">{sniperToast.strategy_name}</p>
          <p className="mt-1 font-mono ltr-num text-xs text-slate-300 tabular-nums">
            {sniperToast.timeframe} · {sniperToast.expiry_seconds}s · {sniperToast.entry_price}
          </p>
        </div>
      )}

      <main className="mx-auto max-w-[1600px] px-5 py-5 space-y-5">
        {!loading && activeTab !== 'python' && (
          <ScopeBar
            lang={lang}
            allAssets={assets}
            selectedAssets={selectedAssets}
            allTimeframes={timeframes}
            selectedTimeframes={selectedTimeframes}
            highPrecision={highPrecision}
            minConfidence={minConfidence}
            autoTrade={autoTrade}
            onSaveScope={handleSaveScope}
            onOpenAutoTradeConfig={() => openModal('autotrade')}
          />
        )}

        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="h-36 rounded-lg border border-slate-800 bg-[#111827] animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {activeTab === 'radar' && (
              <SignalFeed
                lang={lang}
                signals={signals}
                leaderboard={leaderboard}
                mode={mode}
                wsConnected={telemetry.ws_connected}
                brokerProvider={brokerMeta.broker_provider}
                selectedAssets={selectedAssets}
                wsDetail={telemetry.ws_detail}
                autoTrade={autoTrade}
                onJumpToLeaderboard={() => setActiveTab('leaderboard')}
                onOpenConfig={() => openModal('feed')}
              />
            )}

            {activeTab === 'leaderboard' && (
              <StrategyLeaderboard
                lang={lang}
                rows={leaderboard}
                onToggleStrategy={handleToggleStrategy}
                onSelectTopPerformers={handleSelectTopPerformers}
                onClearHistory={handleClearHistory}
              />
            )}

            {activeTab === 'health' && (
              <MarketHealthRadar lang={lang} items={marketHealth} selectedAssets={selectedAssets} />
            )}

            {activeTab === 'history' && (
              <SignalHistoryLog
                lang={lang}
                strategies={leaderboard.map((l) => l.strategy_name)}
                assets={assets}
                timeframes={timeframes}
              />
            )}

            {activeTab === 'python' && <PythonBundlePanel lang={lang} />}
          </>
        )}
      </main>

      <BrokerConfigModal
        key={`${configOpen}-${configInitialTab}`}
        lang={lang}
        open={configOpen}
        initialTab={configInitialTab}
        onClose={() => setConfigOpen(false)}
        initial={brokerMeta}
        wsConnected={telemetry.ws_connected}
        autoTrade={autoTrade}
        onTestConnection={handleTestConnection}
        onDisconnect={handleDisconnectBroker}
        onSaveBroker={handleSaveBrokerConfig}
        onSaveAutoTrade={handleSaveAutoTrade}
      />
    </div>
  );
}

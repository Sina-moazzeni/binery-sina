import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Crosshair, PlugZap, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { t } from '../i18n';
import type {
  AutoTradeState,
  BrokerProvider,
  Lang,
  OperationalMode,
  SignalRecord,
  StrategyLeaderboardRow,
} from '../types';

interface SignalFeedProps {
  lang: Lang;
  signals: SignalRecord[];
  leaderboard: StrategyLeaderboardRow[];
  mode: OperationalMode;
  wsConnected: boolean;
  brokerProvider: BrokerProvider;
  selectedAssets: string[];
  wsDetail: string;
  autoTrade: AutoTradeState;
  onJumpToLeaderboard: () => void;
  onOpenConfig: () => void;
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 50) return price.toFixed(3);
  return price.toFixed(5);
}

function formatUtc(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(11, 19);
}

export function SignalFeed({
  lang,
  signals,
  leaderboard,
  mode,
  wsConnected,
  brokerProvider,
  selectedAssets,
  wsDetail,
  autoTrade,
  onJumpToLeaderboard,
  onOpenConfig,
}: SignalFeedProps) {
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000);
  const [marketFilter, setMarketFilter] = useState<'ALL' | 'LIVE' | 'OTC'>('ALL');
  const [onlyPending, setOnlyPending] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNowSec(Date.now() / 1000), 500);
    return () => clearInterval(id);
  }, []);

  const activeNames = new Set(leaderboard.filter((r) => r.live_active).map((r) => r.strategy_name));
  const isDisconnected = !wsConnected || brokerProvider === 'NONE';
  const noAssetsSelected = selectedAssets.length === 0;

  const filtered = signals
    .filter((s) => (marketFilter === 'ALL' ? true : s.market_type === marketFilter))
    .filter((s) => (onlyPending ? s.status === 'PENDING' : true))
    .filter((s) => (mode === 'SNIPER' ? activeNames.has(s.strategy_name) : true))
    .slice(0, 18);

  const pendingCount = signals.filter((s) => s.status === 'PENDING').length;
  const resolvedRecent = signals.filter((s) => s.status === 'WIN' || s.status === 'LOSS').slice(0, 100);
  const recentWins = resolvedRecent.filter((s) => s.status === 'WIN').length;
  const rollingWr = resolvedRecent.length > 0 ? ((recentWins / resolvedRecent.length) * 100).toFixed(1) : '0.0';
  const topStrategy = leaderboard.find((r) => r.total_signals > 0) ?? null;

  return (
    <section className="space-y-6">
      {/* Compact Institutional Summary Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-[#111827] px-4 py-3.5">
          <div className="text-xs text-slate-400">{t(lang, 'kpi_mode')}</div>
          <div
            className={`mt-1 font-display text-sm font-semibold ${
              mode === 'SNIPER' ? 'text-emerald-400' : 'text-white'
            }`}
          >
            {mode === 'SHADOW' ? t(lang, 'kpi_mode_shadow') : t(lang, 'kpi_mode_sniper')}
          </div>
          <div className={`mt-1 text-xs truncate ltr-num ${isDisconnected ? 'text-rose-400' : 'text-slate-400'}`}>
            {wsDetail}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#111827] px-4 py-3.5">
          <div className="text-xs text-slate-400">{t(lang, 'kpi_pending')}</div>
          <div className="mt-1 font-mono ltr-num text-2xl font-semibold text-amber-400 tabular-nums">
            {pendingCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">{t(lang, 'kpi_pending_sub')}</div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#111827] px-4 py-3.5">
          <div className="text-xs text-slate-400">{t(lang, 'kpi_wr')}</div>
          <div className="mt-1 font-mono ltr-num text-2xl font-semibold text-emerald-400 tabular-nums">
            {rollingWr}%
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono ltr-num tabular-nums">
            {recentWins}W / {resolvedRecent.length - recentWins}L {t(lang, 'kpi_decided')}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#111827] px-4 py-3.5">
          <div className="text-xs text-slate-400">{t(lang, 'kpi_top_strat')}</div>
          <div className="mt-1 font-display text-sm font-semibold text-white truncate">
            {topStrategy ? topStrategy.strategy_name : '—'}
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-400 font-mono tabular-nums">
            <span className="ltr-num">{topStrategy ? `${topStrategy.wr_last_100.toFixed(1)}% WR` : '0 signals'}</span>
            <button
              type="button"
              onClick={onJumpToLeaderboard}
              className="font-sans text-blue-400 hover:text-blue-300"
            >
              {t(lang, 'kpi_manage')} ({activeNames.size} {t(lang, 'kpi_active')})
            </button>
          </div>
        </div>
      </div>

      {/* Explicit Active Sniper Mode Banner */}
      {mode === 'SNIPER' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
          <div className="flex items-center gap-2 font-medium">
            <Crosshair className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{t(lang, 'sniper_banner_active')}</span>
          </div>
          <button
            type="button"
            onClick={onJumpToLeaderboard}
            className="rounded-md border border-emerald-500/40 bg-emerald-600/20 px-3 py-1 font-medium text-emerald-200 hover:bg-emerald-600/30 whitespace-nowrap"
          >
            {t(lang, 'btn_open_lab')} ({activeNames.size})
          </button>
        </div>
      )}

      {/* Feed Header & Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-3.5">
        <div>
          <h1 className="font-display text-xl font-semibold text-white">{t(lang, 'radar_title')}</h1>
          <p className="mt-0.5 text-xs text-slate-400 inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            {t(lang, 'radar_safety_note')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-md border border-slate-800 bg-[#111827] p-0.5 text-xs">
            {(['ALL', 'LIVE', 'OTC'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMarketFilter(m)}
                className={`px-3 py-1 rounded font-medium transition-colors whitespace-nowrap ${
                  marketFilter === m ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m === 'ALL' ? t(lang, 'filter_all_markets') : m}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setOnlyPending((v) => !v)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              onlyPending
                ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                : 'border-slate-800 bg-[#111827] text-slate-300 hover:border-slate-700'
            }`}
          >
            {onlyPending ? t(lang, 'filter_showing_pending') : t(lang, 'filter_pending_only')}
          </button>
        </div>
      </div>

      {/* Live Signal Grid or Strict Idle States */}
      {isDisconnected && filtered.length === 0 ? (
        <div className="rounded-lg border border-rose-500/30 bg-[#111827] px-6 py-12 text-center space-y-3">
          <PlugZap className="mx-auto h-7 w-7 text-rose-400" />
          <p className="text-sm font-semibold text-white">{t(lang, 'idle_disconnected_title')}</p>
          <p className="mx-auto max-w-xl text-xs text-slate-400 leading-relaxed">
            {t(lang, 'idle_disconnected_sub')}
          </p>
          <button
            type="button"
            onClick={onOpenConfig}
            className="mt-2 inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500"
          >
            <PlugZap className="h-3.5 w-3.5" />
            {t(lang, 'btn_connect_now')}
          </button>
        </div>
      ) : noAssetsSelected && filtered.length === 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-[#111827] px-6 py-12 text-center space-y-2.5">
          <SlidersHorizontal className="mx-auto h-7 w-7 text-amber-400" />
          <p className="text-sm font-semibold text-white">{t(lang, 'idle_no_assets_title')}</p>
          <p className="mx-auto max-w-xl text-xs text-slate-400 leading-relaxed">
            {t(lang, 'idle_no_assets_sub')}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-[#111827] px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-200">
            {mode === 'SNIPER' && activeNames.size === 0
              ? t(lang, 'empty_sniper_title')
              : t(lang, 'empty_radar_title')}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {mode === 'SNIPER' && activeNames.size === 0
              ? t(lang, 'empty_sniper_sub')
              : t(lang, 'empty_radar_sub')}
          </p>
          {mode === 'SNIPER' && activeNames.size === 0 && (
            <button
              type="button"
              onClick={onJumpToLeaderboard}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500"
            >
              {t(lang, 'btn_open_lab')}
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((sig) => {
            const isCall = sig.direction === 'CALL';
            const remaining = Math.max(0, Math.ceil(sig.expires_at - nowSec));
            const progress =
              sig.status === 'PENDING'
                ? Math.max(0, Math.min(100, (remaining / Math.max(1, sig.expiry_seconds)) * 100))
                : 0;

            const outcomeColor =
              sig.status === 'WIN'
                ? 'text-emerald-400'
                : sig.status === 'LOSS'
                  ? 'text-rose-400'
                  : sig.status === 'TIE'
                    ? 'text-slate-300'
                    : 'text-amber-400';

            return (
              <article
                key={sig.id}
                className="signal-enter rounded-lg border border-slate-800 bg-[#111827] p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-400 ltr-num">
                      <span className="font-mono text-slate-300">{sig.market_type}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-slate-300">{sig.timeframe}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{formatUtc(sig.timestamp)}</span>
                    </div>
                    <h3 className="mt-1 font-mono ltr-num text-base font-semibold text-white truncate">
                      {sig.asset}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-400 truncate" title={sig.strategy_name}>
                      {sig.is_combo ? t(lang, 'combo_prefix') : ''}
                      {sig.strategy_name}
                    </p>
                  </div>

                  <div className="text-end shrink-0">
                    <div
                      className={`inline-flex items-center gap-1 font-mono ltr-num text-sm font-bold ${
                        isCall ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {isCall ? (
                        <ArrowUpRight className="h-4 w-4" />
                      ) : (
                        <ArrowDownRight className="h-4 w-4" />
                      )}
                      {sig.direction}
                    </div>
                    <div className="mt-0.5 font-mono ltr-num text-xs text-slate-300 tabular-nums">
                      {sig.confidence.toFixed(1)}% {t(lang, 'score_label')}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-400 truncate" title={sig.reason}>
                  {sig.reason}
                </p>

                <div className="flex items-center justify-between border-t border-slate-800/80 pt-2.5 text-xs font-mono tabular-nums">
                  <div className="text-slate-400 ltr-num">
                    {t(lang, 'entry_label')}{' '}
                    <span className="text-slate-200">{formatPrice(sig.entry_price)}</span>
                    {sig.exit_price !== null && (
                      <>
                        {' '}
                        → <span className="text-slate-200">{formatPrice(sig.exit_price)}</span>
                      </>
                    )}
                  </div>
                  <div className={`font-semibold ltr-num ${outcomeColor}`}>
                    {sig.status === 'PENDING' ? `EXP ${remaining}s` : sig.status}
                  </div>
                </div>

                <div className="h-1 w-full overflow-hidden rounded-sm bg-slate-800">
                  <div
                    className={`h-full transition-all duration-500 ${
                      sig.status === 'WIN'
                        ? 'bg-emerald-500'
                        : sig.status === 'LOSS'
                          ? 'bg-rose-500'
                          : isCall
                            ? 'bg-emerald-500/80'
                            : 'bg-rose-500/80'
                    }`}
                    style={{ width: sig.status === 'PENDING' ? `${progress}%` : '100%' }}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Guarded Auto-Trade Execution Audit Strip */}
      {autoTrade.recent_executions.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-[#111827] p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <h3 className="font-semibold text-white">{t(lang, 'exec_log_title')}</h3>
            <span className="font-mono ltr-num text-slate-400">
              {autoTrade.daily_trades}/{autoTrade.max_daily_trades} today · Loss Run {autoTrade.consecutive_losses}/{autoTrade.max_consec_losses}
            </span>
          </div>
          <div className="divide-y divide-slate-800/70 text-xs font-mono ltr-num">
            {autoTrade.recent_executions.slice(0, 6).map((ex) => (
              <div key={ex.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-slate-300">
                  {formatUtc(ex.timestamp)} · <strong className="text-white">{ex.asset}</strong> ({ex.timeframe}) ·{' '}
                  <span className={ex.direction === 'CALL' ? 'text-emerald-400' : 'text-rose-400'}>{ex.direction}</span>
                </span>
                <span className={ex.ok ? 'text-emerald-400' : 'text-rose-400'}>{ex.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { t } from '../i18n';
import type { Lang, SignalRecord } from '../types';

interface SignalHistoryLogProps {
  lang: Lang;
  strategies: string[];
  assets: string[];
  timeframes: string[];
}

function formatDateTime(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.toISOString().slice(5, 10)} ${d.toISOString().slice(11, 19)}`;
}

function formatPrice(p: number): string {
  if (p >= 1000) return p.toFixed(2);
  if (p >= 50) return p.toFixed(3);
  return p.toFixed(5);
}

export function SignalHistoryLog({ lang, strategies, assets, timeframes }: SignalHistoryLogProps) {
  const [strategy, setStrategy] = useState('ALL');
  const [asset, setAsset] = useState('ALL');
  const [marketType, setMarketType] = useState('ALL');
  const [timeframe, setTimeframe] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [rows, setRows] = useState<SignalRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        strategy,
        asset,
        market_type: marketType,
        timeframe,
        status,
        limit: '250',
      });
      const res = await fetch(`/api/history?${params.toString()}`);
      const data = await res.json();
      setRows(data.signals ?? []);
    } finally {
      setLoading(false);
    }
  }, [strategy, asset, marketType, timeframe, status]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleExportCsv = () => {
    const params = new URLSearchParams({
      strategy,
      asset,
      market_type: marketType,
      timeframe,
      status,
    });
    window.location.assign(`/api/history/export.csv?${params.toString()}`);
  };

  const decided = rows.filter((r) => r.status === 'WIN' || r.status === 'LOSS');
  const wins = decided.filter((r) => r.status === 'WIN').length;
  const filteredWr = decided.length > 0 ? ((wins / decided.length) * 100).toFixed(1) : '0.0';

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-white">{t(lang, 'history_title')}</h2>
          <p className="mt-1 text-xs text-slate-400">
            {t(lang, 'history_showing')}:{' '}
            <strong className="font-mono ltr-num text-slate-200">{rows.length}</strong> ·{' '}
            {t(lang, 'history_filtered_wr')}:{' '}
            <strong className="font-mono ltr-num text-emerald-400">{filteredWr}%</strong>{' '}
            <span className="font-mono ltr-num">({wins}W / {decided.length - wins}L)</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchHistory}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#141B29] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t(lang, 'btn_refresh')}
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-blue-500 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            {t(lang, 'btn_export_csv')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <select
          aria-label="Filter by strategy"
          value={strategy}
          onChange={(e) => setStrategy(e.target.value)}
          className="rounded-md border border-slate-700 bg-[#111827] px-3 py-2 text-slate-200 max-w-[260px]"
        >
          <option value="ALL">{t(lang, 'all_strategies')}</option>
          {strategies.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by asset"
          value={asset}
          onChange={(e) => setAsset(e.target.value)}
          className="rounded-md border border-slate-700 bg-[#111827] px-3 py-2 text-slate-200"
        >
          <option value="ALL">{t(lang, 'all_assets')}</option>
          {assets.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by market type"
          value={marketType}
          onChange={(e) => setMarketType(e.target.value)}
          className="rounded-md border border-slate-700 bg-[#111827] px-3 py-2 text-slate-200"
        >
          <option value="ALL">{t(lang, 'live_otc_all')}</option>
          <option value="LIVE">{t(lang, 'live_only')}</option>
          <option value="OTC">{t(lang, 'otc_only')}</option>
        </select>

        <select
          aria-label="Filter by timeframe"
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value)}
          className="rounded-md border border-slate-700 bg-[#111827] px-3 py-2 text-slate-200"
        >
          <option value="ALL">{t(lang, 'all_tfs')}</option>
          {timeframes.map((tf) => (
            <option key={tf} value={tf}>
              {tf}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by outcome"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-slate-700 bg-[#111827] px-3 py-2 text-slate-200"
        >
          <option value="ALL">{t(lang, 'all_outcomes')}</option>
          <option value="WIN">WIN</option>
          <option value="LOSS">LOSS</option>
          <option value="TIE">TIE</option>
          <option value="PENDING">PENDING</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#111827]">
        <table className="w-full text-xs">
          <thead className="border-b border-slate-800 text-slate-400">
            <tr>
              <th className="px-4 py-3 text-start font-medium">UTC</th>
              <th className="px-3 py-3 text-start font-medium">Asset</th>
              <th className="px-3 py-3 text-start font-medium">TF / Exp</th>
              <th className="px-3 py-3 text-start font-medium">{t(lang, 'col_strategy')}</th>
              <th className="px-3 py-3 text-start font-medium">Dir</th>
              <th className="px-3 py-3 text-end font-medium">Score</th>
              <th className="px-3 py-3 text-end font-medium">Entry</th>
              <th className="px-3 py-3 text-end font-medium">Exit</th>
              <th className="px-3 py-3 text-start font-medium">Regime</th>
              <th className="px-4 py-3 text-end font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center font-sans text-slate-400">
                  {lang === 'fa' ? 'هیچ سیگنالی با این فیلتر پیدا نشد.' : 'No signals match the selected filters.'}
                </td>
              </tr>
            ) : (
              rows.map((s) => {
                const outcomeColor =
                  s.status === 'WIN'
                    ? 'text-emerald-400'
                    : s.status === 'LOSS'
                      ? 'text-rose-400'
                      : s.status === 'TIE'
                        ? 'text-slate-300'
                        : 'text-amber-400';

                return (
                  <tr key={s.id} className="hover:bg-slate-800/35">
                    <td className="px-4 py-2.5 text-slate-400 ltr-num whitespace-nowrap">{formatDateTime(s.timestamp)}</td>
                    <td className="px-3 py-2.5 ltr-num whitespace-nowrap">
                      <span className="text-white font-medium">{s.asset}</span>{' '}
                      <span className="text-slate-500">{s.market_type}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-300 ltr-num whitespace-nowrap">
                      {s.timeframe} / {s.expiry_seconds}s
                    </td>
                    <td className="px-3 py-2.5 font-sans text-slate-200 max-w-[260px] truncate" title={s.strategy_name}>
                      {s.strategy_name}
                    </td>
                    <td className={`px-3 py-2.5 font-semibold ltr-num ${s.direction === 'CALL' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {s.direction}
                    </td>
                    <td className="px-3 py-2.5 text-end text-slate-300 ltr-num">{s.confidence.toFixed(1)}%</td>
                    <td className="px-3 py-2.5 text-end text-slate-300 ltr-num">{formatPrice(s.entry_price)}</td>
                    <td className="px-3 py-2.5 text-end text-slate-300 ltr-num">
                      {s.exit_price !== null ? formatPrice(s.exit_price) : '—'}
                    </td>
                    <td className="px-3 py-2.5 font-sans text-slate-400 whitespace-nowrap">{s.market_regime}</td>
                    <td className={`px-4 py-2.5 text-end font-semibold ltr-num ${outcomeColor}`}>{s.status}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

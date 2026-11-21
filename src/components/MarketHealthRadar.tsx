import { useState } from 'react';
import { AlertTriangle, CheckCircle2, PauseCircle } from 'lucide-react';
import { t } from '../i18n';
import type { Lang, MarketHealth } from '../types';

interface MarketHealthRadarProps {
  lang: Lang;
  items: MarketHealth[];
  selectedAssets: string[];
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 50) return price.toFixed(3);
  return price.toFixed(5);
}

function Sparkline({ prices, stroke }: { prices: number[]; stroke: string }) {
  if (prices.length < 2) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(max - min, 1e-9);
  const w = 136;
  const h = 34;
  const pts = prices
    .map((p, idx) => {
      const x = (idx / (prices.length - 1)) * w;
      const y = h - 3 - ((p - min) / span) * (h - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible shrink-0" aria-hidden="true">
      <polyline fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

export function MarketHealthRadar({ lang, items, selectedAssets }: MarketHealthRadarProps) {
  const [filter, setFilter] = useState<'ALL' | 'WATCHED' | 'LIVE' | 'OTC'>('ALL');
  const visible = items.filter((m) => {
    if (filter === 'WATCHED') return selectedAssets.includes(m.asset);
    if (filter === 'LIVE') return m.market_type === 'LIVE';
    if (filter === 'OTC') return m.market_type === 'OTC';
    return true;
  });

  const optimalCount = items.filter((m) => m.regime === 'OPTIMAL').length;
  const spikeCount = items.filter((m) => m.regime === 'EXTREME_VOLATILITY').length;
  const deadCount = items.filter((m) => m.regime === 'DEAD_RANGE').length;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-white">{t(lang, 'health_title')}</h2>
          <p className="mt-1 text-xs text-slate-400">{t(lang, 'health_sub')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-3 font-mono ltr-num tabular-nums text-slate-400">
            <span className="text-emerald-400">{optimalCount} Optimal</span>
            <span aria-hidden="true">·</span>
            <span className="text-rose-400">{spikeCount} Spike</span>
            <span aria-hidden="true">·</span>
            <span className="text-amber-400">{deadCount} Dead</span>
          </div>

          <div className="flex items-center rounded-md border border-slate-800 bg-[#111827] p-0.5">
            {(['ALL', 'WATCHED', 'LIVE', 'OTC'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setFilter(m)}
                className={`px-3 py-1 rounded font-medium whitespace-nowrap ${
                  filter === m ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m === 'ALL'
                  ? t(lang, 'health_all')
                  : m === 'WATCHED'
                    ? lang === 'fa'
                      ? 'ارزهای انتخابی'
                      : 'Watchlist'
                    : m}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((m) => {
          const isOptimal = m.regime === 'OPTIMAL';
          const isSpike = m.regime === 'EXTREME_VOLATILITY';
          const isWatched = selectedAssets.includes(m.asset);

          const statusText = isOptimal
            ? t(lang, 'health_optimal')
            : isSpike
              ? t(lang, 'health_spike')
              : t(lang, 'health_dead');

          const statusColor = isOptimal ? 'text-emerald-400' : isSpike ? 'text-rose-400' : 'text-amber-400';
          const strokeColor = isOptimal ? '#10B981' : isSpike ? '#EF4444' : '#F59E0B';

          const biasText =
            m.macro_bias === 'BULLISH_ONLY'
              ? t(lang, 'bias_bull')
              : m.macro_bias === 'BEARISH_ONLY'
                ? t(lang, 'bias_bear')
                : t(lang, 'bias_neutral');

          return (
            <div
              key={m.asset}
              className={`rounded-lg border bg-[#111827] p-4 space-y-3 ${
                isWatched ? 'border-slate-700' : 'border-slate-800/80 opacity-85'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="font-mono text-slate-300">{m.market_type}</span>
                    <span aria-hidden="true">·</span>
                    <span>{biasText}</span>
                    {isWatched && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-emerald-400">{lang === 'fa' ? 'فعال در تست' : 'Active'}</span>
                      </>
                    )}
                  </div>
                  <h3 className="mt-1 font-mono ltr-num text-base font-semibold text-white">{m.asset}</h3>
                </div>

                <div className="text-end font-mono ltr-num tabular-nums">
                  <div className="text-sm font-semibold text-white">{formatPrice(m.price)}</div>
                  <div className={`text-xs ${m.change_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {m.change_pct >= 0 ? '+' : ''}
                    {m.change_pct.toFixed(3)}%
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 py-1">
                <div className="min-w-0">
                  <div className={`inline-flex items-center gap-1.5 text-xs font-semibold ${statusColor}`}>
                    {isOptimal ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    ) : isSpike ? (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <PauseCircle className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>{statusText}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{m.warning_message}</p>
                </div>
                <Sparkline prices={m.recent_prices} stroke={strokeColor} />
              </div>

              <div className="grid grid-cols-3 gap-2 border-t border-slate-800/80 pt-2.5 text-xs font-mono ltr-num tabular-nums">
                <div>
                  <span className="text-slate-500 block">ATR %</span>
                  <span className="text-slate-200">{m.atr_pct.toFixed(4)}%</span>
                </div>
                <div>
                  <span className="text-slate-500 block">ADX (14)</span>
                  <span className="text-slate-200">{m.adx.toFixed(1)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">BB Width</span>
                  <span className="text-slate-200">{m.bb_width_pct.toFixed(3)}%</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

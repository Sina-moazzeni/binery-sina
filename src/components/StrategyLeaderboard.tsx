import { useState } from 'react';
import { Award, Layers, Trash2 } from 'lucide-react';
import { t } from '../i18n';
import type { Lang, StrategyLeaderboardRow } from '../types';

interface StrategyLeaderboardProps {
  lang: Lang;
  rows: StrategyLeaderboardRow[];
  onToggleStrategy: (name: string, patch: { shadow_enabled?: boolean; live_active?: boolean }) => Promise<void>;
  onSelectTopPerformers: (minWinRate: number, minSignals: number) => Promise<number>;
  onClearHistory: () => Promise<void>;
}

export function StrategyLeaderboard({
  lang,
  rows,
  onToggleStrategy,
  onSelectTopPerformers,
  onClearHistory,
}: StrategyLeaderboardProps) {
  const [threshold, setThreshold] = useState(68);
  const [minSignals, setMinSignals] = useState(20);
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'SINGLE' | 'COMBO'>('ALL');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const visible = rows.filter((r) => {
    if (typeFilter === 'SINGLE') return !r.is_combo;
    if (typeFilter === 'COMBO') return r.is_combo;
    return true;
  });

  const handleSelectTop = async () => {
    setBusy(true);
    try {
      const count = await onSelectTopPerformers(threshold, minSignals);
      setNotice(
        lang === 'fa'
          ? `${count} استراتژی با وین‌ریت ≥ ${threshold}% (حداقل ${minSignals} سیگنال) وارد حالت واقعی شدند.`
          : `Activated ${count} strategies with ≥ ${threshold}% Last-100 WR (min ${minSignals} signals).`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-white">{t(lang, 'lab_title')}</h2>
          <p className="mt-1 text-xs text-slate-400">{t(lang, 'lab_sub')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center rounded-md border border-slate-800 bg-[#111827] p-0.5">
            {(['ALL', 'SINGLE', 'COMBO'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTypeFilter(k)}
                className={`px-2.5 py-1 rounded font-medium whitespace-nowrap ${
                  typeFilter === k ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {k === 'ALL' ? t(lang, 'lab_all') : k === 'SINGLE' ? t(lang, 'lab_single') : t(lang, 'lab_combo')}
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-1.5 text-slate-400">
            {t(lang, 'lab_min_wr')}
            <input
              type="number"
              min={50}
              max={95}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-16 rounded-md border border-slate-700 bg-[#111827] px-2 py-1.5 font-mono ltr-num text-white tabular-nums"
            />
          </label>

          <label className="inline-flex items-center gap-1.5 text-slate-400">
            {t(lang, 'lab_min_trades')}
            <input
              type="number"
              min={5}
              max={100}
              value={minSignals}
              onChange={(e) => setMinSignals(Number(e.target.value))}
              className="w-16 rounded-md border border-slate-700 bg-[#111827] px-2 py-1.5 font-mono ltr-num text-white tabular-nums"
            />
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={handleSelectTop}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            <Award className="h-3.5 w-3.5" />
            {t(lang, 'lab_select_top')}
          </button>

          <button
            type="button"
            onClick={onClearHistory}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-slate-300 hover:border-rose-500/40 hover:text-rose-300 transition-colors whitespace-nowrap"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t(lang, 'lab_clear_stats')}
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-center justify-between rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-300">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-emerald-200 hover:text-white">
            ✕
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#111827]">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-800 text-xs text-slate-400">
            <tr>
              <th className="px-4 py-3 text-start font-medium">{t(lang, 'col_strategy')}</th>
              <th className="px-3 py-3 text-end font-medium">{t(lang, 'col_wr100')}</th>
              <th className="px-3 py-3 text-end font-medium">{t(lang, 'col_today')}</th>
              <th className="px-3 py-3 text-end font-medium">{t(lang, 'col_live_otc')}</th>
              <th className="px-3 py-3 text-end font-medium">{t(lang, 'col_signals')}</th>
              <th className="px-3 py-3 text-end font-medium">{t(lang, 'col_wl')}</th>
              <th className="px-3 py-3 text-end font-medium">{t(lang, 'col_streak')}</th>
              <th className="px-3 py-3 text-end font-medium">{t(lang, 'col_maxloss')}</th>
              <th className="px-3 py-3 text-center font-medium">{t(lang, 'col_shadow')}</th>
              <th className="px-4 py-3 text-center font-medium">{t(lang, 'col_active')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {visible.map((row) => {
              const wrColor =
                row.wr_last_100 >= 68
                  ? 'text-emerald-400'
                  : row.wr_last_100 >= 58
                    ? 'text-slate-100'
                    : 'text-rose-400';
              const streakLabel =
                row.current_streak > 0
                  ? `+${row.current_streak}W`
                  : row.current_streak < 0
                    ? `${row.current_streak}L`
                    : '0';
              const streakColor =
                row.current_streak > 0
                  ? 'text-emerald-400'
                  : row.current_streak < 0
                    ? 'text-rose-400'
                    : 'text-slate-500';

              return (
                <tr key={row.strategy_name} className="hover:bg-slate-800/35 transition-colors">
                  <td className="px-4 py-3 max-w-[360px]">
                    <div className="flex items-center gap-2 font-medium text-white">
                      {row.is_combo && <Layers className="h-3.5 w-3.5 text-blue-400 shrink-0" />}
                      <span className="truncate">{row.strategy_name}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500 truncate">
                      {row.is_combo ? t(lang, 'lab_combo') : t(lang, 'lab_single')} · {row.description}
                    </div>
                  </td>
                  <td className={`px-3 py-3 text-end font-mono ltr-num font-semibold tabular-nums ${wrColor}`}>
                    {row.wr_last_100.toFixed(1)}%
                  </td>
                  <td className="px-3 py-3 text-end font-mono ltr-num text-xs text-slate-300 tabular-nums">
                    {row.today_wr.toFixed(1)}%
                  </td>
                  <td className="px-3 py-3 text-end font-mono ltr-num text-xs text-slate-400 tabular-nums whitespace-nowrap">
                    {row.live_wr.toFixed(0)}% / {row.otc_wr.toFixed(0)}%
                  </td>
                  <td className="px-3 py-3 text-end font-mono ltr-num text-xs text-slate-300 tabular-nums">
                    {row.total_signals}
                  </td>
                  <td className="px-3 py-3 text-end font-mono ltr-num text-xs text-slate-300 tabular-nums whitespace-nowrap">
                    {row.wins} / {row.losses}
                  </td>
                  <td className={`px-3 py-3 text-end font-mono ltr-num text-xs font-semibold tabular-nums ${streakColor}`}>
                    {streakLabel}
                  </td>
                  <td className="px-3 py-3 text-end font-mono ltr-num text-xs text-slate-400 tabular-nums">
                    {row.max_consecutive_losses}L
                  </td>
                  <td className="px-3 py-3 text-center">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.shadow_enabled}
                      onClick={() =>
                        onToggleStrategy(row.strategy_name, { shadow_enabled: !row.shadow_enabled })
                      }
                      className={`inline-flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${
                        row.shadow_enabled ? 'bg-blue-600' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        className={`h-4 w-4 rounded-full bg-white transition-transform ${
                          row.shadow_enabled
                            ? lang === 'fa'
                              ? '-translate-x-4'
                              : 'translate-x-4'
                            : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={row.live_active}
                      onClick={() =>
                        onToggleStrategy(row.strategy_name, { live_active: !row.live_active })
                      }
                      className={`inline-flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${
                        row.live_active ? 'bg-emerald-600' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        className={`h-4 w-4 rounded-full bg-white transition-transform ${
                          row.live_active
                            ? lang === 'fa'
                              ? '-translate-x-4'
                              : 'translate-x-4'
                            : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

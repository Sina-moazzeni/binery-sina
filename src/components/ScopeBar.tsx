import { useEffect, useState } from 'react';
import { Check, Plus, ShieldAlert, SlidersHorizontal, XCircle } from 'lucide-react';
import { t } from '../i18n';
import type { AutoTradeState, Lang } from '../types';

interface ScopeBarProps {
  lang: Lang;
  allAssets: string[];
  selectedAssets: string[];
  allTimeframes: string[];
  selectedTimeframes: string[];
  highPrecision: boolean;
  minConfidence: number;
  autoTrade: AutoTradeState;
  onSaveScope: (payload: {
    selected_assets: string[];
    selected_timeframes: string[];
    high_precision_mode: boolean;
    min_signal_confidence: number;
    custom_symbol?: string;
  }) => Promise<void>;
  onOpenAutoTradeConfig: () => void;
}

export function ScopeBar({
  lang,
  allAssets,
  selectedAssets,
  allTimeframes,
  selectedTimeframes,
  highPrecision,
  minConfidence,
  autoTrade,
  onSaveScope,
  onOpenAutoTradeConfig,
}: ScopeBarProps) {
  const [draftAssets, setDraftAssets] = useState<string[]>(selectedAssets);
  const [draftTfs, setDraftTfs] = useState<string[]>(selectedTimeframes);
  const [draftPrecision, setDraftPrecision] = useState<boolean>(highPrecision);
  const [draftMinConf, setDraftMinConf] = useState<number>(minConfidence);
  const [customSym, setCustomSym] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraftAssets(selectedAssets), [selectedAssets]);
  useEffect(() => setDraftTfs(selectedTimeframes), [selectedTimeframes]);
  useEffect(() => setDraftPrecision(highPrecision), [highPrecision]);
  useEffect(() => setDraftMinConf(minConfidence), [minConfidence]);

  // Allow deselecting ALL assets (0 selected = paused/idle)
  const toggleAsset = (sym: string) => {
    setDraftAssets((prev) => (prev.includes(sym) ? prev.filter((x) => x !== sym) : [...prev, sym]));
  };

  const toggleTf = (tf: string) => {
    setDraftTfs((prev) => {
      if (prev.includes(tf)) {
        return prev.length > 1 ? prev.filter((x) => x !== tf) : prev;
      }
      return [...prev, tf];
    });
  };

  const apply = async (extraSymbol?: string, overrideAssets?: string[]) => {
    setSaving(true);
    try {
      await onSaveScope({
        selected_assets: overrideAssets ?? draftAssets,
        selected_timeframes: draftTfs,
        high_precision_mode: draftPrecision,
        min_signal_confidence: draftMinConf,
        custom_symbol: extraSymbol,
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustom = async () => {
    const clean = customSym.trim().toUpperCase();
    if (!clean) return;
    setCustomSym('');
    await apply(clean);
  };

  const handleClearAll = async () => {
    setDraftAssets([]);
    await apply(undefined, []);
  };

  return (
    <section className="rounded-lg border border-slate-800 bg-[#111827] px-4 py-3.5 space-y-3 text-xs">
      {/* Row 1: Heading + Auto-Trade Pill + Custom Symbol */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-blue-400 shrink-0" />
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-semibold text-white">{t(lang, 'scope_heading')}</span>
              {selectedAssets.length === 0 && (
                <span className="text-[11px] font-medium text-amber-400">{t(lang, 'scope_paused_badge')}</span>
              )}
            </div>
            <div className="text-[11px] text-slate-400">{t(lang, 'scope_sub')}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenAutoTradeConfig}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-medium transition-colors whitespace-nowrap ${
              autoTrade.circuit_breaker_tripped
                ? 'border-rose-500/60 bg-rose-500/10 text-rose-300'
                : autoTrade.enabled
                  ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                  : 'border-slate-700 bg-[#0B0F17] text-slate-400 hover:text-slate-200'
            }`}
          >
            {autoTrade.enabled || autoTrade.circuit_breaker_tripped ? (
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            ) : null}
            {autoTrade.circuit_breaker_tripped
              ? t(lang, 'autotrade_tripped')
              : autoTrade.enabled
                ? `${t(lang, 'autotrade_on')} (${autoTrade.target})`
                : t(lang, 'autotrade_off')}
          </button>

          <div className="flex items-center gap-1">
            <input
              type="text"
              value={customSym}
              onChange={(e) => setCustomSym(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCustom();
                }
              }}
              placeholder={t(lang, 'scope_custom_placeholder')}
              className="w-48 sm:w-56 rounded-md border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 font-mono text-white placeholder:font-sans placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={handleAddCustom}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-[#141B29] px-2.5 py-1.5 text-slate-200 hover:bg-slate-800 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              {t(lang, 'scope_add')}
            </button>
          </div>
        </div>
      </div>

      {/* Row 2: Timeframes + High-Precision Gate + Apply */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400 font-medium whitespace-nowrap">{t(lang, 'scope_tfs')}:</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {allTimeframes.map((tf) => {
              const active = draftTfs.includes(tf);
              return (
                <button
                  key={tf}
                  type="button"
                  onClick={() => toggleTf(tf)}
                  className={`font-mono ltr-num rounded border px-2.5 py-1 transition-colors whitespace-nowrap ${
                    active
                      ? 'border-blue-500 bg-blue-600/20 text-blue-300 font-semibold'
                      : 'border-slate-800 bg-[#0B0F17] text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {tf}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setDraftTfs(['5m'])}
              className="rounded border border-slate-800 px-2 py-1 text-[11px] text-slate-400 hover:text-white"
            >
              {t(lang, 'scope_only_5m')}
            </button>
            <button
              type="button"
              onClick={() => setDraftTfs(['1m'])}
              className="rounded border border-slate-800 px-2 py-1 text-[11px] text-slate-400 hover:text-white"
            >
              {t(lang, 'scope_only_1m')}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={draftPrecision}
              onChange={(e) => setDraftPrecision(e.target.checked)}
              className="h-3.5 w-3.5 accent-emerald-500"
            />
            {t(lang, 'scope_precision')}
          </label>

          {draftPrecision && (
            <label className="inline-flex items-center gap-1.5 text-slate-400 whitespace-nowrap">
              {t(lang, 'scope_min_conf')}
              <input
                type="number"
                min={60}
                max={92}
                value={draftMinConf}
                onChange={(e) => setDraftMinConf(Number(e.target.value))}
                className="w-14 rounded border border-slate-700 bg-[#0B0F17] px-2 py-1 font-mono text-white tabular-nums"
              />
              %
            </label>
          )}

          <button
            type="button"
            disabled={saving}
            onClick={() => apply()}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-60 whitespace-nowrap"
          >
            {savedFlash ? <Check className="h-3.5 w-3.5" /> : null}
            {savedFlash ? t(lang, 'scope_saved') : t(lang, 'scope_apply')}
          </button>
        </div>
      </div>

      {/* Row 3: Selectable Asset Watchlist */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800/80 pt-2.5">
        <span className="text-slate-400 font-medium whitespace-nowrap">
          {t(lang, 'scope_assets')} ({draftAssets.length}/{allAssets.length}):
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {allAssets.map((sym) => {
            const active = draftAssets.includes(sym);
            return (
              <button
                key={sym}
                type="button"
                onClick={() => toggleAsset(sym)}
                className={`font-mono ltr-num rounded border px-2.5 py-1 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-emerald-500/80 bg-emerald-600/15 text-emerald-300 font-medium'
                    : 'border-slate-800 bg-[#0B0F17] text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                {sym}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setDraftAssets(allAssets.slice(0, 3))}
            className="rounded border border-slate-800 px-2 py-1 text-[11px] text-slate-400 hover:text-white"
          >
            {t(lang, 'scope_top3')}
          </button>
          <button
            type="button"
            onClick={() => setDraftAssets([...allAssets])}
            className="rounded border border-slate-800 px-2 py-1 text-[11px] text-slate-400 hover:text-white"
          >
            {t(lang, 'scope_all_assets')}
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className="inline-flex items-center gap-1 rounded border border-slate-800 px-2 py-1 text-[11px] text-slate-400 hover:border-rose-500/40 hover:text-rose-300"
          >
            <XCircle className="h-3 w-3" />
            {t(lang, 'scope_clear_all')}
          </button>
        </div>
      </div>
    </section>
  );
}

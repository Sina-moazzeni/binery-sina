import { Crosshair, Globe, Settings2, Volume2, VolumeX } from 'lucide-react';
import { t } from '../i18n';
import type { ActiveTab, Lang, OperationalMode, TelemetrySnapshot } from '../types';

interface TopBarProps {
  lang: Lang;
  onToggleLang: () => void;
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  mode: OperationalMode;
  onModeChange: (mode: OperationalMode) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onOpenConfig: () => void;
  telemetry: TelemetrySnapshot;
  socketOpen: boolean;
}

export function TopBar({
  lang,
  onToggleLang,
  activeTab,
  onTabChange,
  mode,
  onModeChange,
  soundEnabled,
  onToggleSound,
  onOpenConfig,
  telemetry,
  socketOpen,
}: TopBarProps) {
  const brokerConnected = socketOpen && telemetry.ws_connected && telemetry.broker_provider !== 'NONE';
  const navItems: Array<{ id: ActiveTab; label: string }> = [
    { id: 'radar', label: t(lang, 'nav_radar') },
    { id: 'leaderboard', label: t(lang, 'nav_leaderboard') },
    { id: 'health', label: t(lang, 'nav_health') },
    { id: 'history', label: t(lang, 'nav_history') },
    { id: 'python', label: t(lang, 'nav_python') },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#0E1420]/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-5 px-5 py-3">
        {/* Zone 1: Brand Wordmark */}
        <button
          type="button"
          onClick={() => onTabChange('radar')}
          className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        >
          QuantRadar
        </button>

        {/* Zone 2: Clean Single-Line Text Navigation */}
        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium" aria-label="Primary navigation">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`relative py-1 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded ${
                  active
                    ? 'text-white after:absolute after:inset-x-0 after:-bottom-[13px] after:h-[2px] after:bg-blue-500'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Telemetry + Language + Mode + Broker SSID Action */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="hidden 2xl:flex items-center gap-2.5 text-xs text-slate-400 font-mono tabular-nums ltr-num whitespace-nowrap pe-2 border-e border-slate-800">
            <span>
              CPU <strong className="text-slate-200 font-medium">{telemetry.cpu_pct.toFixed(1)}%</strong>
            </span>
            <span aria-hidden="true">/</span>
            <span>
              RAM <strong className="text-slate-200 font-medium">{telemetry.ram_pct.toFixed(0)}%</strong>
            </span>
            <span aria-hidden="true">/</span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${brokerConnected ? 'bg-emerald-500' : 'bg-rose-500'}`}
                aria-hidden="true"
              />
              <span className={brokerConnected ? 'text-emerald-400' : 'text-rose-400'}>
                {brokerConnected ? t(lang, 'ws_live') : t(lang, 'ws_disconnected')}
              </span>
            </span>
          </div>

          <button
            type="button"
            onClick={onToggleLang}
            title="Switch Language / تغییر زبان"
            className="inline-flex items-center gap-1 rounded-md border border-slate-800 bg-[#141B29] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-700 hover:text-white whitespace-nowrap shrink-0"
          >
            <Globe className="h-3.5 w-3.5 text-blue-400" />
            {lang === 'fa' ? 'EN' : 'فارسی'}
          </button>

          <div
            className="flex items-center rounded-md border border-slate-800 bg-[#0B0F17] p-0.5"
            role="group"
            aria-label="Operational mode"
          >
            <button
              type="button"
              aria-pressed={mode === 'SHADOW'}
              onClick={() => onModeChange('SHADOW')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'SHADOW' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {t(lang, 'mode_shadow')}
            </button>
            <button
              type="button"
              aria-pressed={mode === 'SNIPER'}
              onClick={() => onModeChange('SNIPER')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mode === 'SNIPER' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <Crosshair className="h-3.5 w-3.5" />
              {t(lang, 'mode_sniper')}
            </button>
          </div>

          <button
            type="button"
            onClick={onToggleSound}
            title={soundEnabled ? 'Mute' : 'Unmute'}
            aria-label={soundEnabled ? 'Mute' : 'Unmute'}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-800 bg-[#141B29] text-slate-300 hover:border-slate-700 hover:text-white transition-colors shrink-0"
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-slate-500" />}
          </button>

          <button
            type="button"
            onClick={onOpenConfig}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 transition-colors whitespace-nowrap shrink-0"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {t(lang, 'btn_broker_config')}
          </button>
        </div>
      </div>

      {/* Responsive secondary nav for viewports < lg */}
      <div className="flex lg:hidden items-center gap-4 overflow-x-auto border-t border-slate-800/70 px-5 py-2 text-xs font-medium">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onTabChange(item.id)}
            className={`whitespace-nowrap shrink-0 py-1 ${
              activeTab === item.id ? 'text-white underline underline-offset-4 decoration-blue-500' : 'text-slate-400'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </header>
  );
}

import { useState, type FormEvent } from 'react';
import { BookOpen, CheckCircle2, Loader2, PlugZap, ShieldAlert, Unplug, X, XCircle } from 'lucide-react';
import { t } from '../i18n';
import type {
  AutoTradeState,
  AutoTradeTarget,
  BrokerProvider,
  ConnectionTestResult,
  Lang,
} from '../types';

export interface BrokerConfigValues {
  broker_provider: BrokerProvider;
  broker_demo_mode: boolean;
  broker_ssid: string;
  block_extreme_volatility: boolean;
  block_dead_range: boolean;
  enable_confluence_combos: boolean;
  ai_analyst_enabled: boolean;
  telegram_bot_token: string;
  telegram_chat_id: string;
}

export interface AutoTradeFormValues {
  enabled: boolean;
  target: AutoTradeTarget;
  stake: number;
  max_daily_trades: number;
  max_consec_losses: number;
  reset_breaker: boolean;
}

interface BrokerConfigModalProps {
  lang: Lang;
  open: boolean;
  initialTab?: 'feed' | 'autotrade';
  onClose: () => void;
  initial: {
    broker_provider: BrokerProvider;
    broker_demo_mode: boolean;
    ssid_configured: boolean;
    telegram_configured: boolean;
    block_extreme_volatility: boolean;
    block_dead_range: boolean;
    enable_confluence_combos: boolean;
    ai_analyst_enabled: boolean;
  };
  wsConnected: boolean;
  autoTrade: AutoTradeState;
  onTestConnection: (
    provider: BrokerProvider,
    ssid: string,
    demoMode: boolean,
  ) => Promise<ConnectionTestResult>;
  onDisconnect: () => Promise<void>;
  onSaveBroker: (values: BrokerConfigValues) => Promise<void>;
  onSaveAutoTrade: (values: AutoTradeFormValues) => Promise<void>;
}

export function BrokerConfigModal({
  lang,
  open,
  initialTab = 'feed',
  onClose,
  initial,
  wsConnected,
  autoTrade,
  onTestConnection,
  onDisconnect,
  onSaveBroker,
  onSaveAutoTrade,
}: BrokerConfigModalProps) {
  const [modalTab, setModalTab] = useState<'feed' | 'autotrade'>(initialTab);

  // Feed fields
  const [provider, setProvider] = useState<BrokerProvider>(initial.broker_provider);
  const [demoMode, setDemoMode] = useState(initial.broker_demo_mode);
  const [ssid, setSsid] = useState('');
  const [blockSpike, setBlockSpike] = useState(initial.block_extreme_volatility);
  const [blockDead, setBlockDead] = useState(initial.block_dead_range);
  const [combos, setCombos] = useState(initial.enable_confluence_combos);
  const [aiEnabled, setAiEnabled] = useState(initial.ai_analyst_enabled);
  const [tgToken, setTgToken] = useState('');
  const [tgChat, setTgChat] = useState('');

  // Connection test state
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  // Auto-trade fields
  const [atEnabled, setAtEnabled] = useState(autoTrade.enabled);
  const [atTarget, setAtTarget] = useState<AutoTradeTarget>(autoTrade.target);
  const [atStake, setAtStake] = useState(autoTrade.stake);
  const [atMaxDaily, setAtMaxDaily] = useState(autoTrade.max_daily_trades);
  const [atMaxLoss, setAtMaxLoss] = useState(autoTrade.max_consec_losses);
  const [resetBreaker, setResetBreaker] = useState(false);

  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onTestConnection(provider, ssid, demoMode);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        provider,
        latency_ms: 0,
        message: err instanceof Error ? err.message : 'Network error during connection test',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await onDisconnect();
      setProvider('NONE');
      setTestResult(null);
      onClose();
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveBroker({
        broker_provider: provider,
        broker_demo_mode: demoMode,
        broker_ssid: ssid,
        block_extreme_volatility: blockSpike,
        block_dead_range: blockDead,
        enable_confluence_combos: combos,
        ai_analyst_enabled: aiEnabled,
        telegram_bot_token: tgToken,
        telegram_chat_id: tgChat,
      });
      await onSaveAutoTrade({
        enabled: atEnabled,
        target: atTarget,
        stake: atStake,
        max_daily_trades: atMaxDaily,
        max_consec_losses: atMaxLoss,
        reset_breaker: resetBreaker,
      });
      setSsid('');
      setTgToken('');
      setResetBreaker(false);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const renderConnectionGuide = () => {
    if (provider === 'POCKET_OPTION' || provider === 'OLYMP_TRADE') {
      return lang === 'fa' ? (
        <ol className="list-decimal list-inside space-y-1 text-slate-300 leading-relaxed">
          <li>در مرورگر Chrome وارد حساب <strong>دمو</strong> سایت {provider === 'POCKET_OPTION' ? 'Pocket Option' : 'Olymp Trade'} شوید.</li>
          <li>کلید <code className="font-mono text-blue-300">F12</code> → تب <strong>Network</strong> → فیلتر <strong>WS</strong> را بزنید و صفحه را یک‌بار رفرش کنید.</li>
          <li>روی اتصال WebSocket کلیک کرده و در تب <strong>Messages</strong> رشته احراز هویت (<code className="font-mono text-emerald-300">42[&quot;auth&quot;,...]</code> یا مقدار <code className="font-mono text-emerald-300">ssid</code>) را کپی کنید.</li>
          <li>در کادر بالا جای‌گذاری کرده و ابتدا دکمه <strong>تست اتصال واقعی</strong> را بزنید تا از برقراری ارتباط مطمئن شوید.</li>
        </ol>
      ) : (
        <ol className="list-decimal list-inside space-y-1 text-slate-300 leading-relaxed">
          <li>Log into your <strong>Demo</strong> {provider === 'POCKET_OPTION' ? 'Pocket Option' : 'Olymp Trade'} account in Chrome.</li>
          <li>Press <code className="font-mono text-blue-300">F12</code> → <strong>Network</strong> → filter by <strong>WS</strong> and refresh once.</li>
          <li>Inspect the WebSocket → <strong>Messages</strong> → copy your <code className="font-mono text-emerald-300">42[&quot;auth&quot;,...]</code> frame or <code className="font-mono text-emerald-300">ssid</code> cookie.</li>
          <li>Paste above and click <strong>Test Connection</strong> to verify handshake &amp; authentication before saving.</li>
        </ol>
      );
    }
    if (provider === 'MOCK') {
      return lang === 'fa' ? (
        <p className="text-slate-300 leading-relaxed">
          شبیه‌ساز آفلاین فقط پس از انتخاب جفت‌ارزها توسط شما در نوار بالا اجرا می‌شود و برای تست سریع رابط کاربری و جدول ۱۰۰ سیگنالی مناسب است.
        </p>
      ) : (
        <p className="text-slate-300 leading-relaxed">
          The Offline Simulator only runs after you explicitly select target assets in the top bar—ideal for testing strategy filters before inserting a live SSID.
        </p>
      );
    }
    return lang === 'fa' ? (
      <p className="text-slate-300 leading-relaxed">
        در حالت قطع اتصال، موتور کاملاً متوقف است و هیچ سیگنال یا تستی اجرا نمی‌شود. برای شروع، Pocket Option یا Olymp Trade (یا شبیه‌ساز آفلاین) را انتخاب کنید.
      </p>
    ) : (
      <p className="text-slate-300 leading-relaxed">
        While Disconnected, the engine remains completely idle with zero testing. Pick Pocket Option, Olymp Trade, or Offline Simulator to start.
      </p>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="broker-modal-title"
    >
      <div className="w-full max-w-2xl rounded-lg border border-slate-800 bg-[#111827] p-6 space-y-5 my-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 id="broker-modal-title" className="font-display text-base font-semibold text-white">
            {t(lang, 'modal_title')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sub-tabs inside modal */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2 text-xs">
          <button
            type="button"
            onClick={() => setModalTab('feed')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              modalTab === 'feed' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t(lang, 'modal_tab_feed')}
          </button>
          <button
            type="button"
            onClick={() => setModalTab('autotrade')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              modalTab === 'autotrade' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t(lang, 'modal_tab_autotrade')}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {modalTab === 'feed' ? (
            <>
              <div>
                <label htmlFor="cfg-provider" className="block text-slate-400 mb-1.5">
                  {t(lang, 'modal_provider')}
                </label>
                <select
                  id="cfg-provider"
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value as BrokerProvider);
                    setTestResult(null);
                  }}
                  className="w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-sm text-white"
                >
                  <option value="NONE">{t(lang, 'modal_provider_none')}</option>
                  <option value="POCKET_OPTION">{t(lang, 'modal_provider_po')}</option>
                  <option value="OLYMP_TRADE">{t(lang, 'modal_provider_ot')}</option>
                  <option value="MOCK">{t(lang, 'modal_provider_mock')}</option>
                </select>
              </div>

              {(provider === 'POCKET_OPTION' || provider === 'OLYMP_TRADE') && (
                <div className="space-y-3">
                  <label className="flex items-center gap-2.5 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={demoMode}
                      onChange={(e) => setDemoMode(e.target.checked)}
                      className="h-4 w-4 accent-blue-600"
                    />
                    {t(lang, 'modal_demo_check')}
                  </label>
                  <div>
                    <label htmlFor="cfg-ssid" className="block text-slate-400 mb-1">
                      {t(lang, 'modal_ssid_label')} {initial.ssid_configured ? '✓' : ''}
                    </label>
                    <input
                      id="cfg-ssid"
                      type="password"
                      value={ssid}
                      onChange={(e) => setSsid(e.target.value)}
                      placeholder='42["auth",{"session":"...","isDemo":1}]'
                      className="w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono ltr-num text-white"
                    />
                  </div>
                </div>
              )}

              {/* Connection Test Action + Inline Diagnostics */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={testing || provider === 'NONE'}
                  onClick={handleTest}
                  className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/60 bg-blue-600/20 px-3.5 py-2 font-medium text-blue-300 hover:bg-blue-600/30 disabled:opacity-45 transition-colors"
                >
                  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
                  {testing ? t(lang, 'btn_testing_connection') : t(lang, 'btn_test_connection')}
                </button>

                {wsConnected && (
                  <button
                    type="button"
                    disabled={disconnecting}
                    onClick={handleDisconnect}
                    className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 font-medium text-rose-300 hover:bg-rose-500/20 transition-colors"
                  >
                    <Unplug className="h-3.5 w-3.5" />
                    {t(lang, 'btn_disconnect')}
                  </button>
                )}
              </div>

              {testResult && (
                <div
                  className={`rounded-md border p-3 space-y-1 ${
                    testResult.ok
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                      : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 font-semibold">
                    <span className="inline-flex items-center gap-1.5">
                      {testResult.ok ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
                      )}
                      {testResult.ok
                        ? lang === 'fa'
                          ? 'اتصال با موفقیت تأیید شد'
                          : 'Connection Verified'
                        : lang === 'fa'
                          ? 'اتصال ناموفق بود'
                          : 'Connection Failed'}
                    </span>
                    {testResult.latency_ms > 0 && (
                      <span className="font-mono ltr-num text-[11px] opacity-85">{testResult.latency_ms} ms</span>
                    )}
                  </div>
                  <p className="font-mono ltr-num text-[11px] leading-relaxed opacity-90">{testResult.message}</p>
                </div>
              )}

              {/* Contextual Step-by-Step Guide */}
              <div className="rounded-md border border-slate-800 bg-[#0B0F17] p-3.5 space-y-2">
                <div className="flex items-center gap-1.5 font-semibold text-blue-300">
                  <BookOpen className="h-3.5 w-3.5 shrink-0" />
                  {t(lang, 'modal_guide_title')}
                </div>
                {renderConnectionGuide()}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 border-t border-slate-800 pt-3">
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={blockSpike}
                    onChange={(e) => setBlockSpike(e.target.checked)}
                    className="h-4 w-4 accent-blue-600"
                  />
                  {t(lang, 'modal_block_spike')}
                </label>
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={blockDead}
                    onChange={(e) => setBlockDead(e.target.checked)}
                    className="h-4 w-4 accent-blue-600"
                  />
                  {t(lang, 'modal_block_dead')}
                </label>
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={combos}
                    onChange={(e) => setCombos(e.target.checked)}
                    className="h-4 w-4 accent-blue-600"
                  />
                  {t(lang, 'modal_combos')}
                </label>
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={aiEnabled}
                    onChange={(e) => setAiEnabled(e.target.checked)}
                    className="h-4 w-4 accent-blue-600"
                  />
                  {t(lang, 'modal_ai')}
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-800 pt-3">
                <div>
                  <label className="block text-slate-400 mb-1">
                    Telegram Bot Token {initial.telegram_configured ? '✓' : ''}
                  </label>
                  <input
                    type="password"
                    value={tgToken}
                    onChange={(e) => setTgToken(e.target.value)}
                    placeholder="123456:ABC..."
                    className="w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-1.5 font-mono ltr-num text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Telegram Chat ID</label>
                  <input
                    type="text"
                    value={tgChat}
                    onChange={(e) => setTgChat(e.target.value)}
                    placeholder="-100123456789"
                    className="w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-1.5 font-mono ltr-num text-white"
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3.5 space-y-1.5 text-amber-200">
                <div className="flex items-center gap-1.5 font-semibold">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  {t(lang, 'modal_at_warning')}
                </div>
              </div>

              {autoTrade.circuit_breaker_tripped && (
                <div className="flex items-center justify-between rounded-md border border-rose-500/50 bg-rose-500/10 px-3.5 py-2.5 text-rose-200">
                  <span>{autoTrade.circuit_breaker_reason}</span>
                  <label className="inline-flex items-center gap-1.5 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={resetBreaker}
                      onChange={(e) => setResetBreaker(e.target.checked)}
                      className="accent-rose-500"
                    />
                    {t(lang, 'modal_reset_breaker')}
                  </label>
                </div>
              )}

              <label className="flex items-center gap-2.5 text-sm font-medium text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={atEnabled}
                  onChange={(e) => setAtEnabled(e.target.checked)}
                  className="h-4 w-4 accent-amber-500"
                />
                {t(lang, 'modal_at_arm')}
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">{t(lang, 'modal_at_target')}</label>
                  <select
                    value={atTarget}
                    onChange={(e) => setAtTarget(e.target.value as AutoTradeTarget)}
                    className="w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-white"
                  >
                    <option value="POCKET_OPTION">Pocket Option WebSocket (Demo/Live)</option>
                    <option value="OLYMP_TRADE">Olymp Trade WebSocket (Demo/Live)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">{t(lang, 'modal_at_stake')}</label>
                  <input
                    type="number"
                    min="1"
                    max="5000"
                    value={atStake}
                    onChange={(e) => setAtStake(Number(e.target.value))}
                    className="w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono ltr-num text-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">{t(lang, 'modal_at_maxdaily')}</label>
                  <input
                    type="number"
                    min="1"
                    max="200"
                    value={atMaxDaily}
                    onChange={(e) => setAtMaxDaily(Number(e.target.value))}
                    className="w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono ltr-num text-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">{t(lang, 'modal_at_maxloss')}</label>
                  <input
                    type="number"
                    min="1"
                    max="15"
                    value={atMaxLoss}
                    onChange={(e) => setAtMaxLoss(Number(e.target.value))}
                    className="w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono ltr-num text-white"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-4 py-2 font-medium text-slate-300 hover:bg-slate-800"
            >
              {t(lang, 'btn_cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-60"
            >
              {saving ? t(lang, 'btn_saving') : t(lang, 'btn_save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

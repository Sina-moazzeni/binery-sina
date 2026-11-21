import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

import { SignalDatabase } from './server/database.ts';
import { QuantRadarEngine } from './server/engine.ts';
import type { BrokerProvider, OperationalMode } from './server/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PYTHON_ENGINE_DIR = path.resolve(__dirname, 'python_engine');
const DB_PATH = path.resolve(__dirname, 'data', 'quantradar_preview.db');

function collectPythonFiles(dir: string, baseDir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__pycache__' || entry.name === 'data' || entry.name === '.venv') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectPythonFiles(full, baseDir));
    } else if (entry.isFile()) {
      results.push(path.relative(baseDir, full).replace(/\\/g, '/'));
    }
  }
  return results.sort();
}

function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  const broadcast = (type: string, data: unknown) => {
    if (clients.size === 0) return;
    const payload = JSON.stringify({ type, data });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  };

  const db = new SignalDatabase(DB_PATH);
  const engine = new QuantRadarEngine(db, broadcast);
  engine.start();

  server.on('upgrade', (req, socket, head) => {
    const reqPath = (req.url || '').split('?')[0];
    if (reqPath === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'init', data: engine.getInitialState() }));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  // --- REST API ---
  app.get('/api/state', (_req, res) => {
    res.json(engine.getInitialState());
  });

  app.post('/api/mode', (req, res) => {
    const mode = req.body?.mode;
    if (mode !== 'SHADOW' && mode !== 'SNIPER') {
      res.status(400).json({ error: 'Invalid mode. Expected SHADOW or SNIPER.' });
      return;
    }
    engine.config.mode = mode as OperationalMode;
    broadcast('mode:update', { mode });
    engine.broadcastTelemetry();
    res.json({ ok: true, mode });
  });

  app.post('/api/strategies/toggle', (req, res) => {
    const { strategy_name, shadow_enabled, live_active } = req.body ?? {};
    if (typeof strategy_name !== 'string' || !strategy_name.trim()) {
      res.status(400).json({ error: 'strategy_name is required' });
      return;
    }
    db.setStrategyFlags(
      strategy_name,
      typeof shadow_enabled === 'boolean' ? shadow_enabled : undefined,
      typeof live_active === 'boolean' ? live_active : undefined,
    );
    const leaderboard = db.getLeaderboard();
    broadcast('leaderboard:update', leaderboard);
    res.json({ ok: true, leaderboard });
  });

  app.post('/api/strategies/select-top', (req, res) => {
    const minWinRate = Number(req.body?.min_win_rate ?? 68);
    const minSignals = Number(req.body?.min_signals ?? 10);
    if (Number.isNaN(minWinRate) || minWinRate < 0 || minWinRate > 100) {
      res.status(400).json({ error: 'min_win_rate must be between 0 and 100' });
      return;
    }
    const current = db.getLeaderboard();
    const activated: string[] = [];
    for (const row of current) {
      const qualifies = row.total_signals >= minSignals && row.wr_last_100 >= minWinRate;
      db.setStrategyFlags(row.strategy_name, undefined, qualifies);
      if (qualifies) activated.push(row.strategy_name);
    }
    const leaderboard = db.getLeaderboard();
    broadcast('leaderboard:update', leaderboard);
    res.json({ ok: true, activated_count: activated.length, activated, leaderboard });
  });

  app.post('/api/scope', (req, res) => {
    const body = req.body ?? {};
    const updated = engine.updateScope({
      selected_assets: Array.isArray(body.selected_assets) ? body.selected_assets : undefined,
      selected_timeframes: Array.isArray(body.selected_timeframes) ? body.selected_timeframes : undefined,
      high_precision_mode: typeof body.high_precision_mode === 'boolean' ? body.high_precision_mode : undefined,
      min_signal_confidence:
        typeof body.min_signal_confidence === 'number' ? body.min_signal_confidence : undefined,
      custom_symbol: typeof body.custom_symbol === 'string' ? body.custom_symbol : undefined,
    });
    res.json({ ok: true, ...updated });
  });

  app.post('/api/autotrade', (req, res) => {
    const body = req.body ?? {};
    const validTargets = ['POCKET_OPTION', 'OLYMP_TRADE'];
    if (body.target && !validTargets.includes(body.target)) {
      res.status(400).json({ error: 'Invalid auto-trade execution target' });
      return;
    }
    const auto_trade = engine.updateAutoTrade({
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      target: body.target,
      stake: typeof body.stake === 'number' ? body.stake : undefined,
      max_daily_trades: typeof body.max_daily_trades === 'number' ? body.max_daily_trades : undefined,
      max_consec_losses: typeof body.max_consec_losses === 'number' ? body.max_consec_losses : undefined,
      reset_breaker: Boolean(body.reset_breaker),
    });
    res.json({ ok: true, auto_trade });
  });

  app.post('/api/broker/test-connection', async (req, res) => {
    const body = req.body ?? {};
    const validProviders: BrokerProvider[] = ['NONE', 'MOCK', 'POCKET_OPTION', 'OLYMP_TRADE'];
    const provider = (body.broker_provider || 'NONE') as BrokerProvider;
    if (!validProviders.includes(provider)) {
      res.status(400).json({ ok: false, provider: 'NONE', latency_ms: 0, message: 'Unsupported broker provider' });
      return;
    }
    const ssid =
      typeof body.broker_ssid === 'string' && body.broker_ssid.trim()
        ? body.broker_ssid.trim()
        : engine.config.broker_ssid;
    const demoMode = typeof body.broker_demo_mode === 'boolean' ? body.broker_demo_mode : engine.config.broker_demo_mode;
    const result = await engine.testBrokerConnection(provider, ssid, demoMode);
    res.json(result);
  });

  app.post('/api/broker/disconnect', (_req, res) => {
    engine.disconnectBroker();
    res.json({
      ok: true,
      broker_provider: engine.config.broker_provider,
      ws_connected: engine.wsConnected,
      ws_detail: engine.wsDetail,
    });
  });

  app.post('/api/config/broker', (req, res) => {
    const body = req.body ?? {};
    const validProviders: BrokerProvider[] = ['NONE', 'MOCK', 'POCKET_OPTION', 'OLYMP_TRADE'];
    if (body.broker_provider && !validProviders.includes(body.broker_provider)) {
      res.status(400).json({ error: 'Unsupported broker_provider' });
      return;
    }
    engine.updateBrokerConfig({
      broker_provider: body.broker_provider,
      broker_demo_mode: typeof body.broker_demo_mode === 'boolean' ? body.broker_demo_mode : undefined,
      broker_ssid: typeof body.broker_ssid === 'string' ? body.broker_ssid : undefined,
      block_extreme_volatility:
        typeof body.block_extreme_volatility === 'boolean' ? body.block_extreme_volatility : undefined,
      block_dead_range: typeof body.block_dead_range === 'boolean' ? body.block_dead_range : undefined,
      enable_confluence_combos:
        typeof body.enable_confluence_combos === 'boolean' ? body.enable_confluence_combos : undefined,
      ai_analyst_enabled: typeof body.ai_analyst_enabled === 'boolean' ? body.ai_analyst_enabled : undefined,
      telegram_bot_token: typeof body.telegram_bot_token === 'string' ? body.telegram_bot_token : undefined,
      telegram_chat_id: typeof body.telegram_chat_id === 'string' ? body.telegram_chat_id : undefined,
    });
    res.json({
      ok: true,
      broker_provider: engine.config.broker_provider,
      broker_demo_mode: engine.config.broker_demo_mode,
      ssid_configured: Boolean(engine.config.broker_ssid.trim()),
      telegram_configured: Boolean(engine.config.telegram_bot_token && engine.config.telegram_chat_id),
      ws_connected: engine.wsConnected,
      ws_detail: engine.wsDetail,
    });
  });

  app.post('/api/history/clear', (_req, res) => {
    const leaderboard = engine.clearHistory();
    res.json({ ok: true, leaderboard });
  });

  app.get('/api/history', (req, res) => {
    const q = req.query;
    const signals = db.querySignals({
      strategy: typeof q.strategy === 'string' ? q.strategy : undefined,
      asset: typeof q.asset === 'string' ? q.asset : undefined,
      market_type: typeof q.market_type === 'string' ? q.market_type : undefined,
      timeframe: typeof q.timeframe === 'string' ? q.timeframe : undefined,
      status: typeof q.status === 'string' ? q.status : undefined,
      limit: q.limit ? Number(q.limit) : 250,
    });
    res.json({ signals });
  });

  app.get('/api/history/export.csv', (req, res) => {
    const q = req.query;
    const signals = db.querySignals({
      strategy: typeof q.strategy === 'string' ? q.strategy : undefined,
      asset: typeof q.asset === 'string' ? q.asset : undefined,
      market_type: typeof q.market_type === 'string' ? q.market_type : undefined,
      timeframe: typeof q.timeframe === 'string' ? q.timeframe : undefined,
      status: typeof q.status === 'string' ? q.status : undefined,
      limit: 2000,
    });

    const headers = [
      'id',
      'timestamp',
      'asset',
      'market_type',
      'timeframe',
      'strategy_name',
      'direction',
      'confidence',
      'entry_price',
      'exit_price',
      'expiry_seconds',
      'market_regime',
      'macro_bias',
      'status',
      'mode_generated',
      'reason',
    ];
    const lines = [headers.join(',')];
    for (const s of signals) {
      const row = s as unknown as Record<string, unknown>;
      lines.push(headers.map((h) => escapeCsvCell(row[h])).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="quantradar_signals.csv"');
    res.send(lines.join('\n'));
  });

  // --- Python Windows Server Bundle Inspector & ZIP Downloader ---
  app.get('/api/python-files', (_req, res) => {
    const files = collectPythonFiles(PYTHON_ENGINE_DIR, PYTHON_ENGINE_DIR);
    res.json({ files });
  });

  app.get('/api/python-file', (req, res) => {
    const rel = typeof req.query.path === 'string' ? req.query.path : '';
    if (!rel || rel.includes('..') || path.isAbsolute(rel)) {
      res.status(400).json({ error: 'Invalid file path' });
      return;
    }
    const resolved = path.resolve(PYTHON_ENGINE_DIR, rel);
    if (!resolved.startsWith(PYTHON_ENGINE_DIR + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const content = fs.readFileSync(resolved, 'utf-8');
    res.json({ path: rel, content });
  });

  app.get('/api/python-bundle.zip', async (_req, res) => {
    const zip = new JSZip();
    const rootFolder = zip.folder('quantradar-python-server');
    if (!rootFolder) {
      res.status(500).json({ error: 'Failed initializing zip archive' });
      return;
    }
    const files = collectPythonFiles(PYTHON_ENGINE_DIR, PYTHON_ENGINE_DIR);
    for (const rel of files) {
      const resolved = path.resolve(PYTHON_ENGINE_DIR, rel);
      if (resolved.startsWith(PYTHON_ENGINE_DIR + path.sep)) {
        rootFolder.file(rel, fs.readFileSync(resolved));
      }
    }
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="quantradar-python-server.zip"');
    res.send(buffer);
  });

  // --- Vite / Static Frontend ---
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`QuantRadar server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start QuantRadar server:', err);
  process.exit(1);
});

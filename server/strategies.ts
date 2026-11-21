import {
  adx,
  atr,
  bollingerBands,
  cci,
  ema,
  keltnerChannels,
  macd,
  rollingVwap,
  rsi,
  stochastic,
  supertrend,
  williamsR,
} from './indicators.ts';
import type { Candle, StrategyPlugin } from './types.ts';

function extract(candles: Candle[]) {
  return {
    opens: candles.map((c) => c.open),
    highs: candles.map((c) => c.high),
    lows: candles.map((c) => c.low),
    closes: candles.map((c) => c.close),
    volumes: candles.map((c) => c.volume),
  };
}

export const BUILTIN_STRATEGIES: StrategyPlugin[] = [
  {
    name: 'RSI + Bollinger Reversal',
    description: 'Fades outer 2.2-std Bollinger Band pierces confirmed by extreme RSI(14) <= 26 / >= 74 and reversal close.',
    supportedTimeframes: ['15s', '30s', '1m', '5m', '15m'],
    evaluate(candles) {
      if (candles.length < 35) return null;
      const { opens, highs, lows, closes } = extract(candles);
      const bb = bollingerBands(closes, 20, 2.2);
      const rArr = rsi(closes, 14);
      const i = closes.length - 1;
      const r = rArr[i];
      const rPrev = rArr[i - 1];
      if (Number.isNaN(r) || Number.isNaN(rPrev) || Number.isNaN(bb.upper[i])) return null;

      if (lows[i] <= bb.lower[i] && r <= 26 && r > rPrev && closes[i] > opens[i]) {
        return {
          direction: 'CALL',
          confidence: Number((79 + Math.min(16, (26 - r) * 1.1)).toFixed(1)),
          reason: `Confirmed lower BB(2.2) rejection with RSI=${r.toFixed(1)} turning up`,
        };
      }
      if (highs[i] >= bb.upper[i] && r >= 74 && r < rPrev && closes[i] < opens[i]) {
        return {
          direction: 'PUT',
          confidence: Number((79 + Math.min(16, (r - 74) * 1.1)).toFixed(1)),
          reason: `Confirmed upper BB(2.2) rejection with RSI=${r.toFixed(1)} turning down`,
        };
      }
      return null;
    },
  },
  {
    name: 'EMA Cross + MACD Momentum',
    description: 'Captures fresh EMA(9/21) crossovers aligned with EMA(50) macro slope and 2-bar expanding MACD.',
    supportedTimeframes: ['30s', '1m', '5m', '15m'],
    evaluate(candles) {
      if (candles.length < 55) return null;
      const { opens, closes } = extract(candles);
      const fast = ema(closes, 9);
      const slow = ema(closes, 21);
      const macro = ema(closes, 50);
      const { hist } = macd(closes, 12, 26, 9);
      const i = closes.length - 1;
      if (
        Number.isNaN(fast[i - 1]) ||
        Number.isNaN(slow[i - 1]) ||
        Number.isNaN(macro[i]) ||
        Number.isNaN(hist[i - 2])
      ) {
        return null;
      }

      if (
        fast[i - 1] <= slow[i - 1] &&
        fast[i] > slow[i] &&
        closes[i] > macro[i] &&
        closes[i] > opens[i] &&
        hist[i] > 0 &&
        hist[i] > hist[i - 1] &&
        hist[i - 1] > hist[i - 2]
      ) {
        return {
          direction: 'CALL',
          confidence: 82.5,
          reason: 'EMA 9/21 bullish cross above EMA(50) with 2-bar expanding MACD',
        };
      }
      if (
        fast[i - 1] >= slow[i - 1] &&
        fast[i] < slow[i] &&
        closes[i] < macro[i] &&
        closes[i] < opens[i] &&
        hist[i] < 0 &&
        hist[i] < hist[i - 1] &&
        hist[i - 1] < hist[i - 2]
      ) {
        return {
          direction: 'PUT',
          confidence: 82.5,
          reason: 'EMA 9/21 bearish cross below EMA(50) with 2-bar expanding MACD',
        };
      }
      return null;
    },
  },
  {
    name: 'Stochastic + S/R Bounce',
    description: 'Triggers on deep oversold/overbought %K/%D crossover (<20 / >80) with rejection close at 30-bar S/R.',
    supportedTimeframes: ['30s', '1m', '5m', '15m'],
    evaluate(candles) {
      if (candles.length < 40) return null;
      const { opens, highs, lows, closes } = extract(candles);
      const { k, d } = stochastic(highs, lows, closes, 14, 3);
      const i = closes.length - 1;
      if (Number.isNaN(k[i - 1]) || Number.isNaN(d[i - 1])) return null;

      const support = Math.min(...lows.slice(i - 30, i));
      const resistance = Math.max(...highs.slice(i - 30, i));
      const zone = Math.max(resistance - support, 1e-9) * 0.1;

      if (
        k[i - 1] <= d[i - 1] &&
        k[i] > d[i] &&
        k[i - 1] < 20 &&
        k[i] < 26 &&
        lows[i] <= support + zone &&
        closes[i] > opens[i]
      ) {
        return {
          direction: 'CALL',
          confidence: 80.5,
          reason: `Deep oversold Stoch cross (%K=${k[i].toFixed(1)}) + bullish bounce at 30-bar support`,
        };
      }
      if (
        k[i - 1] >= d[i - 1] &&
        k[i] < d[i] &&
        k[i - 1] > 80 &&
        k[i] > 74 &&
        highs[i] >= resistance - zone &&
        closes[i] < opens[i]
      ) {
        return {
          direction: 'PUT',
          confidence: 80.5,
          reason: `Deep overbought Stoch cross (%K=${k[i].toFixed(1)}) + bearish rejection at 30-bar resistance`,
        };
      }
      return null;
    },
  },
  {
    name: 'Price Action Pinbar / Engulfing',
    description: 'Detects institutional rejection pinbars (2.5x wick) and strong engulfing candles aligned with EMA(50).',
    supportedTimeframes: ['15s', '30s', '1m', '5m', '15m'],
    evaluate(candles) {
      if (candles.length < 55) return null;
      const { opens, highs, lows, closes } = extract(candles);
      const trend = ema(closes, 50);
      const i = closes.length - 1;
      if (Number.isNaN(trend[i])) return null;

      const o = opens[i], h = highs[i], l = lows[i], c = closes[i];
      const po = opens[i - 1], pc = closes[i - 1];
      const body = Math.abs(c - o);
      const total = Math.max(h - l, 1e-9);
      const upperWick = h - Math.max(o, c);
      const lowerWick = Math.min(o, c) - l;

      const bullPin = lowerWick >= body * 2.5 && upperWick <= total * 0.2 && body > 0 && c > o;
      const bullEngulf = pc < po && c > o && c > po && o <= pc && body > Math.abs(pc - po) * 1.25;
      if ((bullPin || bullEngulf) && c >= trend[i]) {
        return {
          direction: 'CALL',
          confidence: bullPin ? 82.5 : 79.5,
          reason: `${bullPin ? 'Bullish Pinbar' : 'Bullish Engulfing'} rejection above EMA(50)`,
        };
      }

      const bearPin = upperWick >= body * 2.5 && lowerWick <= total * 0.2 && body > 0 && c < o;
      const bearEngulf = pc > po && c < o && c < po && o >= pc && body > Math.abs(pc - po) * 1.25;
      if ((bearPin || bearEngulf) && c <= trend[i]) {
        return {
          direction: 'PUT',
          confidence: bearPin ? 82.5 : 79.5,
          reason: `${bearPin ? 'Bearish Pinbar' : 'Bearish Engulfing'} rejection below EMA(50)`,
        };
      }
      return null;
    },
  },
  {
    name: 'CCI + ADX Trend',
    description: 'Enters confirmed trends when rising ADX >= 25 confirms directional strength and CCI breaks +/-120.',
    supportedTimeframes: ['30s', '1m', '5m', '15m'],
    evaluate(candles) {
      if (candles.length < 40) return null;
      const { opens, highs, lows, closes } = extract(candles);
      const cciArr = cci(highs, lows, closes, 20);
      const { adx: adxArr, plusDi, minusDi } = adx(highs, lows, closes, 14);
      const i = closes.length - 1;
      if (
        Number.isNaN(cciArr[i - 1]) ||
        Number.isNaN(adxArr[i - 1]) ||
        adxArr[i] < 25 ||
        adxArr[i] < adxArr[i - 1]
      ) {
        return null;
      }

      if (plusDi[i] > minusDi[i] + 4 && cciArr[i - 1] <= 120 && cciArr[i] > 120 && closes[i] > opens[i]) {
        return {
          direction: 'CALL',
          confidence: Number(Math.min(92, 79 + (adxArr[i] - 25) * 0.45).toFixed(1)),
          reason: `Rising ADX=${adxArr[i].toFixed(1)} (+DI>-DI) with CCI break > +120`,
        };
      }
      if (minusDi[i] > plusDi[i] + 4 && cciArr[i - 1] >= -120 && cciArr[i] < -120 && closes[i] < opens[i]) {
        return {
          direction: 'PUT',
          confidence: Number(Math.min(92, 79 + (adxArr[i] - 25) * 0.45).toFixed(1)),
          reason: `Rising ADX=${adxArr[i].toFixed(1)} (-DI>+DI) with CCI break < -120`,
        };
      }
      return null;
    },
  },
  {
    name: 'Triple EMA Scalp',
    description: 'Precision EMA(8/21/50) sloping ribbon pullback with counter-bar rejection close.',
    supportedTimeframes: ['15s', '30s', '1m', '5m'],
    evaluate(candles) {
      if (candles.length < 55) return null;
      const { opens, highs, lows, closes } = extract(candles);
      const e8 = ema(closes, 8);
      const e21 = ema(closes, 21);
      const e50 = ema(closes, 50);
      const i = closes.length - 1;
      if (Number.isNaN(e50[i - 1])) return null;

      if (
        e8[i] > e21[i] &&
        e21[i] > e50[i] &&
        e21[i] > e21[i - 1] &&
        lows[i] <= e21[i] &&
        closes[i] > e8[i] &&
        closes[i] > opens[i] &&
        closes[i - 1] < opens[i - 1]
      ) {
        return { direction: 'CALL', confidence: 81.0, reason: 'Bullish 8/21/50 EMA ribbon pullback rejection after red bar' };
      }
      if (
        e8[i] < e21[i] &&
        e21[i] < e50[i] &&
        e21[i] < e21[i - 1] &&
        highs[i] >= e21[i] &&
        closes[i] < e8[i] &&
        closes[i] < opens[i] &&
        closes[i - 1] > opens[i - 1]
      ) {
        return { direction: 'PUT', confidence: 81.0, reason: 'Bearish 8/21/50 EMA ribbon pullback rejection after green bar' };
      }
      return null;
    },
  },
  {
    name: 'Keltner Squeeze Breakout',
    description: 'Fires when Bollinger Bands release from inside Keltner Channels with directional close.',
    supportedTimeframes: ['15s', '30s', '1m', '5m', '15m'],
    evaluate(candles) {
      if (candles.length < 30) return null;
      const { highs, lows, closes } = extract(candles);
      const bb = bollingerBands(closes, 20, 2.0);
      const kc = keltnerChannels(highs, lows, closes, 20, 10, 1.5);
      const i = closes.length - 1;
      if (Number.isNaN(bb.upper[i - 1]) || Number.isNaN(kc.upper[i - 1])) return null;

      const wasSqueezed = bb.upper[i - 1] < kc.upper[i - 1] && bb.lower[i - 1] > kc.lower[i - 1];
      const nowReleased = bb.upper[i] >= kc.upper[i] || bb.lower[i] <= kc.lower[i];
      if (wasSqueezed && nowReleased) {
        if (closes[i] > bb.mid[i] && closes[i] > closes[i - 1]) {
          return { direction: 'CALL', confidence: 82.5, reason: 'TTM Squeeze bullish volatility expansion release' };
        }
        if (closes[i] < bb.mid[i] && closes[i] < closes[i - 1]) {
          return { direction: 'PUT', confidence: 82.5, reason: 'TTM Squeeze bearish volatility expansion release' };
        }
      }
      return null;
    },
  },
  {
    name: 'Williams %R Exhaustion',
    description: 'Identifies sharp snap-back reversals exiting -90/-10 Williams %R extremes confirmed by RSI(7) turn.',
    supportedTimeframes: ['30s', '1m', '5m', '15m'],
    evaluate(candles) {
      if (candles.length < 28) return null;
      const { opens, highs, lows, closes } = extract(candles);
      const wr = williamsR(highs, lows, closes, 14);
      const r7 = rsi(closes, 7);
      const i = closes.length - 1;
      if (Number.isNaN(wr[i - 1]) || Number.isNaN(r7[i - 1])) return null;

      if (wr[i - 1] <= -90 && wr[i] > -80 && r7[i - 1] <= 25 && r7[i] > r7[i - 1] && closes[i] > opens[i]) {
        return {
          direction: 'CALL',
          confidence: 80.0,
          reason: `Williams %R extreme snap-back (${wr[i - 1].toFixed(1)} -> ${wr[i].toFixed(1)}) + RSI(7) turn`,
        };
      }
      if (wr[i - 1] >= -10 && wr[i] < -20 && r7[i - 1] >= 75 && r7[i] < r7[i - 1] && closes[i] < opens[i]) {
        return {
          direction: 'PUT',
          confidence: 80.0,
          reason: `Williams %R extreme snap-back (${wr[i - 1].toFixed(1)} -> ${wr[i].toFixed(1)}) + RSI(7) turn`,
        };
      }
      return null;
    },
  },
  {
    name: 'VWAP Mean Reversion',
    description: 'Fades 2.1x ATR extensions away from rolling 20-bar VWAP after exhaustion bar with reversal close.',
    supportedTimeframes: ['15s', '30s', '1m', '5m'],
    evaluate(candles) {
      if (candles.length < 30) return null;
      const { opens, highs, lows, closes, volumes } = extract(candles);
      const vwap = rollingVwap(highs, lows, closes, volumes, 20);
      const a = atr(highs, lows, closes, 14);
      const i = closes.length - 1;
      if (Number.isNaN(vwap[i]) || Number.isNaN(a[i]) || a[i] <= 0) return null;

      const dist = (closes[i] - vwap[i]) / a[i];
      if (dist <= -2.1 && closes[i - 1] < opens[i - 1] && closes[i] > opens[i]) {
        return {
          direction: 'CALL',
          confidence: Number(Math.min(91, 76 + Math.abs(dist) * 3.8).toFixed(1)),
          reason: `Stretched ${dist.toFixed(2)}x ATR below VWAP with bullish reversal close`,
        };
      }
      if (dist >= 2.1 && closes[i - 1] > opens[i - 1] && closes[i] < opens[i]) {
        return {
          direction: 'PUT',
          confidence: Number(Math.min(91, 76 + Math.abs(dist) * 3.8).toFixed(1)),
          reason: `Stretched +${dist.toFixed(2)}x ATR above VWAP with bearish reversal close`,
        };
      }
      return null;
    },
  },
  {
    name: 'Supertrend Pullback',
    description: 'Trades fresh Supertrend(10, 2.5) regime flips and first retest continuations.',
    supportedTimeframes: ['15s', '30s', '1m', '5m', '15m'],
    evaluate(candles) {
      if (candles.length < 30) return null;
      const { highs, lows, closes } = extract(candles);
      const { st, dir } = supertrend(highs, lows, closes, 10, 2.5);
      const i = closes.length - 1;
      if (Number.isNaN(st[i]) || dir[i - 1] === 0) return null;

      if (dir[i - 1] === -1 && dir[i] === 1) {
        return { direction: 'CALL', confidence: 81.4, reason: 'Fresh bullish Supertrend(10, 2.5) flip' };
      }
      if (dir[i - 1] === 1 && dir[i] === -1) {
        return { direction: 'PUT', confidence: 81.4, reason: 'Fresh bearish Supertrend(10, 2.5) flip' };
      }
      return null;
    },
  },
];

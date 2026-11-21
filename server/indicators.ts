/**
 * High-speed technical indicators in pure TypeScript (parity with python_engine/core/indicators.py).
 */

export function sma(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period || period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period || period <= 0) return out;
  const alpha = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  out[period - 1] = seed / period;
  for (let i = period; i < n; i++) {
    out[i] = alpha * values[i] + (1 - alpha) * out[i - 1];
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(NaN);
  if (n <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d;
    else avgLoss -= d;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = 100 - 100 / (1 + avgGain / (avgLoss + 1e-12));

  for (let i = period + 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = 100 - 100 / (1 + avgGain / (avgLoss + 1e-12));
  }
  return out;
}

export function bollingerBands(closes: number[], period = 20, mult = 2.0) {
  const n = closes.length;
  const mid = sma(closes, period);
  const upper = new Array<number>(n).fill(NaN);
  const lower = new Array<number>(n).fill(NaN);
  const widthPct = new Array<number>(n).fill(NaN);
  if (n < period) return { upper, mid, lower, widthPct };

  for (let i = period - 1; i < n; i++) {
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - mid[i];
      variance += diff * diff;
    }
    const std = Math.sqrt(variance / period);
    upper[i] = mid[i] + mult * std;
    lower[i] = mid[i] - mult * std;
    widthPct[i] = ((upper[i] - lower[i]) / (Math.abs(mid[i]) + 1e-12)) * 100;
  }
  return { upper, mid, lower, widthPct };
}

export function trueRange(highs: number[], lows: number[], closes: number[]): number[] {
  const n = closes.length;
  const tr = new Array<number>(n).fill(0);
  if (n === 0) return tr;
  tr[0] = highs[0] - lows[0];
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
  }
  return tr;
}

export function atr(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period) return out;
  const tr = trueRange(highs, lows, closes);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  out[period - 1] = sum / period;
  for (let i = period; i < n; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }
  return out;
}

export function adx(highs: number[], lows: number[], closes: number[], period = 14) {
  const n = closes.length;
  const adxArr = new Array<number>(n).fill(NaN);
  const plusDi = new Array<number>(n).fill(NaN);
  const minusDi = new Array<number>(n).fill(NaN);
  if (n < period * 2) return { adx: adxArr, plusDi, minusDi };

  const tr = trueRange(highs, lows, closes);
  const plusDm = new Array<number>(n).fill(0);
  const minusDm = new Array<number>(n).fill(0);

  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1];
    const dn = lows[i - 1] - lows[i];
    if (up > dn && up > 0) plusDm[i] = up;
    if (dn > up && dn > 0) minusDm[i] = dn;
  }

  let smTr = 0;
  let smPlus = 0;
  let smMinus = 0;
  for (let i = 1; i <= period; i++) {
    smTr += tr[i];
    smPlus += plusDm[i];
    smMinus += minusDm[i];
  }

  const dx = new Array<number>(n).fill(NaN);
  for (let i = period; i < n; i++) {
    if (i > period) {
      smTr = smTr - smTr / period + tr[i];
      smPlus = smPlus - smPlus / period + plusDm[i];
      smMinus = smMinus - smMinus / period + minusDm[i];
    }
    const pdi = (100 * smPlus) / (smTr + 1e-12);
    const mdi = (100 * smMinus) / (smTr + 1e-12);
    plusDi[i] = pdi;
    minusDi[i] = mdi;
    dx[i] = (100 * Math.abs(pdi - mdi)) / (pdi + mdi + 1e-12);
  }

  const start = period * 2 - 1;
  let dxSum = 0;
  for (let i = period; i <= start; i++) dxSum += dx[i];
  adxArr[start] = dxSum / period;
  for (let i = start + 1; i < n; i++) {
    adxArr[i] = (adxArr[i - 1] * (period - 1) + dx[i]) / period;
  }
  return { adx: adxArr, plusDi, minusDi };
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine = closes.map((_, i) => fastEma[i] - slowEma[i]);
  const firstValid = macdLine.findIndex((v) => !Number.isNaN(v));
  const sigLine = new Array<number>(closes.length).fill(NaN);
  if (firstValid >= 0 && closes.length - firstValid >= signal) {
    const sub = ema(macdLine.slice(firstValid), signal);
    for (let i = 0; i < sub.length; i++) sigLine[firstValid + i] = sub[i];
  }
  const hist = macdLine.map((v, i) => v - sigLine[i]);
  return { macdLine, sigLine, hist };
}

export function stochastic(highs: number[], lows: number[], closes: number[], kPeriod = 14, dPeriod = 3) {
  const n = closes.length;
  const k = new Array<number>(n).fill(NaN);
  if (n < kPeriod) return { k, d: new Array<number>(n).fill(NaN) };

  for (let i = kPeriod - 1; i < n; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (highs[j] > highest) highest = highs[j];
      if (lows[j] < lowest) lowest = lows[j];
    }
    k[i] = (100 * (closes[i] - lowest)) / (highest - lowest + 1e-12);
  }
  const cleanK = k.map((v) => (Number.isNaN(v) ? 50 : v));
  const d = sma(cleanK, dPeriod);
  for (let i = 0; i < kPeriod + dPeriod - 2 && i < n; i++) d[i] = NaN;
  return { k, d };
}

export function cci(highs: number[], lows: number[], closes: number[], period = 20): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period) return out;
  const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const tpSma = sma(tp, period);
  for (let i = period - 1; i < n; i++) {
    let mad = 0;
    for (let j = i - period + 1; j <= i; j++) mad += Math.abs(tp[j] - tpSma[i]);
    mad /= period;
    out[i] = (tp[i] - tpSma[i]) / (0.015 * mad + 1e-12);
  }
  return out;
}

export function williamsR(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period) return out;
  for (let i = period - 1; i < n; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > highest) highest = highs[j];
      if (lows[j] < lowest) lowest = lows[j];
    }
    out[i] = (-100 * (highest - closes[i])) / (highest - lowest + 1e-12);
  }
  return out;
}

export function keltnerChannels(highs: number[], lows: number[], closes: number[], emaPeriod = 20, atrPeriod = 10, mult = 1.5) {
  const mid = ema(closes, emaPeriod);
  const a = atr(highs, lows, closes, atrPeriod);
  const upper = mid.map((m, i) => m + mult * a[i]);
  const lower = mid.map((m, i) => m - mult * a[i]);
  return { upper, mid, lower };
}

export function rollingVwap(highs: number[], lows: number[], closes: number[], volumes: number[], period = 20): number[] {
  const n = closes.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < period) return out;
  for (let i = period - 1; i < n; i++) {
    let pv = 0;
    let vSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const tp = (highs[j] + lows[j] + closes[j]) / 3;
      const v = Math.max(volumes[j], 1);
      pv += tp * v;
      vSum += v;
    }
    out[i] = pv / (vSum + 1e-12);
  }
  return out;
}

export function supertrend(highs: number[], lows: number[], closes: number[], period = 10, mult = 2.5) {
  const n = closes.length;
  const st = new Array<number>(n).fill(NaN);
  const dir = new Array<number>(n).fill(0);
  if (n < period + 2) return { st, dir };

  const a = atr(highs, lows, closes, period);
  const finalUpper = new Array<number>(n).fill(NaN);
  const finalLower = new Array<number>(n).fill(NaN);

  for (let i = period - 1; i < n; i++) {
    const hl2 = (highs[i] + lows[i]) / 2;
    const bu = hl2 + mult * a[i];
    const bl = hl2 - mult * a[i];
    if (i === period - 1) {
      finalUpper[i] = bu;
      finalLower[i] = bl;
      dir[i] = 1;
      st[i] = bl;
      continue;
    }
    finalUpper[i] = bu < finalUpper[i - 1] || closes[i - 1] > finalUpper[i - 1] ? bu : finalUpper[i - 1];
    finalLower[i] = bl > finalLower[i - 1] || closes[i - 1] < finalLower[i - 1] ? bl : finalLower[i - 1];
    if (dir[i - 1] === 1) {
      if (closes[i] < finalLower[i]) {
        dir[i] = -1;
        st[i] = finalUpper[i];
      } else {
        dir[i] = 1;
        st[i] = finalLower[i];
      }
    } else {
      if (closes[i] > finalUpper[i]) {
        dir[i] = 1;
        st[i] = finalLower[i];
      } else {
        dir[i] = -1;
        st[i] = finalUpper[i];
      }
    }
  }
  return { st, dir };
}

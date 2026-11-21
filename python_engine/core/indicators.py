"""Pure vectorized NumPy technical indicator library for millisecond evaluation."""

from __future__ import annotations

from typing import Tuple
import numpy as np


def sma(values: np.ndarray, period: int) -> np.ndarray:
    """Simple Moving Average."""
    n = len(values)
    out = np.full(n, np.nan, dtype=np.float64)
    if n < period or period <= 0:
        return out
    csum = np.cumsum(values, dtype=np.float64)
    csum[period:] = csum[period:] - csum[:-period]
    out[period - 1 :] = csum[period - 1 :] / period
    return out


def ema(values: np.ndarray, period: int) -> np.ndarray:
    """Exponential Moving Average."""
    n = len(values)
    out = np.full(n, np.nan, dtype=np.float64)
    if n < period or period <= 0:
        return out
    alpha = 2.0 / (period + 1.0)
    out[period - 1] = float(np.mean(values[:period]))
    for i in range(period, n):
        out[i] = alpha * values[i] + (1.0 - alpha) * out[i - 1]
    return out


def rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
    """Wilder's Relative Strength Index."""
    n = len(closes)
    out = np.full(n, np.nan, dtype=np.float64)
    if n <= period:
        return out
    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)

    avg_gain = float(np.mean(gains[:period]))
    avg_loss = float(np.mean(losses[:period]))

    rs = avg_gain / (avg_loss + 1e-12)
    out[period] = 100.0 - (100.0 / (1.0 + rs))

    for i in range(period, len(deltas)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        rs = avg_gain / (avg_loss + 1e-12)
        out[i + 1] = 100.0 - (100.0 / (1.0 + rs))
    return out


def bollinger_bands(
    closes: np.ndarray, period: int = 20, std_mult: float = 2.0
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return (upper, middle, lower, width_pct) Bollinger Bands."""
    n = len(closes)
    mid = sma(closes, period)
    upper = np.full(n, np.nan, dtype=np.float64)
    lower = np.full(n, np.nan, dtype=np.float64)
    width_pct = np.full(n, np.nan, dtype=np.float64)
    if n < period:
        return upper, mid, lower, width_pct

    for i in range(period - 1, n):
        window = closes[i - period + 1 : i + 1]
        std = float(np.std(window, ddof=0))
        upper[i] = mid[i] + std_mult * std
        lower[i] = mid[i] - std_mult * std
        width_pct[i] = ((upper[i] - lower[i]) / (abs(mid[i]) + 1e-12)) * 100.0
    return upper, mid, lower, width_pct


def true_range(
    highs: np.ndarray, lows: np.ndarray, closes: np.ndarray
) -> np.ndarray:
    """True Range series."""
    n = len(closes)
    tr = np.zeros(n, dtype=np.float64)
    if n == 0:
        return tr
    tr[0] = highs[0] - lows[0]
    if n > 1:
        prev_close = closes[:-1]
        tr[1:] = np.maximum.reduce(
            [
                highs[1:] - lows[1:],
                np.abs(highs[1:] - prev_close),
                np.abs(lows[1:] - prev_close),
            ]
        )
    return tr


def atr(
    highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14
) -> np.ndarray:
    """Wilder's Average True Range."""
    n = len(closes)
    out = np.full(n, np.nan, dtype=np.float64)
    if n < period:
        return out
    tr = true_range(highs, lows, closes)
    out[period - 1] = float(np.mean(tr[:period]))
    for i in range(period, n):
        out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
    return out


def adx(
    highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (adx_line, plus_di, minus_di)."""
    n = len(closes)
    adx_arr = np.full(n, np.nan, dtype=np.float64)
    plus_di = np.full(n, np.nan, dtype=np.float64)
    minus_di = np.full(n, np.nan, dtype=np.float64)
    if n < period * 2:
        return adx_arr, plus_di, minus_di

    up_move = np.diff(highs, prepend=highs[0])
    down_move = -np.diff(lows, prepend=lows[0])

    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    tr = true_range(highs, lows, closes)

    sm_tr = np.full(n, np.nan, dtype=np.float64)
    sm_plus = np.full(n, np.nan, dtype=np.float64)
    sm_minus = np.full(n, np.nan, dtype=np.float64)

    sm_tr[period] = float(np.sum(tr[1 : period + 1]))
    sm_plus[period] = float(np.sum(plus_dm[1 : period + 1]))
    sm_minus[period] = float(np.sum(minus_dm[1 : period + 1]))

    dx = np.full(n, np.nan, dtype=np.float64)
    for i in range(period, n):
        if i > period:
            sm_tr[i] = sm_tr[i - 1] - (sm_tr[i - 1] / period) + tr[i]
            sm_plus[i] = sm_plus[i - 1] - (sm_plus[i - 1] / period) + plus_dm[i]
            sm_minus[i] = sm_minus[i - 1] - (sm_minus[i - 1] / period) + minus_dm[i]
        pdi = 100.0 * sm_plus[i] / (sm_tr[i] + 1e-12)
        mdi = 100.0 * sm_minus[i] / (sm_tr[i] + 1e-12)
        plus_di[i] = pdi
        minus_di[i] = mdi
        dx[i] = 100.0 * abs(pdi - mdi) / (pdi + mdi + 1e-12)

    start_idx = period * 2 - 1
    adx_arr[start_idx] = float(np.nanmean(dx[period : start_idx + 1]))
    for i in range(start_idx + 1, n):
        adx_arr[i] = (adx_arr[i - 1] * (period - 1) + dx[i]) / period

    return adx_arr, plus_di, minus_di


def macd(
    closes: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (macd_line, signal_line, histogram)."""
    fast_ema = ema(closes, fast)
    slow_ema = ema(closes, slow)
    macd_line = fast_ema - slow_ema
    valid_mask = ~np.isnan(macd_line)
    signal_line = np.full(len(closes), np.nan, dtype=np.float64)
    if np.sum(valid_mask) >= signal:
        first_valid = int(np.argmax(valid_mask))
        signal_line[first_valid:] = ema(macd_line[first_valid:], signal)
    hist = macd_line - signal_line
    return macd_line, signal_line, hist


def stochastic(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    k_period: int = 14,
    d_period: int = 3,
) -> Tuple[np.ndarray, np.ndarray]:
    """Return (%K, %D) Stochastic Oscillator."""
    n = len(closes)
    k_arr = np.full(n, np.nan, dtype=np.float64)
    if n < k_period:
        return k_arr, np.full(n, np.nan, dtype=np.float64)

    for i in range(k_period - 1, n):
        highest = float(np.max(highs[i - k_period + 1 : i + 1]))
        lowest = float(np.min(lows[i - k_period + 1 : i + 1]))
        k_arr[i] = 100.0 * (closes[i] - lowest) / (highest - lowest + 1e-12)

    d_arr = sma(np.nan_to_num(k_arr, nan=50.0), d_period)
    d_arr[: k_period + d_period - 2] = np.nan
    return k_arr, d_arr


def cci(
    highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 20
) -> np.ndarray:
    """Commodity Channel Index."""
    n = len(closes)
    out = np.full(n, np.nan, dtype=np.float64)
    if n < period:
        return out
    tp = (highs + lows + closes) / 3.0
    tp_sma = sma(tp, period)
    for i in range(period - 1, n):
        window = tp[i - period + 1 : i + 1]
        mad = float(np.mean(np.abs(window - tp_sma[i])))
        out[i] = (tp[i] - tp_sma[i]) / (0.015 * mad + 1e-12)
    return out


def williams_r(
    highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14
) -> np.ndarray:
    """Williams %R (-100 to 0)."""
    n = len(closes)
    out = np.full(n, np.nan, dtype=np.float64)
    if n < period:
        return out
    for i in range(period - 1, n):
        highest = float(np.max(highs[i - period + 1 : i + 1]))
        lowest = float(np.min(lows[i - period + 1 : i + 1]))
        out[i] = -100.0 * (highest - closes[i]) / (highest - lowest + 1e-12)
    return out


def keltner_channels(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    ema_period: int = 20,
    atr_period: int = 10,
    mult: float = 1.5,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (upper, middle, lower) Keltner Channels."""
    mid = ema(closes, ema_period)
    atr_vals = atr(highs, lows, closes, atr_period)
    return mid + mult * atr_vals, mid, mid - mult * atr_vals


def rolling_vwap(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    volumes: np.ndarray,
    period: int = 20,
) -> np.ndarray:
    """Rolling Volume-Weighted Average Price."""
    n = len(closes)
    out = np.full(n, np.nan, dtype=np.float64)
    if n < period:
        return out
    tp = (highs + lows + closes) / 3.0
    vol = np.maximum(volumes.astype(np.float64), 1.0)
    for i in range(period - 1, n):
        tp_w = tp[i - period + 1 : i + 1]
        v_w = vol[i - period + 1 : i + 1]
        out[i] = float(np.sum(tp_w * v_w) / (np.sum(v_w) + 1e-12))
    return out


def supertrend(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    period: int = 10,
    multiplier: float = 2.5,
) -> Tuple[np.ndarray, np.ndarray]:
    """Return (supertrend_line, trend_direction) where direction is +1 bullish / -1 bearish."""
    n = len(closes)
    st = np.full(n, np.nan, dtype=np.float64)
    direction = np.zeros(n, dtype=np.int8)
    if n < period + 2:
        return st, direction

    atr_vals = atr(highs, lows, closes, period)
    hl2 = (highs + lows) / 2.0
    basic_upper = hl2 + multiplier * atr_vals
    basic_lower = hl2 - multiplier * atr_vals

    final_upper = basic_upper.copy()
    final_lower = basic_lower.copy()

    direction[period - 1] = 1
    st[period - 1] = final_lower[period - 1]

    for i in range(period, n):
        if basic_upper[i] < final_upper[i - 1] or closes[i - 1] > final_upper[i - 1]:
            final_upper[i] = basic_upper[i]
        else:
            final_upper[i] = final_upper[i - 1]

        if basic_lower[i] > final_lower[i - 1] or closes[i - 1] < final_lower[i - 1]:
            final_lower[i] = basic_lower[i]
        else:
            final_lower[i] = final_lower[i - 1]

        if direction[i - 1] == 1:
            if closes[i] < final_lower[i]:
                direction[i] = -1
                st[i] = final_upper[i]
            else:
                direction[i] = 1
                st[i] = final_lower[i]
        else:
            if closes[i] > final_upper[i]:
                direction[i] = 1
                st[i] = final_lower[i]
            else:
                direction[i] = -1
                st[i] = final_upper[i]

    return st, direction

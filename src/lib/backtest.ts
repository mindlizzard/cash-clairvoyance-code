export type Strategy = "sma-cross" | "rsi" | "macd";

function smaArr(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += values[j];
    out.push(s / period);
  }
  return out;
}

function emaArr(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

function rsiArr(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [null];
  let avgG = 0, avgL = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    if (i <= period) {
      avgG += g; avgL += l;
      if (i === period) {
        avgG /= period; avgL /= period;
        out.push(100 - 100 / (1 + (avgL === 0 ? 100 : avgG / avgL)));
      } else out.push(null);
    } else {
      avgG = (avgG * (period - 1) + g) / period;
      avgL = (avgL * (period - 1) + l) / period;
      out.push(100 - 100 / (1 + (avgL === 0 ? 100 : avgG / avgL)));
    }
  }
  return out;
}

export type Trade = {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
};

export type BacktestResult = {
  trades: Trade[];
  finalValue: number;
  returnPct: number;
  buyHoldReturnPct: number;
  winRate: number;
  maxDrawdownPct: number;
  equityCurve: { i: number; value: number }[];
};

export function backtest(
  closes: number[],
  strategy: Strategy,
  initial = 1000,
): BacktestResult {
  if (closes.length < 50) {
    return {
      trades: [], finalValue: initial, returnPct: 0,
      buyHoldReturnPct: 0, winRate: 0, maxDrawdownPct: 0, equityCurve: [],
    };
  }

  let signal: number[];
  if (strategy === "sma-cross") {
    const s20 = smaArr(closes, 20);
    const s50 = smaArr(closes, 50);
    signal = closes.map((_, i) =>
      s20[i] != null && s50[i] != null ? ((s20[i] as number) > (s50[i] as number) ? 1 : 0) : 0,
    );
  } else if (strategy === "rsi") {
    const r = rsiArr(closes, 14);
    let pos = 0;
    signal = closes.map((_, i) => {
      const v = r[i];
      if (v == null) return 0;
      if (v < 30) pos = 1;
      else if (v > 70) pos = 0;
      return pos;
    });
  } else {
    const e12 = emaArr(closes, 12);
    const e26 = emaArr(closes, 26);
    const line = closes.map((_, i) => e12[i] - e26[i]);
    const sig = emaArr(line, 9);
    signal = closes.map((_, i) => (line[i] > sig[i] ? 1 : 0));
  }

  const trades: Trade[] = [];
  let cash = initial;
  let units = 0;
  let entryPrice = 0;
  let entryIdx = 0;
  const equity: { i: number; value: number }[] = [];

  for (let i = 1; i < closes.length; i++) {
    const want = signal[i];
    const have = units > 0 ? 1 : 0;
    if (want === 1 && have === 0) {
      units = cash / closes[i];
      entryPrice = closes[i];
      entryIdx = i;
      cash = 0;
    } else if (want === 0 && have === 1) {
      cash = units * closes[i];
      trades.push({
        entryIndex: entryIdx,
        exitIndex: i,
        entryPrice,
        exitPrice: closes[i],
        returnPct: ((closes[i] - entryPrice) / entryPrice) * 100,
      });
      units = 0;
    }
    const value = cash + units * closes[i];
    equity.push({ i, value });
  }

  // mark-to-market open position
  const finalValue = cash + units * closes[closes.length - 1];
  if (units > 0) {
    trades.push({
      entryIndex: entryIdx,
      exitIndex: closes.length - 1,
      entryPrice,
      exitPrice: closes[closes.length - 1],
      returnPct: ((closes[closes.length - 1] - entryPrice) / entryPrice) * 100,
    });
  }

  const returnPct = ((finalValue - initial) / initial) * 100;
  const buyHoldReturnPct = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
  const winRate = trades.length
    ? (trades.filter((t) => t.returnPct > 0).length / trades.length) * 100
    : 0;

  let peak = -Infinity;
  let maxDD = 0;
  for (const e of equity) {
    if (e.value > peak) peak = e.value;
    const dd = ((peak - e.value) / peak) * 100;
    if (dd > maxDD) maxDD = dd;
  }

  return {
    trades,
    finalValue,
    returnPct,
    buyHoldReturnPct,
    winRate,
    maxDrawdownPct: maxDD,
    equityCurve: equity,
  };
}
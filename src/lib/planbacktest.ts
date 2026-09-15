/**
 * Backtest van het handelsplan zelf (BUY / HOLD / SELL / NO TRADE) op
 * historische dagkoersen, inclusief transactiekosten en slippage.
 * Dezelfde regels als de live-motor: trend, momentum, volatiliteit,
 * ATR-stop en take profits, plus de NO TRADE-drempel op verwachte edge.
 */

export type PlanTrade = {
  entryIndex: number;
  exitIndex: number;
  direction: "long" | "short";
  entry: number;
  exit: number;
  reason: "stop-loss" | "take profit" | "signaal weg" | "einde reeks";
  returnPct: number;
};

export type PlanBacktestResult = {
  bars: number;
  trades: PlanTrade[];
  noTradeBars: number;
  winRate: number | null;
  profitFactor: number | null;
  avgReturnPct: number | null;
  expectancyPct: number | null;
  totalReturnPct: number;
  buyHoldPct: number;
  maxDrawdownPct: number;
  equityCurve: { i: number; value: number }[];
  costPct: number;
};

function emaSeries(v: number[], p: number) {
  const k = 2 / (p + 1);
  const out = [v[0]];
  for (let i = 1; i < v.length; i++) out.push(v[i] * k + out[i - 1] * (1 - k));
  return out;
}

function smaAt(v: number[], i: number, p: number): number | null {
  if (i < p - 1) return null;
  let s = 0;
  for (let j = i - p + 1; j <= i; j++) s += v[j];
  return s / p;
}

function rsiSeries(v: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [null];
  let g = 0;
  let l = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    if (i <= period) {
      g += d > 0 ? d : 0;
      l += d < 0 ? -d : 0;
      if (i === period) {
        g /= period;
        l /= period;
        out.push(100 - 100 / (1 + (l === 0 ? 100 : g / l)));
      } else out.push(null);
    } else {
      g = (g * (period - 1) + (d > 0 ? d : 0)) / period;
      l = (l * (period - 1) + (d < 0 ? -d : 0)) / period;
      out.push(100 - 100 / (1 + (l === 0 ? 100 : g / l)));
    }
  }
  return out;
}

function atrSeries(closes: number[], period = 14): number[] {
  const trs: number[] = [0];
  for (let i = 1; i < closes.length; i++) trs.push(Math.abs(closes[i] - closes[i - 1]));
  const out: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const from = Math.max(1, i - period + 1);
    let s = 0;
    let n = 0;
    for (let j = from; j <= i; j++) {
      s += trs[j];
      n++;
    }
    // close-to-close range onderschat de echte range; ~1.4x correctie
    out.push(n ? (s / n) * 1.4 : 0);
  }
  return out;
}

export function backtestPlan(
  closes: number[],
  opts: { feePct?: number; slippagePct?: number } = {},
): PlanBacktestResult {
  const feePct = opts.feePct ?? 0.1;
  const slippagePct = opts.slippagePct ?? 0.05;
  const costPct = (feePct + slippagePct) * 2; // in en uit
  const empty: PlanBacktestResult = {
    bars: closes.length,
    trades: [],
    noTradeBars: 0,
    winRate: null,
    profitFactor: null,
    avgReturnPct: null,
    expectancyPct: null,
    totalReturnPct: 0,
    buyHoldPct: 0,
    maxDrawdownPct: 0,
    equityCurve: [],
    costPct,
  };
  if (closes.length < 120) return empty;

  const e12 = emaSeries(closes, 12);
  const e26 = emaSeries(closes, 26);
  const macdLine = closes.map((_, i) => e12[i] - e26[i]);
  const macdSig = emaSeries(macdLine, 9);
  const rsi = rsiSeries(closes, 14);
  const atr = atrSeries(closes, 14);

  const trades: PlanTrade[] = [];
  const equity: { i: number; value: number }[] = [];
  let value = 100;
  let noTradeBars = 0;
  let pos: {
    direction: "long" | "short";
    entry: number;
    entryIndex: number;
    stop: number;
    tp: number;
  } | null = null;

  const signalAt = (i: number): "BUY" | "SELL" | "HOLD" | "NO_TRADE" => {
    const s20 = smaAt(closes, i, 20);
    const s50 = smaAt(closes, i, 50);
    const r = rsi[i];
    if (s20 == null || s50 == null || r == null || atr[i] <= 0) return "NO_TRADE";
    const price = closes[i];
    const atrPct = (atr[i] / price) * 100;
    const trend = (s20 - s50) / s50;
    const hist = macdLine[i] - macdSig[i];
    // korte-termijn momentum over 5 bars
    const mom = i >= 5 ? (price - closes[i - 5]) / closes[i - 5] : 0;
    const score =
      (trend > 0 ? 1 : -1) + (hist > 0 ? 1 : -1) + (mom > 0 ? 1 : -1) + (r > 70 ? -1 : r < 30 ? 1 : 0);
    // verwachte edge per trade ≈ 1.5 ATR; NO TRADE als kosten of ruis te groot zijn
    const edgePct = Math.abs(trend) * 100 + Math.abs(mom) * 100;
    if (edgePct < costPct * 1.5) return "NO_TRADE";
    if (atrPct > 9) return "NO_TRADE";
    if (score >= 3) return "BUY";
    if (score <= -3) return "SELL";
    return "HOLD";
  };

  for (let i = 60; i < closes.length; i++) {
    const price = closes[i];
    const sig = signalAt(i);
    if (sig === "NO_TRADE") noTradeBars++;

    if (pos) {
      const hitStop = pos.direction === "long" ? price <= pos.stop : price >= pos.stop;
      const hitTp = pos.direction === "long" ? price >= pos.tp : price <= pos.tp;
      const gone =
        (pos.direction === "long" && (sig === "SELL" || sig === "NO_TRADE")) ||
        (pos.direction === "short" && (sig === "BUY" || sig === "NO_TRADE"));
      if (hitStop || hitTp || gone) {
        const exit = hitStop ? pos.stop : hitTp ? pos.tp : price;
        const raw = ((exit - pos.entry) / pos.entry) * 100;
        const net = (pos.direction === "long" ? raw : -raw) - costPct;
        trades.push({
          entryIndex: pos.entryIndex,
          exitIndex: i,
          direction: pos.direction,
          entry: pos.entry,
          exit,
          reason: hitStop ? "stop-loss" : hitTp ? "take profit" : "signaal weg",
          returnPct: net,
        });
        value *= 1 + net / 100;
        pos = null;
      }
    } else if (sig === "BUY" || sig === "SELL") {
      const dir = sig === "BUY" ? "long" : "short";
      pos = {
        direction: dir,
        entry: price,
        entryIndex: i,
        stop: dir === "long" ? price - atr[i] * 1.5 : price + atr[i] * 1.5,
        tp: dir === "long" ? price + atr[i] * 2.5 : price - atr[i] * 2.5,
      };
    }
    equity.push({ i, value });
  }

  if (pos) {
    const price = closes[closes.length - 1];
    const raw = ((price - pos.entry) / pos.entry) * 100;
    const net = (pos.direction === "long" ? raw : -raw) - costPct;
    trades.push({
      entryIndex: pos.entryIndex,
      exitIndex: closes.length - 1,
      direction: pos.direction,
      entry: pos.entry,
      exit: price,
      reason: "einde reeks",
      returnPct: net,
    });
    value *= 1 + net / 100;
  }

  const rets = trades.map((t) => t.returnPct);
  const wins = rets.filter((r) => r > 0);
  const losses = rets.filter((r) => r <= 0);
  const grossWin = wins.reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r, 0));
  const winRate = rets.length ? (wins.length / rets.length) * 100 : null;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  let peak = -Infinity;
  let maxDD = 0;
  for (const e of equity) {
    peak = Math.max(peak, e.value);
    maxDD = Math.max(maxDD, ((peak - e.value) / peak) * 100);
  }

  return {
    bars: closes.length,
    trades,
    noTradeBars,
    winRate,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgReturnPct: rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : null,
    expectancyPct:
      winRate != null ? (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss : null,
    totalReturnPct: value - 100,
    buyHoldPct: ((closes[closes.length - 1] - closes[60]) / closes[60]) * 100,
    maxDrawdownPct: maxDD,
    equityCurve: equity,
    costPct,
  };
}

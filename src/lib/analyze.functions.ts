import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { simulateAllHorizons } from "./montecarlo";

const InputSchema = z.object({
  symbol: z.string().min(1).max(40),
  market: z.enum(["stock", "crypto"]),
});

type Candle = {
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close: number;
  volume?: number;
};

function dataError(symbol: string, market: "stock" | "crypto", message?: string) {
  return {
    ok: false as const,
    fallback: true as const,
    symbol: symbol.trim(),
    market,
    error:
      message ??
      (market === "stock"
        ? `Geen koersdata gevonden voor ${symbol.trim().toUpperCase()}. Controleer het symbool of kies een preset.`
        : "Onbekend crypto symbool. Gebruik bijvoorbeeld bitcoin, ethereum of solana."),
  };
}

function parseYahooCandles(result: any): Candle[] {
  const timestamps: number[] = result?.timestamp ?? [];
  const q = result?.indicators?.quote?.[0] ?? {};
  const closes: (number | null)[] = q.close ?? [];
  const opens: (number | null)[] = q.open ?? [];
  const highs: (number | null)[] = q.high ?? [];
  const lows: (number | null)[] = q.low ?? [];
  const volumes: (number | null)[] = q.volume ?? [];
  const rows: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (typeof c === "number" && !isNaN(c)) {
      const num = (x: any) => (typeof x === "number" && !isNaN(x) ? x : undefined);
      rows.push({
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        open: num(opens[i]),
        high: num(highs[i]),
        low: num(lows[i]),
        close: c,
        volume: num(volumes[i]),
      });
    }
  }
  return rows;
}

function parseNasdaqPrice(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchNasdaqStock(symbol: string, assetClass: "stocks" | "etf"): Promise<Candle[]> {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 5);
  const format = (date: Date) => date.toISOString().slice(0, 10);
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=${assetClass}&fromdate=${format(start)}&todate=${format(end)}&limit=9999`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://www.nasdaq.com",
      Referer: `https://www.nasdaq.com/market-activity/${assetClass}/${symbol.toLowerCase()}/historical`,
    },
  });
  if (!res.ok) return [];
  const json: any = await res.json();
  const rows = json?.data?.tradesTable?.rows ?? [];
  return rows
    .map((row: any) => {
      const [month, day, year] = String(row?.date ?? "").split("/");
      const close = parseNasdaqPrice(row?.close);
      if (!month || !day || !year || close == null) return null;
      return { date: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`, close };
    })
    .filter((row: Candle | null): row is Candle => row != null)
    .reverse();
}

async function fetchStock(symbol: string): Promise<Candle[]> {
  const t = symbol.trim().toUpperCase().replace(/\./g, "-");
  try {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "application/json",
  };
  let result: any = null;
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(t)}?range=5y&interval=1d`;
    const res = await fetch(url, { headers });
    if (!res.ok) continue;
    const json: any = await res.json();
    result = json?.chart?.result?.[0];
    if (result) break;
  }

  let rows = parseYahooCandles(result);
  if (rows.length < 30) {
    const sparkUrl = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(t)}&range=5y&interval=1d`;
    const sparkRes = await fetch(sparkUrl, { headers });
    if (sparkRes.ok) {
      const sparkJson: any = await sparkRes.json();
      const sparkResult = sparkJson?.spark?.result?.[0]?.response?.[0];
      rows = parseYahooCandles(sparkResult);
    }
  }
  if (rows.length < 30) {
    for (const assetClass of ["stocks", "etf"] as const) {
      rows = await fetchNasdaqStock(t, assetClass);
      if (rows.length >= 30) break;
    }
  }
  return rows;
  } catch (error) {
    console.error("Stock provider error", { symbol: t, error: (error as Error).message });
    return [];
  }
}

async function fetchCrypto(symbol: string): Promise<Candle[]> {
  try {
  const id = symbol.toLowerCase().replace(/\s+/g, "-");
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=eur&days=365&interval=daily`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as { prices: [number, number][] };
  if (!Array.isArray(json.prices)) return [];
  return json.prices.map(([t, p]) => ({
    date: new Date(t).toISOString().slice(0, 10),
    close: p,
  }));
  } catch (error) {
    console.error("Crypto provider error", { symbol, error: (error as Error).message });
    return [];
  }
}

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += values[j];
    out.push(s / period);
  }
  return out;
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [null];
  let avgG = 0, avgL = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    if (i <= period) {
      avgG += gain; avgL += loss;
      if (i === period) {
        avgG /= period; avgL /= period;
        const rs = avgL === 0 ? 100 : avgG / avgL;
        out.push(100 - 100 / (1 + rs));
      } else out.push(null);
    } else {
      avgG = (avgG * (period - 1) + gain) / period;
      avgL = (avgL * (period - 1) + loss) / period;
      const rs = avgL === 0 ? 100 : avgG / avgL;
      out.push(100 - 100 / (1 + rs));
    }
  }
  return out;
}

function macd(values: number[]) {
  const e12 = ema(values, 12);
  const e26 = ema(values, 26);
  const line = values.map((_, i) => e12[i] - e26[i]);
  const signal = ema(line, 9);
  const hist = line.map((v, i) => v - signal[i]);
  return { line, signal, hist };
}

function bollinger(values: number[], period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { upper.push(null); lower.push(null); continue; }
    const m = mid[i] as number;
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += (values[j] - m) ** 2;
    const sd = Math.sqrt(s / period);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  }
  return { upper, mid, lower };
}

function stochastic(values: number[], period = 14, dPeriod = 3) {
  const k: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { k.push(null); continue; }
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (values[j] > hi) hi = values[j];
      if (values[j] < lo) lo = values[j];
    }
    k.push(hi === lo ? 50 : ((values[i] - lo) / (hi - lo)) * 100);
  }
  const d: (number | null)[] = k.map((_, i) => {
    if (i < period - 1 + dPeriod - 1) return null;
    let s = 0;
    for (let j = i - dPeriod + 1; j <= i; j++) s += k[j] as number;
    return s / dPeriod;
  });
  return { k, d };
}

/** Daily log returns of a series. */
function logReturns(values: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0 && values[i] > 0) r.push(Math.log(values[i] / values[i - 1]));
  }
  return r;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Linear regression slope (per index step) of y on its index. */
function linRegSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Average True Range (gemiddelde 14-daagse echte range). */
function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const hi = c.high ?? c.close;
    const lo = c.low ?? c.close;
    const tr = Math.max(hi - lo, Math.abs(hi - prev.close), Math.abs(lo - prev.close));
    trs.push(tr);
  }
  const last = trs.slice(-period);
  return last.reduce((s, x) => s + x, 0) / last.length;
}

/** On-Balance Volume — laatste waarde. */
function obvLast(candles: Candle[]): number | null {
  let v = 0;
  let any = false;
  for (let i = 1; i < candles.length; i++) {
    const vol = candles[i].volume;
    if (vol == null) continue;
    any = true;
    if (candles[i].close > candles[i - 1].close) v += vol;
    else if (candles[i].close < candles[i - 1].close) v -= vol;
  }
  return any ? v : null;
}

/** VWAP over de laatste `period` dagen (typical price * volume / sum volume). */
function vwap(candles: Candle[], period = 20): number | null {
  const last = candles.slice(-period);
  let num = 0, den = 0;
  for (const c of last) {
    if (c.volume == null) continue;
    const tp = ((c.high ?? c.close) + (c.low ?? c.close) + c.close) / 3;
    num += tp * c.volume;
    den += c.volume;
  }
  return den > 0 ? num / den : null;
}

/**
 * EWMA volatiliteit (RiskMetrics, lambda=0.94) — vangt vol-clustering op
 * zonder volledige GARCH. Geeft dag-sigma.
 */
function ewmaVol(returns: number[], lambda = 0.94): number {
  if (returns.length < 5) return stdev(returns);
  let v = returns[0] * returns[0];
  for (let i = 1; i < returns.length; i++) {
    v = lambda * v + (1 - lambda) * returns[i] * returns[i];
  }
  return Math.sqrt(v);
}

type Regime = "bull" | "bear" | "sideways";

function detectRegime(closes: number[], atrPct: number): Regime {
  if (closes.length < 200) return "sideways";
  const last200 = closes.slice(-200);
  const slope = linRegSlope(last200) / closes[closes.length - 1] * 100; // %/dag
  if (slope > 0.05 && atrPct < 4) return "bull";
  if (slope < -0.05) return "bear";
  return "sideways";
}

/** Ichimoku Cloud — laatste waarden. */
function ichimoku(candles: Candle[]) {
  const len = candles.length;
  if (len < 52) return null;
  const rangeMid = (w: number) => {
    let hi = -Infinity, lo = Infinity;
    for (let j = len - w; j < len; j++) {
      const c = candles[j];
      hi = Math.max(hi, c.high ?? c.close);
      lo = Math.min(lo, c.low ?? c.close);
    }
    return (hi + lo) / 2;
  };
  const tenkan = rangeMid(9);
  const kijun = rangeMid(26);
  const spanA = (tenkan + kijun) / 2;
  const spanB = rangeMid(52);
  return { tenkan, kijun, spanA, spanB };
}

/** Fibonacci retracement over laatste `lookback` dagen. */
function fibLevels(candles: Candle[], lookback = 90) {
  const last = candles.slice(-lookback);
  if (last.length < 5) return null;
  let hi = -Infinity, lo = Infinity;
  for (const c of last) {
    hi = Math.max(hi, c.high ?? c.close);
    lo = Math.min(lo, c.low ?? c.close);
  }
  const r = hi - lo;
  const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((p) => ({
    pct: +(p * 100).toFixed(1),
    price: +(hi - r * p).toFixed(4),
  }));
  return { high: hi, low: lo, levels };
}

/**
 * Ornstein–Uhlenbeck half-life schatting via regressie van Δy op y_{t-1}.
 * < 0 betekent mean-reverting. Return waarde in handelsdagen (0 = niet detecteerbaar).
 */
function ouHalfLife(closes: number[]): number {
  if (closes.length < 30) return 0;
  const x: number[] = [], y: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    y.push(closes[i] - closes[i - 1]);
    x.push(closes[i - 1]);
  }
  const mx = mean(x), my = mean(y);
  let num = 0, den = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  const b = den === 0 ? 0 : num / den;
  if (b >= 0 || b <= -1) return 0;
  const hl = -Math.log(2) / Math.log(1 + b);
  return isFinite(hl) && hl > 0 && hl < 500 ? hl : 0;
}

/** Gewogen autoregressive (LSTM-achtig): exponentieel-gewogen laatste returns. */
function arWeightedDrift(returns: number[], lookback = 20, tau = 8): number {
  const recent = returns.slice(-lookback);
  if (!recent.length) return 0;
  let num = 0, den = 0;
  for (let i = 0; i < recent.length; i++) {
    const w = Math.exp(-(recent.length - 1 - i) / tau);
    num += w * recent[i];
    den += w;
  }
  return den === 0 ? 0 : num / den;
}

/** Prophet-stijl: trend (60d gem) + dag-van-week seasonality. */
function prophetDrift(returns: number[], dates: string[]): number {
  const recent = returns.slice(-252);
  if (recent.length < 30) return mean(recent);
  const trend = mean(recent.slice(-60));
  // align: returns[i] hoort bij dates[i+1] (close-to-close)
  const startDateIdx = dates.length - recent.length;
  const byDow = new Map<number, number[]>();
  for (let i = 0; i < recent.length; i++) {
    const d = dates[startDateIdx + i];
    if (!d) continue;
    const dow = new Date(d).getDay();
    if (!byDow.has(dow)) byDow.set(dow, []);
    byDow.get(dow)!.push(recent[i]);
  }
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const arr = byDow.get(tomorrow.getDay()) ?? [];
  const seasonal = arr.length >= 3 ? mean(arr) - trend : 0;
  return trend + seasonal * 0.5;
}

/** Sharpe / Sortino / Max drawdown (op basis van log-returns). */
function riskStats(returns: number[]) {
  if (returns.length < 20) {
    return { sharpe: 0, sortino: 0, maxDDPct: 0 };
  }
  const m = mean(returns);
  const s = stdev(returns);
  const annualRet = m * 252;
  const annualVol = s * Math.sqrt(252);
  const sharpe = annualVol === 0 ? 0 : annualRet / annualVol;
  const downside = returns.filter((r) => r < 0);
  const dStd = stdev(downside) * Math.sqrt(252);
  const sortino = dStd === 0 ? 0 : annualRet / dStd;
  let cum = 0, peak = 0, maxDD = 0;
  for (const r of returns) {
    cum += r;
    if (cum > peak) peak = cum;
    if (cum - peak < maxDD) maxDD = cum - peak;
  }
  return {
    sharpe: +sharpe.toFixed(2),
    sortino: +sortino.toFixed(2),
    maxDDPct: +((Math.exp(maxDD) - 1) * 100).toFixed(1),
  };
}

/** Fetch macro context (VIX, DXY, 10Y rente, SPX, BTC) in parallel. */
async function fetchMacro(): Promise<{
  vix: number | null;
  dxy: number | null;
  tnx: number | null;
  spxChangePct: number | null;
  btcChangePct: number | null;
}> {
  const fetchLast = async (sym: string): Promise<{ price: number; prev: number } | null> => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`;
      const r = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        },
      });
      if (!r.ok) return null;
      const j: any = await r.json();
      const closes: number[] = (j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter(
        (x: any) => typeof x === "number",
      );
      if (closes.length < 2) return null;
      return { price: closes[closes.length - 1], prev: closes[closes.length - 2] };
    } catch {
      return null;
    }
  };
  const [vix, dxy, tnx, spx, btc] = await Promise.all([
    fetchLast("^VIX"),
    fetchLast("DX-Y.NYB"),
    fetchLast("^TNX"),
    fetchLast("^GSPC"),
    fetchLast("BTC-USD"),
  ]);
  return {
    vix: vix?.price ?? null,
    dxy: dxy?.price ?? null,
    tnx: tnx?.price ?? null,
    spxChangePct: spx ? ((spx.price - spx.prev) / spx.prev) * 100 : null,
    btcChangePct: btc ? ((btc.price - btc.prev) / btc.prev) * 100 : null,
  };
}

/** Probeer earnings datum op te halen via Yahoo quoteSummary. */
async function fetchEarningsDate(symbol: string): Promise<string | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents`;
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const ev = j?.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate?.[0];
    const raw = ev?.raw;
    if (!raw) return null;
    return new Date(raw * 1000).toISOString();
  } catch {
    return null;
  }
}

/** Fear & Greed (crypto, alternative.me free). */
async function fetchCryptoFearGreed(): Promise<{ value: number; label: string } | null> {
  try {
    const r = await fetch("https://api.alternative.me/fng/?limit=1");
    if (!r.ok) return null;
    const j: any = await r.json();
    const x = j?.data?.[0];
    if (!x) return null;
    return { value: Number(x.value), label: String(x.value_classification) };
  } catch {
    return null;
  }
}

export const analyzeAsset = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }) => {
    let candles: Candle[];
    try {
      candles =
        data.market === "stock"
          ? await fetchStock(data.symbol)
          : await fetchCrypto(data.symbol);
    } catch (error) {
      return dataError(data.symbol, data.market, (error as Error).message);
    }

    if (candles.length < 30) {
      return dataError(data.symbol, data.market);
    }

    const closes = candles.map((c) => c.close);
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const rsiArr = rsi(closes, 14);
    const macdRes = macd(closes);
    const bb = bollinger(closes, 20, 2);
    const stoch = stochastic(closes, 14, 3);
    const atrVal = atr(candles, 14);
    const obvVal = obvLast(candles);
    const vwapVal = vwap(candles, 20);
    const ichi = ichimoku(candles);
    const fib = fibLevels(candles, 90);

    const last = closes.length - 1;
    const price = closes[last];
    const prev = closes[last - 1] ?? price;
    const changePct = ((price - prev) / prev) * 100;
    const weekAgo = closes[Math.max(0, last - 5)];
    const monthAgo = closes[Math.max(0, last - 22)];
    const indicators = {
      price,
      changePct,
      sma20: sma20[last],
      sma50: sma50[last],
      rsi: rsiArr[last],
      macd: macdRes.line[last],
      macdSignal: macdRes.signal[last],
      macdHist: macdRes.hist[last],
      bbUpper: bb.upper[last],
      bbLower: bb.lower[last],
      stochK: stoch.k[last],
      stochD: stoch.d[last],
      volume: candles[last].volume ?? null,
      atr: atrVal,
      atrPct: price > 0 ? (atrVal / price) * 100 : 0,
      obv: obvVal,
      vwap: vwapVal,
      weekChangePct: ((price - weekAgo) / weekAgo) * 100,
      monthChangePct: ((price - monthAgo) / monthAgo) * 100,
      ichimoku: ichi,
    };

    // ---- Statistische basis voor voorspellingen ----
    const rets = logReturns(closes);                       // dagelijkse log returns
    const recent = rets.slice(-252);                       // ~1 handelsjaar
    const drift = mean(recent);                            // dagelijkse drift
    const volSimple = stdev(recent);                       // simpel dagelijkse vol
    const volEwma = ewmaVol(recent, 0.94);                 // EWMA (vangt clustering)
    const vol = volEwma || volSimple;                      // gebruik EWMA als hoofd-vol
    const annualVolPct = vol * Math.sqrt(252) * 100;

    // Regressie-trend over laatste 90 dagen → %/dag
    const last90 = closes.slice(-90);
    const slope90 = linRegSlope(last90);
    const slopePctPerDay = price > 0 ? (slope90 / price) * 100 : 0;

    // Regime detectie
    const regime = detectRegime(closes, indicators.atrPct);

    // ---- Macro + earnings + sentiment (parallel) ----
    const [macro, earningsIso, fng] = await Promise.all([
      fetchMacro().catch(() => ({
        vix: null, dxy: null, tnx: null, spxChangePct: null, btcChangePct: null,
      })),
      data.market === "stock" ? fetchEarningsDate(data.symbol.trim().toUpperCase().replace(/\./g, "-")) : Promise.resolve(null),
      data.market === "crypto" ? fetchCryptoFearGreed() : Promise.resolve(null),
    ]);

    const earningsInDays = (() => {
      if (!earningsIso) return null;
      const ms = new Date(earningsIso).getTime() - Date.now();
      const d = Math.round(ms / 86_400_000);
      return isFinite(d) ? d : null;
    })();

    // ---- Monte Carlo per horizon ----
    const mcBase = simulateAllHorizons(drift, vol, 1000);
    // Regime-aangepaste MC: in bear regime drift -50%, in bull +20%
    const regimeMu = regime === "bull" ? drift * 1.2 + 0.0005 : regime === "bear" ? drift * 0.5 - 0.0005 : drift;
    const mcRegime = simulateAllHorizons(regimeMu, vol, 1000);

    // Helper: convert dagelijkse log-return naar geprojecteerde % over N dagen
    const proj = (mu: number, days: number) => (Math.exp(mu * days) - 1) * 100;
    const band = (days: number) => vol * Math.sqrt(days) * 100; // 1-sigma band in %

    const apiKey = process.env.LOVABLE_API_KEY;
    let ai: {
      signal: "BUY" | "SELL" | "HOLD";
      confidence: number;
      shortTerm: string;
      longTerm: string;
      reasoning: string;
      risks: string;
      forecasts: {
        model: string;
        day: number;
        week: number;
        month: number;
        bandDay?: number;
        bandWeek?: number;
        bandMonth?: number;
      }[];
    } = {
      signal: "HOLD",
      confidence: 50,
      shortTerm: "",
      longTerm: "",
      reasoning: "",
      risks: "",
      forecasts: [],
    };

    // ---- Heuristische modellen op basis van log-returns + statistiek ----
    const trendPct = (indicators.sma20 && indicators.sma50)
      ? ((indicators.sma20 - indicators.sma50) / indicators.sma50)
      : 0;
    const macdBiasPerDay = (indicators.macdHist ?? 0) > 0
      ? Math.min(0.002, vol * 0.3)
      : -Math.min(0.002, vol * 0.3);
    // RSI mean-reversion drift: kracht ~ afstand van 50, met dempfactor
    const rsiDriftDay = indicators.rsi != null
      ? ((50 - indicators.rsi) / 50) * vol * 0.4
      : 0;
    // Historische gemiddelde drift (annual return)
    const histDriftDay = drift;
    // Trend-volger: combineert SMA-spread + regressieslope
    const trendDriftDay = (trendPct / 60) + (slopePctPerDay / 100) * 0.6 + macdBiasPerDay;
    // Momentum: recente 5d gem return blijft (met decay)
    const recent5 = rets.slice(-5);
    const momentumDriftDay = mean(recent5) * 0.5;

    const mkForecast = (model: string, mu: number) => ({
      model,
      day: +proj(mu, 1).toFixed(2),
      week: +proj(mu, 5).toFixed(2),
      month: +proj(mu, 21).toFixed(2),
      bandDay: +band(1).toFixed(2),
      bandWeek: +band(5).toFixed(2),
      bandMonth: +band(21).toFixed(2),
    });

    const heuristicForecasts = [
      mkForecast("Trendvolger (SMA+regressie)", trendDriftDay),
      mkForecast("Momentum (5d EMA)", momentumDriftDay),
      mkForecast("Mean Reversion (RSI)", rsiDriftDay),
      mkForecast("Historische drift (1j)", histDriftDay),
      mkForecast("LSTM-achtig (AR + decay)", arWeightedDrift(rets, 20, 8)),
      mkForecast("Prophet-stijl (trend+seizoen)", prophetDrift(rets, candles.map((c) => c.date))),
      (() => {
        const hl = ouHalfLife(closes.slice(-180));
        const ma50 = sma50[last] ?? price;
        const gap = (ma50 - price) / price;
        const mu = hl > 0 ? gap / Math.max(hl, 2) : 0;
        return { ...mkForecast("Mean Reversion (OU)", Math.max(-0.01, Math.min(0.01, mu))) };
      })(),
      {
        model: "Monte Carlo (1000 sim)",
        day: +mcBase.day.median.toFixed(2),
        week: +mcBase.week.median.toFixed(2),
        month: +mcBase.month.median.toFixed(2),
        bandDay: +((mcBase.day.p75 - mcBase.day.p25) / 2).toFixed(2),
        bandWeek: +((mcBase.week.p75 - mcBase.week.p25) / 2).toFixed(2),
        bandMonth: +((mcBase.month.p75 - mcBase.month.p25) / 2).toFixed(2),
      },
      {
        model: `Regime-MC (${regime})`,
        day: +mcRegime.day.median.toFixed(2),
        week: +mcRegime.week.median.toFixed(2),
        month: +mcRegime.month.median.toFixed(2),
        bandDay: +((mcRegime.day.p75 - mcRegime.day.p25) / 2).toFixed(2),
        bandWeek: +((mcRegime.week.p75 - mcRegime.week.p25) / 2).toFixed(2),
        bandMonth: +((mcRegime.month.p75 - mcRegime.month.p25) / 2).toFixed(2),
      },
    ];
    ai.forecasts = heuristicForecasts;

    // Risico-statistieken + sizing
    const risk = riskStats(rets);
    const ouHl = ouHalfLife(closes.slice(-180));
    // Kelly-fractie (continuous): mu/sigma², gecapt op 25%
    const kelly = vol > 0 ? Math.max(0, Math.min(0.25, drift / (vol * vol))) : 0;
    const slLong = Math.max(0, price - 1.5 * atrVal);
    const tpLong = price + 2.5 * atrVal;
    const slShort = price + 1.5 * atrVal;
    const tpShort = Math.max(0, price - 2.5 * atrVal);
    const riskReward = atrVal > 0 ? 2.5 / 1.5 : 0;

    if (apiKey) {
      const prompt = `Je bent een ervaren technisch analist. Geef een nuchtere analyse voor ${data.symbol} (${data.market === "stock" ? "aandeel/ETF" : "crypto"}).

Volg deze redeneerstappen INTERN (niet uitschrijven):
1. Beoordeel trend (SMA20 vs SMA50, regressieslope, regime).
2. Beoordeel momentum (MACD-hist, RSI, Stochastic).
3. Beoordeel volatiliteit & risico (ATR%, EWMA-vol, Bollinger-positie).
4. Beoordeel macro context (VIX, DXY, 10Y, SPX). Hoge VIX of stijgende 10Y → meer voorzichtig.
5. ${data.market === "stock" ? "Check earnings — vlak vóór earnings is volatiliteit hoog." : "Check crypto Fear & Greed — extreme greed → mean-reversion risico."}
6. Combineer tot signal + verwachting met realistische onzekerheidsband.

Voorbeelden (few-shot, ter referentie van toon en cijfers):
- AAPL met RSI 72, SMA20>SMA50, VIX 13: signal HOLD, conf 55, week +1.2% ±3%, month +2.5% ±6%.
- TSLA met RSI 28, MACD bullish-cross, VIX 22: signal BUY, conf 65, week +4% ±7%, month +9% ±15%.
- NVDA met RSI 80, bearish MACD-hist, VIX 18: signal SELL/HOLD, conf 60, week -2% ±5%, month -4% ±12%.

Huidige indicatoren:
- Prijs: ${price.toFixed(4)}
- Dagverandering: ${changePct.toFixed(2)}%
- Week: ${indicators.weekChangePct.toFixed(2)}%, Maand: ${indicators.monthChangePct.toFixed(2)}%
- SMA20: ${indicators.sma20?.toFixed(4)}, SMA50: ${indicators.sma50?.toFixed(4)}
- RSI(14): ${indicators.rsi?.toFixed(1)}
- MACD: ${indicators.macd?.toFixed(4)} signaal: ${indicators.macdSignal?.toFixed(4)} hist: ${indicators.macdHist?.toFixed(4)}
- Stochastic %K: ${indicators.stochK?.toFixed(1)}, %D: ${indicators.stochD?.toFixed(1)}
- Bollinger upper: ${indicators.bbUpper?.toFixed(4)}, lower: ${indicators.bbLower?.toFixed(4)}
- ATR(14): ${atrVal.toFixed(4)} (${indicators.atrPct.toFixed(2)}% van prijs)
- VWAP(20): ${vwapVal?.toFixed(4) ?? "n/a"}
- Regime: ${regime}

Statistiek over ${rets.length} dagen:
- Gem. dagrendement (drift): ${(drift * 100).toFixed(3)}%
- Dagelijkse volatiliteit (EWMA): ${(vol * 100).toFixed(2)}%
- Geannualiseerde volatiliteit: ${annualVolPct.toFixed(1)}%
- Regressie-trend laatste 90d: ${slopePctPerDay.toFixed(3)}%/dag

Macro context:
- VIX: ${macro.vix?.toFixed(2) ?? "n/a"}, DXY: ${macro.dxy?.toFixed(2) ?? "n/a"}, 10Y rente: ${macro.tnx?.toFixed(2) ?? "n/a"}%
- S&P500 dag: ${macro.spxChangePct?.toFixed(2) ?? "n/a"}%, BTC dag: ${macro.btcChangePct?.toFixed(2) ?? "n/a"}%
${earningsInDays != null ? `- Earnings over ${earningsInDays} dagen (${earningsIso?.slice(0, 10)})` : ""}
${fng ? `- Crypto Fear & Greed: ${fng.value} (${fng.label})` : ""}

Monte Carlo simulatie (1000 paden, basis-drift):
- 1d: mediaan ${mcBase.day.median.toFixed(2)}%, kans op winst ${mcBase.day.probUp.toFixed(0)}%
- 5d: mediaan ${mcBase.week.median.toFixed(2)}%, P10-P90 [${mcBase.week.p10.toFixed(1)}, ${mcBase.week.p90.toFixed(1)}], kans op winst ${mcBase.week.probUp.toFixed(0)}%
- 21d: mediaan ${mcBase.month.median.toFixed(2)}%, P10-P90 [${mcBase.month.p10.toFixed(1)}, ${mcBase.month.p90.toFixed(1)}], kans op winst ${mcBase.month.probUp.toFixed(0)}%

Heuristische modellen (referentie):
${heuristicForecasts.map(f => `- ${f.model}: dag ${f.day}%, week ${f.week}%, maand ${f.month}% (±${f.bandMonth}%)`).join("\n")}

Antwoord uitsluitend in JSON met velden: signal ("BUY"|"SELL"|"HOLD"), confidence (0-100 getal, verlaag bij hoge VIX of earnings binnen 7d), shortTerm (verwachting 1-2 weken, 1 zin NL), longTerm (3-6 maanden, 1 zin NL), reasoning (3-4 zinnen NL: trend, momentum, volatiliteit, macro), risks (1-2 zinnen NL), aiForecast { day: getal (%), week: getal (%), month: getal (%), bandDay: getal, bandWeek: getal, bandMonth: getal } — realistische rendementsverwachting met 1-sigma onzekerheidsband.`;

      const callAi = async (model: string) => {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: "Je bent een Nederlandse technische beursanalist. Antwoord altijd in valide JSON." },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
          }),
        });
        if (r.status === 429) throw new Error("AI rate limit, probeer zo opnieuw");
        if (r.status === 402) throw new Error("AI credits op");
        if (!r.ok) throw new Error(`AI fout (${r.status})`);
        const j = await r.json();
        return JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
      };

      try {
        // Parallel: Flash + Pro (ensemble)
        const [flash, pro] = await Promise.allSettled([
          callAi("google/gemini-3-flash-preview"),
          callAi("google/gemini-3.1-pro-preview"),
        ]);
        const flashOk = flash.status === "fulfilled" ? flash.value : null;
        const proOk = pro.status === "fulfilled" ? pro.value : null;
        const parsed = flashOk ?? proOk ?? {};
        const { aiForecast, ...rest } = parsed ?? {};
        ai = { ...ai, ...rest };
        const aiList: { model: string; data: any }[] = [];
        if (flashOk?.aiForecast) aiList.push({ model: "AI Flash", data: flashOk.aiForecast });
        if (proOk?.aiForecast) aiList.push({ model: "AI Pro", data: proOk.aiForecast });
        const aiForecasts = aiList.map(({ model, data: a }) => ({
          model,
          day: +Number(a.day ?? 0).toFixed(2),
          week: +Number(a.week ?? 0).toFixed(2),
          month: +Number(a.month ?? 0).toFixed(2),
          bandDay: +Number(a.bandDay ?? band(1)).toFixed(2),
          bandWeek: +Number(a.bandWeek ?? band(5)).toFixed(2),
          bandMonth: +Number(a.bandMonth ?? band(21)).toFixed(2),
        }));
        if (aiForecast && typeof aiForecast === "object") {
          ai.forecasts = [...aiForecasts, ...heuristicForecasts];
        } else if (aiForecasts.length) {
          ai.forecasts = [...aiForecasts, ...heuristicForecasts];
        }
      } catch (e) {
        ai.reasoning = `AI-prognose niet beschikbaar: ${(e as Error).message}`;
      }
    }

    const chart = candles.slice(-90).map((c, i) => {
      const idx = candles.length - 90 + i;
      return {
        date: c.date,
        close: c.close,
        sma20: sma20[idx],
        sma50: sma50[idx],
        bbUpper: bb.upper[idx],
        bbLower: bb.lower[idx],
        volume: c.volume ?? null,
      };
    });

    const history = candles.slice(-1250).map((c) => c.close);

    return {
      ok: true as const,
      symbol: data.symbol.toUpperCase(),
      market: data.market,
      indicators,
      ai,
      chart,
      history,
      stats: {
        samples: rets.length,
        driftPct: +(drift * 100).toFixed(4),
        dailyVolPct: +(vol * 100).toFixed(3),
        annualVolPct: +annualVolPct.toFixed(2),
        slopePctPerDay: +slopePctPerDay.toFixed(4),
        regime,
      },
      monteCarlo: {
        base: mcBase,
        regime: mcRegime,
      },
      macro: {
        vix: macro.vix,
        dxy: macro.dxy,
        tnx: macro.tnx,
        spxChangePct: macro.spxChangePct,
        btcChangePct: macro.btcChangePct,
      },
      earnings: earningsInDays != null ? {
        date: earningsIso,
        inDays: earningsInDays,
      } : null,
      fearGreed: fng,
      fibonacci: fib,
      risk: {
        ...risk,
        halfLifeDays: +ouHl.toFixed(1),
        kellyPct: +(kelly * 100).toFixed(1),
        riskReward: +riskReward.toFixed(2),
        long: { stop: +slLong.toFixed(4), target: +tpLong.toFixed(4) },
        short: { stop: +slShort.toFixed(4), target: +tpShort.toFixed(4) },
      },
    };
  });

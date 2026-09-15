import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const IntradayInputSchema = z.object({
  symbol: z.string().min(1).max(40),
  market: z.enum(["stock", "crypto"]),
});

type Market = "stock" | "crypto";
type HourCandle = { time: string; close: number; open?: number; high?: number; low?: number; volume?: number };

const HORIZONS = [1, 2, 4, 8, 12, 24] as const;
const mean = (xs: number[]) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number, d = 2) => +n.toFixed(d);
const pctFromLog = (r: number) => (Math.exp(r) - 1) * 100;

function stdev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function logReturns(values: number[]) {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0 && values[i] > 0) out.push(Math.log(values[i] / values[i - 1]));
  }
  return out;
}

function ema(values: number[], period: number) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

function rsiLast(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function ewmaVol(returns: number[], lambda = 0.94) {
  if (!returns.length) return 0;
  if (returns.length < 6) return stdev(returns);
  let variance = returns[0] ** 2;
  for (let i = 1; i < returns.length; i++) variance = lambda * variance + (1 - lambda) * returns[i] ** 2;
  return Math.sqrt(variance);
}

function weightedRecent(values: number[], lookback = 48, tau = 12) {
  const xs = values.slice(-lookback);
  if (!xs.length) return 0;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    const age = xs.length - 1 - i;
    const w = Math.exp(-age / tau);
    num += xs[i] * w;
    den += w;
  }
  return den ? num / den : 0;
}

function slope(values: number[]) {
  if (values.length < 2) return 0;
  const xm = (values.length - 1) / 2;
  const ym = mean(values);
  let num = 0, den = 0;
  for (let i = 0; i < values.length; i++) {
    num += (i - xm) * (values[i] - ym);
    den += (i - xm) ** 2;
  }
  return den ? num / den : 0;
}

function erf(x: number) {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-a * a);
  return sign * y;
}
const normalCdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));

async function fetchStockHourly(symbol: string): Promise<{ candles: HourCandle[]; currency: string }> {
  const ticker = symbol.trim().toUpperCase().replace(/\./g, "-");
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "application/json",
  };
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?range=1mo&interval=60m&includePrePost=false`;
      const res = await fetch(url, { headers });
      if (!res.ok) continue;
      const json: any = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) continue;
      const ts: number[] = result.timestamp ?? [];
      const q = result?.indicators?.quote?.[0] ?? {};
      const candles: HourCandle[] = [];
      for (let i = 0; i < ts.length; i++) {
        const close = q.close?.[i];
        if (typeof close !== "number" || !Number.isFinite(close)) continue;
        const n = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;
        candles.push({
          time: new Date(ts[i] * 1000).toISOString(),
          close,
          open: n(q.open?.[i]), high: n(q.high?.[i]), low: n(q.low?.[i]), volume: n(q.volume?.[i]),
        });
      }
      if (candles.length >= 24) return { candles, currency: String(result?.meta?.currency ?? "USD") };
    } catch {}
  }
  return { candles: [], currency: "USD" };
}

async function fetchCryptoHourly(symbol: string): Promise<{ candles: HourCandle[]; currency: string }> {
  const id = symbol.trim().toLowerCase().replace(/\s+/g, "-");
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=eur&days=14`;
    const res = await fetch(url);
    if (!res.ok) return { candles: [], currency: "EUR" };
    const json: any = await res.json();
    const prices: [number, number][] = Array.isArray(json?.prices) ? json.prices : [];
    const buckets = new Map<string, HourCandle>();
    for (const [timestamp, price] of prices) {
      if (!Number.isFinite(timestamp) || !Number.isFinite(price)) continue;
      const d = new Date(timestamp);
      d.setUTCMinutes(0, 0, 0);
      const key = d.toISOString();
      const row = buckets.get(key);
      if (!row) buckets.set(key, { time: key, open: price, high: price, low: price, close: price });
      else {
        row.high = Math.max(row.high ?? price, price);
        row.low = Math.min(row.low ?? price, price);
        row.close = price;
      }
    }
    return { candles: [...buckets.values()].sort((a, b) => a.time.localeCompare(b.time)), currency: "EUR" };
  } catch {
    return { candles: [], currency: "EUR" };
  }
}

function makeModel(closes: number[], market: Market) {
  const price = closes.at(-1)!;
  const returns = logReturns(closes);
  const recent = returns.slice(market === "crypto" ? -168 : -120);
  const vol = ewmaVol(recent) || stdev(recent) || 0.001;
  const longDrift = mean(recent);
  const recentDrift = weightedRecent(recent, market === "crypto" ? 72 : 36, market === "crypto" ? 18 : 10);

  const e8 = ema(closes, 8).at(-1) ?? price;
  const e21 = ema(closes, 21).at(-1) ?? price;
  const emaTrend = clamp(Math.log(Math.max(e8, 1e-9) / Math.max(e21, 1e-9)) / 13, -vol * 0.7, vol * 0.7);
  const regTrend = clamp(slope(closes.slice(-24).map(x => Math.log(Math.max(x, 1e-9)))), -vol * 0.7, vol * 0.7);
  const r3 = closes.length > 3 ? Math.log(price / closes[closes.length - 4]) / 3 : 0;
  const r6 = closes.length > 6 ? Math.log(price / closes[closes.length - 7]) / 6 : r3;
  const momentum = clamp(r3 * 0.6 + r6 * 0.25, -vol * 0.8, vol * 0.8);
  const hourlyRsi = rsiLast(closes, 14);
  const meanReversion = hourlyRsi == null ? 0 : clamp(((50 - hourlyRsi) / 50) * vol * 0.18, -vol * 0.25, vol * 0.25);

  let drift = longDrift * 0.15 + recentDrift * 0.30 + emaTrend * 0.20 + regTrend * 0.15 + momentum * 0.15 + meanReversion * 0.05;
  drift = clamp(drift, -vol * 0.65, vol * 0.65);

  const votes = [recentDrift, emaTrend, regTrend, momentum];
  const pos = votes.filter(x => x > 0).length;
  const neg = votes.filter(x => x < 0).length;
  const coherence = Math.abs(pos - neg) / votes.length;
  const sampleScore = clamp(recent.length / 120, 0, 1);
  const volPenalty = clamp(vol * 100 / (market === "crypto" ? 3.5 : 2), 0, 1);
  const baseConfidence = Math.round(clamp(46 + sampleScore * 18 + coherence * 20 - volPenalty * 8, 35, 86));

  const forecasts = HORIZONS.map(hours => {
    const meanLog = drift * hours;
    const sigma = vol * Math.sqrt(hours);
    const z80 = 1.2815515655446004;
    const lowLog = meanLog - z80 * sigma;
    const highLog = meanLog + z80 * sigma;
    return {
      hours,
      expectedPct: round(pctFromLog(meanLog)),
      expectedPrice: round(price * Math.exp(meanLog), 6),
      lowPct: round(pctFromLog(lowLog)),
      highPct: round(pctFromLog(highLog)),
      lowPrice: round(price * Math.exp(lowLog), 6),
      highPrice: round(price * Math.exp(highLog), 6),
      probUp: round(normalCdf(meanLog / (sigma || 1e-9)) * 100, 1),
      confidence: Math.round(clamp(baseConfidence - Math.log2(hours) * 3, 28, 86)),
    };
  });

  const f4 = forecasts.find(f => f.hours === 4) ?? forecasts[0];
  const threshold = Math.max(0.15, vol * 100 * 0.35);
  const signal = f4.expectedPct > threshold ? "BULLISH" : f4.expectedPct < -threshold ? "BEARISH" : "NEUTRAL";
  const last24 = closes.slice(-24);

  return {
    drift, vol, forecasts, signal, confidence: baseConfidence,
    diagnostics: {
      rsi: hourlyRsi == null ? null : round(hourlyRsi, 1),
      ema8: round(e8, 6), ema21: round(e21, 6),
      trendPct: round(((e8 - e21) / Math.max(e21, 1e-9)) * 100),
      momentum3hPct: round(closes.length > 3 ? (price / closes[closes.length - 4] - 1) * 100 : 0),
      momentum6hPct: round(closes.length > 6 ? (price / closes[closes.length - 7] - 1) * 100 : 0),
      support: round(Math.min(...last24), 6), resistance: round(Math.max(...last24), 6),
    },
  };
}

export const analyzeIntraday = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => IntradayInputSchema.parse(input))
  .handler(async ({ data }) => {
    const source = data.market === "stock" ? await fetchStockHourly(data.symbol) : await fetchCryptoHourly(data.symbol);
    if (source.candles.length < 24) {
      return {
        ok: false as const,
        symbol: data.symbol.trim(), market: data.market,
        error: data.market === "stock"
          ? "Te weinig intraday-data ontvangen. Controleer de ticker of probeer later opnieuw."
          : "Te weinig uurdata ontvangen. Gebruik de CoinGecko coin-id, bijvoorbeeld bitcoin of ethereum.",
      };
    }

    const candles = source.candles.filter(c => Number.isFinite(c.close) && c.close > 0);
    const closes = candles.map(c => c.close);
    const currentPrice = closes.at(-1)!;
    const previous = closes.at(-2) ?? currentPrice;
    const model = makeModel(closes, data.market);
    const recent = candles.slice(-48).map((c, i, arr) => ({
      label: i === arr.length - 1 ? "Nu" : `-${arr.length - 1 - i}u`,
      time: c.time,
      close: round(c.close, 6),
    }));
    const path = [
      { label: "Nu", hours: 0, expectedPrice: round(currentPrice, 6), lowPrice: round(currentPrice, 6), highPrice: round(currentPrice, 6) },
      ...model.forecasts.map(f => ({ label: `+${f.hours}u`, hours: f.hours, expectedPrice: f.expectedPrice, lowPrice: f.lowPrice, highPrice: f.highPrice })),
    ];

    return {
      ok: true as const,
      symbol: data.market === "stock" ? data.symbol.trim().toUpperCase() : data.symbol.trim().toLowerCase(),
      market: data.market,
      currency: source.currency,
      currentPrice: round(currentPrice, 6),
      oneHourChangePct: round(((currentPrice - previous) / previous) * 100),
      signal: model.signal,
      confidence: model.confidence,
      forecasts: model.forecasts,
      recent,
      path,
      diagnostics: model.diagnostics,
      stats: {
        samples: Math.max(0, closes.length - 1),
        hourlyDriftPct: round(model.drift * 100, 4),
        hourlyVolPct: round(model.vol * 100, 3),
      },
      updatedAt: new Date().toISOString(),
      horizonMode: data.market === "stock" ? "trading-hours" as const : "clock-hours" as const,
      disclaimer: "Statistische intraday-prognose op basis van recente koersdata; geen financieel advies.",
    };
  });

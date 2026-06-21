import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  symbol: z.string().min(1).max(40),
  market: z.enum(["stock", "crypto"]),
});

type Candle = { date: string; close: number; volume?: number };

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
  const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];
  const volumes: (number | null)[] = result?.indicators?.quote?.[0]?.volume ?? [];
  const rows: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (typeof c === "number" && !isNaN(c)) {
      const v = volumes[i];
      rows.push({
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        close: c,
        volume: typeof v === "number" && !isNaN(v) ? v : undefined,
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
      weekChangePct: ((price - weekAgo) / weekAgo) * 100,
      monthChangePct: ((price - monthAgo) / monthAgo) * 100,
    };

    // ---- Statistische basis voor voorspellingen ----
    const rets = logReturns(closes);                       // dagelijkse log returns
    const recent = rets.slice(-252);                       // ~1 handelsjaar
    const drift = mean(recent);                            // dagelijkse drift
    const vol = stdev(recent);                             // dagelijkse volatiliteit
    const annualVolPct = vol * Math.sqrt(252) * 100;

    // Regressie-trend over laatste 90 dagen → %/dag
    const last90 = closes.slice(-90);
    const slope90 = linRegSlope(last90);
    const slopePctPerDay = price > 0 ? (slope90 / price) * 100 : 0;

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
    ];
    ai.forecasts = heuristicForecasts;

    if (apiKey) {
      const prompt = `Je bent een ervaren technisch analist. Geef een nuchtere analyse voor ${data.symbol} (${data.market === "stock" ? "aandeel/ETF" : "crypto"}).

Huidige indicatoren:
- Prijs: ${price.toFixed(4)}
- Dagverandering: ${changePct.toFixed(2)}%
- Week: ${indicators.weekChangePct.toFixed(2)}%, Maand: ${indicators.monthChangePct.toFixed(2)}%
- SMA20: ${indicators.sma20?.toFixed(4)}, SMA50: ${indicators.sma50?.toFixed(4)}
- RSI(14): ${indicators.rsi?.toFixed(1)}
- MACD: ${indicators.macd?.toFixed(4)} signaal: ${indicators.macdSignal?.toFixed(4)} hist: ${indicators.macdHist?.toFixed(4)}
- Stochastic %K: ${indicators.stochK?.toFixed(1)}, %D: ${indicators.stochD?.toFixed(1)}
- Bollinger upper: ${indicators.bbUpper?.toFixed(4)}, lower: ${indicators.bbLower?.toFixed(4)}

Statistiek over ${rets.length} dagen:
- Gem. dagrendement (drift): ${(drift * 100).toFixed(3)}%
- Dagelijkse volatiliteit: ${(vol * 100).toFixed(2)}%
- Geannualiseerde volatiliteit: ${annualVolPct.toFixed(1)}%
- Regressie-trend laatste 90d: ${slopePctPerDay.toFixed(3)}%/dag

Heuristische modellen (referentie):
${heuristicForecasts.map(f => `- ${f.model}: dag ${f.day}%, week ${f.week}%, maand ${f.month}% (±${f.bandMonth}%)`).join("\n")}

Antwoord uitsluitend in JSON met velden: signal ("BUY"|"SELL"|"HOLD"), confidence (0-100 getal), shortTerm (verwachting 1-2 weken, 1 zin NL), longTerm (3-6 maanden, 1 zin NL), reasoning (2-3 zinnen NL over de indicatoren én hoe je rekening houdt met volatiliteit), risks (1-2 zinnen NL), aiForecast { day: getal (%), week: getal (%), month: getal (%), bandDay: getal, bandWeek: getal, bandMonth: getal } — realistische rendementsverwachting met 1-sigma onzekerheidsband in procenten.`;

      try {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": apiKey,
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
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
        const content = j.choices?.[0]?.message?.content ?? "{}";
        const parsed = JSON.parse(content);
        const { aiForecast, ...rest } = parsed ?? {};
        ai = { ...ai, ...rest };
        if (aiForecast && typeof aiForecast === "object") {
          ai.forecasts = [
            {
              model: "AI Prognose",
              day: +Number(aiForecast.day ?? 0).toFixed(2),
              week: +Number(aiForecast.week ?? 0).toFixed(2),
              month: +Number(aiForecast.month ?? 0).toFixed(2),
              bandDay: +Number(aiForecast.bandDay ?? band(1)).toFixed(2),
              bandWeek: +Number(aiForecast.bandWeek ?? band(5)).toFixed(2),
              bandMonth: +Number(aiForecast.bandMonth ?? band(21)).toFixed(2),
            },
            ...heuristicForecasts,
          ];
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
    };
  });

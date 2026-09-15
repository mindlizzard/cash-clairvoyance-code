/**
 * Intraday-model: echte intraday candles (5m/15m/30m/1h) → uurprognoses.
 * Geen lineaire schaling van een dagprognose: drift en volatiliteit worden
 * per intraday-stap geschat en gecombineerd met VWAP, RSI, MACD, volume,
 * ATR en intraday support/resistance.
 */

export type IntradayCandle = {
  t: number; // epoch ms
  o?: number;
  h?: number;
  l?: number;
  c: number;
  v?: number;
};

function emaSeries(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

function rsiLast(values: number[], period = 14): number | null {
  if (values.length < period + 2) return null;
  let avgG = 0;
  let avgL = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) avgG += d;
    else avgL -= d;
  }
  avgG /= period;
  avgL /= period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgG = (avgG * (period - 1) + (d > 0 ? d : 0)) / period;
    avgL = (avgL * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  const rs = avgL === 0 ? 100 : avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function meanOf(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function stdevOf(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = meanOf(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function slopeOf(values: number[]): number {
  const n = values.length;
  if (n < 3) return 0;
  const xm = (n - 1) / 2;
  const ym = meanOf(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (values[i] - ym);
    den += (i - xm) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** Standaardnormale verdelingsfunctie (Abramowitz–Stegun). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-(z * z) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? 1 - p : p;
}

export type IntradayContext = {
  intervalMinutes: number;
  samples: number;
  price: number;
  lastAt: number;
  ema20: number | null;
  ema50: number | null;
  rsi: number | null;
  macdHist: number | null;
  vwap: number | null;
  atr: number;
  atrPct: number;
  sigmaStep: number;
  driftStep: number;
  biasStep: number;
  volumeRatio: number | null;
  support: number;
  resistance: number;
  trendScore: number;
  momentumScore: number;
  vwapScore: number;
  volumeScore: number;
  levelScore: number;
};

/** Bouw intraday context uit ruwe candles. Null bij te weinig data. */
export function buildIntradayContext(
  candles: IntradayCandle[],
  intervalMinutes: number,
): IntradayContext | null {
  const rows = candles.filter((c) => typeof c.c === "number" && isFinite(c.c) && c.c > 0);
  if (rows.length < 30 || intervalMinutes <= 0) return null;

  const closes = rows.map((c) => c.c);
  const price = closes[closes.length - 1];
  const e20 = emaSeries(closes, 20);
  const e50 = emaSeries(closes, 50);
  const e12 = emaSeries(closes, 12);
  const e26 = emaSeries(closes, 26);
  const macdLine = closes.map((_, i) => e12[i] - e26[i]);
  const macdSignal = emaSeries(macdLine, 9);
  const idx = closes.length - 1;
  const macdHist = macdLine[idx] - macdSignal[idx];

  // log-returns per stap
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const window = rets.slice(-120);
  const sigmaStep = Math.max(stdevOf(window), 1e-6);
  const driftStep = meanOf(rets.slice(-40));

  // ATR over intraday candles
  let atr = 0;
  {
    const trs: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const hi = rows[i].h ?? rows[i].c;
      const lo = rows[i].l ?? rows[i].c;
      const pc = rows[i - 1].c;
      trs.push(Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc)));
    }
    const last = trs.slice(-14);
    atr = last.length ? meanOf(last) : 0;
  }

  // VWAP over de laatste handelssessie (max 1 dag aan candles)
  const perDay = Math.max(4, Math.round((60 / intervalMinutes) * 8));
  const session = rows.slice(-perDay);
  let vNum = 0;
  let vDen = 0;
  for (const c of session) {
    if (c.v == null || !isFinite(c.v)) continue;
    const tp = ((c.h ?? c.c) + (c.l ?? c.c) + c.c) / 3;
    vNum += tp * c.v;
    vDen += c.v;
  }
  const vwap = vDen > 0 ? vNum / vDen : null;

  const vols = rows.map((c) => c.v ?? 0).filter((v) => v > 0);
  const volumeRatio =
    vols.length >= 20 ? meanOf(vols.slice(-5)) / Math.max(meanOf(vols.slice(-40)), 1e-9) : null;

  const support = Math.min(...session.map((c) => c.l ?? c.c));
  const resistance = Math.max(...session.map((c) => c.h ?? c.c));

  // ---- scores, alle genormaliseerd naar ongeveer [-1, 1] ----
  const emaSpread = e50[idx] > 0 ? (e20[idx] - e50[idx]) / e50[idx] : 0;
  const slopePct = price > 0 ? (slopeOf(closes.slice(-40)) / price) * 100 : 0;
  const trendScore = clamp(emaSpread * 120 + slopePct * 6, -1, 1);
  const rsi = rsiLast(closes, 14);
  const momentumScore = clamp(
    (macdHist / Math.max(atr * 0.35, 1e-9)) * 0.6 + (rsi != null ? (rsi - 50) / 50 : 0) * 0.4,
    -1,
    1,
  );
  const vwapScore = vwap != null && atr > 0 ? clamp((price - vwap) / (atr * 1.5), -1, 1) : 0;
  const volumeScore = volumeRatio != null ? clamp((volumeRatio - 1) * 1.2, -1, 1) : 0;
  const range = Math.max(resistance - support, 1e-9);
  const posInRange = clamp((price - support) / range, 0, 1);
  // dicht bij weerstand → rem op long, dicht bij steun → rem op short
  const levelScore = clamp((0.5 - posInRange) * 1.4, -1, 1);

  // Overbought/oversold mean-reversion correctie
  const stretch = rsi != null ? (rsi > 72 ? -0.5 : rsi < 28 ? 0.5 : 0) : 0;

  const rawBias =
    trendScore * 0.34 +
    momentumScore * 0.24 +
    vwapScore * 0.16 +
    levelScore * 0.12 +
    stretch * 0.09 +
    volumeScore * 0.05;
  // bias uitgedrukt als drift per stap, begrensd door intraday volatiliteit
  const biasStep = clamp(rawBias, -1, 1) * sigmaStep * 0.5;

  return {
    intervalMinutes,
    samples: rows.length,
    price,
    lastAt: rows[rows.length - 1].t,
    ema20: e20[idx] ?? null,
    ema50: e50[idx] ?? null,
    rsi,
    macdHist,
    vwap,
    atr,
    atrPct: price > 0 ? (atr / price) * 100 : 0,
    sigmaStep,
    driftStep,
    biasStep,
    volumeRatio,
    support,
    resistance,
    trendScore,
    momentumScore,
    vwapScore,
    volumeScore,
    levelScore,
  };
}

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, isFinite(x) ? x : 0));
}

export type HourlyRow = {
  hours: number;
  expectedPct: number;
  expectedPrice: number;
  probabilityUp: number;
  low: number;
  high: number;
  sigmaPct: number;
  source: "intraday" | "dagmodel";
};

/**
 * Uurprognoses uit intraday context. Drift per stap = 0.35 * gemeten drift +
 * 0.65 * signaal-bias; onzekerheid = sigma * sqrt(stappen).
 */
export function intradayForecasts(
  ctx: IntradayContext,
  hours: number[] = [1, 2, 4, 8, 12, 24],
): HourlyRow[] {
  const muStep = ctx.driftStep * 0.35 + ctx.biasStep * 0.65;
  return hours.map((h) => {
    const steps = Math.max(1, (h * 60) / ctx.intervalMinutes);
    const expectedPct = (Math.exp(muStep * steps) - 1) * 100;
    const sigmaPct = ctx.sigmaStep * Math.sqrt(steps) * 100;
    const z = sigmaPct > 0 ? expectedPct / sigmaPct : 0;
    return {
      hours: h,
      expectedPct: +expectedPct.toFixed(2),
      expectedPrice: +(ctx.price * (1 + expectedPct / 100)).toFixed(4),
      probabilityUp: +(normCdf(z) * 100).toFixed(0),
      low: +(ctx.price * (1 + (expectedPct - sigmaPct) / 100)).toFixed(4),
      high: +(ctx.price * (1 + (expectedPct + sigmaPct) / 100)).toFixed(4),
      sigmaPct: +sigmaPct.toFixed(2),
      source: "intraday" as const,
    };
  });
}

/** Fallback wanneer geen intraday data beschikbaar is (expliciet gelabeld). */
export function dailyFallbackForecasts(
  price: number,
  dailyMu: number,
  dailySigma: number,
  hours: number[] = [1, 2, 4, 8, 12, 24],
): HourlyRow[] {
  return hours.map((h) => {
    const frac = h / 24;
    const expectedPct = (Math.exp(dailyMu * frac) - 1) * 100;
    const sigmaPct = dailySigma * Math.sqrt(frac) * 100;
    const z = sigmaPct > 0 ? expectedPct / sigmaPct : 0;
    return {
      hours: h,
      expectedPct: +expectedPct.toFixed(2),
      expectedPrice: +(price * (1 + expectedPct / 100)).toFixed(4),
      probabilityUp: +(normCdf(z) * 100).toFixed(0),
      low: +(price * (1 + (expectedPct - sigmaPct) / 100)).toFixed(4),
      high: +(price * (1 + (expectedPct + sigmaPct) / 100)).toFixed(4),
      sigmaPct: +sigmaPct.toFixed(2),
      source: "dagmodel" as const,
    };
  });
}

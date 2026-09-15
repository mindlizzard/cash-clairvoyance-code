/**
 * Meetbare betrouwbaarheid: voorspellingen worden per model én per horizon
 * gelogd en later vergeleken met de werkelijke koers. Daaruit volgen hit-rate,
 * MAE, MAPE en het aantal metingen. Te weinig metingen → expliciet
 * "onvoldoende data" in plaats van kunstmatige zekerheid.
 */

const KEY = "beursziener:forecast-log:v2";
const EVENT = "beursziener-accuracy";
export const MIN_SAMPLES = 5;

export type HorizonKey = "1u" | "4u" | "24u" | "1w" | "1m";

export const HORIZONS: { key: HorizonKey; label: string; hours: number }[] = [
  { key: "1u", label: "1 uur", hours: 1 },
  { key: "4u", label: "4 uur", hours: 4 },
  { key: "24u", label: "24 uur", hours: 24 },
  { key: "1w", label: "1 week", hours: 24 * 7 },
  { key: "1m", label: "1 maand", hours: 24 * 30 },
];

type Prediction = { key: HorizonKey; predictedPct: number };

type Scored = {
  key: HorizonKey;
  actualPct: number;
  predictedPct: number;
  absErrorPct: number;
  apePct: number;
  hit: boolean;
  scoredAt: number;
};

type LoggedForecast = {
  id: string;
  symbol: string;
  market: "stock" | "crypto";
  model: string;
  createdAt: number;
  priceAt: number;
  predictions: Prediction[];
  scored: Scored[];
};

function read(): LoggedForecast[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function write(arr: LoggedForecast[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(arr.slice(-1500)));
  window.dispatchEvent(new Event(EVENT));
}

export function onAccuracyChange(handler: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** Log de actuele voorspellingen van elk model, per horizon. */
export function logForecasts(args: {
  symbol: string;
  market: "stock" | "crypto";
  price: number;
  entries: { model: string; predictions: Prediction[] }[];
}) {
  if (typeof window === "undefined" || !args.price) return;
  const arr = read();
  const now = Date.now();
  const sym = args.symbol.toUpperCase();
  // niet dubbel loggen binnen 30 minuten voor hetzelfde symbool
  const recent = arr.some(
    (f) => f.symbol === sym && f.market === args.market && now - f.createdAt < 30 * 60_000,
  );
  if (recent) return;
  for (const e of args.entries) {
    if (!e.predictions.length) continue;
    arr.push({
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      symbol: sym,
      market: args.market,
      model: e.model,
      createdAt: now,
      priceAt: args.price,
      predictions: e.predictions,
      scored: [],
    });
  }
  write(arr);
}

/**
 * Score alle openstaande horizons waarvan de looptijd verstreken is tegen de
 * huidige koers. Wordt bij elke nieuwe analyse van hetzelfde symbool gedaan.
 */
export function scoreOpenForecasts(args: {
  symbol: string;
  market: "stock" | "crypto";
  currentPrice: number;
}) {
  if (typeof window === "undefined" || !args.currentPrice) return;
  const arr = read();
  const sym = args.symbol.toUpperCase();
  const now = Date.now();
  let changed = false;
  for (const f of arr) {
    if (f.symbol !== sym || f.market !== args.market || !f.priceAt) continue;
    const ageH = (now - f.createdAt) / 3_600_000;
    const actualPct = ((args.currentPrice - f.priceAt) / f.priceAt) * 100;
    for (const p of f.predictions) {
      const h = HORIZONS.find((x) => x.key === p.key);
      if (!h || ageH < h.hours) continue;
      if (f.scored.some((s) => s.key === p.key)) continue;
      // te laat gemeten (meer dan 3x de horizon) → niet meer representatief
      if (ageH > h.hours * 3 + 24) {
        f.scored.push({
          key: p.key,
          actualPct,
          predictedPct: p.predictedPct,
          absErrorPct: NaN,
          apePct: NaN,
          hit: false,
          scoredAt: now,
        });
        changed = true;
        continue;
      }
      const absErrorPct = Math.abs(actualPct - p.predictedPct);
      f.scored.push({
        key: p.key,
        actualPct,
        predictedPct: p.predictedPct,
        absErrorPct,
        apePct: (absErrorPct / Math.max(Math.abs(actualPct), 0.5)) * 100,
        hit:
          Math.abs(actualPct) < 0.05
            ? Math.abs(p.predictedPct) < 0.05
            : Math.sign(actualPct) === Math.sign(p.predictedPct),
        scoredAt: now,
      });
      changed = true;
    }
  }
  if (changed) write(arr);
}

export type ModelStats = {
  model: string;
  horizon: HorizonKey;
  samples: number;
  sufficient: boolean;
  hitRate: number | null;
  mae: number | null;
  mape: number | null;
  weight: number; // relatief gewicht (1 = neutraal bij onvoldoende data)
};

/** Statistieken per model voor één horizon (of alle horizons samen). */
export function getModelStats(
  symbol: string,
  market: "stock" | "crypto",
  horizon: HorizonKey | "alle" = "alle",
): ModelStats[] {
  const arr = read();
  const sym = symbol.toUpperCase();
  const byModel = new Map<string, { errs: number[]; apes: number[]; hits: number[] }>();
  for (const f of arr) {
    if (f.symbol !== sym || f.market !== market) continue;
    for (const s of f.scored) {
      if (horizon !== "alle" && s.key !== horizon) continue;
      if (!isFinite(s.absErrorPct)) continue;
      const m = byModel.get(f.model) ?? { errs: [], apes: [], hits: [] };
      m.errs.push(s.absErrorPct);
      m.apes.push(s.apePct);
      m.hits.push(s.hit ? 1 : 0);
      byModel.set(f.model, m);
    }
  }
  const out: ModelStats[] = [];
  for (const [model, m] of byModel) {
    const samples = m.errs.length;
    const mae = m.errs.reduce((s, x) => s + x, 0) / samples;
    const mape = m.apes.reduce((s, x) => s + x, 0) / samples;
    const hitRate = (m.hits.reduce((s, x) => s + x, 0) / samples) * 100;
    const sufficient = samples >= MIN_SAMPLES;
    const hitPart = Math.max(0, (hitRate - 40) / 60);
    const errPart = Math.max(0, 1 - Math.min(mae, 15) / 15);
    out.push({
      model,
      horizon: horizon === "alle" ? "24u" : horizon,
      samples,
      sufficient,
      hitRate,
      mae,
      mape,
      weight: sufficient ? Math.max(0.15, hitPart * 0.65 + errPart * 0.35) * 2 : 1,
    });
  }
  return out.sort((a, b) => b.weight - a.weight || b.samples - a.samples);
}

/** Modellen zonder metingen krijgen gewicht 1 (neutraal). Som = 1. */
export function getEnsembleWeights(
  models: string[],
  symbol: string,
  market: "stock" | "crypto",
  horizon: HorizonKey | "alle" = "alle",
): { model: string; weight: number; samples: number; sufficient: boolean }[] {
  const stats = new Map(getModelStats(symbol, market, horizon).map((s) => [s.model, s]));
  const raw = models.map((model) => {
    const s = stats.get(model);
    return { model, weight: s?.weight ?? 1, samples: s?.samples ?? 0, sufficient: !!s?.sufficient };
  });
  const total = raw.reduce((s, r) => s + r.weight, 0) || 1;
  return raw
    .map((r) => ({ ...r, weight: r.weight / total }))
    .sort((a, b) => b.weight - a.weight);
}

/** Samenvatting per horizon over alle modellen: hoeveel is er echt gemeten? */
export function getHorizonSummary(symbol: string, market: "stock" | "crypto") {
  return HORIZONS.map((h) => {
    const stats = getModelStats(symbol, market, h.key);
    const samples = stats.reduce((s, x) => s + x.samples, 0);
    const hit = stats.length
      ? stats.reduce((s, x) => s + (x.hitRate ?? 0) * x.samples, 0) / Math.max(samples, 1)
      : null;
    const mae = stats.length
      ? stats.reduce((s, x) => s + (x.mae ?? 0) * x.samples, 0) / Math.max(samples, 1)
      : null;
    return {
      ...h,
      samples,
      sufficient: samples >= MIN_SAMPLES,
      hitRate: samples ? hit : null,
      mae: samples ? mae : null,
    };
  });
}

/** Gemeten betrouwbaarheid; null zolang er te weinig metingen zijn. */
export function measuredConfidence(
  symbol: string,
  market: "stock" | "crypto",
  horizon: HorizonKey | "alle" = "alle",
): { value: number; samples: number } | null {
  const stats = getModelStats(symbol, market, horizon);
  const samples = stats.reduce((s, x) => s + x.samples, 0);
  if (samples < MIN_SAMPLES) return null;
  const hit = stats.reduce((s, x) => s + (x.hitRate ?? 0) * x.samples, 0) / samples;
  return { value: hit, samples };
}

export function clearForecastLog() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(EVENT));
  }
}

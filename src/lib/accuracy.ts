/**
 * Meetbare betrouwbaarheid van voorspellingen.
 *
 * Belangrijk:
 * - Elke horizon wordt apart gemeten.
 * - Alleen een meting die dicht genoeg bij het bedoelde evaluatiemoment gebeurt,
 *   telt mee. Een voorspelling van +1 uur die pas morgen wordt bekeken, wordt dus
 *   NIET als fout of goed meegeteld.
 * - "Gemeten betrouwbaarheid" gebruikt primair het Ensemble (handelsplan), zodat
 *   9 modellen uit één analysemoment niet ten onrechte als 9 onafhankelijke
 *   succesvolle voorspellingen worden geteld.
 * - Te weinig echte metingen = expliciet onvoldoende data.
 */

const KEY = "beursziener:forecast-log:v3";
const EVENT = "beursziener-accuracy";

/** Minimaal aantal onafhankelijke handelsplan-metingen vóór we een hit-rate serieus tonen. */
export const MIN_SAMPLES = 20;

export type HorizonKey = "1u" | "4u" | "24u" | "1w" | "1m";

export const HORIZONS: {
  key: HorizonKey;
  label: string;
  hours: number;
  maxDelayHours: number;
}[] = [
  { key: "1u", label: "1 uur", hours: 1, maxDelayHours: 0.75 },
  { key: "4u", label: "4 uur", hours: 4, maxDelayHours: 2 },
  { key: "24u", label: "24 uur", hours: 24, maxDelayHours: 8 },
  { key: "1w", label: "1 week", hours: 24 * 7, maxDelayHours: 30 },
  { key: "1m", label: "1 maand", hours: 24 * 30, maxDelayHours: 72 },
];

type Prediction = {
  key: HorizonKey;
  predictedPct: number;
};

type Scored = {
  key: HorizonKey;
  actualPct: number;
  predictedPct: number;
  absErrorPct: number;
  apePct: number;
  hit: boolean;
  scoredAt: number;
  delayHours: number;
  valid: boolean;
  skipReason?: string;
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
  // Ruim genoeg voor maanden meten, maar nog netjes binnen normale localStorage-limieten.
  localStorage.setItem(KEY, JSON.stringify(arr.slice(-3000)));
  window.dispatchEvent(new Event(EVENT));
}

export function onAccuracyChange(handler: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** Log per analysemoment maximaal één batch per symbool binnen 30 minuten. */
export function logForecasts(args: {
  symbol: string;
  market: "stock" | "crypto";
  price: number;
  entries: { model: string; predictions: Prediction[] }[];
}) {
  if (typeof window === "undefined" || !(args.price > 0)) return;

  const arr = read();
  const now = Date.now();
  const sym = args.symbol.toUpperCase();

  const recent = arr.some(
    (f) =>
      f.symbol === sym &&
      f.market === args.market &&
      now - f.createdAt < 30 * 60_000,
  );
  if (recent) return;

  for (const entry of args.entries) {
    const predictions = entry.predictions.filter(
      (p) => Number.isFinite(p.predictedPct) && HORIZONS.some((h) => h.key === p.key),
    );
    if (!predictions.length) continue;

    arr.push({
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      symbol: sym,
      market: args.market,
      model: entry.model,
      createdAt: now,
      priceAt: args.price,
      predictions,
      scored: [],
    });
  }

  write(arr);
}

/**
 * Score een voorspelling alleen als de gebruiker rond het bedoelde evaluatiemoment
 * opnieuw een actuele koers ophaalt. Is de app veel te laat geopend, dan markeren
 * we die horizon als overgeslagen. Dat is veel eerlijker dan de koers van morgen
 * gebruiken om een +1u voorspelling te beoordelen.
 */
export function scoreOpenForecasts(args: {
  symbol: string;
  market: "stock" | "crypto";
  currentPrice: number;
}) {
  if (typeof window === "undefined" || !(args.currentPrice > 0)) return;

  const arr = read();
  const sym = args.symbol.toUpperCase();
  const now = Date.now();
  let changed = false;

  for (const f of arr) {
    if (f.symbol !== sym || f.market !== args.market || !(f.priceAt > 0)) continue;

    const ageH = (now - f.createdAt) / 3_600_000;
    const actualPct = ((args.currentPrice - f.priceAt) / f.priceAt) * 100;

    for (const p of f.predictions) {
      if (f.scored.some((s) => s.key === p.key)) continue;

      const horizon = HORIZONS.find((h) => h.key === p.key);
      if (!horizon || ageH < horizon.hours) continue;

      const delayHours = ageH - horizon.hours;

      if (delayHours > horizon.maxDelayHours) {
        f.scored.push({
          key: p.key,
          actualPct: Number.NaN,
          predictedPct: p.predictedPct,
          absErrorPct: Number.NaN,
          apePct: Number.NaN,
          hit: false,
          scoredAt: now,
          delayHours,
          valid: false,
          skipReason: "Te laat gemeten voor een eerlijke vergelijking",
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
        delayHours,
        valid: true,
      });

      changed = true;
    }
  }

  if (changed) write(arr);
}

function wilsonBounds(hits: number, n: number, z = 1.96) {
  if (!n) return { lower: 0, upper: 1 };

  const phat = hits / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = phat + z2 / (2 * n);
  const margin =
    z *
    Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);

  return {
    lower: Math.max(0, (centre - margin) / denom),
    upper: Math.min(1, (centre + margin) / denom),
  };
}

export type ModelStats = {
  model: string;
  horizon: HorizonKey;
  samples: number;
  skipped: number;
  sufficient: boolean;
  hitRate: number | null;
  hitRateLow: number | null;
  hitRateHigh: number | null;
  mae: number | null;
  mape: number | null;
  weight: number;
};

/** Statistieken per model, per horizon. Ongeldige/te late metingen tellen niet mee. */
export function getModelStats(
  symbol: string,
  market: "stock" | "crypto",
  horizon: HorizonKey | "alle" = "alle",
): ModelStats[] {
  const arr = read();
  const sym = symbol.toUpperCase();

  const byModel = new Map<
    string,
    { errs: number[]; apes: number[]; hits: number[]; skipped: number }
  >();

  for (const f of arr) {
    if (f.symbol !== sym || f.market !== market) continue;

    for (const s of f.scored) {
      if (horizon !== "alle" && s.key !== horizon) continue;

      const row = byModel.get(f.model) ?? {
        errs: [],
        apes: [],
        hits: [],
        skipped: 0,
      };

      if (!s.valid || !Number.isFinite(s.absErrorPct)) {
        row.skipped++;
        byModel.set(f.model, row);
        continue;
      }

      row.errs.push(s.absErrorPct);
      row.apes.push(s.apePct);
      row.hits.push(s.hit ? 1 : 0);
      byModel.set(f.model, row);
    }
  }

  const out: ModelStats[] = [];

  for (const [model, m] of byModel) {
    const samples = m.errs.length;

    if (!samples) {
      out.push({
        model,
        horizon: horizon === "alle" ? "24u" : horizon,
        samples: 0,
        skipped: m.skipped,
        sufficient: false,
        hitRate: null,
        hitRateLow: null,
        hitRateHigh: null,
        mae: null,
        mape: null,
        weight: 1,
      });
      continue;
    }

    const hitCount = m.hits.reduce((s, x) => s + x, 0);
    const hitRate = (hitCount / samples) * 100;
    const mae = m.errs.reduce((s, x) => s + x, 0) / samples;
    const mape = m.apes.reduce((s, x) => s + x, 0) / samples;
    const bounds = wilsonBounds(hitCount, samples);
    const sufficient = samples >= MIN_SAMPLES;

    // Gebruik bij modelgewicht de voorzichtige ondergrens, niet alleen de kale hit-rate.
    const conservativeHit = bounds.lower * 100;
    const hitPart = Math.max(0, (conservativeHit - 40) / 40);
    const errPart = Math.max(0, 1 - Math.min(mae, 15) / 15);

    out.push({
      model,
      horizon: horizon === "alle" ? "24u" : horizon,
      samples,
      skipped: m.skipped,
      sufficient,
      hitRate,
      hitRateLow: bounds.lower * 100,
      hitRateHigh: bounds.upper * 100,
      mae,
      mape,
      weight: sufficient
        ? Math.max(0.25, hitPart * 0.7 + errPart * 0.3)
        : 1,
    });
  }

  return out.sort(
    (a, b) =>
      Number(b.sufficient) - Number(a.sufficient) ||
      b.weight - a.weight ||
      b.samples - a.samples,
  );
}

/** Modellen zonder genoeg historie blijven neutraal en krijgen geen kunstmatige bonus. */
export function getEnsembleWeights(
  models: string[],
  symbol: string,
  market: "stock" | "crypto",
  horizon: HorizonKey | "alle" = "alle",
): { model: string; weight: number; samples: number; sufficient: boolean }[] {
  const stats = new Map(
    getModelStats(symbol, market, horizon).map((s) => [s.model, s]),
  );

  const raw = models.map((model) => {
    const s = stats.get(model);
    return {
      model,
      weight: s?.sufficient ? s.weight : 1,
      samples: s?.samples ?? 0,
      sufficient: !!s?.sufficient,
    };
  });

  const total = raw.reduce((s, r) => s + r.weight, 0) || 1;

  return raw
    .map((r) => ({ ...r, weight: r.weight / total }))
    .sort((a, b) => b.weight - a.weight);
}

export function getHorizonSummary(
  symbol: string,
  market: "stock" | "crypto",
) {
  return HORIZONS.map((h) => {
    const stats = getModelStats(symbol, market, h.key);
    const samples = stats.reduce((s, x) => s + x.samples, 0);
    const skipped = stats.reduce((s, x) => s + x.skipped, 0);

    const hit =
      samples > 0
        ? stats.reduce(
            (s, x) => s + (x.hitRate ?? 0) * x.samples,
            0,
          ) / samples
        : null;

    const mae =
      samples > 0
        ? stats.reduce(
            (s, x) => s + (x.mae ?? 0) * x.samples,
            0,
          ) / samples
        : null;

    return {
      ...h,
      samples,
      skipped,
      sufficient: samples >= MIN_SAMPLES,
      hitRate: hit,
      mae,
    };
  });
}

/**
 * Betrouwbaarheid van het HANDELSPLAN, niet een optelsom van alle losse modellen.
 * Hierdoor is één analysemoment gewoon één meting.
 */
export function measuredConfidence(
  symbol: string,
  market: "stock" | "crypto",
  horizon: HorizonKey | "alle" = "alle",
): {
  value: number;
  lower: number;
  upper: number;
  samples: number;
  skipped: number;
} | null {
  const stats = getModelStats(symbol, market, horizon);
  const ensemble = stats.find((s) => s.model === "Ensemble (handelsplan)");

  if (
    !ensemble ||
    !ensemble.sufficient ||
    ensemble.hitRate == null ||
    ensemble.hitRateLow == null ||
    ensemble.hitRateHigh == null
  ) {
    return null;
  }

  return {
    value: ensemble.hitRate,
    lower: ensemble.hitRateLow,
    upper: ensemble.hitRateHigh,
    samples: ensemble.samples,
    skipped: ensemble.skipped,
  };
}

export function clearForecastLog() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(EVENT));
  }
}

/**
 * Lokale tracking van voorspellingen vs. werkelijkheid per (symbool, model).
 * Bij elke analyse: loggen we de huidige forecasts. Bij volgende analyse
 * van hetzelfde symbool: checken oude forecasts waarvan de horizon verstreken
 * is, en scoren we MAE + hit-rate (richting).
 */

const KEY = "beursziener:forecast-log:v1";

type LoggedForecast = {
  id: string;
  symbol: string;
  market: "stock" | "crypto";
  model: string;
  createdAt: number;     // epoch ms
  priceAt: number;       // koers op moment van voorspelling
  day: number;           // verwachte %
  week: number;
  month: number;
  // Gescoord (gevuld zodra horizon verstreken is)
  scored?: {
    horizon: "day" | "week" | "month";
    actualPct: number;
    predictedPct: number;
    errorPct: number;     // |actual - predicted|
    directionHit: boolean;
    scoredAt: number;
  }[];
};

function read(): LoggedForecast[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function write(arr: LoggedForecast[]) {
  if (typeof window === "undefined") return;
  // hou laatste 500
  const trimmed = arr.slice(-500);
  localStorage.setItem(KEY, JSON.stringify(trimmed));
}

/** Sla een batch nieuwe forecasts op. */
export function logForecasts(args: {
  symbol: string;
  market: "stock" | "crypto";
  price: number;
  forecasts: { model: string; day: number; week: number; month: number }[];
}) {
  const arr = read();
  const now = Date.now();
  for (const f of args.forecasts) {
    arr.push({
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      symbol: args.symbol.toUpperCase(),
      market: args.market,
      model: f.model,
      createdAt: now,
      priceAt: args.price,
      day: f.day,
      week: f.week,
      month: f.month,
    });
  }
  write(arr);
}

/**
 * Score open voorspellingen tegen huidige prijs. Verwerkt elke horizon
 * (1/5/21 handelsdagen ≈ 1/7/30 kalenderdagen) zodra verstreken.
 */
export function scoreOpenForecasts(args: {
  symbol: string;
  market: "stock" | "crypto";
  currentPrice: number;
}) {
  const arr = read();
  const now = Date.now();
  const DAY_MS = 86_400_000;
  const horizons: { name: "day" | "week" | "month"; days: number }[] = [
    { name: "day", days: 1.5 },
    { name: "week", days: 7 },
    { name: "month", days: 30 },
  ];
  let changed = false;
  for (const f of arr) {
    if (f.symbol !== args.symbol.toUpperCase() || f.market !== args.market) continue;
    const age = now - f.createdAt;
    const actualPct = ((args.currentPrice - f.priceAt) / f.priceAt) * 100;
    for (const h of horizons) {
      if (age < h.days * DAY_MS) continue;
      if (f.scored?.some((s) => s.horizon === h.name)) continue;
      const pred = h.name === "day" ? f.day : h.name === "week" ? f.week : f.month;
      const errorPct = Math.abs(actualPct - pred);
      const directionHit = Math.sign(actualPct) === Math.sign(pred);
      f.scored = [
        ...(f.scored ?? []),
        { horizon: h.name, actualPct, predictedPct: pred, errorPct, directionHit, scoredAt: now },
      ];
      changed = true;
    }
  }
  if (changed) write(arr);
}

export type ModelStats = {
  model: string;
  samples: number;
  mae: number;          // gem. absolute fout in %
  hitRate: number;      // % juiste richting
  weight: number;       // 0-1 voor ensemble (hoger = meer accuraat)
};

/**
 * Stats per model voor (symbool, market). Combineert week+month scores.
 * Lege of weinig-data modellen krijgen weight 0.5 (neutraal).
 */
export function getModelStats(symbol: string, market: "stock" | "crypto"): ModelStats[] {
  const arr = read();
  const sym = symbol.toUpperCase();
  const byModel = new Map<string, { errs: number[]; hits: number[] }>();
  for (const f of arr) {
    if (f.symbol !== sym || f.market !== market || !f.scored) continue;
    for (const s of f.scored) {
      if (s.horizon === "day") continue;
      const m = byModel.get(f.model) ?? { errs: [], hits: [] };
      m.errs.push(s.errorPct);
      m.hits.push(s.directionHit ? 1 : 0);
      byModel.set(f.model, m);
    }
  }
  const out: ModelStats[] = [];
  for (const [model, { errs, hits }] of byModel) {
    const mae = errs.reduce((s, x) => s + x, 0) / errs.length;
    const hitRate = (hits.reduce((s, x) => s + x, 0) / hits.length) * 100;
    // weight: hitRate boven 50% telt mee, MAE onder 5% telt mee
    const hitW = Math.max(0, (hitRate - 40) / 60);
    const maeW = Math.max(0, 1 - Math.min(mae, 20) / 20);
    const weight = errs.length < 3 ? 0.5 : Math.max(0.1, (hitW * 0.6 + maeW * 0.4));
    out.push({ model, samples: errs.length, mae, hitRate, weight });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

export function clearForecastLog() {
  if (typeof window !== "undefined") localStorage.removeItem(KEY);
}
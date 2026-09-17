/**
 * Meetbare betrouwbaarheid van de modellen.
 *
 * Belangrijk onderscheid:
 *  - Historische koersdagen (result.stats.samples) → data die de modellen NU
 *    gebruiken om verwachtingen te berekenen. Die is er altijd.
 *  - Gecontroleerde voorspellingen (deze module) → voorspellingen die in DEZE
 *    browser zijn vastgelegd, waarvan de horizon inmiddels is verstreken én
 *    waarvoor een verse vergelijkingskoers is opgehaald.
 *
 * "Nog niet getoetst" zegt dus niets over het downloaden van koersdata.
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

/** Meetvenster rond de horizon: een koers ver na de horizon meet iets anders. */
export function scoreWindowHours(hours: number) {
  return Math.max(1, hours * 0.5);
}

/** Minimale afstand tussen twee onafhankelijke observaties van dezelfde horizon. */
export function minSpacingHours(hours: number) {
  return Math.max(0.5, hours * 0.5);
}

type Prediction = { key: HorizonKey; predictedPct: number };

type Scored = {
  key: HorizonKey;
  actualPct: number;
  predictedPct: number;
  absErrorPct: number;
  apePct: number;
  hit: boolean;
  scoredAt: number;
  ageHours: number;
  /** true = horizon te laat gemeten of data niet bevestigd → telt niet mee */
  expired?: boolean;
};

export type LoggedForecast = {
  id: string;
  symbol: string;
  market: "stock" | "crypto";
  model: string;
  /** moment van vastleggen (klok) */
  createdAt: number;
  /** tijdstip van de basiswaarneming zelf (candle/provider) */
  observedAt: number;
  /** basiskoers uit DEZELFDE waarneming als observedAt */
  basePrice: number;
  /** herkomst van het prijs+tijd-paar, bv. "5m (Nasdaq)" of "dagslot" */
  sourceKind: "intraday" | "dagslot";
  sourceLabel?: string;
  predictions: Prediction[];
  scored: Scored[];
  /** legacy veld (bevatte de basiskoers) */
  priceAt?: number;
};

/** Basiskoers, met terugvalwaarde voor eerder opgeslagen records. */
function baseOf(f: LoggedForecast) {
  return f.basePrice ?? f.priceAt ?? 0;
}

/** Tijdstip van de basiswaarneming, met terugval op het logmoment. */
function observedOf(f: LoggedForecast) {
  return f.observedAt ?? f.createdAt;
}


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

export type LogArgs = {
  symbol: string;
  market: "stock" | "crypto";
  price: number;
  /** Vertraagde/onbevestigde koers → niet loggen (anders meten we ruis). */
  stale?: boolean;
  entries: { model: string; predictions: Prediction[] }[];
};

/**
 * Pure variant: voegt alleen die horizons toe die genoeg afstand hebben tot de
 * vorige observatie. Herhaald refreshen levert dus geen extra "metingen" op.
 */
export function appendForecasts(
  arr: LoggedForecast[],
  args: LogArgs,
  now: number,
): { arr: LoggedForecast[]; added: number } {
  if (!args.price || !isFinite(args.price) || args.stale) return { arr, added: 0 };
  const sym = args.symbol.toUpperCase();
  const out = arr.slice();
  let added = 0;
  for (const e of args.entries) {
    const fresh: Prediction[] = [];
    for (const p of e.predictions) {
      if (!isFinite(p.predictedPct)) continue;
      const h = HORIZONS.find((x) => x.key === p.key);
      if (!h) continue;
      const spacing = minSpacingHours(h.hours) * 3_600_000;
      const dup = out.some(
        (f) =>
          f.symbol === sym &&
          f.market === args.market &&
          f.model === e.model &&
          now - f.createdAt < spacing &&
          f.predictions.some((q) => q.key === p.key),
      );
      if (!dup) fresh.push(p);
    }
    if (!fresh.length) continue;
    out.push({
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      symbol: sym,
      market: args.market,
      model: e.model,
      createdAt: now,
      priceAt: args.price,
      predictions: fresh,
      scored: [],
    });
    added += fresh.length;
  }
  return { arr: out, added };
}

/** Log de actuele voorspellingen van elk model, per horizon. */
export function logForecasts(args: LogArgs) {
  if (typeof window === "undefined") return;
  const { arr, added } = appendForecasts(read(), args, Date.now());
  if (added) write(arr);
}

export type ScoreArgs = {
  symbol: string;
  market: "stock" | "crypto";
  currentPrice: number;
  /** Tijdstip van de vergelijkingskoers (niet het moment van kijken). */
  priceAt?: number;
  /** Vertraagde/onbevestigde koers → niet scoren. */
  stale?: boolean;
};

/**
 * Pure variant. Scoort uitsluitend binnen het meetvenster rond de horizon;
 * te late horizons worden als "expired" gemarkeerd en tellen nooit mee.
 */
export function scoreForecasts(
  arr: LoggedForecast[],
  args: ScoreArgs,
  now: number,
): { arr: LoggedForecast[]; changed: number } {
  const sym = args.symbol.toUpperCase();
  const refTime = args.priceAt ?? now;
  let changed = 0;
  const out = arr.map((f) => ({ ...f, scored: f.scored.slice() }));
  for (const f of out) {
    if (f.symbol !== sym || f.market !== args.market || !f.priceAt) continue;
    const ageH = (refTime - f.createdAt) / 3_600_000;
    if (ageH <= 0) continue;
    const actualPct = ((args.currentPrice - f.priceAt) / f.priceAt) * 100;
    for (const p of f.predictions) {
      const h = HORIZONS.find((x) => x.key === p.key);
      if (!h || ageH < h.hours) continue;
      if (f.scored.some((s) => s.key === p.key)) continue;
      const tooLate = ageH > h.hours + scoreWindowHours(h.hours);
      if (tooLate || args.stale || !args.currentPrice || !isFinite(args.currentPrice)) {
        // niet meetbaar: markeer alleen als verlopen zodra het venster voorbij is
        if (!tooLate) continue;
        f.scored.push({
          key: p.key,
          actualPct,
          predictedPct: p.predictedPct,
          absErrorPct: NaN,
          apePct: NaN,
          hit: false,
          scoredAt: now,
          ageHours: ageH,
          expired: true,
        });
        changed++;
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
        ageHours: ageH,
      });
      changed++;
    }
  }
  return { arr: out, changed };
}

/** Score verstreken horizons tegen de huidige (verse) koers. */
export function scoreOpenForecasts(args: ScoreArgs) {
  if (typeof window === "undefined" || !args.currentPrice) return;
  const { arr, changed } = scoreForecasts(read(), args, Date.now());
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
  weight: number; // indicatief relatief gewicht (1 = neutraal)
};

/** Statistieken per model voor één horizon (of alle horizons samen). */
export function getModelStats(
  symbol: string,
  market: "stock" | "crypto",
  horizon: HorizonKey | "alle" = "alle",
  source?: LoggedForecast[],
): ModelStats[] {
  const arr = source ?? read();
  const sym = symbol.toUpperCase();
  const byModel = new Map<string, { errs: number[]; apes: number[]; hits: number[] }>();
  for (const f of arr) {
    if (f.symbol !== sym || f.market !== market) continue;
    for (const s of f.scored) {
      if (horizon !== "alle" && s.key !== horizon) continue;
      if (s.expired || !isFinite(s.absErrorPct)) continue;
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

/**
 * Indicatieve weegfactoren op basis van gemeten nauwkeurigheid in deze browser.
 * NIET toegepast op het live ensemble op de server (dat rekent ongewogen).
 */
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

export type HorizonSummary = {
  key: HorizonKey;
  label: string;
  hours: number;
  /** unieke tijdstippen met een geldige meting (niet 10 modellen = 10 metingen) */
  observations: number;
  /** aantal model-metingen (per model afzonderlijk gescoord) */
  modelChecks: number;
  /** nog lopende voorspellingen: horizon nog niet verstreken */
  pending: number;
  /** verlopen zonder geldige vergelijkingskoers */
  expired: number;
  sufficient: boolean;
  hitRate: number | null;
  mae: number | null;
};

/** Samenvatting per horizon: wat is er écht gemeten, en wat loopt nog? */
export function getHorizonSummary(
  symbol: string,
  market: "stock" | "crypto",
  source?: LoggedForecast[],
  now: number = Date.now(),
): HorizonSummary[] {
  const arr = (source ?? read()).filter(
    (f) => f.symbol === symbol.toUpperCase() && f.market === market,
  );
  return HORIZONS.map((h) => {
    const times = new Set<number>();
    let modelChecks = 0;
    let pending = 0;
    let expired = 0;
    let hits = 0;
    let errSum = 0;
    for (const f of arr) {
      if (!f.predictions.some((p) => p.key === h.key)) continue;
      const s = f.scored.find((x) => x.key === h.key);
      if (!s) {
        const ageH = (now - f.createdAt) / 3_600_000;
        if (ageH < h.hours) pending++;
        else expired++;
        continue;
      }
      if (s.expired || !isFinite(s.absErrorPct)) {
        expired++;
        continue;
      }
      modelChecks++;
      times.add(f.createdAt);
      hits += s.hit ? 1 : 0;
      errSum += s.absErrorPct;
    }
    const observations = times.size;
    const sufficient = observations >= MIN_SAMPLES;
    return {
      ...h,
      observations,
      modelChecks,
      pending,
      expired,
      sufficient,
      hitRate: modelChecks ? (hits / modelChecks) * 100 : null,
      mae: modelChecks ? errSum / modelChecks : null,
    };
  });
}

export type TrackingOverview = {
  observations: number;
  modelChecks: number;
  pending: number;
  expired: number;
};

/** Totaaloverzicht van de live-tracking voor dit symbool. */
export function getTrackingOverview(
  symbol: string,
  market: "stock" | "crypto",
  source?: LoggedForecast[],
  now: number = Date.now(),
): TrackingOverview {
  const rows = getHorizonSummary(symbol, market, source, now);
  return {
    observations: rows.reduce((s, r) => s + r.observations, 0),
    modelChecks: rows.reduce((s, r) => s + r.modelChecks, 0),
    pending: rows.reduce((s, r) => s + r.pending, 0),
    expired: rows.reduce((s, r) => s + r.expired, 0),
  };
}

/**
 * Gemeten betrouwbaarheid; null zolang er te weinig ONAFHANKELIJKE metingen
 * (unieke tijdstippen) zijn.
 */
export function measuredConfidence(
  symbol: string,
  market: "stock" | "crypto",
  horizon: HorizonKey | "alle" = "alle",
): { value: number; samples: number } | null {
  const rows = getHorizonSummary(symbol, market);
  const sel = horizon === "alle" ? rows : rows.filter((r) => r.key === horizon);
  const observations = sel.reduce((s, r) => s + r.observations, 0);
  const checks = sel.reduce((s, r) => s + r.modelChecks, 0);
  if (observations < MIN_SAMPLES || !checks) return null;
  const hit = sel.reduce((s, r) => s + (r.hitRate ?? 0) * r.modelChecks, 0) / checks;
  return { value: hit, samples: observations };
}

/** Tekst voor een modelrij: nooit suggereren dat koersdata ontbreekt. */
export function trackingLabel(samples: number) {
  if (samples <= 0) return `Nog niet getoetst (0/${MIN_SAMPLES} voorspellingen gecontroleerd)`;
  if (samples < MIN_SAMPLES) return `Nog weinig controles (${samples}/${MIN_SAMPLES})`;
  return "";
}

export const ACCURACY_EXPLAINER =
  "De modellen berekenen al verwachtingen uit historische koersen. De nauwkeurigheid kan pas achteraf worden gemeten als voorspellingen zijn verlopen en een echte vergelijkingskoers is opgehaald. Dit gebeurt lokaal in dezelfde browser; dit is geen probleem met de historische koersdata.";

export function clearForecastLog() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(EVENT));
  }
}

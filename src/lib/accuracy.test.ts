import { describe, expect, it } from "vitest";
import {
  appendForecasts,
  scoreForecasts,
  getModelStats,
  getHorizonSummary,
  getTrackingOverview,
  MIN_SAMPLES,
  minSpacingHours,
  scoreWindowHours,
  type LoggedForecast,
} from "./accuracy";

const H = 3_600_000;
const T0 = Date.parse("2026-01-05T14:00:00Z");

function log(
  arr: LoggedForecast[],
  opts: Partial<Parameters<typeof appendForecasts>[1]> & { now?: number } = {},
) {
  const now = opts.now ?? T0;
  return appendForecasts(
    arr,
    {
      symbol: "NVDA",
      market: "stock",
      price: 100,
      observedAt: now,
      sourceKind: "intraday",
      entries: [{ model: "Trendvolger", predictions: [{ key: "24u", predictedPct: 2 }] }],
      ...opts,
    },
    now,
  );
}

describe("logging van voorspellingen", () => {
  it("logt een coherent prijs+tijd-paar", () => {
    const { arr, added } = log([]);
    expect(added).toBe(1);
    expect(arr[0].basePrice).toBe(100);
    expect(arr[0].observedAt).toBe(T0);
  });

  it("logt niets bij verouderde/onbevestigde koers", () => {
    expect(log([], { stale: true }).added).toBe(0);
  });

  it("logt niets bij een timestamp uit de toekomst", () => {
    expect(log([], { observedAt: T0 + 60 * 60_000 }).added).toBe(0);
  });

  it("slaat 1u/4u over als de bron alleen een dagslotkoers is", () => {
    const { arr, added } = log([], {
      sourceKind: "dagslot",
      minHorizonHours: 24,
      entries: [
        {
          model: "Trendvolger",
          predictions: [
            { key: "1u", predictedPct: 0.3 },
            { key: "4u", predictedPct: 0.5 },
            { key: "24u", predictedPct: 2 },
          ],
        },
      ],
    });
    expect(added).toBe(1);
    expect(arr[0].predictions.map((p) => p.key)).toEqual(["24u"]);
  });

  it("dezelfde snapshot opnieuw levert geen extra observatie", () => {
    const first = log([]).arr;
    expect(log(first, { now: T0 + 5 * 60_000, observedAt: T0 }).added).toBe(0);
  });

  it("refreshen binnen de minimale afstand levert geen nep-observatie", () => {
    const first = log([]).arr;
    const spacing = minSpacingHours(24) * H;
    expect(log(first, { now: T0 + spacing / 2, observedAt: T0 + spacing / 2 }).added).toBe(0);
    expect(log(first, { now: T0 + spacing + H, observedAt: T0 + spacing + H }).added).toBe(1);
  });
});

describe("scoren van voorspellingen", () => {
  const base = log([]).arr;
  const later = T0 + 24 * H;

  it("scoort binnen het meetvenster rond de horizon", () => {
    const { arr, changed } = scoreForecasts(
      base,
      { symbol: "NVDA", market: "stock", currentPrice: 103, priceAt: later },
      later,
    );
    expect(changed).toBe(1);
    expect(arr[0].scored[0].hit).toBe(true);
    expect(arr[0].scored[0].expired).toBeUndefined();
  });

  it("scoort niet met een koers ver na de horizon", () => {
    const far = T0 + (24 + scoreWindowHours(24) + 10) * H;
    const { arr } = scoreForecasts(
      base,
      { symbol: "NVDA", market: "stock", currentPrice: 130, priceAt: far },
      far,
    );
    expect(arr[0].scored[0].expired).toBe(true);
  });

  it("scoort niet bij een prijs/tijd-mismatch (verse tijd, oude dagkoers)", () => {
    // vergelijkingskoers hoort bij een moment dat de horizon nog niet haalde
    const early = T0 + 6 * H;
    const { changed } = scoreForecasts(
      base,
      { symbol: "NVDA", market: "stock", currentPrice: 101, priceAt: early },
      early,
    );
    expect(changed).toBe(0);
  });

  it("scoort niet bij vertraagde data en blijft te beoordelen", () => {
    const { arr, changed } = scoreForecasts(
      base,
      { symbol: "NVDA", market: "stock", currentPrice: 103, priceAt: later, stale: true },
      later,
    );
    expect(changed).toBe(0);
    expect(arr[0].scored).toHaveLength(0);
    const sum = getHorizonSummary("NVDA", "stock", arr).find((h) => h.key === "24u")!;
    expect(sum.awaiting).toBe(1);
    expect(sum.expired).toBe(0);
  });

  it("markt gesloten (geen nieuwe koers) → nog geen score, geen percentage", () => {
    const { arr } = scoreForecasts(
      base,
      { symbol: "NVDA", market: "stock", currentPrice: 0, priceAt: later },
      later,
    );
    expect(arr[0].scored).toHaveLength(0);
    expect(getModelStats("NVDA", "stock", "24u", arr)).toHaveLength(0);
  });
});

describe("tellingen", () => {
  it("één basismoment over meerdere horizons = 1 waarneming, meerdere horizon-controles", () => {
    const { arr } = log([], {
      sourceKind: "dagslot",
      minHorizonHours: 24,
      entries: [
        {
          model: "Trendvolger",
          predictions: [
            { key: "24u", predictedPct: 1 },
            { key: "1w", predictedPct: 3 },
            { key: "1m", predictedPct: 6 },
          ],
        },
      ],
    });
    let cur = arr;
    for (const [hrs] of [[24], [24 * 7], [24 * 30]] as const) {
      const t = T0 + hrs * H;
      cur = scoreForecasts(cur, { symbol: "NVDA", market: "stock", currentPrice: 102, priceAt: t }, t).arr;
    }
    const ov = getTrackingOverview("NVDA", "stock", cur, T0 + 24 * 30 * H);
    expect(ov.observations).toBe(1);
    expect(ov.horizonChecks).toBe(3);
  });

  it("10 modellen op één tijdstip blijven 1 onafhankelijke waarneming", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      model: `M${i}`,
      predictions: [{ key: "24u" as const, predictedPct: 1 }],
    }));
    const { arr } = log([], { entries });
    const later = T0 + 24 * H;
    const scored = scoreForecasts(arr, { symbol: "NVDA", market: "stock", currentPrice: 102, priceAt: later }, later).arr;
    const ov = getTrackingOverview("NVDA", "stock", scored, later);
    expect(ov.observations).toBe(1);
    expect(ov.horizonChecks).toBe(10);
  });

  it("onder MIN_SAMPLES blijft er geen percentage staan", () => {
    const logged = log([]).arr;
    const later = T0 + 24 * H;
    const { arr } = scoreForecasts(
      logged,
      { symbol: "NVDA", market: "stock", currentPrice: 103, priceAt: later },
      later,
    );
    const stats = getModelStats("NVDA", "stock", "24u", arr);
    expect(stats[0].samples).toBe(1);
    expect(stats[0].observations).toBe(1);
    expect(stats[0].sufficient).toBe(false);
    expect(MIN_SAMPLES).toBe(5);
  });
});

import { describe, expect, it } from "vitest";
import {
  appendForecasts,
  scoreForecasts,
  getHorizonSummary,
  getModelStats,
  getTrackingOverview,
  trackingLabel,
  MIN_SAMPLES,
  type LoggedForecast,
} from "./accuracy";

const H = 3_600_000;
const base = { symbol: "NVDA", market: "stock" as const, price: 100 };

function log(arr: LoggedForecast[], now: number, models = ["A", "B"], key = "24u" as const) {
  return appendForecasts(
    arr,
    { ...base, entries: models.map((model) => ({ model, predictions: [{ key, predictedPct: 1 }] })) },
    now,
  );
}

describe("logging", () => {
  it("logt per model en horizon", () => {
    const { arr, added } = log([], 0);
    expect(added).toBe(2);
    expect(arr).toHaveLength(2);
  });

  it("negeert vertraagde (stale) koersdata", () => {
    const { added } = appendForecasts(
      [],
      { ...base, stale: true, entries: [{ model: "A", predictions: [{ key: "24u", predictedPct: 1 }] }] },
      0,
    );
    expect(added).toBe(0);
  });

  it("herhaald refreshen levert geen extra observaties", () => {
    const first = log([], 0);
    const again = log(first.arr, 30 * 60_000); // 30 min later, horizon 24u
    expect(again.added).toBe(0);
    const later = log(first.arr, 13 * H); // > halve horizon
    expect(later.added).toBe(2);
  });
});

describe("scoren", () => {
  it("scoort binnen het meetvenster en niet ver daarna", () => {
    const { arr } = log([], 0);
    const early = scoreForecasts(arr, { ...base, currentPrice: 101 }, 10 * H);
    expect(early.changed).toBe(0); // horizon nog niet verstreken

    const ok = scoreForecasts(arr, { ...base, currentPrice: 101 }, 25 * H);
    expect(ok.changed).toBe(2);
    expect(getModelStats("NVDA", "stock", "24u", ok.arr)[0]?.samples).toBe(1);

    const late = scoreForecasts(arr, { ...base, currentPrice: 101 }, 200 * H);
    expect(getModelStats("NVDA", "stock", "24u", late.arr)).toHaveLength(0);
    expect(getHorizonSummary("NVDA", "stock", late.arr, 200 * H)[2].expired).toBe(2);
  });

  it("gebruikt het tijdstip van de koers, niet het kijkmoment", () => {
    const { arr } = log([], 0);
    const res = scoreForecasts(arr, { ...base, currentPrice: 101, priceAt: 25 * H }, 400 * H);
    expect(res.changed).toBe(2);
  });

  it("scoort niet met stale data", () => {
    const { arr } = log([], 0);
    const res = scoreForecasts(arr, { ...base, currentPrice: 101, stale: true }, 25 * H);
    expect(res.changed).toBe(0);
  });

  it("rekent richting juist/onjuist inclusief negatieve beweging", () => {
    const { arr } = log([], 0, ["A"]);
    const down = scoreForecasts(arr, { ...base, currentPrice: 95 }, 25 * H);
    expect(getModelStats("NVDA", "stock", "24u", down.arr)[0]?.hitRate).toBe(0);
  });
});

describe("tellingen", () => {
  it("telt 10 modellen op 1 tijdstip als 1 observatie", () => {
    const models = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const { arr } = log([], 0, models);
    const scored = scoreForecasts(arr, { ...base, currentPrice: 101 }, 25 * H).arr;
    const row = getHorizonSummary("NVDA", "stock", scored, 25 * H)[2];
    expect(row.observations).toBe(1);
    expect(row.modelChecks).toBe(10);
    expect(row.sufficient).toBe(false);
  });

  it("lopende voorspellingen zijn geen mislukte koersdownload", () => {
    const { arr } = log([], 0);
    const overview = getTrackingOverview("NVDA", "stock", arr, 2 * H);
    expect(overview.pending).toBe(2);
    expect(overview.observations).toBe(0);
    expect(trackingLabel(0)).toBe(`Nog niet getoetst (0/${MIN_SAMPLES} voorspellingen gecontroleerd)`);
    expect(trackingLabel(3)).toBe(`Nog weinig controles (3/${MIN_SAMPLES})`);
    expect(trackingLabel(MIN_SAMPLES)).toBe("");
  });

  it("voldoende pas bij MIN_SAMPLES unieke observaties", () => {
    let arr: LoggedForecast[] = [];
    for (let i = 0; i < MIN_SAMPLES; i++) {
      const t = i * 20 * H;
      arr = log(arr, t, ["A"]).arr;
      arr = scoreForecasts(arr, { ...base, currentPrice: 101 }, t + 25 * H).arr;
    }
    const row = getHorizonSummary("NVDA", "stock", arr, 200 * H)[2];
    expect(row.observations).toBe(MIN_SAMPLES);
    expect(row.sufficient).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  costBasisMismatch,
  findConflicts,
  parseBunqSnapshot,
  planImport,
  type ImportedPosition,
} from "./bunq-import";
import type { Position } from "./storage";

/** Testdata: fictieve waarden, geen persoonlijke gegevens. */
function snapshot(overrides: Record<string, unknown> = {}, positions?: unknown[]) {
  return JSON.stringify({
    format: "beursziener-bunq-snapshot/v1",
    source: "test",
    snapshotDate: "2026-01-02",
    snapshotTimeLocal: "12:00",
    currency: "EUR",
    notes: "test",
    bundleOverview: {
      valueEUR: 300,
      allTimeProfitEUR: 25,
      observedAtLocal: "2026-01-02T12:00:00",
      scope: "test",
    },
    positions:
      positions ?? [
        {
          name: "Nvidia",
          ticker: "NVDA",
          quantity: 2,
          positionValueEUR: 200,
          unrealizedPnLEUR: 40,
          costBasisEUR: 160,
          observedAtLocal: "2026-01-02T12:00:00",
        },
        {
          name: "S&P 500 ETF",
          ticker: null,
          quantity: 1.5,
          positionValueEUR: 100,
          unrealizedPnLEUR: -10,
          costBasisEUR: 110,
          observedAtLocal: "2026-01-02T12:00:00",
        },
      ],
    ...overrides,
  });
}

const pos = (p: Partial<ImportedPosition> = {}): ImportedPosition => ({
  id: "x",
  key: "k",
  name: "Nvidia",
  symbol: "NVDA",
  market: "stock",
  quantity: 1,
  snapshotValueEUR: 100,
  unrealizedPnLEUR: 10,
  costBasisEUR: 90,
  currency: "EUR",
  fxStatus: "eur-native",
  snapshotTimestamp: 1,
  observedAtLocal: "2026-01-02T12:00:00",
  snapshotDate: "2026-01-02",
  source: "test",
  importedAt: 1,
  warnings: [],
  ...p,
});

describe("parser", () => {
  it("accepteert het correcte formaat en rekent totalen", () => {
    const r = parseBunqSnapshot(snapshot());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.positions).toHaveLength(2);
    expect(r.totals.valueEUR).toBe(300);
    expect(r.totals.costBasisEUR).toBe(270);
    expect(r.totals.unrealizedPnLEUR).toBe(30);
    expect(r.totals.linked).toBe(1);
    expect(r.totals.unlinked).toBe(1);
  });

  it("bewaart ticker null als ongekoppeld, zonder gok", () => {
    const r = parseBunqSnapshot(snapshot());
    if (!r.ok) throw new Error("verwacht ok");
    const etf = r.positions.find((p) => p.name === "S&P 500 ETF")!;
    expect(etf.symbol).toBeNull();
    expect(etf.market).toBeNull();
    expect(etf.warnings.join(" ")).toContain("ongekoppeld");
  });

  it("staat negatieve ongerealiseerde winst toe", () => {
    const r = parseBunqSnapshot(snapshot());
    if (!r.ok) throw new Error("verwacht ok");
    expect(r.positions.find((p) => p.name === "S&P 500 ETF")!.unrealizedPnLEUR).toBe(-10);
  });

  it("weigert ongeldige JSON", () => {
    const r = parseBunqSnapshot("{niet json");
    expect(r.ok).toBe(false);
  });

  it("weigert verkeerd formaat en verkeerde valuta", () => {
    expect(parseBunqSnapshot(snapshot({ format: "iets-anders" })).ok).toBe(false);
    expect(parseBunqSnapshot(snapshot({ currency: "USD" })).ok).toBe(false);
  });

  it("weigert quantity <= 0, niet-finite en negatieve waarde", () => {
    const bad = (p: Record<string, unknown>) =>
      parseBunqSnapshot(
        snapshot({}, [
          {
            name: "X",
            ticker: "X",
            quantity: 1,
            positionValueEUR: 10,
            unrealizedPnLEUR: 0,
            costBasisEUR: 10,
            observedAtLocal: "2026-01-02T12:00:00",
            ...p,
          },
        ]),
      );
    expect(bad({ quantity: 0 }).ok).toBe(false);
    expect(bad({ positionValueEUR: -1 }).ok).toBe(false);
    expect(bad({ costBasisEUR: -1 }).ok).toBe(false);
    expect(bad({ observedAtLocal: "geen-datum" }).ok).toBe(false);
    expect(bad({ ticker: 5 }).ok).toBe(false);
  });

  it("weigert dubbele posities en lege lijst", () => {
    const dup = {
      name: "X",
      ticker: "X",
      quantity: 1,
      positionValueEUR: 10,
      unrealizedPnLEUR: 0,
      costBasisEUR: 10,
      observedAtLocal: "2026-01-02T12:00:00",
    };
    expect(parseBunqSnapshot(snapshot({}, [dup, { ...dup }])).ok).toBe(false);
    expect(parseBunqSnapshot(snapshot({}, [])).ok).toBe(false);
  });

  it("weigert te grote bestanden", () => {
    expect(parseBunqSnapshot(snapshot(), 2 * 1024 * 1024).ok).toBe(false);
  });

  it("waarschuwt bij kostprijs-discrepantie", () => {
    const r = parseBunqSnapshot(
      snapshot({}, [
        {
          name: "X",
          ticker: "X",
          quantity: 1,
          positionValueEUR: 100,
          unrealizedPnLEUR: 10,
          costBasisEUR: 80,
          observedAtLocal: "2026-01-02T12:00:00",
        },
      ]),
    );
    if (!r.ok) throw new Error("verwacht ok");
    expect(r.positions[0].warnings.join(" ")).toContain("Kostprijs");
  });

  it("costBasisMismatch respecteert afrondingstolerantie", () => {
    expect(costBasisMismatch(100, 10, 90.01).mismatch).toBe(false);
    expect(costBasisMismatch(100, 10, 85).mismatch).toBe(true);
  });
});

describe("conflicten en importplan", () => {
  const existing: Position[] = [
    { id: "p1", symbol: "NVDA", market: "stock", quantity: 1, avgPrice: 50, createdAt: 1 },
  ];

  it("herkent zekere match op ticker", () => {
    const c = findConflicts([pos({ key: "a" })], existing, []);
    expect(c).toHaveLength(1);
    expect(c[0].certainty).toBe("certain");
  });

  it("blokkeert import tot er een keuze is en telt nooit automatisch op", () => {
    const plan = planImport([pos({ key: "a" })], existing, [], {});
    expect(plan.undecided).toEqual(["a"]);
    expect(plan.nextImported).toHaveLength(0);
    expect(plan.removePositionIds).toEqual([]);
  });

  it("overslaan laat bestaande positie staan", () => {
    const plan = planImport([pos({ key: "a" })], existing, [], { a: "skip" });
    expect(plan.skippedKeys).toEqual(["a"]);
    expect(plan.nextImported).toHaveLength(0);
    expect(plan.removePositionIds).toEqual([]);
  });

  it("vervangen verwijdert de handmatige positie", () => {
    const plan = planImport([pos({ key: "a" })], existing, [], { a: "replace" });
    expect(plan.removePositionIds).toEqual(["p1"]);
    expect(plan.nextImported).toHaveLength(1);
  });

  it("herimport van hetzelfde bestand is idempotent", () => {
    const first = planImport([pos({ key: "a", symbol: null, market: null })], [], [], {});
    expect(first.nextImported).toHaveLength(1);
    const second = planImport([pos({ key: "a", symbol: null, market: null })], [], first.nextImported, {});
    expect(second.nextImported).toHaveLength(1);
    expect(second.undecided).toEqual([]);
  });

  it("ongekoppeld instrument met naamovereenkomst vraagt eerst om keuze", () => {
    const c = findConflicts([pos({ key: "b", name: "Alphabet Class A", symbol: null, market: null })], [
      { id: "p2", symbol: "GOOGL", market: "stock", quantity: 1, avgPrice: 100, createdAt: 1 },
      { id: "p3", symbol: "ALPHABET", market: "stock", quantity: 1, avgPrice: 100, createdAt: 1 },
    ]);
    expect(c[0].certainty).toBe("uncertain");
    const plan = planImport(
      [pos({ key: "b", name: "Alphabet Class A", symbol: null, market: null })],
      [{ id: "p3", symbol: "ALPHABET", market: "stock", quantity: 1, avgPrice: 100, createdAt: 1 }],
      [],
      {},
    );
    expect(plan.undecided).toEqual(["b"]);
  });

  it("kosten, open P&L en bundelwinst blijven gescheiden", () => {
    const r = parseBunqSnapshot(snapshot());
    if (!r.ok) throw new Error("verwacht ok");
    expect(r.meta.bundleOverview.allTimeProfitEUR).toBe(25);
    expect(r.totals.unrealizedPnLEUR).not.toBe(r.meta.bundleOverview.allTimeProfitEUR);
    expect(r.totals.costBasisEUR).not.toBe(r.totals.valueEUR);
  });
});

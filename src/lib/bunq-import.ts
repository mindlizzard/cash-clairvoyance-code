/**
 * Volledig client-side parser + importplanner voor een lokaal gekozen
 * bunq-snapshotbestand (formaat "beursziener-bunq-snapshot/v1").
 *
 * Deze module doet GEEN netwerkverkeer en bevat GEEN persoonlijke waarden.
 * Alle gegevens komen uit het bestand dat de gebruiker zelf op zijn apparaat kiest.
 */

import type { Market, Position } from "./storage";

export const BUNQ_SNAPSHOT_FORMAT = "beursziener-bunq-snapshot/v1";
export const MAX_IMPORT_BYTES = 1024 * 1024; // 1 MB

/* ---------------- Types ---------------- */

export type FxStatus = "eur-native" | "unverified";

export type ImportedPosition = {
  id: string;
  /** Sleutel voor idempotentie: zelfde bestand → zelfde key → nooit dubbel. */
  key: string;
  name: string;
  /** null = expliciet ongekoppeld / onbekend instrument (geen ticker-gok). */
  symbol: string | null;
  market: Market | null;
  quantity: number;
  snapshotValueEUR: number;
  unrealizedPnLEUR: number;
  costBasisEUR: number;
  currency: "EUR";
  fxStatus: FxStatus;
  /** ms timestamp uit observedAtLocal. */
  snapshotTimestamp: number;
  /** Ruwe lokale tijdnotatie uit het bestand. */
  observedAtLocal: string;
  snapshotDate: string;
  source: string;
  importedAt: number;
  /** Waarschuwingen per positie (bv. kostprijs-discrepantie). */
  warnings: string[];
};

export type BundleOverview = {
  valueEUR: number;
  allTimeProfitEUR: number;
  observedAtLocal: string;
  scope: string;
};

export type SnapshotMeta = {
  format: string;
  source: string;
  snapshotDate: string;
  snapshotTimeLocal: string;
  currency: "EUR";
  notes: string;
  bundleOverview: BundleOverview;
};

export type ParseOk = {
  ok: true;
  meta: SnapshotMeta;
  positions: ImportedPosition[];
  warnings: string[];
  totals: {
    count: number;
    linked: number;
    unlinked: number;
    valueEUR: number;
    costBasisEUR: number;
    unrealizedPnLEUR: number;
  };
};

export type ParseFail = { ok: false; errors: string[] };
export type ParseResult = ParseOk | ParseFail;

/* ---------------- Hulpfuncties ---------------- */

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function parseLocalDate(v: string): number | null {
  const t = Date.parse(v);
  if (Number.isFinite(t)) return t;
  // "2026-09-17 14:03" varianten
  const t2 = Date.parse(v.replace(" ", "T"));
  return Number.isFinite(t2) ? t2 : null;
}

/** Tolerantie voor kostprijs ≈ waarde − ongerealiseerde winst. */
export function costBasisMismatch(
  positionValueEUR: number,
  unrealizedPnLEUR: number,
  costBasisEUR: number,
): { mismatch: boolean; diff: number; tolerance: number } {
  const expected = positionValueEUR - unrealizedPnLEUR;
  const diff = costBasisEUR - expected;
  const tolerance = Math.max(0.02, Math.abs(expected) * 0.005);
  return { mismatch: Math.abs(diff) > tolerance, diff, tolerance };
}

export function positionKey(name: string, ticker: string | null, snapshotDate: string): string {
  return `${snapshotDate}|${(ticker ?? "").toUpperCase()}|${name.trim().toLowerCase()}`;
}

function makeId(key: string): string {
  // Deterministisch id op basis van de key → herimport overschrijft in plaats van dupliceren.
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `bunq-${(h >>> 0).toString(36)}`;
}

/* ---------------- Parser ---------------- */

export function parseBunqSnapshot(rawText: string, byteSize?: number): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const size = byteSize ?? rawText.length;
  if (size > MAX_IMPORT_BYTES) {
    return { ok: false, errors: [`Bestand is te groot (max ${Math.round(MAX_IMPORT_BYTES / 1024)} kB).`] };
  }

  let root: unknown;
  try {
    root = JSON.parse(rawText);
  } catch {
    return { ok: false, errors: ["Dit is geen geldig JSON-bestand."] };
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    return { ok: false, errors: ["Onverwachte structuur: het bestand moet een JSON-object zijn."] };
  }
  const r = root as Record<string, unknown>;

  if (r.format !== BUNQ_SNAPSHOT_FORMAT) {
    return {
      ok: false,
      errors: [`Onbekend formaat. Alleen "${BUNQ_SNAPSHOT_FORMAT}" wordt geaccepteerd.`],
    };
  }
  if (r.currency !== "EUR") {
    return { ok: false, errors: ['Alleen valuta "EUR" wordt geaccepteerd.'] };
  }
  if (!isStr(r.source)) errors.push('Veld "source" ontbreekt of is geen tekst.');
  if (!isStr(r.snapshotDate)) errors.push('Veld "snapshotDate" ontbreekt of is geen tekst.');
  if (!isStr(r.snapshotTimeLocal)) errors.push('Veld "snapshotTimeLocal" ontbreekt of is geen tekst.');
  if (!isStr(r.notes)) warnings.push('Veld "notes" ontbreekt.');

  const bo = r.bundleOverview as Record<string, unknown> | undefined;
  if (!bo || typeof bo !== "object" || Array.isArray(bo)) {
    errors.push('Veld "bundleOverview" ontbreekt.');
  } else {
    if (!isFiniteNum(bo.valueEUR) || bo.valueEUR < 0) errors.push("bundleOverview.valueEUR is ongeldig.");
    if (!isFiniteNum(bo.allTimeProfitEUR)) errors.push("bundleOverview.allTimeProfitEUR is ongeldig.");
    if (!isStr(bo.observedAtLocal)) errors.push("bundleOverview.observedAtLocal is ongeldig.");
    if (!isStr(bo.scope)) errors.push("bundleOverview.scope is ongeldig.");
  }

  if (!Array.isArray(r.positions) || r.positions.length === 0) {
    errors.push('Veld "positions" moet een niet-lege lijst zijn.');
  }

  if (errors.length) return { ok: false, errors };

  const snapshotDate = r.snapshotDate as string;
  const rawPositions = r.positions as unknown[];
  const importedAt = Date.now();
  const seen = new Set<string>();
  const positions: ImportedPosition[] = [];

  rawPositions.forEach((item, i) => {
    const label = `Positie ${i + 1}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      errors.push(`${label}: geen geldig object.`);
      return;
    }
    const p = item as Record<string, unknown>;
    const pw: string[] = [];

    if (!isStr(p.name) || !p.name.trim()) {
      errors.push(`${label}: "name" ontbreekt.`);
      return;
    }
    const name = p.name.trim();

    let ticker: string | null = null;
    if (p.ticker === null || p.ticker === undefined) {
      ticker = null;
    } else if (isStr(p.ticker) && p.ticker.trim()) {
      ticker = p.ticker.trim().toUpperCase();
    } else {
      errors.push(`${name}: "ticker" moet tekst of null zijn.`);
      return;
    }

    if (!isFiniteNum(p.quantity) || p.quantity <= 0) {
      errors.push(`${name}: "quantity" moet een getal groter dan 0 zijn.`);
      return;
    }
    if (!isFiniteNum(p.positionValueEUR) || p.positionValueEUR < 0) {
      errors.push(`${name}: "positionValueEUR" moet 0 of hoger zijn.`);
      return;
    }
    if (!isFiniteNum(p.unrealizedPnLEUR)) {
      errors.push(`${name}: "unrealizedPnLEUR" moet een getal zijn (negatief mag).`);
      return;
    }
    if (!isFiniteNum(p.costBasisEUR) || p.costBasisEUR < 0) {
      errors.push(`${name}: "costBasisEUR" moet 0 of hoger zijn.`);
      return;
    }
    if (!isStr(p.observedAtLocal)) {
      errors.push(`${name}: "observedAtLocal" ontbreekt.`);
      return;
    }
    const ts = parseLocalDate(p.observedAtLocal);
    if (ts === null) {
      errors.push(`${name}: "observedAtLocal" is geen geldige datum/tijd.`);
      return;
    }

    const key = positionKey(name, ticker, snapshotDate);
    if (seen.has(key)) {
      errors.push(`${name}: staat dubbel in het bestand.`);
      return;
    }
    seen.add(key);

    const cb = costBasisMismatch(p.positionValueEUR, p.unrealizedPnLEUR, p.costBasisEUR);
    if (cb.mismatch) {
      pw.push(
        `Kostprijs wijkt €${Math.abs(cb.diff).toFixed(2)} af van waarde − ongerealiseerde winst. Snapshot wordt bewaard zoals in het bestand.`,
      );
    }
    if (!ticker) {
      pw.push("Geen ticker: bewaard als ongekoppeld instrument, zonder live koers.");
    }

    positions.push({
      id: makeId(key),
      key,
      name,
      symbol: ticker,
      market: ticker ? "stock" : null,
      quantity: p.quantity,
      snapshotValueEUR: p.positionValueEUR,
      unrealizedPnLEUR: p.unrealizedPnLEUR,
      costBasisEUR: p.costBasisEUR,
      currency: "EUR",
      fxStatus: "eur-native",
      snapshotTimestamp: ts,
      observedAtLocal: p.observedAtLocal,
      snapshotDate,
      source: r.source as string,
      importedAt,
      warnings: pw,
    });
  });

  if (errors.length) return { ok: false, errors };

  const totals = positions.reduce(
    (a, p) => ({
      count: a.count + 1,
      linked: a.linked + (p.symbol ? 1 : 0),
      unlinked: a.unlinked + (p.symbol ? 0 : 1),
      valueEUR: a.valueEUR + p.snapshotValueEUR,
      costBasisEUR: a.costBasisEUR + p.costBasisEUR,
      unrealizedPnLEUR: a.unrealizedPnLEUR + p.unrealizedPnLEUR,
    }),
    { count: 0, linked: 0, unlinked: 0, valueEUR: 0, costBasisEUR: 0, unrealizedPnLEUR: 0 },
  );

  const bundle = r.bundleOverview as unknown as BundleOverview;
  const bundleDiff = totals.valueEUR - bundle.valueEUR;
  if (Math.abs(bundleDiff) > Math.max(0.05, Math.abs(bundle.valueEUR) * 0.005)) {
    warnings.push(
      `Som van posities (€${totals.valueEUR.toFixed(2)}) wijkt €${Math.abs(bundleDiff).toFixed(2)} af van het bundeloverzicht (€${bundle.valueEUR.toFixed(2)}).`,
    );
  }
  if (totals.unlinked > 0) {
    warnings.push(
      `${totals.unlinked} instrument(en) zonder ticker worden als "niet live gekoppeld" bewaard, met de snapshotwaarde.`,
    );
  }
  const withMismatch = positions.filter((p) => p.warnings.some((w) => w.startsWith("Kostprijs")));
  if (withMismatch.length) {
    warnings.push(`${withMismatch.length} positie(s) met een afwijking tussen kostprijs en waarde − winst.`);
  }

  return {
    ok: true,
    meta: {
      format: BUNQ_SNAPSHOT_FORMAT,
      source: r.source as string,
      snapshotDate,
      snapshotTimeLocal: r.snapshotTimeLocal as string,
      currency: "EUR",
      notes: isStr(r.notes) ? r.notes : "",
      bundleOverview: bundle,
    },
    positions,
    warnings,
    totals,
  };
}

/* ---------------- Conflicten & importplan ---------------- */

export type ConflictChoice = "skip" | "replace";

export type Conflict = {
  key: string;
  name: string;
  symbol: string | null;
  /** "certain" = zelfde ticker; "uncertain" = mogelijk dezelfde belegging op naam. */
  certainty: "certain" | "uncertain";
  /** Bestaande handmatige posities die overlappen. */
  existing: Position[];
  /** Bestaat deze importpositie al (zelfde bestand opnieuw)? */
  alreadyImported: boolean;
};

/**
 * Bepaalt overlap met handmatig ingevoerde posities.
 * Ongekoppelde instrumenten (ticker null) matchen alleen "uncertain" op naam.
 */
export function findConflicts(
  incoming: ImportedPosition[],
  existingPortfolio: Position[],
  existingImported: ImportedPosition[] = [],
): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const p of incoming) {
    const alreadyImported = existingImported.some((e) => e.key === p.key);
    let existing: Position[] = [];
    let certainty: "certain" | "uncertain" = "certain";
    if (p.symbol) {
      existing = existingPortfolio.filter((e) => e.symbol.toUpperCase() === p.symbol!.toUpperCase());
    } else {
      const upperName = p.name.toUpperCase();
      existing = existingPortfolio.filter((e) => {
        const s = e.symbol.toUpperCase();
        return s.length >= 2 && upperName.includes(s);
      });
      certainty = "uncertain";
    }
    if (existing.length || alreadyImported) {
      conflicts.push({ key: p.key, name: p.name, symbol: p.symbol, certainty, existing, alreadyImported });
    }
  }
  return conflicts;
}

export type ImportPlan = {
  /** Nieuwe volledige lijst met importposities (idempotent samengevoegd). */
  nextImported: ImportedPosition[];
  /** Handmatige posities die de gebruiker expliciet wil laten vervangen. */
  removePositionIds: string[];
  /** Importposities die overgeslagen worden. */
  skippedKeys: string[];
  /** Conflicten waarvoor nog geen keuze is gemaakt → import geblokkeerd. */
  undecided: string[];
};

/**
 * Bouwt het importplan. Standaard is "skip": nooit automatisch optellen.
 * Onzekere matches vereisen een expliciete keuze van de gebruiker.
 */
export function planImport(
  incoming: ImportedPosition[],
  existingPortfolio: Position[],
  existingImported: ImportedPosition[],
  decisions: Record<string, ConflictChoice | undefined>,
): ImportPlan {
  const conflicts = findConflicts(incoming, existingPortfolio, existingImported);
  const byKey = new Map(conflicts.map((c) => [c.key, c]));

  const undecided: string[] = [];
  const skippedKeys: string[] = [];
  const removePositionIds: string[] = [];
  const accepted: ImportedPosition[] = [];

  for (const p of incoming) {
    const c = byKey.get(p.key);
    if (!c) {
      accepted.push(p);
      continue;
    }
    if (c.alreadyImported && !c.existing.length) {
      // Herimport van hetzelfde bestand: vervang op key, geen dubbeltelling.
      accepted.push(p);
      continue;
    }
    const choice = decisions[p.key];
    if (!choice) {
      undecided.push(p.key);
      continue;
    }
    if (choice === "skip") {
      skippedKeys.push(p.key);
      continue;
    }
    // replace: handmatige overlap verwijderen, importpositie overnemen
    for (const e of c.existing) removePositionIds.push(e.id);
    accepted.push(p);
  }

  const merged = new Map<string, ImportedPosition>();
  for (const e of existingImported) merged.set(e.key, e);
  for (const a of accepted) merged.set(a.key, a);

  return {
    nextImported: [...merged.values()],
    removePositionIds,
    skippedKeys,
    undecided,
  };
}

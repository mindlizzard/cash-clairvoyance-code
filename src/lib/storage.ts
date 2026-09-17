import { useEffect, useState } from "react";

export type Market = "stock" | "crypto";

export type WatchItem = {
  symbol: string;
  market: Market;
  addedAt: number;
};

export type Position = {
  id: string;
  symbol: string;
  market: Market;
  quantity: number;
  avgPrice: number;
  createdAt: number;
};

export type AlertRule = {
  id: string;
  symbol: string;
  market: Market;
  type: "price-above" | "price-below" | "rsi-above" | "rsi-below";
  value: number;
  createdAt: number;
  triggeredAt?: number;
};

/** Meta van de laatst toegepaste bunq-snapshotimport (geen persoonlijke bedragen buiten localStorage). */
export type ImportMeta = {
  source: string;
  snapshotDate: string;
  snapshotTimeLocal: string;
  bundleValueEUR: number;
  bundleAllTimeProfitEUR: number;
  bundleObservedAtLocal: string;
  scope: string;
  importedAt: number;
};

export type Store = {
  watchlist: WatchItem[];
  portfolio: Position[];
  alerts: AlertRule[];
  /** Parallel importmodel: raakt handmatige posities, alerts en watchlist niet aan. */
  imported: ImportedPositionRecord[];
  importMeta: ImportMeta | null;
};

/** Losse structuur zodat storage niet van bunq-import hoeft te importeren (voorkomt cyclus). */
export type ImportedPositionRecord = {
  id: string;
  key: string;
  name: string;
  symbol: string | null;
  market: Market | null;
  quantity: number;
  snapshotValueEUR: number;
  unrealizedPnLEUR: number;
  costBasisEUR: number;
  currency: "EUR";
  fxStatus: "eur-native" | "unverified";
  snapshotTimestamp: number;
  observedAtLocal: string;
  snapshotDate: string;
  source: string;
  importedAt: number;
  warnings: string[];
};

const KEY = "beursziener.v1";
const EVENT = "beursziener-store";
const empty: Store = { watchlist: [], portfolio: [], alerts: [], imported: [], importMeta: null };

function read(): Store {
  if (typeof window === "undefined") return empty;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      portfolio: Array.isArray(parsed.portfolio) ? parsed.portfolio : [],
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
      imported: Array.isArray(parsed.imported) ? parsed.imported : [],
      importMeta: parsed.importMeta && typeof parsed.importMeta === "object" ? parsed.importMeta : null,
    };
  } catch {
    return empty;
  }
}

export function readStore(): Store {
  return read();
}

function write(s: Store) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new Event(EVENT));
}

function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function useStore(): Store {
  const [s, setS] = useState<Store>(empty);
  useEffect(() => {
    setS(read());
    const h = () => setS(read());
    window.addEventListener(EVENT, h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener(EVENT, h);
      window.removeEventListener("storage", h);
    };
  }, []);
  return s;
}

export const store = {
  addWatch(item: { symbol: string; market: Market }) {
    const s = read();
    if (!s.watchlist.find((w) => w.symbol === item.symbol && w.market === item.market)) {
      s.watchlist.push({ ...item, addedAt: Date.now() });
      write(s);
    }
  },
  removeWatch(symbol: string, market: Market) {
    const s = read();
    s.watchlist = s.watchlist.filter((w) => !(w.symbol === symbol && w.market === market));
    write(s);
  },
  addPosition(p: { symbol: string; market: Market; quantity: number; avgPrice: number }) {
    const s = read();
    s.portfolio.push({ ...p, id: uid(), createdAt: Date.now() });
    write(s);
  },
  removePosition(id: string) {
    const s = read();
    s.portfolio = s.portfolio.filter((p) => p.id !== id);
    write(s);
  },
  addAlert(a: { symbol: string; market: Market; type: AlertRule["type"]; value: number }) {
    const s = read();
    s.alerts.push({ ...a, id: uid(), createdAt: Date.now() });
    write(s);
  },
  removeAlert(id: string) {
    const s = read();
    s.alerts = s.alerts.filter((a) => a.id !== id);
    write(s);
  },
  markTriggered(id: string) {
    const s = read();
    const a = s.alerts.find((x) => x.id === id);
    if (a) {
      a.triggeredAt = Date.now();
      write(s);
    }
  },
  resetAlertTrigger(id: string) {
    const s = read();
    const a = s.alerts.find((x) => x.id === id);
    if (a) {
      delete a.triggeredAt;
      write(s);
    }
  },

  /** Atomair: import + eventuele vervangingen in één schrijfactie, of niets. */
  applyImport(next: ImportedPositionRecord[], meta: ImportMeta, removePositionIds: string[] = []) {
    const s = read();
    const updated: Store = {
      ...s,
      portfolio: removePositionIds.length
        ? s.portfolio.filter((p) => !removePositionIds.includes(p.id))
        : s.portfolio,
      imported: next,
      importMeta: meta,
    };
    write(updated);
  },
  removeImported(id: string) {
    const s = read();
    s.imported = s.imported.filter((p) => p.id !== id);
    write(s);
  },
  clearImported() {
    const s = read();
    s.imported = [];
    s.importMeta = null;
    write(s);
  },
  /** Volledige lokale data als JSON-tekst (backup vóór import). */
  exportBackup(): string {
    return JSON.stringify({ format: "beursziener-backup/v1", createdAt: Date.now(), store: read() }, null, 2);
  },
  /** Herstel uit een eerdere backup. Geeft false bij ongeldige backup; schrijft dan niets. */
  restoreBackup(text: string): boolean {
    try {
      const parsed = JSON.parse(text);
      const s = parsed?.format === "beursziener-backup/v1" ? parsed.store : parsed;
      if (!s || typeof s !== "object") return false;
      const next: Store = {
        watchlist: Array.isArray(s.watchlist) ? s.watchlist : [],
        portfolio: Array.isArray(s.portfolio) ? s.portfolio : [],
        alerts: Array.isArray(s.alerts) ? s.alerts : [],
        imported: Array.isArray(s.imported) ? s.imported : [],
        importMeta: s.importMeta && typeof s.importMeta === "object" ? s.importMeta : null,
      };
      write(next);
      return true;
    } catch {
      return false;
    }
  },
};

export function checkAlert(
  alert: AlertRule,
  data: { price: number; rsi: number | null },
): boolean {
  switch (alert.type) {
    case "price-above":
      return data.price >= alert.value;
    case "price-below":
      return data.price <= alert.value;
    case "rsi-above":
      return data.rsi != null && data.rsi >= alert.value;
    case "rsi-below":
      return data.rsi != null && data.rsi <= alert.value;
  }
}
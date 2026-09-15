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
  feesPaid: number;
  openedAt: number;
  createdAt: number;
  updatedAt: number;
};

export type ClosedPosition = {
  id: string;
  sourcePositionId: string;
  symbol: string;
  market: Market;
  quantity: number;
  avgPrice: number;
  exitPrice: number;
  entryFees: number;
  exitFees: number;
  realizedPnl: number;
  openedAt: number;
  closedAt: number;
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

export type Store = {
  watchlist: WatchItem[];
  portfolio: Position[];
  history: ClosedPosition[];
  alerts: AlertRule[];
};

const KEY = "beursziener.v1";
const EVENT = "beursziener-store";
const empty: Store = { watchlist: [], portfolio: [], history: [], alerts: [] };

function finite(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSymbol(symbol: string, market: Market) {
  const s = symbol.trim();
  return market === "stock" ? s.toUpperCase() : s.toLowerCase();
}

function read(): Store {
  if (typeof window === "undefined") return empty;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);

    const portfolio: Position[] = Array.isArray(parsed.portfolio)
      ? parsed.portfolio
          .map((p: any) => {
            const createdAt = finite(p.createdAt, Date.now());
            return {
              id: String(p.id ?? uid()),
              symbol: normalizeSymbol(String(p.symbol ?? ""), p.market === "crypto" ? "crypto" : "stock"),
              market: p.market === "crypto" ? "crypto" : "stock",
              quantity: finite(p.quantity),
              avgPrice: finite(p.avgPrice),
              feesPaid: finite(p.feesPaid),
              openedAt: finite(p.openedAt, createdAt),
              createdAt,
              updatedAt: finite(p.updatedAt, createdAt),
            } as Position;
          })
          .filter((p: Position) => p.symbol && p.quantity > 0 && p.avgPrice >= 0)
      : [];

    const history: ClosedPosition[] = Array.isArray(parsed.history)
      ? parsed.history
          .map((h: any) => ({
            id: String(h.id ?? uid()),
            sourcePositionId: String(h.sourcePositionId ?? ""),
            symbol: normalizeSymbol(String(h.symbol ?? ""), h.market === "crypto" ? "crypto" : "stock"),
            market: h.market === "crypto" ? "crypto" : "stock",
            quantity: finite(h.quantity),
            avgPrice: finite(h.avgPrice),
            exitPrice: finite(h.exitPrice),
            entryFees: finite(h.entryFees),
            exitFees: finite(h.exitFees),
            realizedPnl: finite(h.realizedPnl),
            openedAt: finite(h.openedAt, Date.now()),
            closedAt: finite(h.closedAt, Date.now()),
          }))
          .filter((h: ClosedPosition) => h.symbol && h.quantity > 0)
      : [];

    return {
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      portfolio,
      history,
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
    };
  } catch {
    return empty;
  }
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
    const symbol = normalizeSymbol(item.symbol, item.market);
    if (!s.watchlist.find((w) => normalizeSymbol(w.symbol, w.market) === symbol && w.market === item.market)) {
      s.watchlist.push({ symbol, market: item.market, addedAt: Date.now() });
      write(s);
    }
  },

  removeWatch(symbol: string, market: Market) {
    const s = read();
    const normalized = normalizeSymbol(symbol, market);
    s.watchlist = s.watchlist.filter(
      (w) => !(normalizeSymbol(w.symbol, w.market) === normalized && w.market === market),
    );
    write(s);
  },

  addPosition(p: {
    symbol: string;
    market: Market;
    quantity: number;
    avgPrice: number;
    feesPaid?: number;
    openedAt?: number;
  }) {
    const quantity = finite(p.quantity);
    const avgPrice = finite(p.avgPrice);
    const feesPaid = Math.max(0, finite(p.feesPaid));
    if (!(quantity > 0) || !(avgPrice >= 0)) return;

    const s = read();
    const symbol = normalizeSymbol(p.symbol, p.market);
    const existing = s.portfolio.find(
      (x) => x.market === p.market && normalizeSymbol(x.symbol, x.market) === symbol,
    );

    if (existing) {
      const oldCost = existing.quantity * existing.avgPrice;
      const newCost = quantity * avgPrice;
      const totalQty = existing.quantity + quantity;
      existing.avgPrice = totalQty > 0 ? (oldCost + newCost) / totalQty : avgPrice;
      existing.quantity = totalQty;
      existing.feesPaid += feesPaid;
      existing.openedAt = Math.min(existing.openedAt, p.openedAt ?? Date.now());
      existing.updatedAt = Date.now();
    } else {
      const now = Date.now();
      s.portfolio.push({
        id: uid(),
        symbol,
        market: p.market,
        quantity,
        avgPrice,
        feesPaid,
        openedAt: p.openedAt ?? now,
        createdAt: now,
        updatedAt: now,
      });
    }
    write(s);
  },

  buyMore(id: string, quantity: number, price: number, fee = 0) {
    const s = read();
    const p = s.portfolio.find((x) => x.id === id);
    const q = finite(quantity);
    const px = finite(price);
    const f = Math.max(0, finite(fee));
    if (!p || !(q > 0) || !(px >= 0)) return;

    const totalQty = p.quantity + q;
    p.avgPrice = totalQty > 0 ? (p.quantity * p.avgPrice + q * px) / totalQty : px;
    p.quantity = totalQty;
    p.feesPaid += f;
    p.updatedAt = Date.now();
    write(s);
  },

  editPosition(
    id: string,
    patch: Partial<Pick<Position, "quantity" | "avgPrice" | "feesPaid" | "openedAt">>,
  ) {
    const s = read();
    const p = s.portfolio.find((x) => x.id === id);
    if (!p) return;

    if (patch.quantity != null && finite(patch.quantity) > 0) p.quantity = finite(patch.quantity);
    if (patch.avgPrice != null && finite(patch.avgPrice) >= 0) p.avgPrice = finite(patch.avgPrice);
    if (patch.feesPaid != null && finite(patch.feesPaid) >= 0) p.feesPaid = finite(patch.feesPaid);
    if (patch.openedAt != null && finite(patch.openedAt) > 0) p.openedAt = finite(patch.openedAt);
    p.updatedAt = Date.now();
    write(s);
  },

  sellPosition(id: string, quantity: number, exitPrice: number, exitFees = 0) {
    const s = read();
    const p = s.portfolio.find((x) => x.id === id);
    if (!p) return;

    const q = Math.min(p.quantity, finite(quantity));
    const px = finite(exitPrice);
    const sellFees = Math.max(0, finite(exitFees));
    if (!(q > 0) || !(px >= 0)) return;

    const fraction = q / p.quantity;
    const entryFees = p.feesPaid * fraction;
    const realizedPnl = (px - p.avgPrice) * q - entryFees - sellFees;

    s.history.unshift({
      id: uid(),
      sourcePositionId: p.id,
      symbol: p.symbol,
      market: p.market,
      quantity: q,
      avgPrice: p.avgPrice,
      exitPrice: px,
      entryFees,
      exitFees: sellFees,
      realizedPnl,
      openedAt: p.openedAt,
      closedAt: Date.now(),
    });

    if (q >= p.quantity - 1e-12) {
      s.portfolio = s.portfolio.filter((x) => x.id !== p.id);
    } else {
      p.quantity -= q;
      p.feesPaid = Math.max(0, p.feesPaid - entryFees);
      p.updatedAt = Date.now();
    }

    write(s);
  },

  removePosition(id: string) {
    const s = read();
    s.portfolio = s.portfolio.filter((p) => p.id !== id);
    write(s);
  },

  removeHistory(id: string) {
    const s = read();
    s.history = s.history.filter((h) => h.id !== id);
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

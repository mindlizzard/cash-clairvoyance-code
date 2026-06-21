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

export type Store = {
  watchlist: WatchItem[];
  portfolio: Position[];
  alerts: AlertRule[];
};

const KEY = "beursziener.v1";
const EVENT = "beursziener-store";
const empty: Store = { watchlist: [], portfolio: [], alerts: [] };

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
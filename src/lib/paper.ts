/**
 * Paper trading: handelsplannen virtueel uitvoeren en het resultaat meten.
 * Alles lokaal in de browser. Geen echte orders, geen winstgarantie.
 */

import { useEffect, useState } from "react";

const KEY = "beursziener:paper:v1";
const EVENT = "beursziener-paper";

export type PaperTrade = {
  id: string;
  symbol: string;
  market: "stock" | "crypto";
  direction: "long" | "short";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  quantity: number;
  costPct: number; // fees + slippage, heen en terug
  openedAt: number;
  status: "open" | "closed";
  tp1Hit: boolean;
  lastPrice: number;
  maxFavorablePct: number;
  maxAdversePct: number;
  closedAt?: number;
  exitPrice?: number;
  exitReason?: "stop-loss" | "take profit 1" | "take profit 2" | "handmatig";
  returnPct?: number;
};

function read(): PaperTrade[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function write(arr: PaperTrade[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(arr.slice(-300)));
  window.dispatchEvent(new Event(EVENT));
}

function grossPct(t: PaperTrade, price: number) {
  const raw = ((price - t.entry) / t.entry) * 100;
  return t.direction === "long" ? raw : -raw;
}

export function openPaperTrade(t: {
  symbol: string;
  market: "stock" | "crypto";
  direction: "long" | "short";
  entry: number;
  stop: number;
  tp1: number;
  tp2: number;
  quantity: number;
  costPct: number;
}) {
  const arr = read();
  arr.push({
    ...t,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    openedAt: Date.now(),
    status: "open",
    tp1Hit: false,
    lastPrice: t.entry,
    maxFavorablePct: 0,
    maxAdversePct: 0,
  });
  write(arr);
}

export function closePaperTrade(
  id: string,
  price: number,
  reason: PaperTrade["exitReason"] = "handmatig",
) {
  const arr = read();
  const t = arr.find((x) => x.id === id);
  if (!t || t.status === "closed") return;
  t.status = "closed";
  t.closedAt = Date.now();
  t.exitPrice = price;
  t.exitReason = reason;
  t.lastPrice = price;
  t.returnPct = grossPct(t, price) - t.costPct;
  write(arr);
}

export function removePaperTrade(id: string) {
  write(read().filter((t) => t.id !== id));
}

/** Werk open trades bij met de nieuwste koers; sluit bij stop of TP2. */
export function updatePaperTrades(symbol: string, market: "stock" | "crypto", price: number) {
  if (typeof window === "undefined" || !price) return;
  const arr = read();
  const sym = symbol.toUpperCase();
  let changed = false;
  for (const t of arr) {
    if (t.status !== "open" || t.symbol.toUpperCase() !== sym || t.market !== market) continue;
    const g = grossPct(t, price);
    t.lastPrice = price;
    t.maxFavorablePct = Math.max(t.maxFavorablePct, g);
    t.maxAdversePct = Math.min(t.maxAdversePct, g);
    changed = true;
    const hitStop = t.direction === "long" ? price <= t.stop : price >= t.stop;
    const hitTp2 = t.direction === "long" ? price >= t.tp2 : price <= t.tp2;
    const hitTp1 = t.direction === "long" ? price >= t.tp1 : price <= t.tp1;
    if (hitTp1) t.tp1Hit = true;
    if (hitStop) {
      t.status = "closed";
      t.closedAt = Date.now();
      t.exitPrice = t.stop;
      t.exitReason = "stop-loss";
      t.returnPct = grossPct(t, t.stop) - t.costPct;
    } else if (hitTp2) {
      t.status = "closed";
      t.closedAt = Date.now();
      t.exitPrice = t.tp2;
      t.exitReason = "take profit 2";
      t.returnPct = grossPct(t, t.tp2) - t.costPct;
    }
  }
  if (changed) write(arr);
}

export function usePaperTrades(): PaperTrade[] {
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  useEffect(() => {
    const sync = () => setTrades(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return trades;
}

export type PaperStats = {
  open: number;
  closed: number;
  winRate: number | null;
  profitFactor: number | null;
  avgReturnPct: number | null;
  expectancyPct: number | null;
  maxDrawdownPct: number;
  totalReturnPct: number;
};

export function paperStats(trades: PaperTrade[]): PaperStats {
  const closed = trades.filter((t) => t.status === "closed" && t.returnPct != null);
  const open = trades.filter((t) => t.status === "open").length;
  if (!closed.length) {
    return {
      open,
      closed: 0,
      winRate: null,
      profitFactor: null,
      avgReturnPct: null,
      expectancyPct: null,
      maxDrawdownPct: 0,
      totalReturnPct: 0,
    };
  }
  const rets = closed
    .slice()
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))
    .map((t) => t.returnPct as number);
  const wins = rets.filter((r) => r > 0);
  const losses = rets.filter((r) => r <= 0);
  const grossWin = wins.reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r, 0));
  const winRate = (wins.length / rets.length) * 100;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  let cum = 0;
  let peak = 0;
  let maxDD = 0;
  for (const r of rets) {
    cum += r;
    peak = Math.max(peak, cum);
    maxDD = Math.min(maxDD, cum - peak);
  }
  return {
    open,
    closed: rets.length,
    winRate,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgReturnPct: rets.reduce((s, r) => s + r, 0) / rets.length,
    expectancyPct: (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss,
    maxDrawdownPct: Math.abs(maxDD),
    totalReturnPct: cum,
  };
}

/** Positie-sizing: hoeveel stuks passen binnen het gekozen risico per trade? */
export function positionSize(args: {
  portfolio: number;
  riskPct: number;
  entry: number;
  stop: number;
}) {
  const riskAmount = (args.portfolio * args.riskPct) / 100;
  const perUnit = Math.abs(args.entry - args.stop);
  if (!(riskAmount > 0) || !(perUnit > 0) || !(args.entry > 0)) {
    return { riskAmount, perUnit, quantity: 0, exposure: 0, exposurePct: 0 };
  }
  const quantity = riskAmount / perUnit;
  const exposure = quantity * args.entry;
  return {
    riskAmount,
    perUnit,
    quantity,
    exposure,
    exposurePct: (exposure / args.portfolio) * 100,
  };
}

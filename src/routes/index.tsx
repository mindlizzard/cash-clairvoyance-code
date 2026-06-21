import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Area,
  ComposedChart,
  Bar,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Sparkles,
  AlertTriangle,
  Loader2,
  Star,
  Wallet,
  Newspaper,
  FlaskConical,
  Bell,
  Trash2,
  Plus,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { analyzeAsset } from "@/lib/analyze.functions";
import { fetchNews } from "@/lib/news.functions";
import { backtest, type Strategy } from "@/lib/backtest";
import { logForecasts, scoreOpenForecasts, getModelStats, type ModelStats } from "@/lib/accuracy";
import {
  store,
  useStore,
  checkAlert,
  type Market,
  type AlertRule,
} from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Beursziener — AI Koersanalyse, Watchlist & Backtest" },
      {
        name: "description",
        content:
          "Analyseer aandelen en crypto met technische indicatoren, AI-prognose, watchlist, portfolio-tracking, nieuws-sentiment, backtests en prijsalerts.",
      },
      { property: "og:title", content: "Beursziener — AI Koersanalyse" },
      {
        property: "og:description",
        content: "AI-gedreven analyse, prognose, nieuws-sentiment en backtests voor aandelen en crypto.",
      },
    ],
  }),
  component: Home,
});

const PRESETS: Record<Market, { symbol: string; label: string }[]> = {
  stock: [
    { symbol: "AAPL", label: "Apple" },
    { symbol: "NVDA", label: "Nvidia" },
    { symbol: "GOOGL", label: "Alphabet" },
    { symbol: "TSLA", label: "Tesla" },
    { symbol: "MSFT", label: "Microsoft" },
    { symbol: "SPY", label: "S&P 500" },
  ],
  crypto: [
    { symbol: "bitcoin", label: "Bitcoin" },
    { symbol: "ethereum", label: "Ethereum" },
    { symbol: "solana", label: "Solana" },
    { symbol: "cardano", label: "Cardano" },
    { symbol: "ripple", label: "XRP" },
  ],
};

type AnalyzeResult = Extract<
  Awaited<ReturnType<typeof analyzeAsset>>,
  { ok: true }
>;

function Home() {
  const [market, setMarket] = useState<Market>("stock");
  const [symbol, setSymbol] = useState("NVDA");
  const [amount, setAmount] = useState<string>("1000");
  const [tab, setTab] = useState("analyse");

  const analyze = useServerFn(analyzeAsset);
  const news = useServerFn(fetchNews);

  const mutation = useMutation({
    mutationFn: (vars: { symbol: string; market: Market }) =>
      analyze({ data: vars }),
  });

  const newsMutation = useMutation({
    mutationFn: (vars: { symbol: string; market: Market }) =>
      news({ data: vars }),
  });

  const response = mutation.data;
  const result = response?.ok ? (response as AnalyzeResult) : null;
  const dataError = response && !response.ok ? response.error : null;

  // Check alerts whenever a new analysis lands
  const storeData = useStore();
  useEffect(() => {
    if (!result) return;
    const matching = storeData.alerts.filter(
      (a) => a.symbol.toUpperCase() === result.symbol.toUpperCase() && a.market === result.market,
    );
    for (const a of matching) {
      const hit = checkAlert(a, { price: result.indicators.price, rsi: result.indicators.rsi });
      if (hit && !a.triggeredAt) store.markTriggered(a.id);
    }
  }, [result, storeData.alerts]);

  // Accuracy tracking: score oude voorspellingen tegen huidige prijs, log nieuwe
  useEffect(() => {
    if (!result) return;
    scoreOpenForecasts({
      symbol: result.symbol,
      market: result.market,
      currentPrice: result.indicators.price,
    });
    logForecasts({
      symbol: result.symbol,
      market: result.market,
      price: result.indicators.price,
      forecasts: result.ai.forecasts,
    });
  }, [result?.symbol, result?.market]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!symbol.trim()) return;
    mutation.mutate({ symbol: symbol.trim(), market });
    setTab("analyse");
  };

  const pickPreset = (s: string) => {
    setSymbol(s);
    mutation.mutate({ symbol: s, market });
    setTab("analyse");
  };

  const loadFrom = (sym: string, m: Market) => {
    setSymbol(sym);
    setMarket(m);
    mutation.mutate({ symbol: sym, market: m });
    setTab("analyse");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-[image:var(--gradient-hero)] shadow-[var(--shadow-glow)]">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-none">Beursziener</h1>
              <p className="text-xs text-muted-foreground">AI koersanalyse & tools</p>
            </div>
          </div>
          <span className="rounded-full border border-border/60 px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Live data
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">
        <section className="mb-6">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Analyseer, volg, test en word gewaarschuwd
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
            Technische indicatoren, AI-prognose, watchlist, portfolio, nieuws-sentiment, backtests en prijsalerts — alles in één.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning">
            <AlertTriangle className="h-3.5 w-3.5" />
            Geen financieel advies. Beleg verantwoord.
          </p>
        </section>

        <Card className="mb-6 border-border/60 bg-card p-5">
          <div className="mb-4 inline-flex rounded-lg border border-border/60 bg-secondary p-1">
            {(["stock", "crypto"] as Market[]).map((m) => (
              <button
                key={m}
                onClick={() => setMarket(m)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                  market === m
                    ? "bg-primary text-primary-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "stock" ? "Aandelen & ETF" : "Crypto"}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder={market === "stock" ? "Bv. AAPL, NVDA, SPY" : "Bv. bitcoin, ethereum"}
              className="flex-1"
            />
            <Button type="submit" disabled={mutation.isPending} className="sm:w-44">
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyseren…
                </>
              ) : (
                <>Analyseer</>
              )}
            </Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {PRESETS[market].map((p) => (
              <button
                key={p.symbol}
                onClick={() => pickPreset(p.symbol)}
                className="rounded-full border border-border/60 bg-secondary/60 px-3 py-1 text-xs text-muted-foreground transition hover:border-primary/60 hover:text-foreground"
              >
                {p.label}
              </button>
            ))}
          </div>
        </Card>

        {(mutation.isError || dataError) && (
          <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {dataError ?? (mutation.error as Error).message}
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-3 md:grid-cols-6">
            <TabsTrigger value="analyse"><Activity className="mr-1 h-3.5 w-3.5" />Analyse</TabsTrigger>
            <TabsTrigger value="watchlist"><Star className="mr-1 h-3.5 w-3.5" />Watchlist</TabsTrigger>
            <TabsTrigger value="portfolio"><Wallet className="mr-1 h-3.5 w-3.5" />Portfolio</TabsTrigger>
            <TabsTrigger value="news"><Newspaper className="mr-1 h-3.5 w-3.5" />Nieuws</TabsTrigger>
            <TabsTrigger value="backtest"><FlaskConical className="mr-1 h-3.5 w-3.5" />Backtest</TabsTrigger>
            <TabsTrigger value="alerts"><Bell className="mr-1 h-3.5 w-3.5" />Alerts</TabsTrigger>
          </TabsList>

          <TabsContent value="analyse" className="mt-6">
            {result ? (
              <AnalysePanel result={result} amount={amount} setAmount={setAmount} />
            ) : (
              <EmptyHint text="Kies hierboven een ticker en klik Analyseer." />
            )}
          </TabsContent>

          <TabsContent value="watchlist" className="mt-6">
            <WatchlistPanel currentResult={result} onOpen={loadFrom} />
          </TabsContent>

          <TabsContent value="portfolio" className="mt-6">
            <PortfolioPanel currentResult={result} onOpen={loadFrom} />
          </TabsContent>

          <TabsContent value="news" className="mt-6">
            <NewsPanel
              result={result}
              fetchNewsFn={(s, m) => newsMutation.mutate({ symbol: s, market: m })}
              data={newsMutation.data}
              pending={newsMutation.isPending}
              error={newsMutation.error as Error | null}
            />
          </TabsContent>

          <TabsContent value="backtest" className="mt-6">
            <BacktestPanel result={result} />
          </TabsContent>

          <TabsContent value="alerts" className="mt-6">
            <AlertsPanel currentResult={result} onOpen={loadFrom} />
          </TabsContent>
        </Tabs>

        <footer className="mt-12 border-t border-border/60 pt-6 text-center text-xs text-muted-foreground">
          Koersdata: Yahoo Finance & CoinGecko. Nieuws: Yahoo. Analyse via Lovable AI. Lokale opslag (browser).
        </footer>
      </main>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p className="mt-10 text-center text-sm text-muted-foreground">{text}</p>
  );
}

/* ---------------- Analyse panel ---------------- */

function AnalysePanel({
  result,
  amount,
  setAmount,
}: {
  result: AnalyzeResult;
  amount: string;
  setAmount: (v: string) => void;
}) {
  const inWatch = useStore().watchlist.some(
    (w) => w.symbol === result.symbol && w.market === result.market,
  );

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-border/60 bg-card p-0">
        <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {result.market === "stock" ? "Aandeel" : "Crypto"}
            </p>
            <h3 className="text-2xl font-bold">{result.symbol}</h3>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">
                €{result.indicators.price.toFixed(2)}
              </span>
              <span
                className={`flex items-center text-sm font-medium tabular-nums ${
                  result.indicators.changePct >= 0 ? "text-accent" : "text-destructive"
                }`}
              >
                {result.indicators.changePct >= 0 ? (
                  <TrendingUp className="mr-1 h-4 w-4" />
                ) : (
                  <TrendingDown className="mr-1 h-4 w-4" />
                )}
                {result.indicators.changePct.toFixed(2)}%
              </span>
            </div>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <SignalBadge signal={result.ai.signal} confidence={result.ai.confidence} />
            <Button
              variant={inWatch ? "secondary" : "outline"}
              size="sm"
              onClick={() =>
                inWatch
                  ? store.removeWatch(result.symbol, result.market)
                  : store.addWatch({ symbol: result.symbol, market: result.market })
              }
            >
              <Star className={`mr-1.5 h-3.5 w-3.5 ${inWatch ? "fill-current" : ""}`} />
              {inWatch ? "In watchlist" : "Aan watchlist"}
            </Button>
          </div>
        </div>

        <div className="h-64 w-full bg-background/40 px-2 pb-3">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={result.chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.02 260)" />
              <XAxis dataKey="date" hide />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fill: "oklch(0.68 0.02 260)", fontSize: 11 }}
                width={55}
              />
              <Tooltip
                contentStyle={{
                  background: "oklch(0.21 0.022 260)",
                  border: "1px solid oklch(0.3 0.02 260)",
                  borderRadius: 8,
                  color: "oklch(0.97 0.005 250)",
                }}
                formatter={(v: number) => v?.toFixed?.(2)}
              />
              <Area type="monotone" dataKey="bbUpper" stroke="transparent" fill="oklch(0.72 0.18 235 / 0.08)" name="BB upper" />
              <Area type="monotone" dataKey="bbLower" stroke="transparent" fill="oklch(0.21 0.022 260)" name="BB lower" />
              <Line type="monotone" dataKey="close" stroke="oklch(0.72 0.18 235)" strokeWidth={2} dot={false} name="Koers" />
              <Line type="monotone" dataKey="sma20" stroke="oklch(0.78 0.17 145)" strokeWidth={1.5} dot={false} name="SMA20" />
              <Line type="monotone" dataKey="sma50" stroke="oklch(0.82 0.16 75)" strokeWidth={1.5} dot={false} strokeDasharray="4 4" name="SMA50" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {result.chart.some((c) => c.volume) && (
          <div className="h-24 w-full bg-background/30 px-2 pb-3">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={result.chart}>
                <XAxis dataKey="date" hide />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    background: "oklch(0.21 0.022 260)",
                    border: "1px solid oklch(0.3 0.02 260)",
                    borderRadius: 8,
                  }}
                />
                <Bar dataKey="volume" fill="oklch(0.72 0.18 235 / 0.5)" name="Volume" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="RSI (14)" value={result.indicators.rsi?.toFixed(1) ?? "—"} hint={rsiHint(result.indicators.rsi)} />
        <Stat
          label="MACD"
          value={result.indicators.macd?.toFixed(3) ?? "—"}
          hint={(result.indicators.macdHist ?? 0) >= 0 ? "Bullish histogram" : "Bearish histogram"}
          tone={(result.indicators.macdHist ?? 0) >= 0 ? "up" : "down"}
        />
        <Stat
          label="Stoch %K / %D"
          value={
            result.indicators.stochK != null && result.indicators.stochD != null
              ? `${result.indicators.stochK.toFixed(0)} / ${result.indicators.stochD.toFixed(0)}`
              : "—"
          }
          hint={
            result.indicators.stochK == null
              ? "—"
              : result.indicators.stochK > 80
                ? "Overbought"
                : result.indicators.stochK < 20
                  ? "Oversold"
                  : "Neutraal"
          }
        />
        <Stat
          label="Bollinger %"
          value={bbPosition(result.indicators)}
          hint="Positie tov banden"
        />
        <Stat label="Week" value={`${result.indicators.weekChangePct.toFixed(2)}%`} tone={result.indicators.weekChangePct >= 0 ? "up" : "down"} />
        <Stat label="Maand" value={`${result.indicators.monthChangePct.toFixed(2)}%`} tone={result.indicators.monthChangePct >= 0 ? "up" : "down"} />
        <Stat label="SMA20" value={result.indicators.sma20?.toFixed(2) ?? "—"} />
        <Stat label="SMA50" value={result.indicators.sma50?.toFixed(2) ?? "—"} />
      </div>

      <Card className="border-border/60 bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-[image:var(--gradient-hero)]">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <h4 className="text-lg font-semibold">AI Prognose</h4>
          <span className="ml-auto text-xs text-muted-foreground">Vertrouwen: {result.ai.confidence}%</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Block icon={<Activity className="h-4 w-4 text-primary" />} title="Korte termijn (1–2 weken)" text={result.ai.shortTerm || "—"} />
          <Block icon={<TrendingUp className="h-4 w-4 text-accent" />} title="Lange termijn (3–6 mnd)" text={result.ai.longTerm || "—"} />
          <Block title="Analyse" text={result.ai.reasoning || "—"} />
          <Block title="Risico's" text={result.ai.risks || "—"} tone="warning" />
        </div>
      </Card>

      <Card className="border-border/60 bg-card p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h4 className="text-lg font-semibold">Voorspellingen per model</h4>
            <p className="text-xs text-muted-foreground">
              Verwacht rendement (%) ± 1σ-band (historische volatiliteit) en geprojecteerde waarde.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Inleg €</span>
            <Input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-32"
            />
          </div>
        </div>
        <ForecastTable
          forecasts={result.ai.forecasts}
          amount={Number(amount) || 0}
          accuracy={getModelStats(result.symbol, result.market)}
        />
        {result.stats && (
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-5">
            <div><span className="text-foreground font-medium">{result.stats.samples}</span> dagen historie</div>
            <div>Drift: <span className="text-foreground font-medium">{result.stats.driftPct.toFixed(3)}%/d</span></div>
            <div>Volatiliteit: <span className="text-foreground font-medium">{result.stats.annualVolPct.toFixed(1)}%/j</span></div>
            <div>Regressietrend 90d: <span className="text-foreground font-medium">{result.stats.slopePctPerDay.toFixed(3)}%/d</span></div>
            <div>Regime: <span className="text-foreground font-medium capitalize">{result.stats.regime}</span></div>
          </div>
        )}
      </Card>

      {result.monteCarlo && (
        <MonteCarloPanel mc={result.monteCarlo} price={result.indicators.price} amount={Number(amount) || 0} />
      )}

      {(result.macro || result.earnings || result.fearGreed) && (
        <ContextPanel macro={result.macro} earnings={result.earnings} fearGreed={result.fearGreed} />
      )}

      <EntryTiming indicators={result.indicators} />
    </div>
  );
}

function bbPosition(ind: AnalyzeResult["indicators"]): string {
  if (ind.bbUpper == null || ind.bbLower == null || ind.bbUpper === ind.bbLower) return "—";
  const p = ((ind.price - ind.bbLower) / (ind.bbUpper - ind.bbLower)) * 100;
  return `${p.toFixed(0)}%`;
}

/* ---------------- Watchlist ---------------- */

function WatchlistPanel({
  currentResult,
  onOpen,
}: {
  currentResult: AnalyzeResult | null;
  onOpen: (s: string, m: Market) => void;
}) {
  const { watchlist } = useStore();
  return (
    <Card className="border-border/60 bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h4 className="text-lg font-semibold">Watchlist</h4>
          <p className="text-xs text-muted-foreground">{watchlist.length} symbolen — lokaal opgeslagen.</p>
        </div>
        {currentResult && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => store.addWatch({ symbol: currentResult.symbol, market: currentResult.market })}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Huidig toevoegen
          </Button>
        )}
      </div>
      {watchlist.length === 0 ? (
        <EmptyHint text="Nog geen symbolen. Open een analyse en klik 'Aan watchlist'." />
      ) : (
        <div className="divide-y divide-border/40">
          {watchlist.map((w) => (
            <div key={`${w.market}:${w.symbol}`} className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium">{w.symbol}</div>
                <div className="text-xs text-muted-foreground">
                  {w.market === "stock" ? "Aandeel/ETF" : "Crypto"} · sinds{" "}
                  {new Date(w.addedAt).toLocaleDateString("nl-NL")}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => onOpen(w.symbol, w.market)}>
                  Analyseer
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => store.removeWatch(w.symbol, w.market)}
                  aria-label="Verwijder"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ---------------- Portfolio ---------------- */

function PortfolioPanel({
  currentResult,
  onOpen,
}: {
  currentResult: AnalyzeResult | null;
  onOpen: (s: string, m: Market) => void;
}) {
  const { portfolio } = useStore();
  const [qty, setQty] = useState("");
  const [avg, setAvg] = useState("");
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);
  const analyze = useServerFn(analyzeAsset);

  useEffect(() => {
    if (currentResult) {
      setPrices((p) => ({
        ...p,
        [`${currentResult.market}:${currentResult.symbol}`]: currentResult.indicators.price,
      }));
    }
  }, [currentResult]);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentResult || !qty || !avg) return;
    store.addPosition({
      symbol: currentResult.symbol,
      market: currentResult.market,
      quantity: Number(qty),
      avgPrice: Number(avg),
    });
    setQty("");
    setAvg("");
  };

  const refreshAll = async () => {
    if (!portfolio.length) return;
    setRefreshing(true);
    const unique = new Map<string, { symbol: string; market: Market }>();
    for (const p of portfolio) unique.set(`${p.market}:${p.symbol}`, { symbol: p.symbol, market: p.market });
    const updates: Record<string, number> = {};
    await Promise.all(
      [...unique.values()].map(async (u) => {
        try {
          const r = await analyze({ data: u });
          if (r.ok) updates[`${u.market}:${u.symbol}`] = (r as AnalyzeResult).indicators.price;
        } catch {}
      }),
    );
    setPrices((p) => ({ ...p, ...updates }));
    setRefreshing(false);
  };

  const totals = useMemo(() => {
    let invested = 0, current = 0;
    for (const p of portfolio) {
      invested += p.quantity * p.avgPrice;
      const cur = prices[`${p.market}:${p.symbol}`];
      current += p.quantity * (cur ?? p.avgPrice);
    }
    return { invested, current, pnl: current - invested, pnlPct: invested ? ((current - invested) / invested) * 100 : 0 };
  }, [portfolio, prices]);

  return (
    <div className="space-y-6">
      {currentResult && (
        <Card className="border-border/60 bg-card p-5">
          <h4 className="mb-3 text-lg font-semibold">Positie toevoegen ({currentResult.symbol})</h4>
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs text-muted-foreground">Aantal</label>
              <Input type="number" step="any" min={0} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="bv. 10" required />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Gem. aankoopprijs (€)</label>
              <Input type="number" step="any" min={0} value={avg} onChange={(e) => setAvg(e.target.value)} placeholder={currentResult.indicators.price.toFixed(2)} required />
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full"><Plus className="mr-1 h-4 w-4" /> Toevoegen</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="border-border/60 bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h4 className="text-lg font-semibold">Portfolio</h4>
            <p className="text-xs text-muted-foreground">{portfolio.length} posities</p>
          </div>
          <Button size="sm" variant="outline" onClick={refreshAll} disabled={refreshing || !portfolio.length}>
            {refreshing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
            Vernieuw prijzen
          </Button>
        </div>

        {portfolio.length === 0 ? (
          <EmptyHint text="Geen posities. Analyseer een symbool en voeg het toe." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Symbool</th>
                    <th className="py-2 px-3 text-right font-medium">Aantal</th>
                    <th className="py-2 px-3 text-right font-medium">Gem. prijs</th>
                    <th className="py-2 px-3 text-right font-medium">Huidig</th>
                    <th className="py-2 px-3 text-right font-medium">Waarde</th>
                    <th className="py-2 px-3 text-right font-medium">P&L</th>
                    <th className="py-2 pl-3" />
                  </tr>
                </thead>
                <tbody>
                  {portfolio.map((p) => {
                    const cur = prices[`${p.market}:${p.symbol}`];
                    const value = p.quantity * (cur ?? p.avgPrice);
                    const invested = p.quantity * p.avgPrice;
                    const pnl = value - invested;
                    const pnlPct = invested ? (pnl / invested) * 100 : 0;
                    return (
                      <tr key={p.id} className="border-b border-border/40 last:border-0">
                        <td className="py-2 pr-3">
                          <button className="font-medium hover:underline" onClick={() => onOpen(p.symbol, p.market)}>
                            {p.symbol}
                          </button>
                          <div className="text-[10px] uppercase text-muted-foreground">{p.market}</div>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{p.quantity}</td>
                        <td className="py-2 px-3 text-right tabular-nums">€{p.avgPrice.toFixed(2)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{cur != null ? `€${cur.toFixed(2)}` : "—"}</td>
                        <td className="py-2 px-3 text-right tabular-nums">€{value.toFixed(2)}</td>
                        <td className={`py-2 px-3 text-right tabular-nums ${pnl >= 0 ? "text-accent" : "text-destructive"}`}>
                          {pnl >= 0 ? "+" : ""}€{pnl.toFixed(2)} ({pnlPct.toFixed(1)}%)
                        </td>
                        <td className="py-2 pl-3 text-right">
                          <Button size="icon" variant="ghost" onClick={() => store.removePosition(p.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-secondary/40 font-semibold">
                    <td className="py-2 pr-3" colSpan={4}>Totaal</td>
                    <td className="py-2 px-3 text-right tabular-nums">€{totals.current.toFixed(2)}</td>
                    <td className={`py-2 px-3 text-right tabular-nums ${totals.pnl >= 0 ? "text-accent" : "text-destructive"}`}>
                      {totals.pnl >= 0 ? "+" : ""}€{totals.pnl.toFixed(2)} ({totals.pnlPct.toFixed(1)}%)
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/* ---------------- News ---------------- */

function NewsPanel({
  result,
  fetchNewsFn,
  data,
  pending,
  error,
}: {
  result: AnalyzeResult | null;
  fetchNewsFn: (s: string, m: Market) => void;
  data: any;
  pending: boolean;
  error: Error | null;
}) {
  useEffect(() => {
    if (result) fetchNewsFn(result.symbol, result.market);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.symbol, result?.market]);

  if (!result) return <EmptyHint text="Analyseer eerst een symbool voor nieuws en sentiment." />;
  if (pending) return <Card className="p-8 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></Card>;
  if (error) return <Card className="border-destructive/40 bg-destructive/10 p-5 text-sm text-destructive">{error.message}</Card>;
  if (!data?.ok) return <EmptyHint text="Geen nieuws beschikbaar." />;

  const items = data.items as { title: string; publisher: string; link: string; publishedAt: number }[];
  const sentiment = data.sentiment as { score: number; label: string; summary: string } | null;

  return (
    <div className="space-y-4">
      {sentiment && (
        <Card className="border-border/60 bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-lg font-semibold">AI Sentiment — {result.symbol}</h4>
            <Badge variant={sentiment.score > 20 ? "default" : sentiment.score < -20 ? "destructive" : "secondary"}>
              {sentiment.label} ({sentiment.score > 0 ? "+" : ""}{sentiment.score})
            </Badge>
          </div>
          <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full ${sentiment.score >= 0 ? "bg-accent" : "bg-destructive"}`}
              style={{ width: `${Math.abs(sentiment.score)}%`, marginLeft: sentiment.score < 0 ? `${100 - Math.abs(sentiment.score)}%` : 0 }}
            />
          </div>
          <p className="text-sm text-muted-foreground">{sentiment.summary}</p>
        </Card>
      )}
      <Card className="border-border/60 bg-card p-5">
        <h4 className="mb-3 text-lg font-semibold">Recente koppen ({items.length})</h4>
        {items.length === 0 ? (
          <EmptyHint text="Geen nieuws gevonden." />
        ) : (
          <ul className="space-y-3">
            {items.map((it) => (
              <li key={it.link} className="border-b border-border/40 pb-3 last:border-0 last:pb-0">
                <a href={it.link} target="_blank" rel="noreferrer" className="group flex items-start gap-2">
                  <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                  <div>
                    <p className="text-sm font-medium group-hover:text-primary">{it.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {it.publisher}
                      {it.publishedAt ? ` · ${new Date(it.publishedAt).toLocaleString("nl-NL")}` : ""}
                    </p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Backtest ---------------- */

function BacktestPanel({ result }: { result: AnalyzeResult | null }) {
  const [strategy, setStrategy] = useState<Strategy>("sma-cross");
  const [initial, setInitial] = useState("1000");

  const init = Number(initial) || 1000;
  const history = result?.history ?? [];
  const bt = useMemo(() => backtest(history, strategy, init), [history, strategy, init]);

  if (!result) return <EmptyHint text="Analyseer eerst een symbool om te backtesten." />;

  const strategies: { key: Strategy; label: string; desc: string }[] = [
    { key: "sma-cross", label: "SMA Crossover (20/50)", desc: "Koop bij SMA20 > SMA50, verkoop bij omkering." },
    { key: "rsi", label: "RSI Oversold/Overbought", desc: "Koop bij RSI<30, verkoop bij RSI>70." },
    { key: "macd", label: "MACD Crossover", desc: "Koop bij MACD > signaal, verkoop bij omkering." },
  ];

  return (
    <div className="space-y-6">
      <Card className="border-border/60 bg-card p-5">
        <h4 className="mb-3 text-lg font-semibold">Strategie kiezen</h4>
        <div className="grid gap-3 md:grid-cols-3">
          {strategies.map((s) => (
            <button
              key={s.key}
              onClick={() => setStrategy(s.key)}
              className={`rounded-lg border p-3 text-left text-sm transition ${
                strategy === s.key
                  ? "border-primary bg-primary/10"
                  : "border-border/60 bg-background/40 hover:border-primary/40"
              }`}
            >
              <div className="font-medium">{s.label}</div>
              <div className="mt-1 text-xs text-muted-foreground">{s.desc}</div>
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Startkapitaal €</span>
          <Input type="number" min={0} value={initial} onChange={(e) => setInitial(e.target.value)} className="w-32" />
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Eindwaarde" value={`€${bt.finalValue.toFixed(0)}`} tone={bt.returnPct >= 0 ? "up" : "down"} />
        <Stat label="Rendement" value={`${bt.returnPct >= 0 ? "+" : ""}${bt.returnPct.toFixed(1)}%`} tone={bt.returnPct >= 0 ? "up" : "down"} hint={`Buy & hold: ${bt.buyHoldReturnPct.toFixed(1)}%`} />
        <Stat label="Win rate" value={`${bt.winRate.toFixed(0)}%`} hint={`${bt.trades.length} trades`} />
        <Stat label="Max drawdown" value={`-${bt.maxDrawdownPct.toFixed(1)}%`} tone="down" />
      </div>

      <Card className="border-border/60 bg-card p-5">
        <h4 className="mb-3 text-lg font-semibold">Equity curve</h4>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={bt.equityCurve}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.02 260)" />
              <XAxis dataKey="i" hide />
              <YAxis tick={{ fill: "oklch(0.68 0.02 260)", fontSize: 11 }} width={55} />
              <Tooltip
                contentStyle={{ background: "oklch(0.21 0.022 260)", border: "1px solid oklch(0.3 0.02 260)", borderRadius: 8 }}
                formatter={(v: number) => `€${v.toFixed(2)}`}
              />
              <Line type="monotone" dataKey="value" stroke="oklch(0.72 0.18 235)" strokeWidth={2} dot={false} name="Strategie" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="border-border/60 bg-card p-5">
        <h4 className="mb-3 text-lg font-semibold">Trades ({bt.trades.length})</h4>
        {bt.trades.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geen trades — strategie gaf geen signalen op deze data.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="py-2 px-3 text-right font-medium">Entry €</th>
                  <th className="py-2 px-3 text-right font-medium">Exit €</th>
                  <th className="py-2 pl-3 text-right font-medium">Rendement</th>
                </tr>
              </thead>
              <tbody>
                {bt.trades.map((t, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0">
                    <td className="py-1.5 pr-3">{i + 1}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{t.entryPrice.toFixed(2)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{t.exitPrice.toFixed(2)}</td>
                    <td className={`py-1.5 pl-3 text-right tabular-nums ${t.returnPct >= 0 ? "text-accent" : "text-destructive"}`}>
                      {t.returnPct >= 0 ? "+" : ""}{t.returnPct.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Backtest gebruikt dagelijkse slotkoersen van de afgelopen periode. Geen handelskosten of slippage. Resultaten uit het verleden geven geen garantie voor de toekomst.
      </p>
    </div>
  );
}

/* ---------------- Alerts ---------------- */

function AlertsPanel({
  currentResult,
  onOpen,
}: {
  currentResult: AnalyzeResult | null;
  onOpen: (s: string, m: Market) => void;
}) {
  const { alerts } = useStore();
  const [type, setType] = useState<AlertRule["type"]>("price-above");
  const [value, setValue] = useState("");

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentResult || !value) return;
    store.addAlert({
      symbol: currentResult.symbol,
      market: currentResult.market,
      type,
      value: Number(value),
    });
    setValue("");
  };

  const typeOptions: { v: AlertRule["type"]; label: string }[] = [
    { v: "price-above", label: "Prijs boven" },
    { v: "price-below", label: "Prijs onder" },
    { v: "rsi-above", label: "RSI boven" },
    { v: "rsi-below", label: "RSI onder" },
  ];

  return (
    <div className="space-y-6">
      {currentResult && (
        <Card className="border-border/60 bg-card p-5">
          <h4 className="mb-3 text-lg font-semibold">Alert toevoegen ({currentResult.symbol})</h4>
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AlertRule["type"])}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {typeOptions.map((o) => (
                <option key={o.v} value={o.v} className="bg-background text-foreground">
                  {o.label}
                </option>
              ))}
            </select>
            <Input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Waarde" required />
            <Button type="submit"><Plus className="mr-1 h-4 w-4" /> Toevoegen</Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Alerts worden gecontroleerd telkens als je dit symbool analyseert.
          </p>
        </Card>
      )}

      <Card className="border-border/60 bg-card p-5">
        <h4 className="mb-3 text-lg font-semibold">Alerts ({alerts.length})</h4>
        {alerts.length === 0 ? (
          <EmptyHint text="Geen alerts. Voeg er één toe via de analyse-pagina." />
        ) : (
          <div className="divide-y divide-border/40">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <button className="font-medium hover:underline" onClick={() => onOpen(a.symbol, a.market)}>
                      {a.symbol}
                    </button>
                    <Badge variant="outline" className="text-[10px]">
                      {a.type.replace("-", " ")} {a.value}
                    </Badge>
                    {a.triggeredAt && (
                      <Badge variant="destructive" className="text-[10px]">
                        Getriggerd {new Date(a.triggeredAt).toLocaleDateString("nl-NL")}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {a.market} · sinds {new Date(a.createdAt).toLocaleDateString("nl-NL")}
                  </div>
                </div>
                <div className="flex gap-2">
                  {a.triggeredAt && (
                    <Button size="sm" variant="ghost" onClick={() => store.resetAlertTrigger(a.id)}>
                      Reset
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" onClick={() => store.removeAlert(a.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Shared bits ---------------- */

function SignalBadge({ signal, confidence }: { signal: "BUY" | "SELL" | "HOLD"; confidence: number }) {
  const map = {
    BUY: { label: "KOOP", cls: "bg-accent text-accent-foreground", icon: <TrendingUp className="h-4 w-4" /> },
    SELL: { label: "VERKOOP", cls: "bg-destructive text-destructive-foreground", icon: <TrendingDown className="h-4 w-4" /> },
    HOLD: { label: "HOUDEN", cls: "bg-secondary text-secondary-foreground", icon: <Activity className="h-4 w-4" /> },
  };
  const c = map[signal] ?? map.HOLD;
  return (
    <div className="flex flex-col items-start gap-1 md:items-end">
      <div className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-wide ${c.cls}`}>
        {c.icon}
        {c.label}
      </div>
      <span className="text-xs text-muted-foreground">Signaal · {confidence}% vertrouwen</span>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "up" | "down";
}) {
  const toneCls = tone === "up" ? "text-accent" : tone === "down" ? "text-destructive" : "text-foreground";
  return (
    <Card className="border-border/60 bg-card p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${toneCls}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function Block({
  title,
  text,
  icon,
  tone,
}: {
  title: string;
  text: string;
  icon?: React.ReactNode;
  tone?: "warning";
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        tone === "warning" ? "border-warning/40 bg-warning/5" : "border-border/60 bg-background/40"
      }`}
    >
      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function rsiHint(rsi: number | null | undefined) {
  if (rsi == null) return "—";
  if (rsi >= 70) return "Overbought";
  if (rsi <= 30) return "Oversold";
  return "Neutraal";
}

function EntryTiming({
  indicators,
}: {
  indicators: {
    price: number;
    rsi: number | null;
    sma20: number | null;
    sma50: number | null;
    macdHist: number | null;
    weekChangePct: number;
    monthChangePct: number;
  };
}) {
  let score = 50;
  const reasons: string[] = [];

  const rsi = indicators.rsi;
  if (rsi != null) {
    if (rsi < 30) { score += 25; reasons.push(`RSI ${rsi.toFixed(0)} (oversold) — koopkans`); }
    else if (rsi < 45) { score += 12; reasons.push(`RSI ${rsi.toFixed(0)} (laag-neutraal) — gunstig`); }
    else if (rsi > 70) { score -= 25; reasons.push(`RSI ${rsi.toFixed(0)} (overbought) — wacht op dip`); }
    else if (rsi > 60) { score -= 10; reasons.push(`RSI ${rsi.toFixed(0)} (verhit) — voorzichtig`); }
    else reasons.push(`RSI ${rsi.toFixed(0)} — neutraal`);
  }

  if (indicators.sma20 && indicators.sma50) {
    const trend = ((indicators.sma20 - indicators.sma50) / indicators.sma50) * 100;
    if (trend > 1) { score += 10; reasons.push("Opwaartse trend (SMA20 > SMA50)"); }
    else if (trend < -1) { score -= 10; reasons.push("Neerwaartse trend (SMA20 < SMA50)"); }
  }

  const hist = indicators.macdHist ?? 0;
  if (hist > 0) { score += 8; reasons.push("MACD bullish histogram"); }
  else if (hist < 0) { score -= 8; reasons.push("MACD bearish histogram"); }

  if (indicators.weekChangePct < -5) { score += 8; reasons.push("Pullback van >5% deze week"); }
  if (indicators.weekChangePct > 10) { score -= 8; reasons.push("Rally van >10% deze week"); }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let verdict: { label: string; tone: "good" | "warn" | "bad"; advice: string };
  if (score >= 65) verdict = { label: "Gunstig moment", tone: "good", advice: "Indicatoren wijzen op een goed instapmoment. Overweeg gespreid in te leggen (bv. 2–3 tranches)." };
  else if (score >= 45) verdict = { label: "Neutraal", tone: "warn", advice: "Geen duidelijk signaal. Spreid je inleg over enkele weken (DCA) om timing-risico te beperken." };
  else verdict = { label: "Wacht op betere prijs", tone: "bad", advice: "Markt is overhit of in dalende trend. Wacht op een pullback of bevestiging van bodem." };

  const toneCls =
    verdict.tone === "good" ? "bg-accent text-accent-foreground" :
    verdict.tone === "bad" ? "bg-destructive text-destructive-foreground" :
    "bg-secondary text-secondary-foreground";

  return (
    <Card className="border-border/60 bg-card p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-lg font-semibold">Beste instapmoment</h4>
          <p className="text-xs text-muted-foreground">Timing-score op basis van RSI, trend en momentum.</p>
        </div>
        <div className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold uppercase tracking-wide ${toneCls}`}>
          {verdict.label} · {score}/100
        </div>
      </div>
      <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full ${verdict.tone === "good" ? "bg-accent" : verdict.tone === "bad" ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <p className="mb-3 text-sm text-foreground">{verdict.advice}</p>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {reasons.map((r) => (
          <li key={r} className="flex items-start gap-2">
            <span className="mt-1 h-1 w-1 rounded-full bg-primary" />
            {r}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ForecastTable({
  forecasts,
  amount,
}: {
  forecasts: {
    model: string;
    day: number;
    week: number;
    month: number;
    bandDay?: number;
    bandWeek?: number;
    bandMonth?: number;
  }[];
  amount: number;
}) {
  const avg = (key: "day" | "week" | "month") =>
    forecasts.length ? forecasts.reduce((s, f) => s + f[key], 0) / forecasts.length : 0;
  const project = (pct: number) => amount * (1 + pct / 100);
  const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  const fmtBand = (b?: number) => (b != null && b > 0 ? ` ±${b.toFixed(1)}%` : "");
  const fmtEur = (n: number) =>
    n.toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const toneCls = (n: number) =>
    n > 0 ? "text-accent" : n < 0 ? "text-destructive" : "text-muted-foreground";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Model</th>
            <th className="py-2 px-3 text-right font-medium">Dag</th>
            <th className="py-2 px-3 text-right font-medium">Week</th>
            <th className="py-2 px-3 text-right font-medium">Maand</th>
            <th className="py-2 pl-3 text-right font-medium">Range (mnd)</th>
          </tr>
        </thead>
        <tbody>
          {forecasts.map((f) => (
            <tr key={f.model} className="border-b border-border/40 last:border-0">
              <td className="py-2 pr-3 font-medium">{f.model}</td>
              <td className={`py-2 px-3 text-right tabular-nums ${toneCls(f.day)}`}>{fmtPct(f.day)}<span className="text-[10px] text-muted-foreground">{fmtBand(f.bandDay)}</span></td>
              <td className={`py-2 px-3 text-right tabular-nums ${toneCls(f.week)}`}>{fmtPct(f.week)}<span className="text-[10px] text-muted-foreground">{fmtBand(f.bandWeek)}</span></td>
              <td className={`py-2 px-3 text-right tabular-nums ${toneCls(f.month)}`}>{fmtPct(f.month)}<span className="text-[10px] text-muted-foreground">{fmtBand(f.bandMonth)}</span></td>
              <td className="py-2 pl-3 text-right tabular-nums">
                <div>{fmtEur(project(f.month))}</div>
                {f.bandMonth != null && amount > 0 && (
                  <div className="text-[10px] text-muted-foreground">
                    {fmtEur(project(f.month - f.bandMonth))} – {fmtEur(project(f.month + f.bandMonth))}
                  </div>
                )}
              </td>
            </tr>
          ))}
          <tr className="bg-secondary/40 font-semibold">
            <td className="py-2 pr-3">Gemiddeld</td>
            <td className={`py-2 px-3 text-right tabular-nums ${toneCls(avg("day"))}`}>{fmtPct(avg("day"))}</td>
            <td className={`py-2 px-3 text-right tabular-nums ${toneCls(avg("week"))}`}>{fmtPct(avg("week"))}</td>
            <td className={`py-2 px-3 text-right tabular-nums ${toneCls(avg("month"))}`}>{fmtPct(avg("month"))}</td>
            <td className="py-2 pl-3 text-right tabular-nums">{fmtEur(project(avg("month")))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
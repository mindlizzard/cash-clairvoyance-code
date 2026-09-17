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
  Shield,
  Target,
  Layers,
} from "lucide-react";
import { analyzeAsset, scanOpportunities, explainTradePlan } from "@/lib/analyze.functions";
import { fetchNews } from "@/lib/news.functions";
import { backtest, type Strategy } from "@/lib/backtest";
import {
  logForecasts,
  scoreOpenForecasts,
  getModelStats,
  getEnsembleWeights,
  getHorizonSummary,
  getTrackingOverview,
  measuredConfidence,
  clearForecastLog,
  onAccuracyChange,
  trackingLabel,
  ACCURACY_EXPLAINER,
  type ModelStats,
} from "@/lib/accuracy";

import {
  openPaperTrade,
  closePaperTrade,
  removePaperTrade,
  updatePaperTrades,
  usePaperTrades,
  paperStats,
  positionSize,
} from "@/lib/paper";
import { backtestPlan } from "@/lib/planbacktest";
import {
  store,
  useStore,
  checkAlert,
  type Market,
  type AlertRule,
} from "@/lib/storage";
import { BunqImportCard, ImportedPositionsCard } from "@/components/BunqImport";
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
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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

  // Accuracy tracking: score oude voorspellingen, log nieuwe per model en horizon
  useEffect(() => {
    if (!result) return;
    const fresh = result.dataFreshness;
    const ref = fresh?.reference;
    // Prijs én tijdstip komen uit dezelfde waarneming (candle/provider).
    const refPrice = ref?.price;
    const refAt = ref?.at ? Date.parse(ref.at) : NaN;
    const stale = !!fresh?.stale || fresh?.trustworthy === false;
    const minHorizonHours = ref?.minHorizonHours ?? 24;
    const trustworthy =
      !!refPrice && isFinite(refPrice) && refPrice > 0 && isFinite(refAt) && !stale;

    // Paper trading gebruikt de laatst bekende koers (mag ook dagslot zijn).
    updatePaperTrades(result.symbol, result.market, result.indicators.price);
    if (!trustworthy) return; // geen betrouwbaar prijs+tijd-paar → niets loggen/scoren

    scoreOpenForecasts({
      symbol: result.symbol,
      market: result.market,
      currentPrice: refPrice,
      priceAt: refAt,
      sourceKind: ref!.kind,
      minHorizonHours,
      stale: false,
    });
    const hour = (h: number) =>
      result.hourlyForecasts.find((row) => row.hours === h)?.expectedPct ?? 0;
    const intradayBased = ref!.kind === "intraday";
    logForecasts({
      symbol: result.symbol,
      market: result.market,
      price: refPrice,
      observedAt: refAt,
      sourceKind: ref!.kind,
      sourceLabel: ref!.source,
      minHorizonHours,
      stale: false,
      entries: [


        ...result.ai.forecasts.map((f) => ({
          model: f.model,
          predictions: [
            { key: "24u" as const, predictedPct: f.day },
            { key: "1w" as const, predictedPct: f.week },
            { key: "1m" as const, predictedPct: f.month },
          ],
        })),
        {
          model: "Ensemble (handelsplan)",
          predictions: [
            // 1u/4u alleen als de basis een echte, verse intraday-candle is
            ...(intradayBased && result.hourlyForecasts.every((r) => r.source === "intraday")
              ? [
                  { key: "1u" as const, predictedPct: hour(1) },
                  { key: "4u" as const, predictedPct: hour(4) },
                ]
              : []),
            { key: "24u" as const, predictedPct: hour(24) },
            { key: "1w" as const, predictedPct: result.ensemble.ensembleWeekPct },
          ],
        },
      ],
    });
  }, [result?.symbol, result?.market, result?.dataFreshness?.reference?.at]);


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

  const navItems = [
    { value: "analyse", label: "Analyse", icon: Activity },
    { value: "watchlist", label: "Watchlist", icon: Star },
    { value: "portfolio", label: "Portfolio", icon: Wallet },
    { value: "news", label: "Nieuws", icon: Newspaper },
    { value: "alerts", label: "Alerts", icon: Bell },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-primary/30 bg-primary/10">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">Beursziener</h1>
              <p className="truncate text-[11px] text-muted-foreground">AI trading cockpit</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-accent">
            <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_12px_var(--color-accent)]" /> Live
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-4 sm:px-6 sm:pb-10">
        <Card className="mb-4 border-border/70 bg-card/90 p-3 shadow-lg backdrop-blur sm:p-4">
          <div className="mb-3 inline-flex rounded-md border border-border/60 bg-background/60 p-1">
            {(["stock", "crypto"] as Market[]).map((m) => (
              <Button
                key={m}
                type="button"
                size="sm"
                variant={market === m ? "default" : "ghost"}
                onClick={() => setMarket(m)}
                className="h-8"
              >
                {m === "stock" ? "Aandelen & ETF" : "Crypto"}
              </Button>
            ))}
          </div>
          <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder={market === "stock" ? "Bv. AAPL, NVDA, SPY" : "Bv. bitcoin, ethereum"}
              className="flex-1"
            />
            <Button type="submit" disabled={mutation.isPending} className="h-10 px-4 sm:w-44">
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyseren…
                </>
              ) : (
                <>Analyseer</>
              )}
            </Button>
          </form>
          <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
            {PRESETS[market].map((p) => (
              <Button
                key={p.symbol}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => pickPreset(p.symbol)}
                className="shrink-0"
              >
                {p.label}
              </Button>
            ))}
          </div>
        </Card>

        {(mutation.isError || dataError) && (
          <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {dataError ?? (mutation.error as Error).message}
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="no-scrollbar hidden h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-border bg-transparent p-0 sm:flex">
            {navItems.map((item) => <TabsTrigger key={item.value} value={item.value} className="rounded-none border-b-2 border-transparent px-4 py-3 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary"><item.icon className="mr-1.5 h-4 w-4" />{item.label}</TabsTrigger>)}
          </TabsList>

          <TabsContent value="analyse" className="mt-6">
            {result ? (
              <AnalysePanel result={result} amount={amount} setAmount={setAmount} onRefresh={() => submit()} onAlert={() => setTab("alerts")} />
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

          <TabsContent value="alerts" className="mt-6">
            <AlertsPanel currentResult={result} onOpen={loadFrom} />
          </TabsContent>
        </Tabs>

        <footer className="mt-12 border-t border-border/60 pt-6 text-center text-xs text-muted-foreground">
          Koersdata: Yahoo Finance, Nasdaq, Binance & CoinGecko. Nieuws: Yahoo. Signalen worden volledig kwantitatief berekend in de app; een taalmodel wordt alleen gebruikt om te vatten en voor nieuws-sentiment. Meting en opslag lokaal in je browser.
        </footer>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 px-2 pb-[max(0.55rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl sm:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {navItems.map((item) => (
            <Button key={item.value} type="button" variant="ghost" onClick={() => setTab(item.value)} className={`h-12 min-w-0 flex-col gap-1 px-1 text-[9px] ${tab === item.value ? "text-primary" : "text-muted-foreground"}`}>
              <item.icon className="h-5 w-5" />{item.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TradePlanPanel({ result }: { result: AnalyzeResult }) {
  const plan = result.tradePlan;
  const ens = result.ensemble;
  const [portfolio, setPortfolio] = useState("10000");
  const [riskPct, setRiskPct] = useState(1);
  const [explanation, setExplanation] = useState<string | null>(null);
  const explain = useServerFn(explainTradePlan);
  const explainMutation = useMutation({
    mutationFn: () =>
      explain({
        data: {
          symbol: result.symbol,
          facts: [
            `Signaal ${plan.signal}, modelmatig vertrouwen ${plan.confidence}%.`,
            `Verwachte beweging week ${ens.ensembleWeekPct}%, edge ${plan.edgePct}%, kosten ${plan.costPct}%.`,
            `Modelovereenstemming ${plan.agreement}%. Kans omhoog ${plan.probabilityUp}%.`,
            `Instapzone ${plan.entryLow}-${plan.entryHigh}, stop ${plan.stopLoss}, TP1 ${plan.takeProfit1}, TP2 ${plan.takeProfit2}, R/R 1:${plan.riskReward}.`,
            plan.noTradeReasons.length ? `NO TRADE-redenen: ${plan.noTradeReasons.join(" ")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      }),
    onSuccess: (d) => setExplanation(d.ok ? d.text : "Uitleg is nu niet beschikbaar."),
  });

  const tradable = plan.signal === "BUY" || plan.signal === "SELL";
  const size = positionSize({
    portfolio: Number(portfolio) || 0,
    riskPct,
    entry: result.indicators.price,
    stop: plan.stopLoss,
  });

  const forecasts = [
    ["1 uur", result.hourlyForecasts.find((row) => row.hours === 1)?.expectedPct ?? 0],
    ["4 uur", result.hourlyForecasts.find((row) => row.hours === 4)?.expectedPct ?? 0],
    ["24 uur", result.hourlyForecasts.find((row) => row.hours === 24)?.expectedPct ?? 0],
    ["1 week", ens.ensembleWeekPct],
  ] as const;
  const tone = plan.signal === "BUY" ? "text-accent border-accent/40 bg-accent/10" : plan.signal === "SELL" ? "text-destructive border-destructive/40 bg-destructive/10" : plan.signal === "NO_TRADE" ? "text-warning border-warning/40 bg-warning/10" : "text-primary border-primary/40 bg-primary/10";
  const measured = measuredConfidence(result.symbol, result.market, "1w");
  const measuredSamples =
    getHorizonSummary(result.symbol, result.market).find((h) => h.key === "1w")?.observations ?? 0;


  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-card p-4 sm:p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border pb-4">
          <div className="min-w-0"><p className="text-[10px] font-bold uppercase text-muted-foreground">Handelsplan (kwantitatief)</p><div className={`mt-1 inline-flex rounded-md border px-3 py-1.5 text-2xl font-bold ${tone}`}>{plan.signal.replace("_", " ")}</div></div>
          <div className="text-right"><p className="text-[10px] font-bold uppercase text-muted-foreground">Modelmatig</p><p className="text-2xl font-bold tabular-nums">{plan.confidence}%</p><p className="text-[10px] capitalize text-muted-foreground">Risico {plan.riskLevel}</p></div>
        </div>
        <div className="mt-3 rounded-md border border-border/60 bg-secondary/30 p-2.5 text-xs text-muted-foreground">
          <p>
            Gemeten richting-score (1 week):{" "}
            {measured ? (
              <span className="font-semibold text-foreground">{measured.value.toFixed(0)}% over {measured.samples} gecontroleerde voorspellingen</span>
            ) : (
              <span className="font-semibold text-warning">{trackingLabel(measuredSamples)}</span>
            )}
          </p>
          <p className="mt-1">{ACCURACY_EXPLAINER}</p>
        </div>

        {plan.eventRisk && <p className="mt-4 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning"><AlertTriangle className="h-4 w-4" />{plan.eventRisk}</p>}
        {plan.noTradeReasons.length > 0 && (
          <div className="mt-4 rounded-md border border-warning/40 bg-warning/5 p-3">
            <p className="text-[10px] font-bold uppercase text-warning">Waarom niet handelen</p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {plan.noTradeReasons.map((r) => <li key={r}>• {r}</li>)}
            </ul>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {forecasts.map(([label, value]) => <Mini key={label} label={label} value={`${value >= 0 ? "+" : ""}${value.toFixed(2)}%`} />)}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Mini label="Instapzone" value={`€${plan.entryLow.toFixed(2)} – €${plan.entryHigh.toFixed(2)}`} />
          <Mini label="Stop-loss" value={`€${plan.stopLoss.toFixed(2)}`} />
          <Mini label="Take profit 1" value={`€${plan.takeProfit1.toFixed(2)}`} />
          <Mini label="Take profit 2" value={`€${plan.takeProfit2.toFixed(2)}`} />
          <Mini label="Risk / reward" value={`1 : ${plan.riskReward.toFixed(2)}`} />
          <Mini label="Kans omhoog / omlaag" value={`${plan.probabilityUp}% / ${plan.probabilityDown}%`} />
          <Mini label="Verwachte edge" value={`${plan.edgePct.toFixed(2)}%`} />
          <Mini label="Kosten + spread" value={`${plan.costPct.toFixed(2)}%`} />
          <Mini label="Modelovereenstemming" value={`${plan.agreement}%`} />
        </div>
        <div className="mt-4 space-y-2">
          {plan.reasons.map((reason, index) => <div key={reason} className="flex gap-3 text-sm"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-sm bg-primary/10 text-[10px] font-bold text-primary">{index + 1}</span><p className="text-muted-foreground">{reason}</p></div>)}
        </div>
        <p className="mt-4 border-l-2 border-destructive pl-3 text-xs text-muted-foreground"><strong className="text-foreground">Invalidatie:</strong> {plan.invalidation}</p>
        <div className="mt-4">
          <Button size="sm" variant="outline" onClick={() => explainMutation.mutate()} disabled={explainMutation.isPending}>
            {explainMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Plan in gewone taal
          </Button>
          {explanation && <p className="mt-3 rounded-md border border-border bg-background/50 p-3 text-xs leading-relaxed text-muted-foreground">{explanation}</p>}
        </div>
      </Card>

      <Card className="border-border/70 bg-card p-4 sm:p-5">
        <h4 className="text-sm font-semibold">Positie-sizing</h4>
        <p className="mt-1 text-xs text-muted-foreground">Op basis van je instapprijs en stop-loss. Risicobeheer, geen winstverwachting.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Portefeuille €</span>
            <Input type="number" min={0} value={portfolio} onChange={(e) => setPortfolio(e.target.value)} className="w-32" />
          </div>
          <div className="flex gap-2">
            {[0.5, 1, 2].map((p) => (
              <Button key={p} size="sm" variant={riskPct === p ? "default" : "secondary"} onClick={() => setRiskPct(p)}>
                {p}%
              </Button>
            ))}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Mini label="Risico per trade" value={`€${size.riskAmount.toFixed(2)}`} />
          <Mini label="Risico per stuk" value={`€${size.perUnit.toFixed(2)}`} />
          <Mini label="Aantal stuks" value={size.quantity >= 1 ? size.quantity.toFixed(0) : size.quantity.toFixed(4)} />
          <Mini label="Positiegrootte" value={`€${size.exposure.toFixed(0)} (${size.exposurePct.toFixed(0)}%)`} />
        </div>
        <Button
          className="mt-4 w-full"
          disabled={!tradable || size.quantity <= 0}
          onClick={() => {
            openPaperTrade({
              symbol: result.symbol,
              market: result.market,
              direction: plan.signal === "SELL" ? "short" : "long",
              entry: result.indicators.price,
              stop: plan.stopLoss,
              tp1: plan.takeProfit1,
              tp2: plan.takeProfit2,
              quantity: size.quantity,
              costPct: plan.costPct,
            });
          }}
        >
          {tradable ? "Virtueel uitvoeren (paper trade)" : "Geen trade om uit te voeren"}
        </Button>
      </Card>
    </div>
  );
}

function HourlyForecastPanel({ result }: { result: AnalyzeResult }) {
  const [hours, setHours] = useState(4);
  const active = result.hourlyForecasts.find((row) => row.hours === hours) ?? result.hourlyForecasts[0];
  const chartData = result.hourlyForecasts.map((row) => ({ label: `${row.hours}u`, koers: row.expectedPrice, laag: row.low, hoog: row.high }));
  return (
    <div className="space-y-4">
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {result.hourlyForecasts.map((row) => <Button key={row.hours} type="button" size="sm" variant={hours === row.hours ? "default" : "secondary"} onClick={() => setHours(row.hours)} className="shrink-0">{row.hours}u</Button>)}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {result.intraday
          ? `Berekend op echte intraday candles (${result.intraday.interval}, ${result.intraday.samples} candles): trend, VWAP, RSI, MACD, volume en ATR.`
          : "Geen intraday candles beschikbaar bij de databron — dit is een schatting op basis van dagkoersen (minder nauwkeurig)."}
      </p>
      {result.intraday && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Mini label="Intraday VWAP" value={result.intraday.vwap != null ? `€${result.intraday.vwap.toFixed(2)}` : "—"} />
          <Mini label="Intraday RSI" value={result.intraday.rsi != null ? result.intraday.rsi.toFixed(0) : "—"} />
          <Mini label="Volume t.o.v. gem." value={result.intraday.volumeRatio != null ? `${result.intraday.volumeRatio.toFixed(2)}×` : "—"} />
          <Mini label="Intraday ATR" value={`${result.intraday.atrPct.toFixed(2)}%`} />
        </div>
      )}
      <Card className="border-border/70 bg-card p-4 sm:p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div><p className="text-[10px] font-bold uppercase text-muted-foreground">Verwachting {active.hours} uur</p><p className={`mt-1 text-3xl font-bold ${active.expectedPct >= 0 ? "text-accent" : "text-destructive"}`}>{active.expectedPct >= 0 ? "+" : ""}{active.expectedPct.toFixed(2)}%</p></div>
          <div className="text-right"><p className="text-[10px] uppercase text-muted-foreground">Kans omhoog</p><p className="text-xl font-bold">{active.probabilityUp}%</p></div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2"><Mini label="Verwachte prijs" value={`€${active.expectedPrice.toFixed(2)}`} /><Mini label="Ondergrens" value={`€${active.low.toFixed(2)}`} /><Mini label="Bovengrens" value={`€${active.high.toFixed(2)}`} /></div>
        <div className="mt-5 h-56 w-full">
          <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" /><XAxis dataKey="label" tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} /><YAxis domain={["auto", "auto"]} width={52} tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} /><Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8 }} /><Area type="monotone" dataKey="hoog" fill="var(--color-primary)" fillOpacity={0.08} stroke="transparent" /><Line type="monotone" dataKey="koers" stroke="var(--color-primary)" strokeWidth={2.5} dot={{ fill: "var(--color-primary)" }} /></ComposedChart></ResponsiveContainer>
        </div>
      </Card>
      <Card className="border-border/70 bg-card p-4"><p className="text-[10px] font-bold uppercase text-muted-foreground">4u kompas</p><div className="mt-3 grid grid-cols-3 items-center gap-2 text-center"><div className="text-xs text-destructive">Bearish</div><div className={`mx-auto grid h-20 w-20 place-items-center rounded-full border-4 ${((result.hourlyForecasts.find((row) => row.hours === 4)?.expectedPct ?? 0) >= 0) ? "border-accent text-accent" : "border-destructive text-destructive"}`}><TrendingUp className="h-8 w-8" /></div><div className="text-xs text-accent">Bullish</div></div></Card>
    </div>
  );
}

function EntrySetupPanel({ result }: { result: AnalyzeResult }) {
  const plan = result.tradePlan;
  const verdict = plan.signal === "BUY" ? "Ja" : plan.signal === "NO_TRADE" || plan.signal === "SELL" ? "Nee" : "Misschien";
  return <Card className="border-border/70 bg-card p-4 sm:p-5"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase text-muted-foreground">Goed instapmoment?</p><h3 className="mt-1 text-2xl font-bold">{verdict}</h3></div><Target className="h-8 w-8 text-primary" /></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><Mini label="Agressieve entry" value={`€${plan.entryHigh.toFixed(2)}`} /><Mini label="Conservatieve entry" value={`€${plan.entryLow.toFixed(2)}`} /><Mini label="Breakout boven" value={`€${result.levels.resistance.toFixed(2)}`} /><Mini label="Pullback-zone" value={`€${plan.entryLow.toFixed(2)} – €${plan.entryHigh.toFixed(2)}`} /></div><p className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-muted-foreground"><strong className="text-destructive">Niet instappen als:</strong> {plan.invalidation}</p><div className="mt-4"><div className="mb-1 flex justify-between text-[10px] uppercase text-muted-foreground"><span>Risico</span><span>Potentieel rendement</span></div><div className="grid h-2 grid-cols-[minmax(0,1fr)_minmax(0,1.67fr)] gap-1"><span className="rounded-full bg-destructive" /><span className="rounded-full bg-accent" /></div><p className="mt-1 text-right text-xs font-semibold">1 : {plan.riskReward.toFixed(2)}</p></div></Card>;
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
  onRefresh,
  onAlert,
}: {
  result: AnalyzeResult;
  amount: string;
  setAmount: (v: string) => void;
  onRefresh: () => void;
  onAlert: () => void;
}) {
  const [section, setSection] = useState("overview");
  const tracking = getTrackingOverview(result.symbol, result.market);

  const inWatch = useStore().watchlist.some(
    (w) => w.symbol === result.symbol && w.market === result.market,
  );
  const sections = [
    ["overview", "Overzicht"],
    ["hourly", "Uurprognose"],
    ["plan", "Handelsplan"],
    ["models", "Modellen"],
    ["montecarlo", "Monte Carlo"],
    ["risk", "Risico"],
    ["entry", "Instapmoment"],
    ["accuracy", "Nauwkeurigheid"],
    ["paper", "Paper trading"],
    ["scanner", "Kansen"],
  ];
  const plan = result.tradePlan;
  const forecastAverage = (key: "day" | "week" | "month") =>
    result.ai.forecasts.length
      ? result.ai.forecasts.reduce((sum, forecast) => sum + forecast[key], 0) / result.ai.forecasts.length
      : 0;
  const signalTone = plan.signal === "BUY" ? "text-accent" : plan.signal === "SELL" ? "text-destructive" : plan.signal === "NO_TRADE" ? "text-warning" : "text-primary";

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-border/70 bg-card/90 shadow-xl backdrop-blur">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 p-4 sm:p-5">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase text-muted-foreground">
              <span>{result.market === "stock" ? "Aandeel / ETF" : "Crypto"}</span><span>•</span><span>Realtime analyse</span>
            </div>
            <h2 className="truncate text-2xl font-bold">{result.symbol}</h2>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-3xl font-bold tabular-nums">€{result.indicators.price.toFixed(2)}</span>
              <span className={`inline-flex items-center text-sm font-bold tabular-nums ${result.indicators.changePct >= 0 ? "text-accent" : "text-destructive"}`}>
                {result.indicators.changePct >= 0 ? <TrendingUp className="mr-1 h-4 w-4" /> : <TrendingDown className="mr-1 h-4 w-4" />}
                {result.indicators.changePct >= 0 ? "+" : ""}{result.indicators.changePct.toFixed(2)}%
              </span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase text-muted-foreground">Signaal</p>
            <p className={`mt-1 text-xl font-bold ${signalTone}`}>{plan.signal.replace("_", " ")}</p>
            <p className="text-[11px] text-muted-foreground">{plan.confidence}% modelmatig</p>
          </div>
          <div className="col-span-2 flex flex-wrap items-center gap-2 text-[10px]">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${result.dataFreshness.marketOpen ? "border-accent/40 bg-accent/10 text-accent" : "border-border bg-secondary/40 text-muted-foreground"}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {result.dataFreshness.marketOpen ? "Markt open" : "Markt gesloten"}
            </span>
            <span className="text-muted-foreground">
              {result.dataFreshness.reference?.kind === "dagslot"
                ? `Slotkoers ${new Date(result.dataFreshness.reference.at).toLocaleDateString("nl-NL", { dateStyle: "short" })}`
                : `Laatste koers ${new Date(result.dataFreshness.lastPriceAt).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" })}`}{" "}
              · {result.dataFreshness.source}
            </span>

            {result.dataFreshness.stale && (
              <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-warning">
                <AlertTriangle className="h-3 w-3" /> Data mogelijk vertraagd
              </span>
            )}
          </div>
          <p className="col-span-2 border-l-2 border-primary pl-3 text-xs leading-relaxed text-muted-foreground">{plan.summary}</p>
          <div className="col-span-2 grid grid-cols-3 gap-2">
            <Button size="sm" variant={inWatch ? "secondary" : "outline"} onClick={() => inWatch ? store.removeWatch(result.symbol, result.market) : store.addWatch({ symbol: result.symbol, market: result.market })}>
              <Star className={inWatch ? "fill-current" : ""} /><span className="hidden xs:inline">Watchlist</span>
            </Button>
            <Button size="sm" variant="outline" onClick={onAlert}><Bell /><span className="hidden xs:inline">Alert</span></Button>
            <Button size="sm" variant="outline" onClick={onRefresh}><RefreshCw /><span className="hidden xs:inline">Vernieuw</span></Button>
          </div>
        </div>
      </Card>

      <div className="no-scrollbar -mx-4 overflow-x-auto border-y border-border bg-background/80 px-4 sm:mx-0 sm:rounded-md sm:border">
        <div className="flex min-w-max gap-5">
          {sections.map(([value, label]) => (
            <Button key={value} type="button" variant="ghost" onClick={() => setSection(value)} className={`h-11 rounded-none border-b-2 px-0 text-xs ${section === value ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>
              {label}
            </Button>
          ))}
        </div>
      </div>

      {section === "overview" && <>
        <div className="h-56 w-full rounded-md border border-border bg-card px-1 py-3 sm:h-72">
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
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
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
        <Card className="border-border/70 bg-card p-4">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Mini label="Trend" value={result.stats.regime === "bull" ? "Bullish" : result.stats.regime === "bear" ? "Bearish" : "Zijwaarts"} />
            <Mini label="Momentum" value={(result.indicators.macdHist ?? 0) >= 0 ? "Positief" : "Negatief"} />
            <Mini label="Support" value={`€${result.levels.support.toFixed(2)}`} />
            <Mini label="Resistance" value={`€${result.levels.resistance.toFixed(2)}`} />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{result.ai.reasoning || plan.summary}</p>
        </Card>
        <IndicatorsExtraPanel ichimoku={result.indicators.ichimoku} price={result.indicators.price} fib={result.fibonacci} />
      </>}

      {section === "hourly" && <HourlyForecastPanel result={result} />}

      {section === "plan" && <TradePlanPanel result={result} />}

      {section === "models" && <>
        <Card className="border-border/70 bg-card p-4 sm:p-5">
          <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div><h3 className="text-lg font-semibold">Modelensemble</h3><p className="text-xs text-muted-foreground">Alle modellen wegen in het live-signaal even zwaar. De weegfactor hieronder is alleen indicatief (op basis van lokaal gemeten controles) en wordt nog niet toegepast op het live ensemble.</p></div>
            <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Inleg €</span><Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28" /></div>
          </div>
          <div className="mb-3 rounded-md border border-border/60 bg-secondary/30 p-3 text-xs text-muted-foreground">
            <p>{ACCURACY_EXPLAINER}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase">Historische koersdagen</p>
                <p className="text-sm font-semibold text-foreground tabular-nums">{result.stats.samples}</p>
                <p className="text-[10px]">gebruikt voor de huidige verwachtingen</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase">Gecontroleerde voorspellingen</p>
                <p className="text-sm font-semibold text-foreground tabular-nums">{tracking.observations}</p>
                <p className="text-[10px]">
                  {tracking.pending} lopen nog · {tracking.awaiting} te beoordelen · {tracking.horizonChecks} horizon-controles
                </p>
              </div>
            </div>
            <p className="mt-2">
              Controle van 1u/4u/24u/1w/1m kost die tijd: analyseer dit symbool later opnieuw, zodat er rond het einde van elke horizon een echte vergelijkingskoers wordt opgehaald. Met alleen een dagslotkoers worden 1u en 4u niet getoetst.
            </p>

          </div>

          <ForecastTable
            forecasts={result.ai.forecasts}
            amount={Number(amount) || 0}
            accuracy={getModelStats(result.symbol, result.market)}
            weights={getEnsembleWeights(result.ai.forecasts.map((f) => f.model), result.symbol, result.market)}
          />
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Mini label="Ensemble week" value={`${result.ensemble.ensembleWeekPct >= 0 ? "+" : ""}${result.ensemble.ensembleWeekPct.toFixed(2)}%`} />
            <Mini label="Signaal-z-score" value={result.ensemble.zWeek.toFixed(2)} />
            <Mini label="Overeenstemming" value={`${result.ensemble.agreement}%`} />
            <Mini label="Edge vs kosten" value={`${result.ensemble.edgePct.toFixed(2)}% / ${result.ensemble.costPct.toFixed(2)}%`} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-5">
            <div><span className="font-medium text-foreground">{result.stats.samples}</span> dagen</div>
            <div>Drift <span className="font-medium text-foreground">{result.stats.driftPct.toFixed(3)}%</span></div>
            <div>Vol <span className="font-medium text-foreground">{result.stats.annualVolPct.toFixed(1)}%</span></div>
            <div>Trend <span className="font-medium text-foreground">{result.stats.slopePctPerDay.toFixed(3)}%</span></div>
            <div className="capitalize">{result.stats.regime}</div>
          </div>
        </Card>
        <BacktestPanel result={result} />
      </>}

      {section === "montecarlo" && result.monteCarlo && <MonteCarloPanel mc={result.monteCarlo} price={result.indicators.price} amount={Number(amount) || 0} />}

      {section === "risk" && <>
        {(result.macro || result.earnings || result.fearGreed) && <ContextPanel macro={result.macro} earnings={result.earnings} fearGreed={result.fearGreed} />}
        {result.risk && <RiskPanel risk={result.risk} price={result.indicators.price} atr={result.indicators.atr} />}
      </>}

      {section === "entry" && <>
        <EntrySetupPanel result={result} />
        <EntryTiming indicators={result.indicators} />
      </>}

      {section === "accuracy" && <AccuracyPanel result={result} />}

      {section === "paper" && <PaperPanel result={result} />}

      {section === "scanner" && <ScannerPanel market={result.market} />}

      <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-[11px] leading-relaxed text-warning">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Analyse en kansinschattingen zijn geen garantie op winst. Beperk altijd je risico.
      </p>
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

      <BunqImportCard />
      <ImportedPositionsCard />

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
  const costPct = result?.market === "crypto" ? { feePct: 0.25, slippagePct: 0.1 } : { feePct: 0.1, slippagePct: 0.05 };
  const pb = useMemo(() => backtestPlan(history, costPct), [history, costPct.feePct, costPct.slippagePct]);

  if (!result) return <EmptyHint text="Analyseer eerst een symbool om te backtesten." />;

  const strategies: { key: Strategy; label: string; desc: string }[] = [
    { key: "sma-cross", label: "SMA Crossover (20/50)", desc: "Koop bij SMA20 > SMA50, verkoop bij omkering." },
    { key: "rsi", label: "RSI Oversold/Overbought", desc: "Koop bij RSI<30, verkoop bij RSI>70." },
    { key: "macd", label: "MACD Crossover", desc: "Koop bij MACD > signaal, verkoop bij omkering." },
  ];

  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card p-5">
        <h4 className="text-lg font-semibold">Backtest van het handelsplan</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Dezelfde BUY / SELL / NO TRADE-logica als de live-motor, met ATR-stop, take profits, {pb.costPct.toFixed(2)}% kosten en slippage per trade, op {pb.bars} dagen historie.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Totaal rendement" value={`${pb.totalReturnPct >= 0 ? "+" : ""}${pb.totalReturnPct.toFixed(1)}%`} tone={pb.totalReturnPct >= 0 ? "up" : "down"} hint={`Buy & hold: ${pb.buyHoldPct.toFixed(1)}%`} />
          <Stat label="Win rate" value={pb.winRate == null ? "—" : `${pb.winRate.toFixed(0)}%`} hint={`${pb.trades.length} trades · ${pb.noTradeBars} dagen geen trade`} />
          <Stat label="Profit factor" value={pb.profitFactor == null ? "—" : pb.profitFactor.toFixed(2)} hint={pb.expectancyPct == null ? undefined : `Expectancy ${pb.expectancyPct.toFixed(2)}%`} />
          <Stat label="Max drawdown" value={`-${pb.maxDrawdownPct.toFixed(1)}%`} tone="down" />
        </div>
        {pb.trades.length === 0 && (
          <p className="mt-3 text-xs text-warning">Het plan gaf op deze historie geen enkele trade — de edge bleef onder de kosten.</p>
        )}
      </Card>

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
        De losse indicator-strategieën hierboven rekenen zonder kosten of slippage; de plan-backtest bovenaan doet dat wél. Resultaten uit het verleden geven geen garantie voor de toekomst.
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

function SignalBadge({ signal, confidence }: { signal: "BUY" | "SELL" | "HOLD" | "NO_TRADE"; confidence: number }) {
  const map = {
    BUY: { label: "KOOP", cls: "bg-accent text-accent-foreground", icon: <TrendingUp className="h-4 w-4" /> },
    SELL: { label: "VERKOOP", cls: "bg-destructive text-destructive-foreground", icon: <TrendingDown className="h-4 w-4" /> },
    HOLD: { label: "HOUDEN", cls: "bg-secondary text-secondary-foreground", icon: <Activity className="h-4 w-4" /> },
    NO_TRADE: { label: "GEEN TRADE", cls: "bg-warning text-background", icon: <AlertTriangle className="h-4 w-4" /> },
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
  accuracy,
  weights,
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
  accuracy?: ModelStats[];
  weights?: { model: string; weight: number }[];
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
  const accMap = new Map((accuracy ?? []).map((a) => [a.model, a]));
  const weightMap = new Map((weights ?? []).map((x) => [x.model, x.weight]));

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
          {forecasts.map((f) => {
            const a = accMap.get(f.model);
            const w = weightMap.get(f.model);
            return (
            <tr key={f.model} className="border-b border-border/40 last:border-0">
              <td className="py-2 pr-3 font-medium">
                <div>{f.model}</div>
                <div className="text-[10px] text-muted-foreground">
                  {a && a.sufficient && a.hitRate != null && a.mae != null
                    ? `${a.observations} waarnemingen · ${a.samples} horizon-controles · richting juist ${a.hitRate.toFixed(0)}% · MAE ${a.mae.toFixed(1)}%`
                    : trackingLabel(a?.samples ?? 0)}
                  {w != null && ` · weegfactor (indicatief) ${(w * 100).toFixed(0)}%`}
                </div>

              </td>
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
            );
          })}
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

/* ---------------- Monte Carlo panel ---------------- */

function MonteCarloPanel({
  mc,
  price,
  amount,
}: {
  mc: AnalyzeResult["monteCarlo"];
  price: number;
  amount: number;
}) {
  if (!mc) return null;
  const horizons: {
    name: string;
    sub: string;
    h: NonNullable<AnalyzeResult["monteCarlo"]>["base"]["day"];
  }[] = [
    { name: "1 dag", sub: "morgen", h: mc.base.day },
    { name: "1 week", sub: "5 handelsdagen", h: mc.base.week },
    { name: "1 maand", sub: "21 handelsdagen", h: mc.base.month },
  ];

  const fmtEur = (n: number) =>
    (amount * (1 + n / 100)).toLocaleString("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  return (
    <Card className="border-border/60 bg-card p-5">
      <div className="mb-4">
        <h4 className="text-lg font-semibold">Kansverdeling (Monte Carlo)</h4>
        <p className="text-xs text-muted-foreground">
          1.000 gesimuleerde scenario's per horizon. Toont mediaan, P10–P90 spreiding en kans op winst.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {horizons.map((row) => {
          const h = row.h;
          const range = Math.max(Math.abs(h.p10), Math.abs(h.p90), 5);
          const pct = (v: number) => 50 + (v / range) * 50;
          return (
            <div key={row.name} className="rounded-lg border border-border/60 bg-background/40 p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <div>
                  <div className="font-semibold">{row.name}</div>
                  <div className="text-[10px] uppercase text-muted-foreground">{row.sub}</div>
                </div>
                <div className={`text-lg font-bold tabular-nums ${h.median >= 0 ? "text-accent" : "text-destructive"}`}>
                  {h.median >= 0 ? "+" : ""}{h.median.toFixed(2)}%
                </div>
              </div>
              <div className="relative mb-2 h-2 w-full rounded-full bg-secondary">
                <div
                  className="absolute top-0 h-2 rounded-full bg-primary/40"
                  style={{ left: `${pct(h.p10)}%`, width: `${pct(h.p90) - pct(h.p10)}%` }}
                />
                <div
                  className="absolute top-0 h-2 rounded-full bg-primary"
                  style={{ left: `${pct(h.p25)}%`, width: `${pct(h.p75) - pct(h.p25)}%` }}
                />
                <div
                  className="absolute top-[-2px] h-3 w-0.5 bg-foreground"
                  style={{ left: `${pct(0)}%` }}
                />
              </div>
              <div className="mb-2 flex justify-between text-[10px] tabular-nums text-muted-foreground">
                <span>{h.p10.toFixed(1)}%</span>
                <span>0%</span>
                <span>+{h.p90.toFixed(1)}%</span>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Kans op winst</span>
                  <span className={`font-semibold ${h.probUp >= 50 ? "text-accent" : "text-destructive"}`}>
                    {h.probUp.toFixed(0)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Kans &gt; +5%</span>
                  <span className="tabular-nums">{h.probGt5.toFixed(0)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Kans &lt; −5%</span>
                  <span className="tabular-nums">{h.probLtNeg5.toFixed(0)}%</span>
                </div>
                {amount > 0 && (
                  <div className="mt-2 border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
                    Inleg waarschijnlijk:&nbsp;
                    <span className="text-foreground">{fmtEur(h.p25)} – {fmtEur(h.p75)}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] text-muted-foreground">
        Donkere balk = 50% kans (P25–P75). Lichte balk = 80% kans (P10–P90). Verticale streep = huidige prijs ({price.toFixed(2)}).
      </p>
    </Card>
  );
}

/* ---------------- Context panel (macro + earnings + F&G) ---------------- */

function ContextPanel({
  macro,
  earnings,
  fearGreed,
}: {
  macro: AnalyzeResult["macro"];
  earnings: AnalyzeResult["earnings"];
  fearGreed: AnalyzeResult["fearGreed"];
}) {
  return (
    <Card className="border-border/60 bg-card p-5">
      <h4 className="mb-3 text-lg font-semibold">Marktcontext</h4>
      {earnings && earnings.inDays >= 0 && earnings.inDays <= 7 && (
        <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5" />
          Earnings over {earnings.inDays} {earnings.inDays === 1 ? "dag" : "dagen"} — verhoogde volatiliteit.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {macro?.vix != null && <Stat label="VIX" value={macro.vix.toFixed(1)} hint={macro.vix > 25 ? "Angst" : macro.vix < 15 ? "Kalm" : "Normaal"} />}
        {macro?.dxy != null && <Stat label="DXY" value={macro.dxy.toFixed(2)} hint="USD index" />}
        {macro?.tnx != null && <Stat label="10Y rente" value={`${macro.tnx.toFixed(2)}%`} hint="US treasury" />}
        {macro?.spxChangePct != null && (
          <Stat label="S&P500" value={`${macro.spxChangePct >= 0 ? "+" : ""}${macro.spxChangePct.toFixed(2)}%`} tone={macro.spxChangePct >= 0 ? "up" : "down"} hint="vorige dag" />
        )}
        {macro?.btcChangePct != null && (
          <Stat label="BTC" value={`${macro.btcChangePct >= 0 ? "+" : ""}${macro.btcChangePct.toFixed(2)}%`} tone={macro.btcChangePct >= 0 ? "up" : "down"} hint="vorige dag" />
        )}
        {fearGreed && (
          <Stat label="Fear & Greed" value={String(fearGreed.value)} hint={fearGreed.label} />
        )}
        {earnings && earnings.inDays != null && earnings.inDays > 7 && (
          <Stat label="Earnings" value={`${earnings.inDays}d`} hint={earnings.date?.slice(0, 10) ?? ""} />
        )}
      </div>
    </Card>
  );
}
/* ---------------- Extra indicatoren (Ichimoku + Fibonacci) ---------------- */

function IndicatorsExtraPanel({
  ichimoku,
  price,
  fib,
}: {
  ichimoku: { tenkan: number; kijun: number; spanA: number; spanB: number } | null | undefined;
  price: number;
  fib: { high: number; low: number; levels: { pct: number; price: number }[] } | null | undefined;
}) {
  if (!ichimoku && !fib) return null;
  const cloudTop = ichimoku ? Math.max(ichimoku.spanA, ichimoku.spanB) : 0;
  const cloudBot = ichimoku ? Math.min(ichimoku.spanA, ichimoku.spanB) : 0;
  const cloudColor = ichimoku && ichimoku.spanA >= ichimoku.spanB ? "bullish" : "bearish";
  const cloudPos =
    !ichimoku ? "" :
    price > cloudTop ? "Boven cloud (bullish)" :
    price < cloudBot ? "Onder cloud (bearish)" : "In cloud (onbeslist)";
  const tkCross = ichimoku ? (ichimoku.tenkan > ichimoku.kijun ? "Tenkan > Kijun (bullish)" : "Tenkan < Kijun (bearish)") : "";

  // dichtstbijzijnde fib-level
  let nearestFib: { pct: number; price: number; diffPct: number } | null = null;
  if (fib) {
    let best = Infinity;
    for (const l of fib.levels) {
      const d = Math.abs(l.price - price) / price * 100;
      if (d < best) { best = d; nearestFib = { ...l, diffPct: d }; }
    }
  }

  return (
    <Card className="border-border/60 bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <h4 className="text-lg font-semibold">Extra indicatoren</h4>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {ichimoku && (
          <div>
            <p className="mb-2 text-sm font-medium">Ichimoku Cloud</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Mini label="Tenkan (9)" value={ichimoku.tenkan.toFixed(2)} />
              <Mini label="Kijun (26)" value={ichimoku.kijun.toFixed(2)} />
              <Mini label="Span A" value={ichimoku.spanA.toFixed(2)} />
              <Mini label="Span B" value={ichimoku.spanB.toFixed(2)} />
            </div>
            <div className="mt-3 space-y-1 text-xs">
              <p>
                <span className="text-muted-foreground">Cloud:</span>{" "}
                <span className={cloudColor === "bullish" ? "text-accent" : "text-destructive"}>
                  {cloudColor === "bullish" ? "Bullish (groen)" : "Bearish (rood)"}
                </span>
              </p>
              <p><span className="text-muted-foreground">Prijs:</span> {cloudPos}</p>
              <p><span className="text-muted-foreground">Kruising:</span> {tkCross}</p>
            </div>
          </div>
        )}
        {fib && (
          <div>
            <p className="mb-2 text-sm font-medium">
              Fibonacci retracement <span className="text-xs text-muted-foreground">(90d range)</span>
            </p>
            <div className="space-y-1 text-xs">
              {fib.levels.map((l) => {
                const isNear = nearestFib?.pct === l.pct;
                const above = price >= l.price;
                return (
                  <div
                    key={l.pct}
                    className={`flex items-center justify-between rounded px-2 py-1 ${isNear ? "bg-primary/10 ring-1 ring-primary/40" : ""}`}
                  >
                    <span className="text-muted-foreground">{l.pct.toFixed(1)}%</span>
                    <span className="tabular-nums">€{l.price.toFixed(2)}</span>
                    <span className={`text-[10px] ${above ? "text-accent" : "text-destructive"}`}>
                      {above ? "↑ boven" : "↓ onder"}
                    </span>
                  </div>
                );
              })}
            </div>
            {nearestFib && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Dichtstbijzijnde: {nearestFib.pct.toFixed(1)}% (€{nearestFib.price.toFixed(2)}, {nearestFib.diffPct.toFixed(2)}% van prijs)
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

/* ---------------- Risico & Position Sizing ---------------- */

function RiskPanel({
  risk,
  price,
  atr,
}: {
  risk: {
    sharpe: number;
    sortino: number;
    maxDDPct: number;
    halfLifeDays: number;
    kellyPct: number;
    riskReward: number;
    long: { stop: number; target: number };
    short: { stop: number; target: number };
  };
  price: number;
  atr: number;
}) {
  const [side, setSide] = useState<"long" | "short">("long");
  const [portfolio, setPortfolio] = useState("10000");
  const [riskPct, setRiskPct] = useState("1");

  const lvl = side === "long" ? risk.long : risk.short;
  const portfolioVal = Number(portfolio) || 0;
  const riskFraction = (Number(riskPct) || 0) / 100;
  const perShareRisk = Math.abs(price - lvl.stop);
  const fixedRiskShares = perShareRisk > 0 ? Math.floor((portfolioVal * riskFraction) / perShareRisk) : 0;
  const fixedRiskCost = fixedRiskShares * price;
  const kellyShares = Math.floor((portfolioVal * (risk.kellyPct / 100)) / price);
  const kellyCost = kellyShares * price;
  const potentialProfit = side === "long" ? (lvl.target - price) * fixedRiskShares : (price - lvl.target) * fixedRiskShares;
  const potentialLoss = perShareRisk * fixedRiskShares;

  const sharpeHint =
    risk.sharpe > 1 ? "Goed" : risk.sharpe > 0.5 ? "Acceptabel" : risk.sharpe > 0 ? "Zwak" : "Verlies";

  return (
    <Card className="border-border/60 bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Shield className="h-4 w-4 text-primary" />
        <h4 className="text-lg font-semibold">Risico & Position Sizing</h4>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sharpe (1j)" value={risk.sharpe.toFixed(2)} hint={sharpeHint} tone={risk.sharpe >= 1 ? "up" : risk.sharpe < 0 ? "down" : undefined} />
        <Stat label="Sortino (1j)" value={risk.sortino.toFixed(2)} hint="Downside-only" tone={risk.sortino >= 1 ? "up" : risk.sortino < 0 ? "down" : undefined} />
        <Stat label="Max drawdown" value={`${risk.maxDDPct.toFixed(1)}%`} tone="down" hint="Grootste piek-dal" />
        <Stat label="OU half-life" value={risk.halfLifeDays > 0 ? `${risk.halfLifeDays.toFixed(0)}d` : "—"} hint={risk.halfLifeDays > 0 ? "Mean-reverting" : "Trend-volgend"} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border/60 bg-secondary p-1">
          {(["long", "short"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                side === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "long" ? "Long" : "Short"}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          ATR (14) = €{atr.toFixed(2)} · 1.5×ATR stop, 2.5×ATR target (R/R {risk.riskReward.toFixed(2)})
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Target className="h-3.5 w-3.5 text-accent" />
            Target ({side})
          </div>
          <p className="mt-1 text-lg font-semibold tabular-nums">€{lvl.target.toFixed(2)}</p>
          <p className="text-[11px] text-muted-foreground">
            {(((lvl.target - price) / price) * 100).toFixed(2)}% vanaf nu
          </p>
        </div>
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Shield className="h-3.5 w-3.5 text-destructive" />
            Stop-loss ({side})
          </div>
          <p className="mt-1 text-lg font-semibold tabular-nums">€{lvl.stop.toFixed(2)}</p>
          <p className="text-[11px] text-muted-foreground">
            {(((lvl.stop - price) / price) * 100).toFixed(2)}% vanaf nu
          </p>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/40 p-3">
          <div className="text-sm font-medium">Risk / Reward</div>
          <p className="mt-1 text-lg font-semibold tabular-nums">1 : {risk.riskReward.toFixed(2)}</p>
          <p className="text-[11px] text-muted-foreground">Per trade verwachting</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-muted-foreground">Portfolio waarde (€)</label>
          <Input type="number" min={0} value={portfolio} onChange={(e) => setPortfolio(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Risico per trade (%)</label>
          <Input type="number" step="0.1" min={0} max={10} value={riskPct} onChange={(e) => setRiskPct(e.target.value)} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
          <p className="mb-1 font-medium">Fixed-risk sizing</p>
          <p className="text-xs text-muted-foreground">
            Verlies max {riskPct}% (€{(portfolioVal * riskFraction).toFixed(0)}) bij stop.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <span className="text-muted-foreground">Aantal:</span>
            <span className="text-right tabular-nums font-medium">{fixedRiskShares}</span>
            <span className="text-muted-foreground">Positie waarde:</span>
            <span className="text-right tabular-nums">€{fixedRiskCost.toFixed(0)}</span>
            <span className="text-muted-foreground">Max verlies:</span>
            <span className="text-right tabular-nums text-destructive">−€{potentialLoss.toFixed(0)}</span>
            <span className="text-muted-foreground">Verwachte winst:</span>
            <span className="text-right tabular-nums text-accent">+€{potentialProfit.toFixed(0)}</span>
          </div>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
          <p className="mb-1 font-medium">Kelly criterium</p>
          <p className="text-xs text-muted-foreground">
            Optimale fractie o.b.v. drift/volatiliteit: <strong>{risk.kellyPct.toFixed(1)}%</strong> (gecapt op 25%).
          </p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <span className="text-muted-foreground">Aantal:</span>
            <span className="text-right tabular-nums font-medium">{kellyShares}</span>
            <span className="text-muted-foreground">Positie waarde:</span>
            <span className="text-right tabular-nums">€{kellyCost.toFixed(0)}</span>
            <span className="text-muted-foreground">% van portfolio:</span>
            <span className="text-right tabular-nums">
              {portfolioVal > 0 ? ((kellyCost / portfolioVal) * 100).toFixed(1) : "0"}%
            </span>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Veel traders gebruiken ½-Kelly of ¼-Kelly om volatiliteit te beperken.
          </p>
        </div>
      </div>
    </Card>
  );
}

/* ---------------- Nauwkeurigheid (gemeten) ---------------- */

function AccuracyPanel({ result }: { result: AnalyzeResult }) {
  const [, bump] = useState(0);
  useEffect(() => onAccuracyChange(() => bump((n) => n + 1)), []);
  const summary = getHorizonSummary(result.symbol, result.market);
  const stats = getModelStats(result.symbol, result.market);
  const overview = getTrackingOverview(result.symbol, result.market);


  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-card p-4 sm:p-5">
        <h3 className="text-lg font-semibold">Gemeten nauwkeurigheid — {result.symbol}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{ACCURACY_EXPLAINER}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div className="rounded-md border border-border/60 bg-secondary/30 p-2.5">
            <p className="text-[10px] font-bold uppercase">Historische koersdagen</p>
            <p className="text-base font-semibold text-foreground tabular-nums">{result.stats.samples}</p>
          </div>
          <div className="rounded-md border border-border/60 bg-secondary/30 p-2.5">
            <p className="text-[10px] font-bold uppercase">Onafhankelijke waarnemingen</p>
            <p className="text-base font-semibold text-foreground tabular-nums">{overview.observations}</p>
            <p className="text-[10px]">
              {overview.horizonChecks} horizon-controles · {overview.pending} lopen nog · {overview.awaiting} te beoordelen · {overview.expired} verlopen zonder betrouwbare koers
            </p>

          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Horizon</th>
                <th className="py-2 px-3 text-right font-medium">Waarnemingen</th>
                <th className="py-2 px-3 text-right font-medium">Horizon-controles</th>
                <th className="py-2 px-3 text-right font-medium">Lopend / te beoordelen</th>
                <th className="py-2 px-3 text-right font-medium">Richting juist</th>
                <th className="py-2 pl-3 text-right font-medium">Gem. fout</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((h) => (
                <tr key={h.key} className="border-b border-border/40 last:border-0">
                  <td className="py-2 pr-3 font-medium">{h.label}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{h.observations}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{h.modelChecks}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{h.pending} / {h.awaiting}</td>
                  <td className="py-2 px-3 text-right tabular-nums">
                    {h.sufficient && h.hitRate != null ? `${h.hitRate.toFixed(0)}%` : <span className="text-warning">{trackingLabel(h.observations)}</span>}
                  </td>

                  <td className="py-2 pl-3 text-right tabular-nums">
                    {h.sufficient && h.mae != null ? `${h.mae.toFixed(2)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[10px] text-muted-foreground">
          Elke horizon (1u, 4u, 24u, 1 week, 1 maand) kost die tijd voordat hij te toetsen is. Analyseer dit symbool later opnieuw rond het einde van een horizon, dan wordt de echte vergelijkingskoers opgehaald. Koers en tijdstip komen altijd uit dezelfde waarneming; vertraagde of onbevestigde koersen tellen niet mee. Met alleen een dagslotkoers worden 1u en 4u niet getoetst. Eén basismoment dat 24u + 1 week + 1 maand oplevert, telt als één waarneming en drie horizon-controles.
        </p>
      </Card>

      <Card className="border-border/70 bg-card p-4 sm:p-5">
        <h4 className="text-sm font-semibold">Per model (horizon-controles per model apart geteld)</h4>

        {stats.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Nog niet getoetst. De modellen rekenen wél al met {result.stats.samples} historische koersdagen; controles verschijnen hier zodra voorspellingen verlopen zijn.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-border/40">
            {stats.map((s) => (
              <div key={s.model} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate font-medium">{s.model}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {s.sufficient && s.hitRate != null && s.mae != null
                    ? `${s.observations} waarnemingen · ${s.samples} horizon-controles · richting juist ${s.hitRate.toFixed(0)}% · MAE ${s.mae.toFixed(1)}%`
                    : trackingLabel(s.samples)}
                </span>
              </div>
            ))}
          </div>
        )}

        <Button size="sm" variant="outline" className="mt-4" onClick={() => { clearForecastLog(); bump((n) => n + 1); }}>
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Metingen wissen
        </Button>
      </Card>
    </div>
  );
}

/* ---------------- Paper trading ---------------- */

function PaperPanel({ result }: { result: AnalyzeResult }) {
  const trades = usePaperTrades();
  const mine = trades.filter((t) => t.symbol === result.symbol && t.market === result.market);
  const stats = paperStats(trades);
  const fmt = (n: number | null, suffix = "%") => (n == null ? "—" : `${n >= 0 ? "" : ""}${n.toFixed(2)}${suffix}`);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Open posities" value={String(stats.open)} hint={`${stats.closed} afgesloten`} />
        <Stat label="Win rate" value={stats.winRate == null ? "—" : `${stats.winRate.toFixed(0)}%`} tone={(stats.winRate ?? 0) >= 50 ? "up" : "down"} />
        <Stat label="Profit factor" value={stats.profitFactor == null ? "—" : stats.profitFactor.toFixed(2)} />
        <Stat label="Expectancy" value={fmt(stats.expectancyPct)} tone={(stats.expectancyPct ?? 0) >= 0 ? "up" : "down"} hint={`Totaal ${stats.totalReturnPct.toFixed(2)}% · max drawdown ${stats.maxDrawdownPct.toFixed(2)}%`} />
      </div>

      <Card className="border-border/70 bg-card p-4 sm:p-5">
        <h4 className="text-sm font-semibold">Virtuele trades ({trades.length})</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Open een paper trade via het handelsplan. Stop-loss en take profits worden bij elke analyse van hetzelfde symbool getoetst. Kosten en slippage worden meegerekend.
        </p>
        {trades.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nog geen virtuele trades.</p>
        ) : (
          <div className="mt-3 divide-y divide-border/40">
            {trades.slice().reverse().map((t) => (
              <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.symbol}</span>
                    <Badge variant="secondary" className="text-[10px]">{t.direction === "long" ? "Long" : "Short"}</Badge>
                    <Badge variant={t.status === "open" ? "outline" : "secondary"} className="text-[10px]">{t.status === "open" ? "Open" : t.exitReason}</Badge>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Entry €{t.entry.toFixed(2)} · stop €{t.stop.toFixed(2)} · TP1 €{t.tp1.toFixed(2)} · {t.quantity >= 1 ? t.quantity.toFixed(0) : t.quantity.toFixed(4)} stuks
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Beste +{t.maxFavorablePct.toFixed(2)}% · slechtste {t.maxAdversePct.toFixed(2)}%
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold tabular-nums ${(t.returnPct ?? 0) >= 0 ? "text-accent" : "text-destructive"}`}>
                    {t.status === "closed" && t.returnPct != null ? `${t.returnPct >= 0 ? "+" : ""}${t.returnPct.toFixed(2)}%` : `€${t.lastPrice.toFixed(2)}`}
                  </p>
                  <div className="mt-1 flex justify-end gap-1">
                    {t.status === "open" && t.symbol === result.symbol && t.market === result.market && (
                      <Button size="sm" variant="secondary" onClick={() => closePaperTrade(t.id, result.indicators.price, "handmatig")}>
                        Sluiten
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => removePaperTrade(t.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {mine.length === 0 && trades.length > 0 && (
          <p className="mt-3 text-[11px] text-muted-foreground">Geen open trade voor {result.symbol}.</p>
        )}
      </Card>
      <p className="text-[11px] text-muted-foreground">Paper trading is een simulatie zonder echte orders. Resultaten zeggen niets over toekomstige winst.</p>
    </div>
  );
}

/* ---------------- Opportunity scanner ---------------- */

function ScannerPanel({ market }: { market: Market }) {
  const { watchlist } = useStore();
  const scan = useServerFn(scanOpportunities);
  const mutation = useMutation({
    mutationFn: (symbols: string[]) => scan({ data: { market, symbols } }),
  });

  const symbols = Array.from(
    new Set([
      ...PRESETS[market].map((p) => p.symbol),
      ...watchlist.filter((w) => w.market === market).map((w) => w.symbol),
    ]),
  ).slice(0, 12);

  const rows = mutation.data?.rows ?? [];
  const tradable = rows.filter((r) => r.signal !== "NO_TRADE" && r.sufficientData);

  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-card p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div>
            <h3 className="text-lg font-semibold">Top kansen vandaag</h3>
            <p className="text-xs text-muted-foreground">
              Scant {symbols.length} {market === "stock" ? "aandelen/ETF's" : "crypto's"} (presets + watchlist) op verwachte edge, modelovereenstemming en risk/reward.
            </p>
          </div>
          <Button onClick={() => mutation.mutate(symbols)} disabled={mutation.isPending}>
            {mutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scannen…</> : <><Layers className="mr-2 h-4 w-4" /> Scan nu</>}
          </Button>
        </div>
        {mutation.data && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            {mutation.data.analysed} van {mutation.data.requested} symbolen met voldoende historie · {tradable.length} met een bruikbare setup ·{" "}
            {new Date(mutation.data.scannedAt).toLocaleTimeString("nl-NL")}
          </p>
        )}
      </Card>

      {rows.length > 0 && (
        <Card className="border-border/70 bg-card p-4 sm:p-5">
          {tradable.length === 0 && (
            <p className="mb-3 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-warning">
              Geen enkele setup haalt de drempel. Niets doen is nu de conservatieve keuze.
            </p>
          )}
          <div className="divide-y divide-border/40">
            {rows.map((r) => (
              <div key={r.symbol} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.symbol}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${r.signal === "BUY" ? "border-accent/40 text-accent" : r.signal === "SELL" ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground"}`}
                    >
                      {r.signal.replace("_", " ")}
                    </Badge>
                    {!r.sufficientData && <span className="text-[10px] text-warning">weinig historie</span>}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{r.reason}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Edge {r.edgePct.toFixed(2)}% · kosten {r.costPct.toFixed(2)}% · overeenstemming {r.agreement}% · ATR {r.atrPct.toFixed(1)}%
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold tabular-nums">{r.score.toFixed(0)}</p>
                  <p className="text-[10px] uppercase text-muted-foreground">score</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <p className="text-[11px] text-muted-foreground">Een hoge score betekent alleen een relatief betere verhouding tussen verwachte beweging, onzekerheid en kosten — geen garantie op winst.</p>
    </div>
  );
}

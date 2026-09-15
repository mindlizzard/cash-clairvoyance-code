import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Clock3,
  Gauge,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { analyzeIntraday } from "@/lib/intraday.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/uurprognose")({
  head: () => ({
    meta: [
      { title: "Uurprognose — Beursziener" },
      {
        name: "description",
        content: "Intraday koersprognose voor 1, 2, 4, 8, 12 en 24 uur met trend, volatiliteit en kansbanden.",
      },
    ],
  }),
  component: IntradayPage,
});

type Market = "stock" | "crypto";
type IntradaySuccess = Extract<Awaited<ReturnType<typeof analyzeIntraday>>, { ok: true }>;

const PRESETS: Record<Market, { symbol: string; label: string }[]> = {
  stock: [
    { symbol: "NVDA", label: "Nvidia" },
    { symbol: "AAPL", label: "Apple" },
    { symbol: "TSLA", label: "Tesla" },
    { symbol: "MSFT", label: "Microsoft" },
    { symbol: "SPY", label: "S&P 500" },
  ],
  crypto: [
    { symbol: "bitcoin", label: "Bitcoin" },
    { symbol: "ethereum", label: "Ethereum" },
    { symbol: "solana", label: "Solana" },
    { symbol: "ripple", label: "XRP" },
  ],
};

function IntradayPage() {
  const [market, setMarket] = useState<Market>("stock");
  const [symbol, setSymbol] = useState("NVDA");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const analyze = useServerFn(analyzeIntraday);

  const mutation = useMutation({
    mutationFn: (vars: { symbol: string; market: Market }) => analyze({ data: vars }),
  });

  const result = mutation.data?.ok ? (mutation.data as IntradaySuccess) : null;
  const dataError = mutation.data && !mutation.data.ok ? mutation.data.error : null;

  const run = (sym = symbol, m = market) => {
    const clean = sym.trim();
    if (!clean) return;
    mutation.mutate({ symbol: clean, market: m });
  };

  useEffect(() => {
    run("NVDA", "stock");
    // eerste laadactie bewust één keer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoRefresh || !result) return;
    const id = window.setInterval(() => run(result.symbol, result.market), 5 * 60 * 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, result?.symbol, result?.market]);

  const changeMarket = (next: Market) => {
    setMarket(next);
    const nextSymbol = next === "stock" ? "NVDA" : "bitcoin";
    setSymbol(nextSymbol);
    run(nextSymbol, next);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-card/50 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="grid h-9 w-9 place-items-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground transition hover:text-foreground"
              aria-label="Terug naar dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[image:var(--gradient-hero)] shadow-[var(--shadow-glow)]">
              <Zap className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-semibold leading-none">Uurprognose</h1>
              <p className="mt-1 text-xs text-muted-foreground">Intraday · 1u tot 24u</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => run()} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Vernieuw
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-5 py-7">
        <section>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <Clock3 className="h-4 w-4" /> Korte termijn
          </div>
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Wat kan de koers de komende uren doen?</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground md:text-base">
            Een aparte intraday-laag naast de dag/week/maand-modellen. Recente uurdata, momentum, EMA-trend, RSI en EWMA-volatiliteit worden samengevoegd tot één prognosepad.
          </p>
        </section>

        <Card className="border-border/60 bg-card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-border/60 bg-secondary p-1">
              {(["stock", "crypto"] as Market[]).map(m => (
                <button
                  key={m}
                  onClick={() => changeMarket(m)}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${market === m ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {m === "stock" ? "Aandelen & ETF" : "Crypto"}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
              Automatisch elke 5 min
            </label>
          </div>

          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={e => {
              e.preventDefault();
              run();
            }}
          >
            <Input
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              placeholder={market === "stock" ? "NVDA, AAPL, SPY..." : "bitcoin, ethereum..."}
              className="flex-1"
            />
            <Button type="submit" disabled={mutation.isPending} className="sm:w-40">
              {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}
              Bereken
            </Button>
          </form>

          <div className="mt-4 flex flex-wrap gap-2">
            {PRESETS[market].map(p => (
              <button
                key={p.symbol}
                onClick={() => {
                  setSymbol(p.symbol);
                  run(p.symbol, market);
                }}
                className="rounded-full border border-border/60 bg-secondary/60 px-3 py-1 text-xs text-muted-foreground transition hover:border-primary/60 hover:text-foreground"
              >
                {p.label}
              </button>
            ))}
          </div>
        </Card>

        {(mutation.isError || dataError) && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {dataError ?? (mutation.error as Error)?.message ?? "Onbekende fout"}
          </div>
        )}

        {result ? <IntradayDashboard result={result} /> : (
          <Card className="border-border/60 bg-card p-10 text-center text-sm text-muted-foreground">
            {mutation.isPending ? "Uurdata ophalen en prognose berekenen…" : "Kies een ticker of coin en bereken de uurprognose."}
          </Card>
        )}
      </main>
    </div>
  );
}

function IntradayDashboard({ result }: { result: IntradaySuccess }) {
  const money = useMemo(
    () => new Intl.NumberFormat("nl-NL", { style: "currency", currency: result.currency, maximumFractionDigits: result.currentPrice < 10 ? 4 : 2 }),
    [result.currency, result.currentPrice],
  );
  const signal = signalMeta(result.signal);
  const fourHour = result.forecasts.find(f => f.hours === 4) ?? result.forecasts[0];

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-border/60 bg-card p-0">
        <div className="grid gap-5 p-5 md:grid-cols-[1.3fr_1fr] md:items-center">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <span>{result.symbol}</span>
              <span>·</span>
              <span>{result.market === "stock" ? "handelsuren" : "24/7 klokuren"}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-3">
              <span className="text-4xl font-bold tabular-nums">{money.format(result.currentPrice)}</span>
              <span className={`inline-flex items-center text-sm font-semibold ${result.oneHourChangePct >= 0 ? "text-accent" : "text-destructive"}`}>
                {result.oneHourChangePct >= 0 ? <TrendingUp className="mr-1 h-4 w-4" /> : <TrendingDown className="mr-1 h-4 w-4" />}
                {signed(result.oneHourChangePct)} laatste uur
              </span>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Bij aandelen betekent +8u acht toekomstige handelsuren, dus niet automatisch acht klokuren na sluiting.
            </p>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">4u kompas</p>
                <p className={`mt-1 text-xl font-bold ${signal.cls}`}>{signal.label}</p>
              </div>
              <Gauge className={`h-8 w-8 ${signal.cls}`} />
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Verwachting</p>
                <p className={`text-lg font-semibold tabular-nums ${fourHour.expectedPct >= 0 ? "text-accent" : "text-destructive"}`}>
                  {signed(fourHour.expectedPct)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Modelvertrouwen</p>
                <p className="text-lg font-semibold tabular-nums">{result.confidence}%</p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {result.forecasts.map(f => (
          <ForecastCard key={f.hours} row={f} money={money} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/60 bg-card p-5">
          <div className="mb-4">
            <h3 className="font-semibold">Recente uurkoers</h3>
            <p className="text-xs text-muted-foreground">Laatste {result.recent.length} beschikbare uurpunten</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={result.recent}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.02 260)" />
                <XAxis dataKey="label" minTickGap={28} tick={{ fontSize: 10 }} />
                <YAxis domain={["auto", "auto"]} width={70} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => money.format(v)} />
                <Line type="monotone" dataKey="close" stroke="oklch(0.72 0.18 235)" strokeWidth={2} dot={false} name="Koers" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="border-border/60 bg-card p-5">
          <div className="mb-4">
            <h3 className="font-semibold">Prognosepad</h3>
            <p className="text-xs text-muted-foreground">Verwachte koers met 80%-band</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={result.path}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.02 260)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis domain={["auto", "auto"]} width={70} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => money.format(v)} />
                <Line type="monotone" dataKey="highPrice" stroke="oklch(0.72 0.08 230)" strokeDasharray="4 4" dot={false} name="Bovengrens" />
                <Line type="monotone" dataKey="expectedPrice" stroke="oklch(0.72 0.18 145)" strokeWidth={2.5} dot={{ r: 3 }} name="Verwacht" />
                <Line type="monotone" dataKey="lowPrice" stroke="oklch(0.65 0.12 25)" strokeDasharray="4 4" dot={false} name="Ondergrens" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="border-border/60 bg-card p-5">
        <div className="mb-4">
          <h3 className="font-semibold">Alle horizons</h3>
          <p className="text-xs text-muted-foreground">Niet alleen richting, maar ook kans en onzekerheid.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Horizon</th>
                <th className="px-3 py-2 text-right font-medium">Verwacht</th>
                <th className="px-3 py-2 text-right font-medium">Koers</th>
                <th className="px-3 py-2 text-right font-medium">80% band</th>
                <th className="px-3 py-2 text-right font-medium">Kans ↑</th>
                <th className="py-2 pl-3 text-right font-medium">Vertrouwen</th>
              </tr>
            </thead>
            <tbody>
              {result.forecasts.map(f => (
                <tr key={f.hours} className="border-b border-border/40 last:border-0">
                  <td className="py-2 pr-3 font-semibold">+{f.hours} uur</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${f.expectedPct >= 0 ? "text-accent" : "text-destructive"}`}>{signed(f.expectedPct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money.format(f.expectedPrice)}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">{money.format(f.lowPrice)} – {money.format(f.highPrice)}</td>
                  <td className={`px-3 py-2 text-right font-medium tabular-nums ${f.probUp >= 50 ? "text-accent" : "text-destructive"}`}>{f.probUp.toFixed(0)}%</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{f.confidence}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="border-border/60 bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Intraday-diagnose</h3>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Mini label="RSI uur" value={result.diagnostics.rsi == null ? "—" : result.diagnostics.rsi.toFixed(1)} hint={rsiHint(result.diagnostics.rsi)} />
          <Mini label="EMA 8 vs 21" value={signed(result.diagnostics.trendPct)} hint={result.diagnostics.trendPct >= 0 ? "Korte trend boven lange" : "Korte trend onder lange"} />
          <Mini label="Momentum 3u" value={signed(result.diagnostics.momentum3hPct)} />
          <Mini label="Momentum 6u" value={signed(result.diagnostics.momentum6hPct)} />
          <Mini label="Steun 24u" value={money.format(result.diagnostics.support)} />
          <Mini label="Weerstand 24u" value={money.format(result.diagnostics.resistance)} />
          <Mini label="Uurvolatiliteit" value={`${result.stats.hourlyVolPct.toFixed(2)}%`} hint="EWMA" />
          <Mini label="Datapunten" value={String(result.stats.samples)} hint="uurreturns" />
        </div>
      </Card>

      <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-warning">
        Prognoses op uren zijn veel gevoeliger voor nieuws, earnings, macrodata en plotseling volume dan dag- of weekmodellen. Dit is een probabilistische indicatie, geen glazen bol met Bloomberg-abonnement.
      </div>
    </div>
  );
}

function ForecastCard({ row, money }: { row: IntradaySuccess["forecasts"][number]; money: Intl.NumberFormat }) {
  const up = row.expectedPct >= 0;
  return (
    <Card className="border-border/60 bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">+{row.hours} uur</span>
        {up ? <TrendingUp className="h-4 w-4 text-accent" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${up ? "text-accent" : "text-destructive"}`}>{signed(row.expectedPct)}</p>
      <p className="mt-1 text-sm font-medium tabular-nums">{money.format(row.expectedPrice)}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full bg-primary" style={{ width: `${row.confidence}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
        <span>↑ {row.probUp.toFixed(0)}%</span>
        <span>conf. {row.confidence}%</span>
      </div>
    </Card>
  );
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/40 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function signed(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function rsiHint(rsi: number | null) {
  if (rsi == null) return "Geen waarde";
  if (rsi >= 70) return "Overbought";
  if (rsi <= 30) return "Oversold";
  return "Neutraal";
}

function signalMeta(signal: IntradaySuccess["signal"]) {
  if (signal === "BULLISH") return { label: "Bullish", cls: "text-accent" };
  if (signal === "BEARISH") return { label: "Bearish", cls: "text-destructive" };
  return { label: "Neutraal", cls: "text-muted-foreground" };
}

import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { TrendingUp, TrendingDown, Activity, Sparkles, AlertTriangle, Loader2 } from "lucide-react";
import { analyzeAsset } from "@/lib/analyze.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Beursziener — AI Koersanalyse & Prognose" },
      {
        name: "description",
        content:
          "Analyseer aandelen en crypto met technische indicatoren (RSI, MACD, SMA) en AI-prognose in het Nederlands.",
      },
      { property: "og:title", content: "Beursziener — AI Koersanalyse" },
      {
        property: "og:description",
        content: "Snel inzicht in aandelen en crypto met AI-gedreven koop/verkoop signalen.",
      },
    ],
  }),
  component: Home,
});

type Market = "stock" | "crypto";

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

function Home() {
  const [market, setMarket] = useState<Market>("stock");
  const [symbol, setSymbol] = useState("NVDA");
  const analyze = useServerFn(analyzeAsset);

  const mutation = useMutation({
    mutationFn: (vars: { symbol: string; market: Market }) =>
      analyze({ data: vars }),
  });

  const response = mutation.data;
  const result = response?.ok ? response : null;
  const dataError = response && !response.ok ? response.error : null;

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!symbol.trim()) return;
    mutation.mutate({ symbol: symbol.trim(), market });
  };

  const pickPreset = (s: string) => {
    setSymbol(s);
    mutation.mutate({ symbol: s, market });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/60 bg-card/40 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-[image:var(--gradient-hero)] shadow-[var(--shadow-glow)]">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-none">Beursziener</h1>
              <p className="text-xs text-muted-foreground">AI koersanalyse</p>
            </div>
          </div>
          <span className="rounded-full border border-border/60 px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Live data
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8">
        {/* Hero */}
        <section className="mb-8">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Analyse, prognose en signalen
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">
            Voer een aandeel of crypto in en krijg direct technische indicatoren, een AI-prognose
            voor korte en lange termijn, en een koop/verkoop signaal.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning">
            <AlertTriangle className="h-3.5 w-3.5" />
            Geen financieel advies — markten zijn onvoorspelbaar. Beleg verantwoord.
          </p>
        </section>

        {/* Form */}
        <Card className="border-border/60 bg-card p-5">
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
          <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {dataError ?? (mutation.error as Error).message}
          </div>
        )}

        {result && (
          <div className="mt-8 space-y-6">
            {/* Signal Card */}
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
                <SignalBadge signal={result.ai.signal} confidence={result.ai.confidence} />
              </div>

              {/* Chart */}
              <div className="h-64 w-full bg-background/40 px-2 pb-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={result.chart}>
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
                    <Line
                      type="monotone"
                      dataKey="close"
                      stroke="oklch(0.72 0.18 235)"
                      strokeWidth={2}
                      dot={false}
                      name="Koers"
                    />
                    <Line
                      type="monotone"
                      dataKey="sma20"
                      stroke="oklch(0.78 0.17 145)"
                      strokeWidth={1.5}
                      dot={false}
                      name="SMA20"
                    />
                    <Line
                      type="monotone"
                      dataKey="sma50"
                      stroke="oklch(0.82 0.16 75)"
                      strokeWidth={1.5}
                      dot={false}
                      strokeDasharray="4 4"
                      name="SMA50"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Indicators grid */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="RSI (14)" value={result.indicators.rsi?.toFixed(1) ?? "—"} hint={rsiHint(result.indicators.rsi)} />
              <Stat
                label="MACD"
                value={result.indicators.macd?.toFixed(3) ?? "—"}
                hint={(result.indicators.macdHist ?? 0) >= 0 ? "Bullish histogram" : "Bearish histogram"}
                tone={(result.indicators.macdHist ?? 0) >= 0 ? "up" : "down"}
              />
              <Stat
                label="Week"
                value={`${result.indicators.weekChangePct.toFixed(2)}%`}
                tone={result.indicators.weekChangePct >= 0 ? "up" : "down"}
              />
              <Stat
                label="Maand"
                value={`${result.indicators.monthChangePct.toFixed(2)}%`}
                tone={result.indicators.monthChangePct >= 0 ? "up" : "down"}
              />
            </div>

            {/* AI Prognose */}
            <Card className="border-border/60 bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <div className="grid h-7 w-7 place-items-center rounded-md bg-[image:var(--gradient-hero)]">
                  <Sparkles className="h-4 w-4 text-primary-foreground" />
                </div>
                <h4 className="text-lg font-semibold">AI Prognose</h4>
                <span className="ml-auto text-xs text-muted-foreground">
                  Vertrouwen: {result.ai.confidence}%
                </span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Block icon={<Activity className="h-4 w-4 text-primary" />} title="Korte termijn (1–2 weken)" text={result.ai.shortTerm || "—"} />
                <Block icon={<TrendingUp className="h-4 w-4 text-accent" />} title="Lange termijn (3–6 mnd)" text={result.ai.longTerm || "—"} />
                <Block title="Analyse" text={result.ai.reasoning || "—"} />
                <Block title="Risico's" text={result.ai.risks || "—"} tone="warning" />
              </div>
            </Card>
          </div>
        )}

        {!result && !mutation.isPending && (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            Kies een ticker hierboven om je eerste analyse te starten.
          </p>
        )}

        <footer className="mt-12 border-t border-border/60 pt-6 text-center text-xs text-muted-foreground">
          Koersdata: Yahoo Finance & CoinGecko. Analyse via Lovable AI. Niet bedoeld als financieel advies.
        </footer>
      </main>
    </div>
  );
}

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

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  symbol: z.string().min(1).max(40),
  market: z.enum(["stock", "crypto"]),
});

type NewsItem = {
  title: string;
  publisher: string;
  link: string;
  publishedAt: number;
};

async function fetchYahooNews(query: string): Promise<NewsItem[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=10&quotesCount=0`;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!r.ok) return [];
    const j: any = await r.json();
    const news = Array.isArray(j?.news) ? j.news : [];
    return news
      .filter((n: any) => n?.title && n?.link)
      .slice(0, 10)
      .map((n: any) => ({
        title: String(n.title),
        publisher: String(n.publisher ?? ""),
        link: String(n.link),
        publishedAt: Number(n.providerPublishTime ?? 0) * 1000,
      }));
  } catch {
    return [];
  }
}

export const fetchNews = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const query =
      data.market === "crypto"
        ? `${data.symbol} crypto`
        : data.symbol.toUpperCase();
    const items = await fetchYahooNews(query);

    let sentiment: {
      score: number;
      label: string;
      summary: string;
    } | null = null;

    const apiKey = process.env.LOVABLE_API_KEY;
    if (apiKey && items.length) {
      try {
        const headlines = items.map((i, idx) => `${idx + 1}. ${i.title}`).join("\n");
        const prompt = `Analyseer het sentiment van deze recente nieuwskoppen over ${data.symbol}:\n\n${headlines}\n\nGeef JSON: { "score": getal -100..100, "label": "Zeer negatief"|"Negatief"|"Neutraal"|"Positief"|"Zeer positief", "summary": "1-2 zinnen NL waarom" }`;
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": apiKey,
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              {
                role: "system",
                content: "Je bent een NL financieel sentimentanalist. Antwoord altijd in valide JSON.",
              },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
          }),
        });
        if (r.ok) {
          const j = await r.json();
          const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
          if (typeof parsed?.score === "number") {
            sentiment = {
              score: Math.max(-100, Math.min(100, Math.round(parsed.score))),
              label: String(parsed.label ?? "Neutraal"),
              summary: String(parsed.summary ?? ""),
            };
          }
        }
      } catch (e) {
        console.error("Sentiment AI error", (e as Error).message);
      }
    }

    return { ok: true as const, items, sentiment };
  });
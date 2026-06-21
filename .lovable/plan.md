# Plan: Voorspellingen naar pro-niveau

Alle 20 verbeteringen, gegroepeerd in 5 fases. Elke fase is op zichzelf bruikbaar, dus na fase 1 zie je al direct resultaat.

## Fase 1 — Betere ruwe data (OHLC + volume + macro)
- Yahoo/CoinGecko: ophalen van **Open, High, Low, Close, Volume** i.p.v. alleen Close
- **ATR (14)** — echte volatiliteit op basis van true range
- **OBV** en **VWAP** — volume-bevestiging
- **Macro context** ophalen: VIX (^VIX), DXY (DX-Y.NYB), 10Y rente (^TNX), S&P500 (^GSPC), BTC. Correlatie laatste 60d wordt meegegeven aan modellen.
- **Earnings datum** (Yahoo) — waarschuwing als binnen 7 dagen

## Fase 2 — Monte Carlo + kansverdelingen
- **1000 simulaties** per horizon (1d, 5d, 21d) via geometrische Brownian motion met drift μ en vol σ
- Resultaat per horizon: **mediaan, P10, P25, P75, P90, kans op winst, kans op >5% / <-5%**
- Vervangt de huidige ±1σ band met een echte kansverdeling
- UI: violin/range-chart per horizon met percentiel-banden

## Fase 3 — Geavanceerde modellen
- **GARCH(1,1)** lichte implementatie voor vol-clustering → dynamische σ per dag
- **Holt-Winters** (dubbele exp. smoothing) voor trend-decompositie
- **Regime-detectie** op basis van SMA200-helling + ATR%: bull / bear / sideways → ander modelgewicht per regime
- **Ensemble met dynamische gewichten** op basis van recente accuracy (zie fase 4)

## Fase 4 — Accuracy tracking & kalibratie
- Lokaal in `localStorage`: bij elke analyse worden alle voorspellingen + actuele prijs opgeslagen
- Bij volgende analyse van zelfde symbool: vergelijk eerdere voorspelling met huidige werkelijkheid
- Bereken per model: **MAE, hit-rate (richting), Brier score**
- Toon "Trendvolger had laatste 30d 64% accuracy op AAPL" in UI
- Gewichten in ensemble passen zich automatisch aan op basis van accuracy

## Fase 5 — AI upgrades
- **Chain-of-thought prompt**: AI redeneert eerst stap-voor-stap (technisch, macro, risico's) vóór finale prognose
- **Few-shot voorbeelden** in prompt (3 historische gevallen)
- **2e AI-call** met Gemini Pro (zwaarder model) parallel — ensemblen van Flash + Pro
- **Sentiment integreren**: bestaand nieuws-sentiment wordt nu meegewogen in eindscore
- **Fear & Greed Index** (alternative.me API voor crypto, CNN scraping voor stocks) als context

## Technische details
- `src/lib/analyze.functions.ts`: uitgebreid met OHLC parser, ATR, OBV, VWAP, macro fetch, GARCH, regime, Monte Carlo
- `src/lib/montecarlo.ts` (nieuw): GBM simulator + percentielen
- `src/lib/accuracy.ts` (nieuw): localStorage tracking + scoring
- `src/lib/macro.functions.ts` (nieuw): VIX/DXY/10Y/SPX fetch
- `src/routes/index.tsx`: nieuwe "Kansverdeling" sectie met percentiel-bars, accuracy-badges per model, macro-context panel, earnings-waarschuwing

## Verwachte impact
- **Voorspellingen worden kansgebaseerd** ("72% kans op winst, mediaan +3.2%") i.p.v. losse %-getallen
- **Zelflerend**: modellen worden beter naarmate je het meer gebruikt
- **Context-bewust**: VIX-spike of earnings-week beïnvloedt prognose
- **Transparant**: je ziet welk model historisch werkt voor dit specifieke aandeel

## Niet meegenomen (vereist betaalde APIs)
- Intraday 1u/4u candles (Yahoo geeft beperkt, Polygon/Alpaca is betaald)
- Insider trading & analyst ratings (Finnhub gratis tier is zeer beperkt)
- Twitter/Reddit sentiment (X API kost geld)

Geef akkoord en ik bouw alle 5 fases achter elkaar.

/**
 * Monte Carlo simulator op basis van geometrische Brownian motion (GBM).
 * Geeft kansverdeling per horizon ipv één puntschatting.
 */

function gaussian(): number {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

export type HorizonStats = {
  horizonDays: number;
  median: number;     // %
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  probUp: number;     // 0-100
  probGt5: number;
  probLtNeg5: number;
  mean: number;
};

/**
 * Simuleer N paden van `days` dagen met dagdrift mu en dag-vol sigma.
 * Return kansverdeling-stats voor de eind-return (in %).
 */
export function simulateHorizon(
  mu: number,
  sigma: number,
  days: number,
  paths = 1000,
): HorizonStats {
  const finalReturns: number[] = new Array(paths);
  for (let p = 0; p < paths; p++) {
    let logRet = 0;
    for (let t = 0; t < days; t++) {
      logRet += (mu - 0.5 * sigma * sigma) + sigma * gaussian();
    }
    finalReturns[p] = (Math.exp(logRet) - 1) * 100;
  }
  finalReturns.sort((a, b) => a - b);
  const mean = finalReturns.reduce((s, x) => s + x, 0) / paths;
  const up = finalReturns.filter((r) => r > 0).length;
  const gt5 = finalReturns.filter((r) => r > 5).length;
  const lt5 = finalReturns.filter((r) => r < -5).length;
  return {
    horizonDays: days,
    median: percentile(finalReturns, 0.5),
    p10: percentile(finalReturns, 0.10),
    p25: percentile(finalReturns, 0.25),
    p75: percentile(finalReturns, 0.75),
    p90: percentile(finalReturns, 0.90),
    probUp: (up / paths) * 100,
    probGt5: (gt5 / paths) * 100,
    probLtNeg5: (lt5 / paths) * 100,
    mean,
  };
}

export function simulateAllHorizons(mu: number, sigma: number, paths = 1000) {
  return {
    day: simulateHorizon(mu, sigma, 1, paths),
    week: simulateHorizon(mu, sigma, 5, paths),
    month: simulateHorizon(mu, sigma, 21, paths),
  };
}
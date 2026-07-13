export interface PricePoint {
  month: string;
  price: number;
}

// Rolling window ending at the current month, so the chart never shows
// stale year labels. monthIdx is the 0-based calendar month, used to place
// seasonal effects (Black Friday etc.) on the right actual months.
function lastMonths(count: number): { label: string; monthIdx: number }[] {
  const out: { label: string; monthIdx: number }[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      label: `${d.toLocaleString('en-US', { month: 'short' })} ${d.getFullYear()}`,
      monthIdx: d.getMonth(),
    });
  }
  return out;
}

function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function strToSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(31, h) + id.charCodeAt(i) | 0;
  }
  return Math.abs(h);
}

export function generatePriceHistory(currentPrice: number, partId: string): PricePoint[] {
  const rng = seededRng(strToSeed(partId));
  const months = lastMonths(13);
  const history: PricePoint[] = [];

  let price = Math.round(currentPrice * 1.15);

  for (let i = 0; i < 12; i++) {
    history.push({ month: months[i].label, price: Math.round(price) });

    const m = months[i].monthIdx;
    if (m === 9) {
      // October — slight dip
      price *= 1 - 0.03 - rng() * 0.03;
    } else if (m === 10) {
      // November — Black Friday
      price *= 0.88;
    } else if (m === 11) {
      // December — slight recovery
      price *= 1 + 0.02 + rng() * 0.03;
    } else {
      // Normal month ±3-8%
      const change = (rng() - 0.5) * 0.12;
      price *= 1 + change;
    }

    // Clamp to reasonable bounds (50% - 150% of current)
    price = Math.max(currentPrice * 0.5, Math.min(currentPrice * 1.5, price));
  }

  // Final price snaps to current
  history.push({ month: months[12].label, price: currentPrice });

  return history;
}

export function getPriceStats(history: PricePoint[], currentPrice: number) {
  const prices = history.map(p => p.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minMonth = history.find(p => p.price === minPrice)?.month ?? '';
  const maxMonth = history.find(p => p.price === maxPrice)?.month ?? '';
  const firstPrice = history[0].price;
  const trendPct = Math.round(((currentPrice - firstPrice) / firstPrice) * 100);

  let badge: 'great' | 'high' | 'average' = 'average';
  if (currentPrice <= minPrice * 1.05) badge = 'great';
  else if (currentPrice >= maxPrice * 0.95) badge = 'high';

  return { minPrice, maxPrice, minMonth, maxMonth, trendPct, badge };
}

export function getSparklineTrend(history: PricePoint[], currentPrice: number): 'up' | 'down' | 'flat' {
  const firstPrice = history[0]?.price ?? currentPrice;
  const pct = ((currentPrice - firstPrice) / firstPrice) * 100;
  if (pct < -5) return 'down';
  if (pct > 5) return 'up';
  return 'flat';
}

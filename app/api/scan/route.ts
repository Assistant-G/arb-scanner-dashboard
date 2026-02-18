import { NextResponse } from 'next/server';
import Fuse from 'fuse.js';

interface Market {
  platform: string;
  id: string;
  question: string;
  event: string;
  yes_price: number;
  no_price: number;
  url: string;
}

interface Match {
  polymarket: Market;
  kalshi: Market;
  match_score: number;
}

interface Arb {
  question: string;
  match_score: number;
  spread: number;
  cost: number;
  strategy: string;
  poly_url: string;
  kalshi_url: string;
  poly_yes: number;
  poly_no: number;
  kalshi_yes: number;
  kalshi_no: number;
}

function normalize(text: string): string {
  text = text.toLowerCase().trim();
  text = text.replace(/[^\w\s]/g, '');
  for (const w of ['will', 'the', 'be', 'to', 'in', 'on', 'by', 'of', 'a', 'an', 'is']) {
    text = text.replace(new RegExp(`\\b${w}\\b`, 'g'), '');
  }
  return text.replace(/\s+/g, ' ').trim();
}

async function fetchPolymarket(): Promise<Market[]> {
  const markets: Market[] = [];
  try {
    const resp = await fetch(
      'https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100',
      { signal: AbortSignal.timeout(15000), cache: 'no-store' }
    );
    const events = await resp.json();
    for (const event of events) {
      for (const mkt of event.markets || []) {
        if (mkt.closed || !mkt.active) continue;
        let prices: number[];
        try {
          prices = typeof mkt.outcomePrices === 'string'
            ? JSON.parse(mkt.outcomePrices)
            : mkt.outcomePrices;
        } catch { continue; }
        if (!prices || prices.length < 2) continue;
        markets.push({
          platform: 'Polymarket',
          id: mkt.conditionId || mkt.id || '',
          question: mkt.question || event.title || '',
          event: event.title || '',
          yes_price: parseFloat(String(prices[0])),
          no_price: parseFloat(String(prices[1])),
          url: `https://polymarket.com/event/${event.slug || ''}`,
        });
      }
    }
  } catch (e) {
    console.error('[Polymarket] Error:', e);
  }
  return markets;
}

async function fetchKalshi(): Promise<Market[]> {
  const markets: Market[] = [];
  let cursor: string | null = null;
  let pages = 0;
  try {
    while (markets.length < 200 && pages < 2) {
      pages++;
      const params = new URLSearchParams({ limit: '100', status: 'open' });
      if (cursor) params.set('cursor', cursor);
      const resp = await fetch(
        `https://api.elections.kalshi.com/trade-api/v2/markets?${params}`,
        { signal: AbortSignal.timeout(15000), cache: 'no-store' }
      );
      const data = await resp.json();
      for (const mkt of data.markets || []) {
        let yes_price: number;
        const { yes_bid, yes_ask, no_bid, no_ask, last_price } = mkt;
        if (yes_bid && yes_ask && yes_bid > 0) {
          yes_price = (yes_bid + yes_ask) / 2 / 100;
        } else if (yes_ask && yes_ask > 0) {
          yes_price = yes_ask / 100;
        } else if (last_price && last_price > 0) {
          yes_price = last_price / 100;
        } else continue;

        let no_price: number;
        if (no_bid != null && no_ask != null && no_bid > 0) {
          no_price = (no_bid + no_ask) / 2 / 100;
        } else {
          no_price = 1.0 - yes_price;
        }

        const question = mkt.subtitle
          ? `${mkt.title} ${mkt.subtitle}`.trim()
          : mkt.title || '';

        markets.push({
          platform: 'Kalshi',
          id: mkt.ticker || '',
          question,
          event: mkt.event_ticker || '',
          yes_price: Math.round(yes_price * 10000) / 10000,
          no_price: Math.round(no_price * 10000) / 10000,
          url: `https://kalshi.com/markets/${mkt.ticker || ''}`,
        });
      }
      cursor = data.cursor;
      if (!cursor || (data.markets || []).length < 100) break;
    }
  } catch (e) {
    console.error('[Kalshi] Error:', e);
  }
  return markets;
}

function matchMarkets(poly: Market[], kalshi: Market[], threshold = 65): Match[] {
  const normalizedKalshi = kalshi.map(k => ({ ...k, normalized: normalize(k.question) }));
  const fuse = new Fuse(normalizedKalshi, {
    keys: ['normalized'],
    threshold: 0.6,
    includeScore: true,
  });

  const matches: Match[] = [];
  for (const pm of poly) {
    const pq = normalize(pm.question);
    const results = fuse.search(pq);
    if (results.length > 0) {
      const best = results[0];
      const score = Math.round((1 - (best.score || 1)) * 100);
      if (score >= threshold) {
        matches.push({
          polymarket: pm,
          kalshi: best.item,
          match_score: score,
        });
      }
    }
  }
  return matches;
}

function findArbitrage(matches: Match[]): Arb[] {
  const arbs: Arb[] = [];
  for (const m of matches) {
    const pm = m.polymarket;
    const km = m.kalshi;
    const cost1 = pm.yes_price + km.no_price;
    const spread1 = 1.0 - cost1;
    const cost2 = pm.no_price + km.yes_price;
    const spread2 = 1.0 - cost2;

    if (spread1 > 0 || spread2 > 0) {
      const bestSpread = Math.max(spread1, spread2);
      let strategy: string, cost: number;
      if (spread1 >= spread2) {
        strategy = `BUY YES@Poly($${pm.yes_price.toFixed(2)}) + BUY NO@Kalshi($${km.no_price.toFixed(2)})`;
        cost = cost1;
      } else {
        strategy = `BUY NO@Poly($${pm.no_price.toFixed(2)}) + BUY YES@Kalshi($${km.yes_price.toFixed(2)})`;
        cost = cost2;
      }
      arbs.push({
        question: pm.question.slice(0, 80),
        match_score: m.match_score,
        spread: bestSpread,
        cost,
        strategy,
        poly_url: pm.url,
        kalshi_url: km.url,
        poly_yes: pm.yes_price,
        poly_no: pm.no_price,
        kalshi_yes: km.yes_price,
        kalshi_no: km.no_price,
      });
    }
  }
  arbs.sort((a, b) => b.spread - a.spread);
  return arbs;
}

export async function GET() {
  const start = Date.now();
  const [poly, kalshi] = await Promise.all([fetchPolymarket(), fetchKalshi()]);
  const matches = matchMarkets(poly, kalshi);
  const arbs = findArbitrage(matches);
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    scanTime: Date.now() - start,
    polymarketCount: poly.length,
    kalshiCount: kalshi.length,
    matchCount: matches.length,
    opportunities: arbs,
  });
}

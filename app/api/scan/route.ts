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
    const allEvents = [];
    for (let offset = 0; offset < 200; offset += 100) {
      const resp = await fetch(
        `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100&offset=${offset}`,
        { signal: AbortSignal.timeout(8000), cache: 'no-store' }
      );
      const batch = await resp.json();
      if (!batch || batch.length === 0) break;
      allEvents.push(...batch);
    }
    const events = allEvents;
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
  try {
    // Get all events first
    const evResp = await fetch(
      'https://api.elections.kalshi.com/trade-api/v2/events?limit=100&status=open',
      { signal: AbortSignal.timeout(8000), cache: 'no-store' }
    );
    const evData = await evResp.json();
    const events = evData.events || [];

    // Fetch markets per event in parallel (sports parlays don't appear under events)
    const fetchEvent = async (ticker: string, evTitle: string) => {
      try {
        const resp = await fetch(
          `https://api.elections.kalshi.com/trade-api/v2/markets?limit=50&status=open&event_ticker=${ticker}`,
          { signal: AbortSignal.timeout(5000), cache: 'no-store' }
        );
        const data = await resp.json();
        const result: Market[] = [];
        for (const mkt of data.markets || []) {
          const title = mkt.title || '';
          if (title.startsWith('yes ') || title.startsWith('no ')) continue;

          const { yes_bid, yes_ask, no_bid, no_ask, last_price } = mkt;
          let yes_price: number;
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
            ? `${title} - ${mkt.subtitle}`.trim()
            : `${evTitle} - ${title}`.trim();

          result.push({
            platform: 'Kalshi',
            id: mkt.ticker || '',
            question,
            event: ticker,
            yes_price: Math.round(yes_price * 10000) / 10000,
            no_price: Math.round(no_price * 10000) / 10000,
            url: `https://kalshi.com/markets/${mkt.ticker || ''}`,
          });
        }
        return result;
      } catch { return []; }
    };

    // Fetch first 30 events in parallel batches of 10
    for (let i = 0; i < Math.min(events.length, 30); i += 10) {
      const batch = events.slice(i, i + 10);
      const results = await Promise.all(
        batch.map((e: any) => fetchEvent(e.event_ticker, e.title || ''))
      );
      for (const r of results) markets.push(...r);
    }
  } catch (e) {
    console.error('[Kalshi] Error:', e);
  }
  return markets;
}

function matchMarkets(poly: Market[], kalshi: Market[], threshold = 40): Match[] {
  // Strategy 1: Fuse.js fuzzy match
  const normalizedKalshi = kalshi.map(k => ({ ...k, normalized: normalize(k.question) }));
  const fuse = new Fuse(normalizedKalshi, {
    keys: ['normalized', 'question'],
    threshold: 0.8,
    distance: 300,
    includeScore: true,
    ignoreLocation: true,
  });

  const matches: Match[] = [];
  const usedKalshi = new Set<string>();

  for (const pm of poly) {
    const pq = normalize(pm.question);
    if (pq.length < 10) continue;

    const results = fuse.search(pq);
    if (results.length > 0) {
      const best = results[0];
      const kid = best.item.id;
      if (usedKalshi.has(kid)) continue;

      const score = Math.round((1 - (best.score || 1)) * 100);
      if (score >= threshold) {
        usedKalshi.add(kid);
        matches.push({
          polymarket: pm,
          kalshi: best.item,
          match_score: score,
        });
      }
    }
  }

  // Strategy 2: keyword overlap scoring
  for (const pm of poly) {
    const pWords = new Set(normalize(pm.question).split(' ').filter(w => w.length > 3));
    if (pWords.size < 2) continue;

    let bestScore = 0;
    let bestKm: Market | null = null;

    for (const km of kalshi) {
      if (usedKalshi.has(km.id)) continue;
      const kWords = new Set(normalize(km.question).split(' ').filter(w => w.length > 3));
      const overlap = Array.from(pWords).filter(w => kWords.has(w)).length;
      const score = Math.round(overlap / Math.max(pWords.size, kWords.size) * 100);
      if (score > bestScore && score >= threshold) {
        bestScore = score;
        bestKm = km;
      }
    }

    if (bestKm && bestScore >= threshold && !usedKalshi.has(bestKm.id)) {
      usedKalshi.add(bestKm.id);
      matches.push({
        polymarket: pm,
        kalshi: bestKm,
        match_score: bestScore,
      });
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

export const maxDuration = 30;

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
    debug: {
      samplePoly: poly.slice(0, 5).map(m => m.question),
      sampleKalshi: kalshi.slice(0, 5).map(m => m.question),
      allMatches: matches.map(m => ({
        poly: m.polymarket.question.slice(0, 60),
        kalshi: m.kalshi.question.slice(0, 60),
        score: m.match_score,
      })),
    },
  });
}

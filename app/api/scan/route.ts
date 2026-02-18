import { NextResponse } from 'next/server';

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
  marketA: Market;
  marketB: Market;
  match_score: number;
}

interface Arb {
  question: string;
  match_score: number;
  spread: number;
  cost: number;
  strategy: string;
  platformA: string;
  platformB: string;
  urlA: string;
  urlB: string;
  yesA: number;
  noA: number;
  yesB: number;
  noB: number;
}

function normalize(text: string): string {
  text = text.toLowerCase().trim();
  text = text.replace(/[^\w\s]/g, '');
  for (const w of ['will', 'the', 'be', 'to', 'in', 'on', 'by', 'of', 'a', 'an', 'is', 'before', 'after']) {
    text = text.replace(new RegExp(`\\b${w}\\b`, 'g'), '');
  }
  return text.replace(/\s+/g, ' ').trim();
}

const STOP_WORDS = new Set([
  'january','february','march','april','june','july','august','september','october','november','december',
  'than','more','less','most','least','much','many','some','other','this','that','with','from','have','been',
  'what','when','where','which','while','would','could','should','does','about','into','over','under',
  'between','through','during','each','every','both','either','neither','first','second','third','last',
  'next','2024','2025','2026','2027','2028','2029','2030','end','start','year','month','week','day',
  'united','states','world','country',
]);

function getKeywords(text: string): Set<string> {
  return new Set(
    normalize(text).split(' ').filter(w => w.length > 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w))
  );
}

async function fetchPolymarket(): Promise<Market[]> {
  const markets: Market[] = [];
  try {
    const resp = await fetch(
      'https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100&offset=0',
      { signal: AbortSignal.timeout(8000), cache: 'no-store' }
    );
    const events = await resp.json();
    if (!Array.isArray(events)) return markets;
    for (const event of events) {
      for (const mkt of event.markets || []) {
        if (mkt.closed || !mkt.active) continue;
        let prices: number[];
        try {
          prices = typeof mkt.outcomePrices === 'string'
            ? JSON.parse(mkt.outcomePrices) : mkt.outcomePrices;
        } catch { continue; }
        if (!prices || prices.length < 2) continue;
        markets.push({
          platform: 'Polymarket',
          id: `poly-${mkt.conditionId || mkt.id || ''}`,
          question: mkt.question || event.title || '',
          event: event.title || '',
          yes_price: parseFloat(String(prices[0])),
          no_price: parseFloat(String(prices[1])),
          url: `https://polymarket.com/event/${event.slug || ''}`,
        });
      }
    }
  } catch (e) { console.error('[Polymarket]', e); }
  return markets;
}

async function fetchKalshi(): Promise<Market[]> {
  const markets: Market[] = [];
  try {
    const evResp = await fetch(
      'https://api.elections.kalshi.com/trade-api/v2/events?limit=100&status=open',
      { signal: AbortSignal.timeout(6000), cache: 'no-store' }
    );
    const evData = await evResp.json();
    const events = (evData.events || []).slice(0, 15);

    const fetchEvent = async (ticker: string, evTitle: string): Promise<Market[]> => {
      try {
        const resp = await fetch(
          `https://api.elections.kalshi.com/trade-api/v2/markets?limit=50&status=open&event_ticker=${ticker}`,
          { signal: AbortSignal.timeout(4000), cache: 'no-store' }
        );
        const data = await resp.json();
        const result: Market[] = [];
        for (const mkt of data.markets || []) {
          const title = mkt.title || '';
          const { yes_bid, yes_ask, no_bid, no_ask, last_price } = mkt;
          let yes_price: number;
          if (yes_bid && yes_ask && yes_bid > 0) {
            yes_price = (yes_bid + yes_ask) / 2 / 100;
          } else if (yes_ask && yes_ask > 0) {
            yes_price = yes_ask / 100;
          } else if (last_price && last_price > 0) {
            yes_price = last_price / 100;
          } else continue;
          const no_price = (no_bid != null && no_ask != null && no_bid > 0)
            ? (no_bid + no_ask) / 2 / 100
            : 1.0 - yes_price;
          const question = mkt.subtitle ? `${title} - ${mkt.subtitle}`.trim() : title || evTitle;
          result.push({
            platform: 'Kalshi', id: `kalshi-${mkt.ticker || ''}`, question, event: ticker,
            yes_price: Math.round(yes_price * 10000) / 10000,
            no_price: Math.round(no_price * 10000) / 10000,
            url: `https://kalshi.com/events/${ticker}`,
          });
        }
        return result;
      } catch { return []; }
    };

    const results = await Promise.allSettled(
      events.map((e: any) => fetchEvent(e.event_ticker, e.title || ''))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') markets.push(...r.value);
    }
  } catch (e) { console.error('[Kalshi]', e); }
  return markets;
}

async function fetchManifold(): Promise<Market[]> {
  const markets: Market[] = [];
  try {
    const resp = await fetch(
      'https://api.manifold.markets/v0/markets?limit=200',
      { signal: AbortSignal.timeout(8000), cache: 'no-store' }
    );
    const data = await resp.json();
    if (!Array.isArray(data)) return markets;
    for (const mkt of data) {
      if (mkt.isResolved || (mkt.closeTime && mkt.closeTime < Date.now()) || mkt.probability == null) continue;
      const prob = parseFloat(String(mkt.probability));
      if (isNaN(prob)) continue;
      markets.push({
        platform: 'Manifold',
        id: `manifold-${mkt.id || ''}`,
        question: mkt.question || '',
        event: '',
        yes_price: Math.round(prob * 10000) / 10000,
        no_price: Math.round((1 - prob) * 10000) / 10000,
        url: mkt.url || `https://manifold.markets/${mkt.creatorUsername}/${mkt.slug}`,
      });
    }
  } catch (e) { console.error('[Manifold]', e); }
  return markets;
}

async function fetchMetaculus(): Promise<Market[]> {
  const markets: Market[] = [];
  try {
    const resp = await fetch(
      'https://www.metaculus.com/api2/questions/?limit=100&status=open&type=binary',
      { signal: AbortSignal.timeout(8000), cache: 'no-store' }
    );
    const data = await resp.json();
    for (const item of data.results || []) {
      const prob =
        item.community_prediction?.full?.q2 ??
        item.community_prediction?.q2 ??
        item.question?.aggregations?.recency_weighted?.latest?.centers?.[0] ??
        null;
      if (prob == null) continue;
      const p = parseFloat(String(prob));
      if (isNaN(p) || p <= 0 || p >= 1) continue;
      markets.push({
        platform: 'Metaculus', id: `metaculus-${item.id}`, question: item.title || '', event: '',
        yes_price: Math.round(p * 10000) / 10000,
        no_price: Math.round((1 - p) * 10000) / 10000,
        url: `https://www.metaculus.com/questions/${item.id}/`,
      });
    }
  } catch (e) { console.error('[Metaculus]', e); }
  return markets;
}

function matchAllMarkets(allMarkets: Market[], threshold = 50): Match[] {
  const byPlatform: Record<string, Market[]> = {};
  for (const m of allMarkets) (byPlatform[m.platform] ||= []).push(m);
  const platforms = Object.keys(byPlatform);
  const matches: Match[] = [];
  const usedPairs = new Set<string>();

  for (let i = 0; i < platforms.length; i++) {
    for (let j = i + 1; j < platforms.length; j++) {
      const groupA = byPlatform[platforms[i]];
      const groupB = byPlatform[platforms[j]];
      const bKeywords = groupB.map(m => ({ market: m, words: getKeywords(m.question) }));

      for (const mA of groupA) {
        const aWords = getKeywords(mA.question);
        if (aWords.size < 2) continue;
        let bestScore = 0;
        let bestB: Market | null = null;

        for (const { market: mB, words: bWords } of bKeywords) {
          if (bWords.size < 2) continue;
          const overlap = Array.from(aWords).filter(w => bWords.has(w)).length;
          if (overlap < 2) continue;
          const score = Math.round(overlap / Math.min(aWords.size, bWords.size) * 100);
          if (score > bestScore && score >= threshold) {
            bestScore = score;
            bestB = mB;
          }
        }

        if (bestB) {
          const pairKey = [mA.id, bestB.id].sort().join('|');
          if (!usedPairs.has(pairKey)) {
            usedPairs.add(pairKey);
            matches.push({ marketA: mA, marketB: bestB, match_score: bestScore });
          }
        }
      }
    }
  }
  return matches;
}

function findArbitrage(matches: Match[]): Arb[] {
  const arbs: Arb[] = [];
  for (const m of matches) {
    const a = m.marketA, b = m.marketB;
    const cost1 = a.yes_price + b.no_price, spread1 = 1.0 - cost1;
    const cost2 = a.no_price + b.yes_price, spread2 = 1.0 - cost2;
    if (spread1 > 0 || spread2 > 0) {
      const bestSpread = Math.max(spread1, spread2);
      const [strategy, cost] = spread1 >= spread2
        ? [`BUY YES@${a.platform}($${a.yes_price.toFixed(2)}) + BUY NO@${b.platform}($${b.no_price.toFixed(2)})`, cost1]
        : [`BUY NO@${a.platform}($${a.no_price.toFixed(2)}) + BUY YES@${b.platform}($${b.yes_price.toFixed(2)})`, cost2];
      arbs.push({
        question: a.question.slice(0, 80), match_score: m.match_score,
        spread: bestSpread, cost, strategy,
        platformA: a.platform, platformB: b.platform,
        urlA: a.url, urlB: b.url,
        yesA: a.yes_price, noA: a.no_price, yesB: b.yes_price, noB: b.no_price,
      });
    }
  }
  return arbs.sort((a, b) => b.spread - a.spread);
}

export const maxDuration = 30;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>(res => setTimeout(() => res(fallback), ms))]);
}

export async function GET() {
  const start = Date.now();
  const results = await Promise.allSettled([
    withTimeout(fetchPolymarket(), 12000, []),
    withTimeout(fetchKalshi(), 12000, []),
    withTimeout(fetchManifold(), 10000, []),
    withTimeout(fetchMetaculus(), 10000, []),
  ]);

  const [poly, kalshi, manifold, metaculus] = results.map(r =>
    r.status === 'fulfilled' ? r.value : []
  );
  const allMarkets = [...poly, ...kalshi, ...manifold, ...metaculus];
  const matchStart = Date.now();
  const matches = matchAllMarkets(allMarkets);
  const matchTime = Date.now() - matchStart;
  const arbs = findArbitrage(matches);

  const counts: Record<string, number> = {
    Polymarket: poly.length, Kalshi: kalshi.length,
    Manifold: manifold.length, Metaculus: metaculus.length,
  };

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    scanTime: Date.now() - start,
    platformCounts: counts,
    totalMarkets: allMarkets.length,
    matchCount: matches.length,
    opportunities: arbs,
    debug: {
      counts, matchTimeMs: matchTime,
      errors: results.map((r, i) =>
        r.status === 'rejected' ? `${['Polymarket','Kalshi','Manifold','Metaculus'][i]}: ${r.reason}` : null
      ).filter(Boolean),
      sampleMatches: matches.slice(0, 10).map(m => ({
        a: `[${m.marketA.platform}] ${m.marketA.question.slice(0, 60)}`,
        b: `[${m.marketB.platform}] ${m.marketB.question.slice(0, 60)}`,
        score: m.match_score,
      })),
    },
  });
}

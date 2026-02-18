'use client';
import { useState, useEffect, useCallback } from 'react';

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

interface ScanResult {
  timestamp: string;
  scanTime: number;
  platformCounts: Record<string, number>;
  totalMarkets: number;
  matchCount: number;
  opportunities: Arb[];
}

const platformColors: Record<string, string> = {
  Polymarket: 'bg-purple-600',
  Kalshi: 'bg-cyan-600',
  Manifold: 'bg-amber-600',
  Metaculus: 'bg-emerald-600',
};

const platformTextColors: Record<string, string> = {
  Polymarket: 'text-purple-400',
  Kalshi: 'text-cyan-400',
  Manifold: 'text-amber-400',
  Metaculus: 'text-emerald-400',
};

function Badge({ platform }: { platform: string }) {
  return (
    <span className={`${platformColors[platform] || 'bg-gray-600'} text-white text-[10px] px-1.5 py-0.5 rounded font-medium`}>
      {platform}
    </span>
  );
}

export default function Home() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [minSpread, setMinSpread] = useState(0);
  const [countdown, setCountdown] = useState(60);

  const scan = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/scan');
      const json = await res.json();
      setData(json);
    } catch {
      setError('Failed to fetch scan results');
    }
    setLoading(false);
    setCountdown(60);
  }, []);

  useEffect(() => { scan(); }, [scan]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { scan(); return 60; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [scan]);

  const filtered = data?.opportunities.filter(a => a.spread * 100 >= minSpread) || [];

  const spreadColor = (spread: number) => {
    const pct = spread * 100;
    if (pct > 3) return 'text-green-400';
    if (pct > 1) return 'text-yellow-400';
    return 'text-gray-300';
  };

  const rowBg = (spread: number) => {
    const pct = spread * 100;
    if (pct > 3) return 'bg-green-900/20 border-green-800/30';
    if (pct > 1) return 'bg-yellow-900/10 border-yellow-800/20';
    return 'bg-gray-900/20 border-gray-800/30';
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-800 bg-[#0d0d15]">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                ⚡ Arb Scanner
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                Cross-Platform Prediction Market Arbitrage
              </p>
              {data && (
                <div className="flex gap-2 mt-2">
                  {Object.entries(data.platformCounts).map(([p, count]) => (
                    <span key={p} className="flex items-center gap-1 text-xs">
                      <Badge platform={p} />
                      <span className="text-gray-500 font-mono">{count}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-6 text-sm">
              {data && (
                <>
                  <div className="text-center">
                    <div className="text-gray-500">Total Markets</div>
                    <div className="text-lg font-mono">{data.totalMarkets}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-gray-500">Matches</div>
                    <div className="text-lg font-mono">{data.matchCount}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-gray-500">Arbs</div>
                    <div className="text-lg font-mono text-green-400">{data.opportunities.length}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-gray-500">Scan Time</div>
                    <div className="font-mono text-xs">{(data.scanTime / 1000).toFixed(1)}s</div>
                  </div>
                </>
              )}
              <div className="text-center">
                <div className="text-gray-500">Refresh</div>
                <div className="font-mono">{countdown}s</div>
              </div>
              <button
                onClick={scan}
                disabled={loading}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium disabled:opacity-50 transition"
              >
                {loading ? '⏳ Scanning...' : '🔄 Scan Now'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center gap-3 text-sm">
          <label className="text-gray-400">Min Spread %:</label>
          <input
            type="range"
            min="0" max="10" step="0.5"
            value={minSpread}
            onChange={e => setMinSpread(parseFloat(e.target.value))}
            className="w-40 accent-purple-500"
          />
          <span className="font-mono text-purple-400 w-12">{minSpread}%</span>
          <span className="text-gray-600 ml-2">({filtered.length} shown)</span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="max-w-7xl mx-auto px-4">
          <div className="bg-red-900/30 border border-red-800 rounded-lg p-4 text-red-300">{error}</div>
        </div>
      )}

      {/* Table */}
      <div className="max-w-7xl mx-auto px-4 pb-8">
        {loading && !data ? (
          <div className="text-center py-20 text-gray-500">
            <div className="text-4xl mb-4">⚡</div>
            <div>Scanning markets...</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <div className="text-4xl mb-4">🔍</div>
            <div>No arbitrage opportunities found at {minSpread}%+ spread</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-left border-b border-gray-800">
                  <th className="py-3 px-3">#</th>
                  <th className="py-3 px-3">Question</th>
                  <th className="py-3 px-3 text-center">Side A</th>
                  <th className="py-3 px-3 text-center">Side B</th>
                  <th className="py-3 px-3 text-center">Spread</th>
                  <th className="py-3 px-3">Strategy</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a, i) => (
                  <tr key={i} className={`border-b ${rowBg(a.spread)} hover:bg-gray-800/30 transition`}>
                    <td className="py-3 px-3 text-gray-500">{i + 1}</td>
                    <td className="py-3 px-3 max-w-xs">
                      <div className="font-medium truncate">{a.question}</div>
                      <div className="flex gap-2 mt-1 items-center flex-wrap">
                        <a href={a.urlA} target="_blank" className={`text-xs ${platformTextColors[a.platformA] || 'text-gray-400'} hover:underline flex items-center gap-1`}>
                          <Badge platform={a.platformA} /> ↗
                        </a>
                        <a href={a.urlB} target="_blank" className={`text-xs ${platformTextColors[a.platformB] || 'text-gray-400'} hover:underline flex items-center gap-1`}>
                          <Badge platform={a.platformB} /> ↗
                        </a>
                        <span className="text-xs text-gray-600">Match: {a.match_score}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="text-[10px] text-gray-500 mb-1">{a.platformA}</div>
                      <div className="font-mono text-xs">Y ${a.yesA.toFixed(2)} / N ${a.noA.toFixed(2)}</div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="text-[10px] text-gray-500 mb-1">{a.platformB}</div>
                      <div className="font-mono text-xs">Y ${a.yesB.toFixed(2)} / N ${a.noB.toFixed(2)}</div>
                    </td>
                    <td className={`py-3 px-3 text-center font-mono font-bold ${spreadColor(a.spread)}`}>
                      {(a.spread * 100).toFixed(2)}%
                    </td>
                    <td className="py-3 px-3 text-xs text-gray-400 max-w-xs truncate">{a.strategy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

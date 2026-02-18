'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

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

const ALL_PLATFORMS = ['Polymarket', 'Kalshi', 'Manifold', 'Metaculus'];

type TextSize = 'small' | 'medium' | 'large';
type SortKey = 'spread' | 'match_score' | 'platformA';
type SortDir = 'asc' | 'desc';
type ViewTab = 'all' | 'watchlist';

const sizeConfig: Record<TextSize, { body: string; table: string; badge: string; padding: string; header: string; stat: string }> = {
  small: { body: 'text-sm', table: 'text-xs', badge: 'text-[10px] px-1.5 py-0.5', padding: 'py-2 px-2', header: 'text-xl', stat: 'text-base' },
  medium: { body: 'text-base', table: 'text-sm', badge: 'text-xs px-2 py-0.5', padding: 'py-3 px-4', header: 'text-3xl', stat: 'text-xl' },
  large: { body: 'text-lg', table: 'text-base', badge: 'text-sm px-2.5 py-1', padding: 'py-4 px-5', header: 'text-4xl', stat: 'text-2xl' },
};

function Badge({ platform, size }: { platform: string; size: TextSize }) {
  return (
    <span className={`${platformColors[platform] || 'bg-gray-600'} text-white ${sizeConfig[size].badge} rounded font-medium`}>
      {platform}
    </span>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <div className="relative" onClick={() => onChange(!checked)}>
        <div className={`w-10 h-5 rounded-full transition ${checked ? 'bg-purple-600' : 'bg-gray-700'}`} />
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </div>
      <span className="text-gray-400 text-sm">{label}</span>
    </label>
  );
}

export default function Home() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [minSpread, setMinSpread] = useState(0);
  const [minMatch, setMinMatch] = useState(0);
  const [countdown, setCountdown] = useState(60);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [textSize, setTextSize] = useState<TextSize>('medium');
  const [showSettings, setShowSettings] = useState(false);
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());
  const [viewTab, setViewTab] = useState<ViewTab>('all');
  const [sortKey, setSortKey] = useState<SortKey>('spread');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [platformFilter, setPlatformFilter] = useState<Set<string>>(new Set(ALL_PLATFORMS));
  const [searchQuery, setSearchQuery] = useState('');
  const [showPlatformFilter, setShowPlatformFilter] = useState(false);
  const platformFilterRef = useRef<HTMLDivElement>(null);

  // Load from localStorage
  useEffect(() => {
    try {
      const savedSize = localStorage.getItem('arb-text-size') as TextSize;
      if (savedSize && sizeConfig[savedSize]) setTextSize(savedSize);
      const savedWatchlist = localStorage.getItem('arb-watchlist');
      if (savedWatchlist) setWatchlist(new Set(JSON.parse(savedWatchlist)));
      const savedAutoRefresh = localStorage.getItem('arb-auto-refresh');
      if (savedAutoRefresh !== null) setAutoRefresh(JSON.parse(savedAutoRefresh));
    } catch {}
  }, []);

  // Persist
  useEffect(() => { localStorage.setItem('arb-text-size', textSize); }, [textSize]);
  useEffect(() => { localStorage.setItem('arb-watchlist', JSON.stringify(Array.from(watchlist))); }, [watchlist]);
  useEffect(() => { localStorage.setItem('arb-auto-refresh', JSON.stringify(autoRefresh)); }, [autoRefresh]);

  // Close platform filter on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (platformFilterRef.current && !platformFilterRef.current.contains(e.target as Node)) {
        setShowPlatformFilter(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { scan(); return 60; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [scan, autoRefresh]);

  const toggleWatchlist = (question: string) => {
    setWatchlist(prev => {
      const next = new Set(prev);
      if (next.has(question)) next.delete(question);
      else next.add(question);
      return next;
    });
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const togglePlatform = (p: string) => {
    setPlatformFilter(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const filtered = useMemo(() => {
    let items = data?.opportunities || [];
    if (viewTab === 'watchlist') items = items.filter(a => watchlist.has(a.question));
    items = items.filter(a =>
      a.spread * 100 >= minSpread &&
      a.match_score >= minMatch &&
      (platformFilter.has(a.platformA) || platformFilter.has(a.platformB))
    );
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(a => a.question.toLowerCase().includes(q));
    }
    items = [...items].sort((a, b) => {
      let va: number | string, vb: number | string;
      if (sortKey === 'spread') { va = a.spread; vb = b.spread; }
      else if (sortKey === 'match_score') { va = a.match_score; vb = b.match_score; }
      else { va = a.platformA; vb = b.platformA; }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return items;
  }, [data, viewTab, watchlist, minSpread, minMatch, platformFilter, searchQuery, sortKey, sortDir]);

  const activeFilterCount = (minSpread > 0 ? 1 : 0) + (minMatch > 0 ? 1 : 0) + (platformFilter.size < ALL_PLATFORMS.length ? 1 : 0) + (searchQuery.trim() ? 1 : 0);

  const sz = sizeConfig[textSize];

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

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <span className="text-gray-700 ml-1">↕</span>;
    return <span className="text-purple-400 ml-1">{sortDir === 'desc' ? '↓' : '↑'}</span>;
  };

  return (
    <div className={`min-h-screen bg-[#0a0a0f] text-gray-100 ${sz.body}`}>
      {/* Header */}
      <div className="border-b border-gray-800 bg-[#0d0d15]">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <h1 className={`${sz.header} font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent`}>
                ⚡ Arb Scanner
              </h1>
              <p className="text-gray-500 mt-1">
                Cross-Platform Prediction Market Arbitrage
              </p>
              {data && (
                <div className="flex gap-3 mt-3 flex-wrap">
                  {Object.entries(data.platformCounts).map(([p, count]) => (
                    <span key={p} className="flex items-center gap-1.5">
                      <Badge platform={p} size={textSize} />
                      <span className="text-gray-500 font-mono">{count}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
              {data && (
                <>
                  <div className="text-center">
                    <div className="text-gray-500 text-sm">Total Markets</div>
                    <div className={`${sz.stat} font-mono`}>{data.totalMarkets}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-gray-500 text-sm">Matches</div>
                    <div className={`${sz.stat} font-mono`}>{data.matchCount}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-gray-500 text-sm">Arbs</div>
                    <div className={`${sz.stat} font-mono text-green-400`}>{data.opportunities.length}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-gray-500 text-sm">Scan Time</div>
                    <div className="font-mono text-sm">{(data.scanTime / 1000).toFixed(1)}s</div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-4 mt-4 flex-wrap">
            <button
              onClick={scan}
              disabled={loading}
              className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 rounded-lg font-medium disabled:opacity-50 transition text-sm"
            >
              {loading ? '⏳ Scanning...' : '🔄 Refresh Now'}
            </button>
            <Toggle checked={autoRefresh} onChange={setAutoRefresh} label={autoRefresh ? `Auto-refresh in ${countdown}s` : 'Auto-refresh OFF'} />
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition"
              title="Display settings"
            >
              ⚙️ Display
            </button>
          </div>

          {/* Settings panel */}
          {showSettings && (
            <div className="mt-3 p-4 bg-gray-800/60 rounded-lg border border-gray-700 inline-flex gap-2">
              {(['small', 'medium', 'large'] as TextSize[]).map(s => (
                <button
                  key={s}
                  onClick={() => setTextSize(s)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition capitalize ${textSize === s ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tabs + Filters */}
      <div className="max-w-7xl mx-auto px-4 py-4 space-y-3">
        {/* Tabs */}
        <div className="flex items-center gap-4 flex-wrap">
          <button
            onClick={() => setViewTab('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${viewTab === 'all' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
          >
            All Opportunities
          </button>
          <button
            onClick={() => setViewTab('watchlist')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${viewTab === 'watchlist' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
          >
            ⭐ Watchlist
            {watchlist.size > 0 && (
              <span className="bg-yellow-500 text-black text-xs px-1.5 py-0.5 rounded-full font-bold">{watchlist.size}</span>
            )}
          </button>
          {activeFilterCount > 0 && (
            <span className="text-xs text-purple-400 bg-purple-900/30 px-2 py-1 rounded">{activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active</span>
          )}
          <span className="text-gray-600 text-sm ml-auto">{filtered.length} shown</span>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-gray-400 text-sm">Min Spread:</label>
            <input type="range" min="0" max="10" step="0.5" value={minSpread} onChange={e => setMinSpread(parseFloat(e.target.value))} className="w-28 accent-purple-500" />
            <span className="font-mono text-purple-400 text-sm w-10">{minSpread}%</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-gray-400 text-sm">Min Match:</label>
            <input type="range" min="0" max="100" step="5" value={minMatch} onChange={e => setMinMatch(parseFloat(e.target.value))} className="w-28 accent-purple-500" />
            <span className="font-mono text-purple-400 text-sm w-10">{minMatch}%</span>
          </div>
          <div className="relative" ref={platformFilterRef}>
            <button onClick={() => setShowPlatformFilter(!showPlatformFilter)} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-sm transition">
              Platforms {platformFilter.size < ALL_PLATFORMS.length && `(${platformFilter.size})`} ▾
            </button>
            {showPlatformFilter && (
              <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg p-2 z-20 min-w-[160px]">
                {ALL_PLATFORMS.map(p => (
                  <label key={p} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-700 rounded cursor-pointer text-sm">
                    <input type="checkbox" checked={platformFilter.has(p)} onChange={() => togglePlatform(p)} className="accent-purple-500" />
                    {p}
                  </label>
                ))}
              </div>
            )}
          </div>
          <input
            type="text"
            placeholder="🔍 Search markets..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-purple-500 w-48 sm:w-64"
          />
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
            <div className="text-4xl mb-4">{viewTab === 'watchlist' ? '⭐' : '🔍'}</div>
            <div>{viewTab === 'watchlist' ? 'No watchlist items yet. Star some opportunities!' : `No arbitrage opportunities found with current filters`}</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={`w-full ${sz.table}`}>
              <thead>
                <tr className="text-gray-500 text-left border-b border-gray-800">
                  <th className={sz.padding}>★</th>
                  <th className={sz.padding}>#</th>
                  <th className={sz.padding}>Question</th>
                  <th className={sz.padding}>
                    <button onClick={() => handleSort('platformA')} className="hover:text-gray-300 transition flex items-center">
                      Platforms<SortIcon column="platformA" />
                    </button>
                  </th>
                  <th className={`${sz.padding} text-center`}>Side A</th>
                  <th className={`${sz.padding} text-center`}>Side B</th>
                  <th className={`${sz.padding} text-center`}>
                    <button onClick={() => handleSort('spread')} className="hover:text-gray-300 transition flex items-center justify-center">
                      Spread<SortIcon column="spread" />
                    </button>
                  </th>
                  <th className={`${sz.padding} text-center`}>
                    <button onClick={() => handleSort('match_score')} className="hover:text-gray-300 transition flex items-center justify-center">
                      Match<SortIcon column="match_score" />
                    </button>
                  </th>
                  <th className={sz.padding}>Strategy</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a, i) => (
                  <tr key={i} className={`border-b ${rowBg(a.spread)} hover:bg-gray-800/30 transition`}>
                    <td className={sz.padding}>
                      <button onClick={() => toggleWatchlist(a.question)} className="text-lg hover:scale-125 transition-transform" title={watchlist.has(a.question) ? 'Remove from watchlist' : 'Add to watchlist'}>
                        {watchlist.has(a.question) ? '⭐' : '☆'}
                      </button>
                    </td>
                    <td className={`${sz.padding} text-gray-500`}>{i + 1}</td>
                    <td className={`${sz.padding} max-w-xs`}>
                      <div className="font-medium truncate">{a.question}</div>
                    </td>
                    <td className={sz.padding}>
                      <div className="flex flex-col gap-1">
                        <a href={a.urlA} target="_blank" className={`${platformTextColors[a.platformA] || 'text-gray-400'} hover:underline flex items-center gap-1`}>
                          <Badge platform={a.platformA} size={textSize} /> ↗
                        </a>
                        <a href={a.urlB} target="_blank" className={`${platformTextColors[a.platformB] || 'text-gray-400'} hover:underline flex items-center gap-1`}>
                          <Badge platform={a.platformB} size={textSize} /> ↗
                        </a>
                      </div>
                    </td>
                    <td className={`${sz.padding} text-center`}>
                      <div className="text-xs text-gray-500 mb-0.5">{a.platformA}</div>
                      <div className="font-mono">Y ${a.yesA.toFixed(2)} / N ${a.noA.toFixed(2)}</div>
                    </td>
                    <td className={`${sz.padding} text-center`}>
                      <div className="text-xs text-gray-500 mb-0.5">{a.platformB}</div>
                      <div className="font-mono">Y ${a.yesB.toFixed(2)} / N ${a.noB.toFixed(2)}</div>
                    </td>
                    <td className={`${sz.padding} text-center font-mono font-bold ${spreadColor(a.spread)}`}>
                      {(a.spread * 100).toFixed(2)}%
                    </td>
                    <td className={`${sz.padding} text-center font-mono text-gray-400`}>
                      {a.match_score}%
                    </td>
                    <td className={`${sz.padding} text-gray-400 max-w-xs truncate`}>{a.strategy}</td>
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

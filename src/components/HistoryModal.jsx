import React, { useState, useEffect, useMemo } from 'react';
import LineChart from './LineChart';
import { API_BASE } from '../config/api';

/**
 * HistoryModal — Premium slide-over panel showing historical trend data.
 * Features: KPI cards with sparkline indicators, enhanced chart with
 * dual-color theming, detailed execution history table, and rich tooltips.
 */
const HistoryModal = ({ isOpen, onClose, testCase, platform, category, currentValue }) => {
  const [historyData, setHistoryData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);

  const is400 = platform === 'SRX400';
  const accent = is400 ? { from: '#10b981', to: '#059669', bg: 'emerald', hex: '#10b981' }
                       : { from: '#3b82f6', to: '#2563eb', bg: 'blue', hex: '#3b82f6' };

  useEffect(() => {
    if (!isOpen || !testCase || !platform) return;
    const fetchHistory = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          test_case: testCase,
          platform: platform,
          category: category || '',
          days: 90,
        });
        const res = await fetch(`${API_BASE}/api/sanity-history?${params}`);
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const json = await res.json();
        if (json.history && json.history.length > 0) {
          setHistoryData(json.history);
        } else {
          setError('No historical data yet. Click "Ingest Latest" to store the current snapshot.');
          setHistoryData([]);
        }
      } catch (err) {
        setError(`Failed to load history: ${err.message}`);
        setHistoryData([]);
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [isOpen, testCase, platform, category]);

  // Stats
  const stats = useMemo(() => {
    if (historyData.length === 0) return { avg: 0, min: 0, max: 0, trend: 'stable', change: 0, dataPoints: 0, latestRelease: '' };
    const values = historyData.map(d => d.throughput_numeric).filter(v => v > 0);
    if (values.length === 0) return { avg: 0, min: 0, max: 0, trend: 'stable', change: 0, dataPoints: 0, latestRelease: '' };

    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    let trend = 'stable', change = 0;
    if (values.length >= 2) {
      const latest = values[values.length - 1];
      const prev = values[values.length - 2];
      if (prev > 0) {
        change = ((latest - prev) / prev * 100).toFixed(1);
        trend = latest > prev ? 'up' : latest < prev ? 'down' : 'stable';
      }
    }

    const latestRelease = historyData[historyData.length - 1]?.release || '';
    return { avg: avg.toFixed(1), min: min.toFixed(1), max: max.toFixed(1), trend, change, dataPoints: values.length, latestRelease };
  }, [historyData]);

  const handlePointHover = (point, index, event) => {
    const svg = event.currentTarget.ownerSVGElement;
    const svgRect = svg.getBoundingClientRect();
    const cx = parseFloat(event.currentTarget.getAttribute('cx'));
    const cy = parseFloat(event.currentTarget.getAttribute('cy'));
    const scaleXFactor = svgRect.width / 1000;
    const scaleYFactor = svgRect.height / 240;
    setHoveredPoint({
      ...point, index,
      screenX: svgRect.left + (cx * scaleXFactor),
      screenY: svgRect.top + (cy * scaleYFactor),
    });
  };

  // Trend icon
  const TrendBadge = ({ trend, change }) => {
    if (trend === 'stable') return <span className="text-xs text-slate-400 font-medium">—</span>;
    const isUp = trend === 'up';
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
        isUp ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-600 border border-red-200'
      }`}>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
            d={isUp ? 'M5 10l7-7m0 0l7 7m-7-7v18' : 'M19 14l-7 7m0 0l-7-7m7 7V3'} />
        </svg>
        {Math.abs(change)}%
      </span>
    );
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-slate-900/40 z-[100]" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-full max-w-[720px] bg-slate-50 shadow-2xl z-[101] overflow-y-auto border-l border-slate-200 flex flex-col">

        {/* ── Header ── */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200">
          {/* Accent bar */}
          <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${accent.from}, ${accent.to})` }} />

          <div className="px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Breadcrumb */}
                <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
                  <span className={`font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-[10px] ${
                    is400 ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                  }`}>{platform}</span>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="truncate font-medium">{category}</span>
                </div>

                {/* Title */}
                <h2 className="text-xl font-bold text-slate-900 leading-tight">{testCase}</h2>

                {/* Current value + trend */}
                {currentValue && (
                  <div className="flex items-center gap-3 mt-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-400 font-medium">Current</span>
                      <span className="font-jetbrains text-sm font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        {currentValue}
                      </span>
                    </div>
                    <TrendBadge trend={stats.trend} change={stats.change} />
                  </div>
                )}
              </div>

              <button onClick={onClose} className="p-2 -mt-1 -mr-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 px-6 py-5 space-y-5">

          {/* KPI Cards */}
          {historyData.length > 0 && (
            <div className="grid grid-cols-4 gap-3">
              {/* Data Points */}
              <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                <div className="flex items-center gap-1.5 mb-2">
                  <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Runs</p>
                </div>
                <p className="text-2xl font-extrabold text-slate-800 font-jetbrains">{stats.dataPoints}</p>
              </div>

              {/* Average */}
              <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: accent.hex }} />
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg</p>
                </div>
                <p className="text-2xl font-extrabold text-slate-800 font-jetbrains">{stats.avg}</p>
              </div>

              {/* Min */}
              <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                <div className="flex items-center gap-1.5 mb-2">
                  <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Min</p>
                </div>
                <p className="text-2xl font-extrabold text-blue-600 font-jetbrains">{stats.min}</p>
              </div>

              {/* Max */}
              <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                <div className="flex items-center gap-1.5 mb-2">
                  <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                  <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Max</p>
                </div>
                <p className="text-2xl font-extrabold text-emerald-600 font-jetbrains">{stats.max}</p>
              </div>
            </div>
          )}

          {/* Chart */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <LineChart
              data={historyData.map(d => ({
                ...d,
                day: d.date,
                throughput: d.throughput_numeric,
              }))}
              dataKey="throughput"
              color={accent.hex}
              title="Performance Trend"
              subtitle={historyData.length > 0 ? `${historyData[0]?.date} → ${historyData[historyData.length - 1]?.date}` : 'Awaiting data'}
              badgeColor={accent.bg}
              loading={loading}
              error={error}
              onPointHover={handlePointHover}
              onPointLeave={() => setHoveredPoint(null)}
              showAreaFill={true}
              animationDelay="0ms"
            />
          </div>

          {/* Release Info */}
          {stats.latestRelease && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-lg border border-slate-200 shadow-sm">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              <span className="text-xs text-slate-400 font-medium">Latest Release</span>
              <span className="font-jetbrains text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 truncate">
                {stats.latestRelease}
              </span>
            </div>
          )}

          {/* Execution History Table */}
          {historyData.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              {/* Table Header */}
              <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h3 className="text-sm font-bold text-slate-800">Execution History</h3>
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {historyData.length} {historyData.length === 1 ? 'run' : 'runs'}
                </span>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-800">
                      <th className="px-5 py-2.5 text-left text-[10px] font-bold text-slate-300 uppercase tracking-wider">Release</th>
                      <th className="px-5 py-2.5 text-left text-[10px] font-bold text-slate-300 uppercase tracking-wider">Throughput</th>
                      <th className="px-5 py-2.5 text-left text-[10px] font-bold text-slate-300 uppercase tracking-wider">CPU</th>
                      <th className="px-5 py-2.5 text-left text-[10px] font-bold text-slate-300 uppercase tracking-wider">SHM</th>
                      <th className="px-5 py-2.5 text-right text-[10px] font-bold text-slate-300 uppercase tracking-wider">Δ Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...historyData].reverse().map((row, i, arr) => {
                      const prev = i < arr.length - 1 ? arr[i + 1] : null;
                      let changePercent = null;
                      if (prev && prev.throughput_numeric > 0 && row.throughput_numeric > 0) {
                        changePercent = ((row.throughput_numeric - prev.throughput_numeric) / prev.throughput_numeric * 100).toFixed(1);
                      }
                      const isLatest = i === 0;

                      return (
                        <tr key={i} className={`hover:bg-slate-50 ${isLatest ? 'bg-emerald-50/30' : ''}`}>
                          <td className="px-5 py-3 text-xs font-medium text-slate-600">
                            <div className="flex items-center gap-2">
                              {isLatest && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />}
                              <span className="font-jetbrains" title={row.release_full || row.release}>{row.date}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <span className="font-jetbrains text-xs font-bold text-slate-800">{row.throughput}</span>
                          </td>
                          <td className="px-5 py-3">
                            {row.cpu ? (
                              <span className="font-jetbrains text-xs text-orange-600 font-semibold">{row.cpu}</span>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            {row.shm ? (
                              <span className="font-jetbrains text-xs text-purple-600 font-semibold">{row.shm}</span>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right">
                            {changePercent !== null ? (
                              <span className={`inline-flex items-center gap-0.5 font-jetbrains text-xs font-bold ${
                                parseFloat(changePercent) >= 0 ? 'text-emerald-600' : 'text-red-500'
                              }`}>
                                {parseFloat(changePercent) >= 0 ? '▲' : '▼'} {Math.abs(changePercent)}%
                              </span>
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Enhanced Tooltip */}
      {hoveredPoint && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{
            left: `${hoveredPoint.screenX}px`,
            top: `${hoveredPoint.screenY - 16}px`,
            transform: 'translate(-50%, -100%)'
          }}
        >
          <div style={{
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            color: 'white', borderRadius: '12px',
            boxShadow: `0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1), 0 0 20px ${accent.hex}33`,
            padding: '14px 16px', minWidth: '220px',
          }}>
            {/* Date */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid #334155' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {hoveredPoint.release_full || hoveredPoint.release || hoveredPoint.date}
              </span>
              <span style={{ fontSize: '10px', color: accent.hex, fontWeight: 700 }}>
                {platform}
              </span>
            </div>
            {/* Throughput */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>Throughput</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '15px', fontWeight: 700, color: accent.hex }}>
                {hoveredPoint.throughput}
              </span>
            </div>
            {/* CPU */}
            {hoveredPoint.cpu && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>CPU</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', fontWeight: 600, color: '#fb923c' }}>
                  {hoveredPoint.cpu}
                </span>
              </div>
            )}
            {/* SHM */}
            {hoveredPoint.shm && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>SHM</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', fontWeight: 600, color: '#c084fc' }}>
                  {hoveredPoint.shm}
                </span>
              </div>
            )}
            {/* Arrow */}
            <div style={{
              position: 'absolute', bottom: '-6px', left: '50%', transform: 'translateX(-50%)',
              width: 0, height: 0,
              borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
              borderTop: '6px solid #1e293b',
            }} />
          </div>
        </div>
      )}
    </>
  );
};

export default HistoryModal;

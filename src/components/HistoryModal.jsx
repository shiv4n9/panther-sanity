import React, { useState, useEffect, useMemo } from 'react';
import LineChart from './LineChart';
import { API_BASE } from '../config/api';

/**
 * HistoryModal — Slide-over panel showing historical trend data for a test case.
 * Reuses the existing LineChart component for consistent charting.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen       - Whether the modal is visible
 * @param {Function} props.onClose     - Close callback
 * @param {string} props.testCase      - Test case name
 * @param {string} props.platform      - 'SRX400' or 'SRX440'
 * @param {string} props.category      - Section category
 * @param {string} props.currentValue  - Current throughput value (for context)
 */
const HistoryModal = ({ isOpen, onClose, testCase, platform, category, currentValue }) => {
  const [historyData, setHistoryData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);

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

  // Compute stats
  const stats = useMemo(() => {
    if (historyData.length === 0) return { avg: 0, min: 0, max: 0, trend: 'stable', change: 0 };
    const values = historyData.map(d => d.throughput_numeric).filter(v => v > 0);
    if (values.length === 0) return { avg: 0, min: 0, max: 0, trend: 'stable', change: 0 };

    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    // Trend: compare latest vs previous
    let trend = 'stable', change = 0;
    if (values.length >= 2) {
      const latest = values[values.length - 1];
      const prev = values[values.length - 2];
      if (prev > 0) {
        change = ((latest - prev) / prev * 100).toFixed(1);
        trend = latest > prev ? 'up' : latest < prev ? 'down' : 'stable';
      }
    }

    return { avg: avg.toFixed(1), min: min.toFixed(1), max: max.toFixed(1), trend, change };
  }, [historyData]);

  const handlePointHover = (point, index, event) => {
    const svg = event.currentTarget.ownerSVGElement;
    const svgRect = svg.getBoundingClientRect();
    const circle = event.currentTarget;
    const cx = parseFloat(circle.getAttribute('cx'));
    const cy = parseFloat(circle.getAttribute('cy'));
    const chartWidth = 1000;
    const chartHeight = 240;
    const scaleXFactor = svgRect.width / chartWidth;
    const scaleYFactor = svgRect.height / chartHeight;
    const screenX = svgRect.left + (cx * scaleXFactor);
    const screenY = svgRect.top + (cy * scaleYFactor);
    setHoveredPoint({ ...point, index, screenX, screenY });
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-[100]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-full max-w-2xl bg-white shadow-2xl z-[101] overflow-y-auto border-l border-slate-200">

        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 z-10 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                  platform === 'SRX400' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
                }`}>
                  {platform}
                </span>
                <span className="text-xs text-slate-400">•</span>
                <span className="text-xs text-slate-500 font-medium truncate">{category}</span>
              </div>
              <h2 className="text-lg font-bold text-slate-900 truncate">{testCase}</h2>
              {currentValue && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-slate-400">Current:</span>
                  <span className="font-jetbrains text-sm font-bold text-slate-800">{currentValue}</span>
                  {stats.trend !== 'stable' && (
                    <span className={`flex items-center gap-0.5 text-xs font-bold ${
                      stats.trend === 'up' ? 'text-emerald-600' : 'text-red-500'
                    }`}>
                      {stats.trend === 'up' ? '↑' : '↓'} {Math.abs(stats.change)}%
                    </span>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        {historyData.length > 0 && (
          <div className="grid grid-cols-3 gap-3 px-6 py-4">
            <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Average</p>
              <p className="text-xl font-extrabold text-slate-800 font-jetbrains mt-0.5">{stats.avg}</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
              <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Min</p>
              <p className="text-xl font-extrabold text-blue-700 font-jetbrains mt-0.5">{stats.min}</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
              <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Max</p>
              <p className="text-xl font-extrabold text-emerald-700 font-jetbrains mt-0.5">{stats.max}</p>
            </div>
          </div>
        )}

        {/* Chart */}
        <div className="px-6 pb-4">
          <LineChart
            data={historyData.map(d => ({
              ...d,
              day: d.date,
              throughput: d.throughput_numeric,
            }))}
            dataKey="throughput"
            color={platform === 'SRX400' ? '#10b981' : '#3b82f6'}
            title="Throughput Trend"
            subtitle={`${historyData.length} data points over 90 days`}
            badgeColor={platform === 'SRX400' ? 'emerald' : 'blue'}
            loading={loading}
            error={error}
            onPointHover={handlePointHover}
            onPointLeave={() => setHoveredPoint(null)}
            showAreaFill={true}
            animationDelay="0ms"
          />
        </div>

        {/* History Table */}
        {historyData.length > 0 && (
          <div className="px-6 pb-6">
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="bg-slate-800 px-4 py-2.5">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Execution History</h3>
              </div>
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider">Date</th>
                    <th className="px-4 py-2 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider">Throughput</th>
                    <th className="px-4 py-2 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider">CPU</th>
                    <th className="px-4 py-2 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider">SHM</th>
                    <th className="px-4 py-2 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...historyData].reverse().map((row, i, arr) => {
                    const prev = i < arr.length - 1 ? arr[i + 1] : null;
                    let changePercent = null;
                    if (prev && prev.throughput_numeric > 0 && row.throughput_numeric > 0) {
                      changePercent = ((row.throughput_numeric - prev.throughput_numeric) / prev.throughput_numeric * 100).toFixed(1);
                    }

                    return (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-xs font-medium text-slate-600">{row.date}</td>
                        <td className="px-4 py-2.5 text-xs font-jetbrains font-bold text-slate-800">{row.throughput}</td>
                        <td className="px-4 py-2.5 text-xs font-jetbrains text-slate-600">{row.cpu || '—'}</td>
                        <td className="px-4 py-2.5 text-xs font-jetbrains text-slate-600">{row.shm || '—'}</td>
                        <td className="px-4 py-2.5 text-xs font-jetbrains font-bold">
                          {changePercent !== null ? (
                            <span className={parseFloat(changePercent) >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                              {parseFloat(changePercent) >= 0 ? '↑' : '↓'} {Math.abs(changePercent)}%
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
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

      {/* Tooltip Portal */}
      {hoveredPoint && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{
            left: `${hoveredPoint.screenX}px`,
            top: `${hoveredPoint.screenY - 16}px`,
            transform: 'translate(-50%, -100%)'
          }}
        >
          <div style={{ background: '#0f172a', color: 'white', borderRadius: '8px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', border: '1px solid #334155', padding: '12px', minWidth: '200px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid #334155' }}>
              {hoveredPoint.date || hoveredPoint.day}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Value:</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '14px', fontWeight: 700, color: '#34d399' }}>
                {hoveredPoint.throughput}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default HistoryModal;

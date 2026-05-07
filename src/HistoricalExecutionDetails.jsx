import React, { useState, useMemo, useEffect } from 'react';
import LineChart from './components/LineChart';
import { API_BASE } from './config/api';

const HistoricalExecutionDetails = ({ id }) => {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [historicalData, setHistoricalData] = useState([]);
  const [histLoading, setHistLoading] = useState(true);
  const [histError, setHistError] = useState(null);
  const [metadata, setMetadata] = useState({ imageName: '', platform: '' });

  // Parse URL params once — stable references
  const hashParts = window.location.hash.split('?');
  const params = new URLSearchParams(hashParts.length > 1 ? hashParts[1] : '');
  const testCaseParam = params.get('tc') || "Unknown Test Case";
  const parameterParam = params.get('p') || "Unknown Parameter";
  const runId = id || params.get('t') || "Unknown";

  // Aggregated stats (memoized)
  const getNum = (v) => {
    const parsed = parseFloat(v);
    return isNaN(parsed) ? 0 : parsed;
  };

  // Filter out rows where throughput is a pure PR number (numeric-only = GNATS issue, not data)
  const isNumericOnly = (v) => /^\d+$/.test((v || '').trim());

  const stats = useMemo(() => {
    // Exclude PR rows from stats
    const dataRows = historicalData.filter(d => !isNumericOnly(d.throughput));
    if (dataRows.length === 0) return { avg: '0', min: '0', max: '0', peakCpu: '0' };
    const values = dataRows.map(d => getNum(d.throughput));
    const cpuValues = dataRows.map(d => parseInt(d.cpu || '0')).filter(v => !isNaN(v));
    return {
      avg: (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
      min: Math.min(...values).toFixed(2),
      max: Math.max(...values).toFixed(2),
      peakCpu: cpuValues.length > 0 ? Math.max(...cpuValues) : '0',
    };
  }, [historicalData]);

  // Filter to only real performance data (exclude PR/GNATS numbers)
  const performanceData = useMemo(() => {
    return historicalData.filter(d => !isNumericOnly(d.throughput));
  }, [historicalData]);

  // Prepare CPU chart data — normalize to numeric percentages
  const cpuChartData = useMemo(() => {
    return performanceData.map(d => ({
      ...d,
      cpuValue: parseInt(d.cpu || '0'),
    }));
  }, [performanceData]);

  // Prepare Memory chart data — normalize to numeric values
  const memoryChartData = useMemo(() => {
    return performanceData.map(d => ({
      ...d,
      memoryValue: parseInt(d.memory || '0'),
    }));
  }, [performanceData]);

  // Fetch real 30-day history from the backend
  useEffect(() => {
    const fetchHistory = async () => {
      setHistLoading(true);
      setHistError(null);
      try {
        const urlParams = new URLSearchParams({
          test_case: testCaseParam,
          parameter: parameterParam,
          days: 30,
        });
        
        const url = `${API_BASE}/api/history?${urlParams}`;
        console.log('Fetching history from:', url);
        
        const res = await fetch(url);
        
        if (!res.ok) {
          const errorText = await res.text();
          console.error('API error:', errorText);
          throw new Error(`API returned ${res.status}: ${errorText}`);
        }
        
        const json = await res.json();
        console.log('History API response:', json);
        
        if (json.history && json.history.length > 0) {
          setHistoricalData(json.history);
          if (json.history[0]) {
            setMetadata({
              imageName: json.history[0].image_name || 'Unknown',
              platform: json.history[0].platform || 'Unknown'
            });
          }
        } else {
          setHistError('No historical data found. Click "Ingest Latest" on the dashboard to populate the database.');
          setHistoricalData([]);
        }
      } catch (err) {
        console.error('History API error:', err);
        setHistError(`Failed to load historical data: ${err.message}`);
        setHistoricalData([]);
      } finally {
        setHistLoading(false);
      }
    };
    
    if (testCaseParam && parameterParam) {
      fetchHistory();
    } else {
      console.warn('Missing test case or parameter:', { testCase: testCaseParam, parameter: parameterParam });
      setHistLoading(false);
      setHistError('Invalid test case or parameter');
    }
  }, [testCaseParam, parameterParam]);

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

  const handlePointLeave = () => {
    setHoveredPoint(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16 relative overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* Dynamic Atmospheric Glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-40 -right-20 w-[50rem] h-[50rem] rounded-full blur-[100px] animate-blob bg-slate-200/40 transition-colors duration-1000"></div>
        <div className="absolute top-60 -left-40 w-[40rem] h-[40rem] rounded-full blur-[100px] animate-blob bg-slate-200/30 transition-colors duration-1000" style={{ animationDelay: '4s' }}></div>
      </div>

      {/* Header Section */}
      <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-50 relative">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <a 
            href="#" 
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-emerald-600 transition-colors mb-4 group"
          >
            <svg className="w-4 h-4 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Dashboard
          </a>

          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="flex-1">
              <div className="mb-3 inline-flex items-center gap-3 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg shadow-sm">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider leading-none">Image</p>
                    <p className="font-jetbrains text-sm font-bold text-slate-800 leading-tight mt-0.5">{metadata.imageName || 'Loading...'}</p>
                  </div>
                </div>
                <div className="h-8 w-px bg-slate-300"></div>
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                  </svg>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider leading-none">Platform</p>
                    <p className="font-jetbrains text-sm font-bold text-slate-800 leading-tight mt-0.5">{metadata.platform || 'Unknown'}</p>
                  </div>
                </div>
              </div>
              
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-2">
                {testCaseParam}
              </h1>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-500">Parameter:</span>
                <span className="text-sm font-bold text-slate-800 font-mono bg-slate-100 px-2.5 py-1 rounded border border-slate-200">{parameterParam}</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:border-slate-400 transition-all shadow-sm focus:ring-2 focus:ring-emerald-500/20">
                Export CSV
              </button>
              <button className="px-4 py-2 bg-slate-800 border border-transparent rounded-lg text-sm font-semibold text-white hover:bg-slate-700 transition-all shadow-sm focus:ring-2 focus:ring-slate-600/50">
                Download Report
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8 relative z-10">
        
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <div className="bg-white/95 backdrop-blur-xl rounded-xl p-5 border border-slate-300 shadow-lg hover:shadow-xl transition-all duration-300">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Average</p>
            </div>
            <div className="flex items-end gap-2">
              <p className="text-3xl font-extrabold text-slate-900 leading-none">{stats.avg}</p>
              <p className="text-sm font-bold text-slate-400 mb-0.5">KPPS</p>
            </div>
          </div>
          
          <div className="bg-white/95 backdrop-blur-xl rounded-xl p-5 border-t-[3px] border-orange-500 shadow-lg hover:shadow-xl transition-all duration-300 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <svg className="w-12 h-12 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Peak CPU</p>
            </div>
            <div className="flex items-end gap-2">
              <p className="text-3xl font-extrabold text-slate-900 leading-none">{stats.peakCpu}</p>
              <p className="text-sm font-bold text-slate-400 mb-0.5">%</p>
            </div>
            <div className="mt-3 w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-orange-400 to-orange-500 rounded-full transition-all duration-500" style={{ width: `${stats.peakCpu}%` }}></div>
            </div>
          </div>

          <div className="bg-white/95 backdrop-blur-xl rounded-xl p-5 border border-slate-300 shadow-lg hover:shadow-xl transition-all duration-300">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
              </svg>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Minimum</p>
            </div>
            <div className="flex items-end gap-2">
              <p className="text-3xl font-extrabold text-blue-600 leading-none">{stats.min}</p>
              <p className="text-sm font-bold text-slate-400 mb-0.5">KPPS</p>
            </div>
          </div>

          <div className="bg-white/95 backdrop-blur-xl rounded-xl p-5 border border-slate-300 shadow-lg hover:shadow-xl transition-all duration-300">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Maximum</p>
            </div>
            <div className="flex items-end gap-2">
              <p className="text-3xl font-extrabold text-emerald-600 leading-none">{stats.max}</p>
              <p className="text-sm font-bold text-slate-400 mb-0.5">KPPS</p>
            </div>
          </div>
        </div>

        {/* Charts — using reusable LineChart component */}
        <div className="grid grid-cols-1 gap-6">
          
          {/* Throughput Chart */}
          <LineChart
            data={performanceData}
            dataKey="throughput"
            color="#10b981"
            title="Throughput Performance"
            subtitle="Historical trend analysis"
            badgeColor="emerald"
            loading={histLoading}
            error={histError}
            onPointHover={handlePointHover}
            onPointLeave={handlePointLeave}
            showAreaFill={true}
            animationDelay="200ms"
          />

          {/* CPU Chart */}
          <LineChart
            data={cpuChartData}
            dataKey="cpuValue"
            color="#fb923c"
            title="CPU Utilization"
            subtitle="Processor usage metrics"
            badgeColor="orange"
            yAxisSuffix="%"
            yScale={{ min: 0, max: 100 }}
            loading={histLoading}
            error={histError}
            onPointHover={handlePointHover}
            onPointLeave={handlePointLeave}
            animationDelay="300ms"
          />

          {/* Memory Chart */}
          <LineChart
            data={memoryChartData}
            dataKey="memoryValue"
            color="#60a5fa"
            title="Memory Consumption"
            subtitle="RAM usage statistics"
            badgeColor="blue"
            loading={histLoading}
            error={histError}
            onPointHover={handlePointHover}
            onPointLeave={handlePointLeave}
            animationDelay="400ms"
          />

        </div>

        {/* Data Summary Table */}
        <div className="bg-white/95 backdrop-blur-xl rounded-xl border border-slate-300 shadow-lg overflow-hidden animate-fade-in-up" style={{ animationDelay: '500ms' }}>
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800 tracking-tight">Execution History</h2>
                <p className="text-xs text-slate-500 mt-0.5">Detailed test run records</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="font-medium">Showing latest {Math.min(10, historicalData.length)} entries</span>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-800 border-b border-slate-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">Throughput</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">CPU</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">Memory</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider">SHM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {historicalData.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-12 text-center">
                      <p className="text-slate-400 text-sm">No historical data available</p>
                    </td>
                  </tr>
                ) : (
                  historicalData.slice(-10).reverse().map((row, index) => {
                    const isPR = isNumericOnly(row.throughput);
                    return (
                    <tr key={index} className={`hover:bg-slate-50 transition-colors ${isPR ? 'opacity-50' : ''}`}>
                      <td className="px-6 py-3 text-sm text-slate-600 font-medium">{row.date}</td>
                      <td className="px-6 py-3 text-sm font-jetbrains font-semibold">
                        {isPR ? (
                          <span className="text-slate-400">PR:{row.throughput}</span>
                        ) : (
                          <span className="text-emerald-600">{row.throughput}</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-sm font-jetbrains text-slate-700">{row.cpu || 'N/A'}</td>
                      <td className="px-6 py-3 text-sm font-jetbrains text-slate-700">{row.memory || 'N/A'}</td>
                      <td className="px-6 py-3 text-sm font-jetbrains text-slate-700">{row.shm || 'N/A'}</td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 shadow-sm relative z-10">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span className="font-medium">Historical Data View</span>
            <span className="text-slate-400">•</span>
            <span className="font-jetbrains font-semibold text-slate-700">{historicalData.length} days loaded</span>
          </div>
        </div>
      </footer>

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
          <div style={{ position: 'relative', background: '#0f172a', color: 'white', borderRadius: '8px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', border: '1px solid #334155', padding: '14px', minWidth: '240px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid #334155' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{hoveredPoint.day}</span>
              <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>{hoveredPoint.date}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>Throughput:</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '15px', fontWeight: 700, color: '#34d399' }}>{hoveredPoint.throughput}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>CPU Usage:</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', fontWeight: 600, color: '#fb923c' }}>{hoveredPoint.cpu}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>Memory:</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', fontWeight: 600, color: '#60a5fa' }}>{hoveredPoint.memory}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>SHM:</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', fontWeight: 600, color: '#c084fc' }}>{hoveredPoint.shm}</span>
              </div>
            </div>
            {/* Arrow */}
            <div style={{
              position: 'absolute',
              bottom: '-8px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '8px solid transparent',
              borderRight: '8px solid transparent',
              borderTop: '8px solid #334155'
            }}>
              <div style={{
                position: 'absolute',
                top: '-9px',
                left: '-7px',
                width: 0,
                height: 0,
                borderLeft: '7px solid transparent',
                borderRight: '7px solid transparent',
                borderTop: '7px solid #0f172a'
              }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoricalExecutionDetails;

import React, { useState, useRef, useEffect } from 'react';

const HistoricalExecutionDetails = ({ id }) => {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [historicalData, setHistoricalData] = useState([]);
  const [histLoading, setHistLoading] = useState(true);
  const [histError, setHistError] = useState(null);
  const [metadata, setMetadata] = useState({ imageName: '', platform: '' });
  const chartRef = useRef(null);

  const hashParts = window.location.hash.split('?');
  const params = new URLSearchParams(hashParts.length > 1 ? hashParts[1] : '');
  const testCaseParam = params.get('tc') || "Unknown Test Case";
  const parameterParam = params.get('p') || "Unknown Parameter";

  const data = {
    runId: id || params.get('t') || "Unknown",
    testCase: testCaseParam,
    parameter: parameterParam,
    status: "Passed",
    timestamp: new Date().toLocaleDateString(),
    imageName: "", // Will be populated from API response
    platform: "", // Will be populated from API response
  };

  // Aggregated stats from history (safely parse floats since throughput may contain letters like 'KPPS')
  const getNum = (v) => {
    const parsed = parseFloat(v);
    return isNaN(parsed) ? 0 : parsed;
  };

  const avgThroughput = historicalData.length 
    ? (historicalData.reduce((acc, curr) => acc + getNum(curr.throughput), 0) / historicalData.length).toFixed(2) 
    : '0';
  const minThpt = historicalData.length 
    ? Math.min(...historicalData.map(d => getNum(d.throughput))).toFixed(2) 
    : '0';
  const maxThpt = historicalData.length 
    ? Math.max(...historicalData.map(d => getNum(d.throughput))).toFixed(2) 
    : '0';
  const peakCpu = historicalData.length 
    ? Math.max(...historicalData.map(d => parseInt(d.cpu || '0'))) 
    : '0';

  // Fetch real 30-day history from the backend
  useEffect(() => {
    const fetchHistory = async () => {
      setHistLoading(true);
      setHistError(null);
      try {
        const API_BASE = import.meta.env.VITE_API_URL || '';
        const params = new URLSearchParams({
          test_case: data.testCase,
          parameter: data.parameter,
          days: 30,
        });
        
        const url = `${API_BASE}/api/history?${params}`;
        console.log('Fetching history from:', url);
        console.log('Query params:', { test_case: data.testCase, parameter: data.parameter });
        
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
          // Extract metadata from first record
          if (json.history[0]) {
            setMetadata({
              imageName: json.history[0].image_name || 'Unknown',
              platform: json.history[0].platform || 'Unknown'
            });
          }
        } else {
          // Database is empty - no data has been ingested yet
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
    
    // Only fetch if we have test case and parameter
    if (data.testCase && data.parameter) {
      fetchHistory();
    } else {
      console.warn('Missing test case or parameter:', { testCase: data.testCase, parameter: data.parameter });
      setHistLoading(false);
      setHistError('Invalid test case or parameter');
    }
  }, [data.testCase, data.parameter]);



  // Calculate chart dimensions and scaling
  const chartWidth = 1000;
  const chartHeight = 240;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const yMaxThroughput = Math.max(...historicalData.map(d => getNum(d.throughput)));
  const yMinThroughput = Math.min(...historicalData.map(d => getNum(d.throughput)));
  const yRange = yMaxThroughput - yMinThroughput;
  const yPadding = yRange === 0 ? 10 : yRange * 0.1;

  const scaleY = (value) => {
    const num = getNum(value);
    const normalized = (num - (yMinThroughput - yPadding)) / (yRange + 2 * yPadding);
    return innerHeight - (normalized * innerHeight);
  };

  const scaleX = (index) => {
    return (index / (historicalData.length - 1)) * innerWidth;
  };

  // Generate path for the line chart
  const linePath = historicalData
    .map((point, index) => {
      const x = scaleX(index) + padding.left;
      const y = scaleY(point.throughput) + padding.top;
      return `${index === 0 ? 'M' : 'L'} ${x},${y}`;
    })
    .join(' ');

  // Generate path for the area fill
  const areaPath = `${linePath} L ${scaleX(historicalData.length - 1) + padding.left},${innerHeight + padding.top} L ${padding.left},${innerHeight + padding.top} Z`;

  const handlePointHover = (point, index, event) => {
    // Get the SVG element and calculate exact position
    const svg = event.currentTarget.ownerSVGElement;
    const svgRect = svg.getBoundingClientRect();
    
    // Get the circle's center in SVG coordinates
    const circle = event.currentTarget;
    const cx = parseFloat(circle.getAttribute('cx'));
    const cy = parseFloat(circle.getAttribute('cy'));
    
    // Calculate scale factors for responsive SVG
    const scaleX = svgRect.width / chartWidth;
    const scaleY = svgRect.height / chartHeight;
    
    // Convert SVG coordinates to screen coordinates
    const screenX = svgRect.left + (cx * scaleX);
    const screenY = svgRect.top + (cy * scaleY);
    
    setHoveredPoint({ 
      ...point, 
      index,
      screenX,
      screenY
    });
  };

  const handlePointLeave = () => {
    setHoveredPoint(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-green-50/20 to-emerald-50/30 text-slate-900 pb-16">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        
        .font-jetbrains {
          font-family: 'JetBrains Mono', monospace;
        }
      `}</style>

      {/* Header Section */}
      <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-5">
          <a 
            href="#" 
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-green-700 transition-colors mb-4 group"
          >
            <svg className="w-4 h-4 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Dashboard
          </a>

          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="flex-1">
              {/* Image Name - Prominent Display */}
              <div className="mb-3 inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-lg shadow-sm">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div>
                  <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Image Version</p>
                  <p className="font-jetbrains text-sm font-bold text-emerald-900">{metadata.imageName || 'Loading...'}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-3 mb-2">
                <span className="px-2.5 py-1 rounded bg-slate-100 text-slate-600 font-mono text-xs font-bold tracking-widest border border-slate-200">
                  {metadata.platform || 'Platform'}
                </span>
                <span className="text-xs font-medium text-slate-400 border-l border-slate-300 pl-3">
                  30-Day Historical View
                </span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                {data.testCase}
              </h1>
              <p className="text-sm font-semibold text-slate-500 mt-1 flex items-center gap-2">
                Target Configuration Parameter: 
                <span className="text-slate-800 font-mono bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{data.parameter}</span>
              </p>
            </div>
            <div className="flex gap-3">
              <button className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm focus:ring-2 focus:ring-green-500/20">
                Export CSV
              </button>
              <button className="px-4 py-2 bg-green-600 border border-transparent rounded-lg text-sm font-semibold text-white hover:bg-green-700 transition-colors shadow-sm focus:ring-2 focus:ring-green-600/50">
                Download Report
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        
        {/* KPI Cards (Top Row) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Avg Throughput</p>
            <div className="flex items-end gap-2">
              <p className="text-3xl font-extrabold text-slate-900 leading-none">{avgThroughput}</p>
              <p className="text-sm font-bold text-slate-400 mb-0.5">Units</p>
            </div>
          </div>
          
          <div className="bg-white rounded-xl p-5 border-t-[3px] border-orange-500 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <svg className="w-12 h-12 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Peak CPU</p>
            <div className="flex items-end gap-2">
              <p className="text-3xl font-extrabold text-slate-900 leading-none">{peakCpu}</p>
              <p className="text-sm font-bold text-slate-400 mb-0.5">%</p>
            </div>
            <div className="mt-3 w-full h-1 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-orange-500 rounded-full" style={{ width: `${peakCpu}%` }}></div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Min Throughput</p>
            <div className="flex items-end gap-2">
              <p className="text-3xl font-extrabold text-blue-600 leading-none">{minThpt}</p>
              <p className="text-sm font-bold text-slate-400 mb-0.5">Units</p>
            </div>
          </div>

          <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Max Throughput</p>
            <div className="flex items-end gap-2">
              <p className="text-3xl font-extrabold text-emerald-600 leading-none">{maxThpt}</p>
              <p className="text-sm font-bold text-slate-400 mb-0.5">Units</p>
            </div>
          </div>
        </div>

        {/* Three Separate Charts - Throughput, CPU, Memory */}
        <div className="grid grid-cols-1 gap-6">
          
          {/* Throughput Chart */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800 tracking-tight">Throughput over Time</h2>
              <p className="text-xs text-slate-500 mt-0.5">Daily test execution results (30 days)</p>
            </div>
            <div className="p-6">
              {histLoading ? (
                <div className="h-[200px] flex items-center justify-center">
                  <div className="text-slate-400">Loading...</div>
                </div>
              ) : histError || historicalData.length === 0 ? (
                <div className="h-[200px] flex items-center justify-center text-center">
                  <div>
                    <p className="text-slate-400 text-sm">No data available</p>
                  </div>
                </div>
              ) : (
                <div className="h-[200px] flex items-center justify-center">
                  <p className="text-slate-500 text-sm">Chart: Throughput values over 30 days</p>
                </div>
              )}
            </div>
          </div>

          {/* CPU Chart */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800 tracking-tight">CPU Usage over Time</h2>
              <p className="text-xs text-slate-500 mt-0.5">Daily CPU utilization (30 days)</p>
            </div>
            <div className="p-6">
              {histLoading ? (
                <div className="h-[200px] flex items-center justify-center">
                  <div className="text-slate-400">Loading...</div>
                </div>
              ) : histError || historicalData.length === 0 ? (
                <div className="h-[200px] flex items-center justify-center text-center">
                  <div>
                    <p className="text-slate-400 text-sm">No data available</p>
                  </div>
                </div>
              ) : (
                <div className="h-[200px] flex items-center justify-center">
                  <p className="text-slate-500 text-sm">Chart: CPU percentage over 30 days</p>
                </div>
              )}
            </div>
          </div>

          {/* Memory Chart */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800 tracking-tight">Memory Usage over Time</h2>
              <p className="text-xs text-slate-500 mt-0.5">Daily memory consumption (30 days)</p>
            </div>
            <div className="p-6">
              {histLoading ? (
                <div className="h-[200px] flex items-center justify-center">
                  <div className="text-slate-400">Loading...</div>
                </div>
              ) : histError || historicalData.length === 0 ? (
                <div className="h-[200px] flex items-center justify-center text-center">
                  <div>
                    <p className="text-slate-400 text-sm">No data available</p>
                  </div>
                </div>
              ) : (
                <div className="h-[200px] flex items-center justify-center">
                  <p className="text-slate-500 text-sm">Chart: Memory usage over 30 days</p>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Longitudinal Chart - Daily Runs - OLD VERSION TO BE REPLACED */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" style={{display: 'none'}}>
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-800 tracking-tight">Throughput over Time</h2>
              <p className="text-xs text-slate-500 mt-0.5">Daily sanity test execution results (30 days)</p>
            </div>
            <div className="flex items-center gap-2">
              {histLoading ? (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200">
                  <svg className="w-3.5 h-3.5 text-slate-400 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  <span className="text-xs font-semibold text-slate-500">Loading history...</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 rounded-lg border border-emerald-200">
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                  <span className="text-xs font-semibold text-emerald-700">
                    {historicalData.length} day{historicalData.length !== 1 ? 's' : ''} of data
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="p-6">
            {histLoading ? (
              <div className="h-[240px] flex items-center justify-center">
                <div className="space-y-3 w-full animate-pulse">
                  <div className="h-3 bg-slate-100 rounded w-3/4 mx-auto"></div>
                  <div className="h-32 bg-slate-50 rounded-lg border border-slate-100 w-full"></div>
                  <div className="h-3 bg-slate-100 rounded w-1/2 mx-auto"></div>
                </div>
              </div>
            ) : histError ? (
              <div className="h-[240px] flex items-center justify-center text-center">
                <div className="max-w-md">
                  <div className="text-amber-500 text-5xl mb-4">📊</div>
                  <p className="text-slate-700 font-semibold text-base mb-2">No Historical Data Available</p>
                  <p className="text-slate-500 text-sm mb-4">{histError}</p>
                  <a 
                    href="#" 
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-semibold shadow-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    Go to Dashboard
                  </a>
                </div>
              </div>
            ) : historicalData.length === 0 ? (
              <div className="h-[240px] flex items-center justify-center text-center">
                <div className="max-w-md">
                  <div className="text-slate-300 text-5xl mb-4">📈</div>
                  <p className="text-slate-600 font-semibold text-base mb-2">No Data Points Yet</p>
                  <p className="text-slate-400 text-sm mb-4">
                    Historical data will appear here once test results are ingested into the database.
                  </p>
                  <a 
                    href="#" 
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-semibold shadow-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    Back to Dashboard
                  </a>
                </div>
              </div>
            ) : (
            <div className="relative" ref={chartRef}>
              <svg 
                width="100%" 
                height={chartHeight} 
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="overflow-visible"
              >
                <defs>
                  <linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="rgba(16, 185, 129, 0.2)" />
                    <stop offset="100%" stopColor="rgba(16, 185, 129, 0.02)" />
                  </linearGradient>
                  <filter id="glow">
                    <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                    <feMerge>
                      <feMergeNode in="coloredBlur"/>
                      <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                  </filter>
                </defs>

                {/* Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                  <line
                    key={ratio}
                    x1={padding.left}
                    y1={padding.top + innerHeight * ratio}
                    x2={padding.left + innerWidth}
                    y2={padding.top + innerHeight * ratio}
                    stroke="#e2e8f0"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                ))}

                {/* Y-axis labels */}
                {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                  const value = (yMaxThroughput + yPadding) - (ratio * (yRange + 2 * yPadding));
                  return (
                    <text
                      key={ratio}
                      x={padding.left - 10}
                      y={padding.top + innerHeight * ratio + 4}
                      textAnchor="end"
                      className="text-xs font-semibold fill-slate-400 font-jetbrains"
                    >
                      {value.toFixed(2)}
                    </text>
                  );
                })}

                {/* X-axis labels (show every 5th day) */}
                {historicalData.map((point, index) => {
                  if (index % 5 === 0 || index === historicalData.length - 1) {
                    return (
                      <text
                        key={index}
                        x={scaleX(index) + padding.left}
                        y={chartHeight - 10}
                        textAnchor="middle"
                        className="text-xs font-medium fill-slate-500"
                      >
                        {point.day}
                      </text>
                    );
                  }
                  return null;
                })}

                {/* Area fill */}
                <path
                  d={areaPath}
                  fill="url(#areaGradient)"
                />

                {/* Line */}
                <path
                  d={linePath}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Data point markers */}
                {historicalData.map((point, index) => {
                  const x = scaleX(index) + padding.left;
                  const y = scaleY(point.throughput) + padding.top;
                  const isHovered = hoveredPoint?.index === index;

                  return (
                    <g key={index}>
                      {/* Invisible larger circle for easier hovering */}
                      <circle
                        cx={x}
                        cy={y}
                        r="16"
                        fill="transparent"
                        style={{ pointerEvents: 'all' }}
                        className="cursor-pointer"
                        onMouseEnter={(e) => handlePointHover(point, index, e)}
                        onMouseLeave={handlePointLeave}
                      />
                      {/* Visible marker */}
                      <circle
                        cx={x}
                        cy={y}
                        r={isHovered ? "7" : "4.5"}
                        fill={isHovered ? "#10b981" : "#10b981"}
                        stroke="white"
                        strokeWidth={isHovered ? "3" : "2"}
                        className="transition-all duration-150 pointer-events-none"
                        style={{ 
                          filter: isHovered ? 'drop-shadow(0 0 6px rgba(16, 185, 129, 0.8))' : 'none',
                          transformOrigin: `${x}px ${y}px`
                        }}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
            )} {/* end ternary: chart visible */}
          </div>
        </div>

        {/* Data Summary Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-lg font-bold text-slate-800 tracking-tight">Recent Execution Summary</h2>
            <p className="text-xs text-slate-500 mt-0.5">Last 10 daily test runs</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Throughput</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">CPU</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Memory</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">SHM</th>
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
                  historicalData.slice(-10).reverse().map((row, index) => (
                    <tr key={index} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-3 text-sm text-slate-600 font-medium">{row.date}</td>
                      <td className="px-6 py-3 text-sm font-jetbrains font-semibold text-emerald-600">{row.throughput}</td>
                      <td className="px-6 py-3 text-sm font-jetbrains text-slate-700">{row.cpu}</td>
                      <td className="px-6 py-3 text-sm font-jetbrains text-slate-700">{row.memory}</td>
                      <td className="px-6 py-3 text-sm font-jetbrains text-slate-700">{row.shm}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Custom Tooltip Portal */}
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
            {/* Arrow tucked inside the relative container, flush at the bottom */}
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
              {/* Inner fill triangle to mask the border-top colour */}
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

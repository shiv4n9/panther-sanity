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

  const yMaxThroughput = historicalData.length > 0 ? Math.max(...historicalData.map(d => getNum(d.throughput))) : 100;
  const yMinThroughput = historicalData.length > 0 ? Math.min(...historicalData.map(d => getNum(d.throughput))) : 0;
  const yRange = yMaxThroughput - yMinThroughput;
  // For single data point, create a reasonable scale around the value (±20%)
  const yPadding = yRange === 0 ? Math.max(yMaxThroughput * 0.2, 10) : yRange * 0.1;

  const scaleY = (value) => {
    const num = getNum(value);
    const normalized = (num - (yMinThroughput - yPadding)) / (yRange + 2 * yPadding);
    return innerHeight - (normalized * innerHeight);
  };

  const scaleX = (index) => {
    if (historicalData.length === 1) return innerWidth / 2; // Center single point
    return (index / (historicalData.length - 1)) * innerWidth;
  };

  // Generate path for the line chart (only if multiple points)
  const linePath = historicalData.length > 1 ? historicalData
    .map((point, index) => {
      const x = scaleX(index) + padding.left;
      const y = scaleY(point.throughput) + padding.top;
      return `${index === 0 ? 'M' : 'L'} ${x},${y}`;
    })
    .join(' ') : '';

  // Generate path for the area fill (only if multiple points)
  const areaPath = historicalData.length > 1 
    ? `${linePath} L ${scaleX(historicalData.length - 1) + padding.left},${innerHeight + padding.top} L ${padding.left},${innerHeight + padding.top} Z`
    : '';

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
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16 relative overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        
        .font-jetbrains {
          font-family: 'JetBrains Mono', monospace;
        }

        @keyframes floatBlob {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(30px, -40px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-blob { animation: floatBlob 15s infinite alternate ease-in-out; }
        .animate-fade-in-up {
          opacity: 0;
          animation: fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        /* Custom Light Premium Scrollbar */
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: rgba(241, 245, 249, 0.5);
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(16, 185, 129, 0.4);
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(16, 185, 129, 0.7);
        }
      `}</style>

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
                {data.testCase}
              </h1>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-500">Parameter:</span>
                <span className="text-sm font-bold text-slate-800 font-mono bg-slate-100 px-2.5 py-1 rounded border border-slate-200">{data.parameter}</span>
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
        
        {/* KPI Cards (Top Row) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <div className="bg-white/95 backdrop-blur-xl rounded-xl p-5 border border-slate-300 shadow-lg hover:shadow-xl transition-all duration-300">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Average</p>
            </div>
            <div className="flex items-end gap-2">
              <p className="text-3xl font-extrabold text-slate-900 leading-none">{avgThroughput}</p>
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
              <p className="text-3xl font-extrabold text-slate-900 leading-none">{peakCpu}</p>
              <p className="text-sm font-bold text-slate-400 mb-0.5">%</p>
            </div>
            <div className="mt-3 w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-orange-400 to-orange-500 rounded-full transition-all duration-500" style={{ width: `${peakCpu}%` }}></div>
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
              <p className="text-3xl font-extrabold text-blue-600 leading-none">{minThpt}</p>
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
              <p className="text-3xl font-extrabold text-emerald-600 leading-none">{maxThpt}</p>
              <p className="text-sm font-bold text-slate-400 mb-0.5">KPPS</p>
            </div>
          </div>
        </div>

        {/* Three Separate Charts - Throughput, CPU, Memory */}
        <div className="grid grid-cols-1 gap-6">
          
          {/* Throughput Chart */}
          <div className="bg-white/95 backdrop-blur-xl rounded-xl border border-slate-300 shadow-lg overflow-hidden animate-fade-in-up" style={{ animationDelay: '200ms' }}>
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 tracking-tight">Throughput Performance</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Historical trend analysis</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                  <span className="text-xs font-bold text-emerald-700">{historicalData.length} {historicalData.length === 1 ? 'Record' : 'Records'}</span>
                </div>
              </div>
            </div>
            <div className="p-6">
              {histLoading ? (
                <div className="h-[240px] flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600"></div>
                </div>
              ) : histError ? (
                <div className="h-[240px] flex items-center justify-center text-center">
                  <div className="max-w-md">
                    <p className="text-slate-600 font-medium mb-2">No Data Available</p>
                    <p className="text-slate-400 text-sm">{histError}</p>
                  </div>
                </div>
              ) : historicalData.length === 0 ? (
                <div className="h-[240px] flex items-center justify-center text-center">
                  <div>
                    <p className="text-slate-400 text-sm">No historical data found</p>
                    <p className="text-slate-300 text-xs mt-1">Click "Ingest Latest" on the dashboard</p>
                  </div>
                </div>
              ) : (
                <svg ref={chartRef} viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto" style={{ maxHeight: '240px' }}>
                  {/* Grid lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                    const y = padding.top + innerHeight * ratio;
                    return (
                      <line
                        key={ratio}
                        x1={padding.left}
                        y1={y}
                        x2={chartWidth - padding.right}
                        y2={y}
                        stroke="#e2e8f0"
                        strokeWidth="1"
                        strokeDasharray={ratio === 0 || ratio === 1 ? "0" : "4 4"}
                      />
                    );
                  })}

                  {/* Area fill */}
                  {historicalData.length > 1 && (
                    <path
                      d={areaPath}
                      fill="url(#throughputGradient)"
                      opacity="0.2"
                    />
                  )}

                  {/* Line path */}
                  {historicalData.length > 1 && (
                    <path
                      d={linePath}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Data points */}
                  {historicalData.map((point, index) => {
                    const x = (historicalData.length === 1 ? 0.5 : index / (historicalData.length - 1)) * innerWidth + padding.left;
                    const y = scaleY(point.throughput) + padding.top;
                    return (
                      <g key={index}>
                        <circle
                          cx={x}
                          cy={y}
                          r="6"
                          fill="white"
                          stroke="#10b981"
                          strokeWidth="2.5"
                          className="cursor-pointer transition-all"
                          onMouseEnter={(e) => handlePointHover(point, index, e)}
                          onMouseLeave={handlePointLeave}
                        />
                        <circle
                          cx={x}
                          cy={y}
                          r="3"
                          fill="#10b981"
                          className="pointer-events-none"
                        />
                      </g>
                    );
                  })}

                  {/* Single data point indicator */}
                  {historicalData.length === 1 && (
                    <text
                      x={chartWidth / 2}
                      y={padding.top + innerHeight + 15}
                      textAnchor="middle"
                      fontSize="11"
                      fill="#94a3b8"
                      fontWeight="500"
                      fontStyle="italic"
                    >
                      Single data point available • Trend will appear as more data is collected
                    </text>
                  )}

                  {/* Y-axis labels */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                    const y = padding.top + innerHeight * ratio;
                    const value = (yMaxThroughput + yPadding) - ratio * (yRange + 2 * yPadding);
                    return (
                      <text
                        key={ratio}
                        x={padding.left - 10}
                        y={y}
                        textAnchor="end"
                        alignmentBaseline="middle"
                        fontSize="11"
                        fill="#64748b"
                        fontWeight="600"
                        fontFamily="'JetBrains Mono', monospace"
                      >
                        {value.toFixed(0)}
                      </text>
                    );
                  })}

                  {/* X-axis labels (show dates for first, middle, last) */}
                  {historicalData.length > 0 && [0, Math.floor(historicalData.length / 2), historicalData.length - 1].map((index) => {
                    if (index >= historicalData.length) return null;
                    const x = (historicalData.length === 1 ? 0.5 : index / (historicalData.length - 1)) * innerWidth + padding.left;
                    return (
                      <text
                        key={index}
                        x={x}
                        y={chartHeight - padding.bottom + 20}
                        textAnchor="middle"
                        fontSize="10"
                        fill="#94a3b8"
                        fontWeight="600"
                      >
                        {historicalData[index].date}
                      </text>
                    );
                  })}

                  {/* Gradient definition */}
                  <defs>
                    <linearGradient id="throughputGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.5" />
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0.05" />
                    </linearGradient>
                  </defs>
                </svg>
              )}
            </div>
          </div>

          {/* CPU Chart */}
          <div className="bg-white/95 backdrop-blur-xl rounded-xl border border-slate-300 shadow-lg overflow-hidden animate-fade-in-up" style={{ animationDelay: '300ms' }}>
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 tracking-tight">CPU Utilization</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Processor usage metrics</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded-lg">
                  <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                  <span className="text-xs font-bold text-orange-700">{historicalData.length} {historicalData.length === 1 ? 'Record' : 'Records'}</span>
                </div>
              </div>
            </div>
            <div className="p-6">
              {histLoading ? (
                <div className="h-[240px] flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600"></div>
                </div>
              ) : histError ? (
                <div className="h-[240px] flex items-center justify-center text-center">
                  <div className="max-w-md">
                    <p className="text-slate-600 font-medium mb-2">No Data Available</p>
                    <p className="text-slate-400 text-sm">{histError}</p>
                  </div>
                </div>
              ) : historicalData.length === 0 ? (
                <div className="h-[240px] flex items-center justify-center text-center">
                  <div>
                    <p className="text-slate-400 text-sm">No historical data found</p>
                  </div>
                </div>
              ) : (
                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto" style={{ maxHeight: '240px' }}>
                  {/* Grid lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                    const y = padding.top + innerHeight * ratio;
                    return (
                      <line
                        key={ratio}
                        x1={padding.left}
                        y1={y}
                        x2={chartWidth - padding.right}
                        y2={y}
                        stroke="#e2e8f0"
                        strokeWidth="1"
                        strokeDasharray={ratio === 0 || ratio === 1 ? "0" : "4 4"}
                      />
                    );
                  })}

                  {/* CPU line path */}
                  {historicalData.length > 1 && (
                    <path
                      d={historicalData.map((point, index) => {
                        const x = (index / (historicalData.length - 1)) * innerWidth + padding.left;
                        const cpuVal = parseInt(point.cpu || '0');
                        const y = padding.top + innerHeight * (1 - cpuVal / 100);
                        return `${index === 0 ? 'M' : 'L'} ${x},${y}`;
                      }).join(' ')}
                      fill="none"
                      stroke="#fb923c"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* CPU data points */}
                  {historicalData.map((point, index) => {
                    const x = (historicalData.length === 1 ? 0.5 : index / (historicalData.length - 1)) * innerWidth + padding.left;
                    const cpuVal = parseInt(point.cpu || '0');
                    const y = padding.top + innerHeight * (1 - cpuVal / 100);
                    return (
                      <g key={index}>
                        <circle
                          cx={x}
                          cy={y}
                          r="6"
                          fill="white"
                          stroke="#fb923c"
                          strokeWidth="2.5"
                          className="cursor-pointer transition-all"
                          onMouseEnter={(e) => handlePointHover(point, index, e)}
                          onMouseLeave={handlePointLeave}
                        />
                        <circle
                          cx={x}
                          cy={y}
                          r="3"
                          fill="#fb923c"
                          className="pointer-events-none"
                        />
                      </g>
                    );
                  })}

                  {/* Single data point indicator */}
                  {historicalData.length === 1 && (
                    <text
                      x={chartWidth / 2}
                      y={padding.top + innerHeight + 15}
                      textAnchor="middle"
                      fontSize="11"
                      fill="#94a3b8"
                      fontWeight="500"
                      fontStyle="italic"
                    >
                      Single data point available • Trend will appear as more data is collected
                    </text>
                  )}

                  {/* Y-axis labels (0-100%) */}
                  {[0, 25, 50, 75, 100].map((value) => {
                    const y = padding.top + innerHeight * (1 - value / 100);
                    return (
                      <text
                        key={value}
                        x={padding.left - 10}
                        y={y}
                        textAnchor="end"
                        alignmentBaseline="middle"
                        fontSize="11"
                        fill="#64748b"
                        fontWeight="600"
                        fontFamily="'JetBrains Mono', monospace"
                      >
                        {value}%
                      </text>
                    );
                  })}

                  {/* X-axis labels */}
                  {historicalData.length > 0 && [0, Math.floor(historicalData.length / 2), historicalData.length - 1].map((index) => {
                    if (index >= historicalData.length) return null;
                    const x = (historicalData.length === 1 ? 0.5 : index / (historicalData.length - 1)) * innerWidth + padding.left;
                    return (
                      <text
                        key={index}
                        x={x}
                        y={chartHeight - padding.bottom + 20}
                        textAnchor="middle"
                        fontSize="10"
                        fill="#94a3b8"
                        fontWeight="600"
                      >
                        {historicalData[index].date}
                      </text>
                    );
                  })}
                </svg>
              )}
            </div>
          </div>

          {/* Memory Chart */}
          <div className="bg-white/95 backdrop-blur-xl rounded-xl border border-slate-300 shadow-lg overflow-hidden animate-fade-in-up" style={{ animationDelay: '400ms' }}>
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 tracking-tight">Memory Consumption</h2>
                  <p className="text-xs text-slate-500 mt-0.5">RAM usage statistics</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-xs font-bold text-blue-700">{historicalData.length} {historicalData.length === 1 ? 'Record' : 'Records'}</span>
                </div>
              </div>
            </div>
            <div className="p-6">
              {histLoading ? (
                <div className="h-[240px] flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600"></div>
                </div>
              ) : histError ? (
                <div className="h-[240px] flex items-center justify-center text-center">
                  <div className="max-w-md">
                    <p className="text-slate-600 font-medium mb-2">No Data Available</p>
                    <p className="text-slate-400 text-sm">{histError}</p>
                  </div>
                </div>
              ) : historicalData.length === 0 ? (
                <div className="h-[240px] flex items-center justify-center text-center">
                  <div>
                    <p className="text-slate-400 text-sm">No historical data found</p>
                  </div>
                </div>
              ) : (
                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto" style={{ maxHeight: '240px' }}>
                  {/* Grid lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                    const y = padding.top + innerHeight * ratio;
                    return (
                      <line
                        key={ratio}
                        x1={padding.left}
                        y1={y}
                        x2={chartWidth - padding.right}
                        y2={y}
                        stroke="#e2e8f0"
                        strokeWidth="1"
                        strokeDasharray={ratio === 0 || ratio === 1 ? "0" : "4 4"}
                      />
                    );
                  })}

                  {/* Memory line path */}
                  {historicalData.length > 1 && (() => {
                    const memValues = historicalData.map(p => parseInt(p.memory || '0'));
                    const maxMem = Math.max(...memValues);
                    const minMem = Math.min(...memValues);
                    const memRange = maxMem - minMem || 1;
                    
                    return (
                      <path
                        d={historicalData.map((point, index) => {
                          const x = (index / (historicalData.length - 1)) * innerWidth + padding.left;
                          const memVal = parseInt(point.memory || '0');
                          const normalized = (memVal - minMem) / memRange;
                          const y = padding.top + innerHeight * (1 - normalized);
                          return `${index === 0 ? 'M' : 'L'} ${x},${y}`;
                        }).join(' ')}
                        fill="none"
                        stroke="#60a5fa"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    );
                  })()}

                  {/* Memory data points */}
                  {(() => {
                    const memValues = historicalData.map(p => parseInt(p.memory || '0'));
                    const maxMem = Math.max(...memValues);
                    const minMem = Math.min(...memValues);
                    const memRange = maxMem - minMem || 1;
                    
                    return historicalData.map((point, index) => {
                      const x = (historicalData.length === 1 ? 0.5 : index / (historicalData.length - 1)) * innerWidth + padding.left;
                      const memVal = parseInt(point.memory || '0');
                      const normalized = (memVal - minMem) / memRange;
                      const y = padding.top + innerHeight * (1 - normalized);
                      return (
                        <g key={index}>
                          <circle
                            cx={x}
                            cy={y}
                            r="6"
                            fill="white"
                            stroke="#60a5fa"
                            strokeWidth="2.5"
                            className="cursor-pointer transition-all"
                            onMouseEnter={(e) => handlePointHover(point, index, e)}
                            onMouseLeave={handlePointLeave}
                          />
                          <circle
                            cx={x}
                            cy={y}
                            r="3"
                            fill="#60a5fa"
                            className="pointer-events-none"
                          />
                        </g>
                      );
                    });
                  })()}

                  {/* Single data point indicator */}
                  {historicalData.length === 1 && (
                    <text
                      x={chartWidth / 2}
                      y={padding.top + innerHeight + 15}
                      textAnchor="middle"
                      fontSize="11"
                      fill="#94a3b8"
                      fontWeight="500"
                      fontStyle="italic"
                    >
                      Single data point available • Trend will appear as more data is collected
                    </text>
                  )}

                  {/* Y-axis labels (dynamic based on data) */}
                  {(() => {
                    const memValues = historicalData.map(p => parseInt(p.memory || '0'));
                    const maxMem = Math.max(...memValues);
                    const minMem = Math.min(...memValues);
                    
                    return [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                      const y = padding.top + innerHeight * ratio;
                      const value = maxMem - ratio * (maxMem - minMem);
                      return (
                        <text
                          key={ratio}
                          x={padding.left - 10}
                          y={y}
                          textAnchor="end"
                          alignmentBaseline="middle"
                          fontSize="11"
                          fill="#64748b"
                          fontWeight="600"
                          fontFamily="'JetBrains Mono', monospace"
                        >
                          {value.toFixed(0)}
                        </text>
                      );
                    });
                  })()}

                  {/* X-axis labels */}
                  {historicalData.length > 0 && [0, Math.floor(historicalData.length / 2), historicalData.length - 1].map((index) => {
                    if (index >= historicalData.length) return null;
                    const x = (historicalData.length === 1 ? 0.5 : index / (historicalData.length - 1)) * innerWidth + padding.left;
                    return (
                      <text
                        key={index}
                        x={x}
                        y={chartHeight - padding.bottom + 20}
                        textAnchor="middle"
                        fontSize="10"
                        fill="#94a3b8"
                        fontWeight="600"
                      >
                        {historicalData[index].date}
                      </text>
                    );
                  })}
                </svg>
              )}
            </div>
          </div>

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

      {/* Footer matching dashboard */}
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

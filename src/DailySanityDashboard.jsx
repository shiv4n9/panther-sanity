import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { loadCSVFromServer } from './utils/csvParser';

// Tooltip Component using Portal
const MetricsTooltip = ({ targetRef, isVisible, data }) => {
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (isVisible && targetRef.current) {
      const rect = targetRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom + window.scrollY + 8,
        left: rect.left + window.scrollX
      });
    }
  }, [isVisible, targetRef]);

  if (!isVisible) return null;

  return createPortal(
    <div 
      className="fixed z-[9999] animate-fade-in-up pointer-events-none"
      style={{ 
        top: `${position.top}px`, 
        left: `${position.left}px`,
        animationDuration: '200ms'
      }}
    >
      <div className="bg-slate-900 text-white rounded-lg shadow-2xl border border-slate-700 p-3 min-w-[200px] pointer-events-auto">
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700">
          <div className="w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.8)]"></div>
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">System Metrics</span>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">CPU Usage:</span>
            <span className="font-jetbrains text-sm font-semibold text-emerald-400">{data.cpu || 'N/A'}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">Memory:</span>
            <span className="font-jetbrains text-sm font-semibold text-blue-400">{data.memory || 'N/A'}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">SHM:</span>
            <span className="font-jetbrains text-sm font-semibold text-purple-400">{data.shm || 'N/A'}</span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

const DailySanityDashboard = ({ data: propData }) => {
  const [csvData, setCsvData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load CSV data on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const result = await loadCSVFromServer('/sample-data.csv');
        setCsvData(result);
        setLoading(false);
      } catch (err) {
        console.error('Failed to load CSV:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    if (!propData) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [propData]);

  // Use prop data if provided, otherwise use loaded CSV data
  const data = propData || csvData?.testData || [];
  const metadata = csvData?.metadata || { platform: 'SRX400', image: 'Loading...' };
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [hoveredCell, setHoveredCell] = useState(null);

  const isNumericOnly = (value) => {
    return /^\d+$/.test(value.trim());
  };

  // Get the appropriate link for throughput value
  const getThroughputLink = (item) => {
    if (isNumericOnly(item.throughput)) {
      // GNATS issue link
      return {
        href: `https://gnats.juniper.net/web/default/${item.throughput}`,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: 'View GNATS issue details'
      };
    } else {
      // Historical view link
      return {
        href: `#/history/${item.id}`,
        target: '_self',
        title: 'View historical performance data'
      };
    }
  };

  const parseThroughput = (throughput) => {
    const cpuMatch = throughput.match(/CPU:\s*(\d+)%/i);
    if (cpuMatch) {
      const cpuPercent = parseInt(cpuMatch[1]);
      const throughputText = throughput.replace(/,?\s*CPU:\s*\d+%/i, '').trim();
      return {
        hasCPU: true,
        throughputText: throughputText,
        cpuPercent,
        isNumeric: false
      };
    }
    // Check if it's numeric only
    if (/^\d+$/.test(throughput.trim())) {
      return {
        hasCPU: false,
        throughputText: throughput,
        cpuPercent: null,
        isNumeric: true
      };
    }
    return {
      hasCPU: false,
      throughputText: throughput,
      cpuPercent: null,
      isNumeric: false
    };
  };

  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return data;
    const lowerSearch = searchTerm.toLowerCase();
    return data.filter(item => 
      item.testCase.toLowerCase().includes(lowerSearch) ||
      item.parameter.toLowerCase().includes(lowerSearch)
    );
  }, [data, searchTerm]);

  const groupedData = useMemo(() => {
    const groups = {};
    filteredData.forEach(item => {
      if (!groups[item.testCase]) {
        groups[item.testCase] = [];
      }
      groups[item.testCase].push(item);
    });
    return groups;
  }, [filteredData]);

  // Initial group expansion
  useMemo(() => {
    const initialExpanded = {};
    Object.keys(groupedData).forEach(testCase => {
      if (!(testCase in expandedGroups)) {
        initialExpanded[testCase] = true;
      }
    });
    if (Object.keys(initialExpanded).length > 0) {
      setExpandedGroups(prev => ({ ...prev, ...initialExpanded }));
    }
  }, [groupedData]);

  const toggleGroup = (testCase) => {
    setExpandedGroups(prev => ({
      ...prev,
      [testCase]: !prev[testCase]
    }));
  };

  const getGroupStatus = (items) => {
    let highestCpu = 0;
    items.forEach(item => {
      const td = parseThroughput(item.throughput);
      if(td.hasCPU && td.cpuPercent > highestCpu) {
        highestCpu = td.cpuPercent;
      }
    });
    if (highestCpu > 95) return 'critical';
    if (highestCpu > 90) return 'warning';
    return 'healthy';
  };

  const getCategoryStyles = (testCase) => {
    const lowerCase = testCase.toLowerCase();
    if (lowerCase.includes('firewall') || lowerCase.includes('udp')) return { bg: 'bg-blue-50/90', bgExpanded: 'bg-blue-100/60', hover: 'hover:bg-blue-100', text: 'text-blue-900', border: 'border-blue-200' };
    if (lowerCase.includes('ipsec')) return { bg: 'bg-indigo-50/90', bgExpanded: 'bg-indigo-100/60', hover: 'hover:bg-indigo-100', text: 'text-indigo-900', border: 'border-indigo-200' };
    if (lowerCase.includes('appsec')) return { bg: 'bg-orange-50/90', bgExpanded: 'bg-orange-100/60', hover: 'hover:bg-orange-100', text: 'text-orange-900', border: 'border-orange-200' };
    return { bg: 'bg-slate-50/90', bgExpanded: 'bg-slate-100/60', hover: 'hover:bg-slate-100', text: 'text-slate-800', border: 'border-slate-200' };
  };

  const overallSeverity = useMemo(() => {
    let severity = 0; 
    Object.values(groupedData).forEach(items => {
      const status = getGroupStatus(items);
      if (status === 'critical') severity = 2;
      else if (status === 'warning' && severity < 2) severity = 1;
    });
    return severity;
  }, [groupedData]);

  const blobColors = 
    overallSeverity === 2 ? ['bg-red-200/40', 'bg-orange-200/30'] :
    overallSeverity === 1 ? ['bg-amber-200/40', 'bg-yellow-200/30'] :
    ['bg-emerald-200/40', 'bg-teal-200/30'];

  return (
    <>
      {loading && (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mb-4"></div>
            <p className="text-slate-600 font-medium">Loading sanity test results...</p>
          </div>
        </div>
      )}
      
      {error && (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="text-red-500 text-5xl mb-4">⚠️</div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Failed to Load Data</h2>
            <p className="text-slate-600">{error}</p>
            <button 
              onClick={() => window.location.reload()} 
              className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}
      
      {!loading && !error && (
      <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

        .font-jetbrains {
          font-family: 'JetBrains Mono', monospace;
        }

        @keyframes scan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
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
          background: rgba(241, 245, 249, 0.5); /* Slate 50 */
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(16, 185, 129, 0.4); /* Soft emerald */
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(16, 185, 129, 0.7); /* Brighter emerald on hover */
        }
      `}</style>
      
      <div 
        className={`min-h-screen bg-slate-50 text-slate-800 relative overflow-hidden pb-16 transition-colors duration-1000`}
        style={{ fontFamily: "'Inter', sans-serif" }}
      >
        
        {/* Dynamic Atmospheric Glows */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
          <div className={`absolute -top-40 -right-20 w-[50rem] h-[50rem] rounded-full blur-[100px] animate-blob ${blobColors[0]} transition-colors duration-1000`}></div>
          <div className={`absolute top-60 -left-40 w-[40rem] h-[40rem] rounded-full blur-[100px] animate-blob ${blobColors[1]} transition-colors duration-1000`} style={{ animationDelay: '4s' }}></div>
        </div>

        {/* Crisp Enterprise Header */}
        <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 py-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
                  <span className="w-2 h-7 bg-gradient-to-b from-emerald-400 to-emerald-600 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.3)]"></span>
                  Daily Sanity Execution
                </h1>
                <p className="text-sm font-medium text-slate-500 capitalize mt-1.5 ml-5">
                  {metadata.platform} • {metadata.image}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="px-3.5 py-1.5 bg-slate-50 border border-slate-200 shadow-sm rounded-lg flex items-center gap-2.5 transition-colors">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></span>
                  </span>
                  <span className="text-xs font-bold text-emerald-600 tracking-wider uppercase">Live System</span>
                </div>
                <div className="text-right border-l border-slate-200 pl-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Database Sync</p>
                  <p className="font-jetbrains text-xs font-semibold text-slate-600 tracking-tight leading-tight mt-0.5">{new Date().toLocaleTimeString()}</p>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-6 py-8 relative z-10 space-y-6">
          
          {/* Search Bar */}
          <div 
            className="animate-fade-in-up relative group transition-shadow duration-300 rounded-xl"
            style={{ animationDelay: '300ms' }}
          >
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-emerald-500 transition-colors pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Query test configurations or network parameters..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-3 bg-white/95 backdrop-blur-md border border-slate-300 rounded-xl
                        focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500
                        transition-all duration-300 text-slate-800 text-sm font-medium placeholder-slate-400 shadow-sm hover:shadow-md"
            />
          </div>

          {/* High Density Accordion Table */}
          <div 
            className="animate-fade-in-up bg-white/95 backdrop-blur-xl rounded-xl shadow-lg border border-slate-300 overflow-hidden flex flex-col"
            style={{ animationDelay: '400ms' }}
          >
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-slate-800 border-b border-slate-700">
              <div className="col-span-4 text-xs font-bold text-slate-300 uppercase tracking-wider pl-1">System Test Case / Profile</div>
              <div className="col-span-4 text-xs font-bold text-slate-300 uppercase tracking-wider">SRX 400 Telemetry</div>
              <div className="col-span-4 text-xs font-bold text-slate-300 uppercase tracking-wider">SRX 440 Telemetry</div>
            </div>

            {/* Table Body */}
            <div className="flex flex-col bg-white">
              {Object.keys(groupedData).length === 0 ? (
                <div className="px-6 py-20 text-center bg-transparent">
                  <p className="text-slate-500 font-medium text-sm">No signals detected. Adjust query.</p>
                </div>
              ) : (
                Object.entries(groupedData).map(([testCase, items], index) => {
                  const isExpanded = expandedGroups[testCase];
                  const status = getGroupStatus(items);
                  const catStyles = getCategoryStyles(testCase);
                  
                  const statusVisuals = {
                    critical: { ring: 'ring-red-400/30', bg: 'bg-red-500', glow: 'shadow-[0_0_12px_rgba(239,68,68,0.8)]', text: 'text-red-700' },
                    warning: { ring: 'ring-orange-400/30', bg: 'bg-orange-500', glow: 'shadow-[0_0_12px_rgba(249,115,22,0.8)]', text: 'text-orange-700' },
                    healthy: { ring: 'ring-emerald-400/30', bg: 'bg-emerald-500', glow: 'shadow-[0_0_12px_rgba(16,185,129,0.8)]', text: catStyles.text }
                  }[status];

                  return (
                    <div 
                      key={testCase} 
                      className="animate-fade-in-up flex flex-col group/accordion transition-colors duration-200 border-b border-slate-200 last:border-0"
                      style={{ animationDelay: `${500 + index * 100}ms` }}
                    >
                      {/* Accordion Header Row (Categorized Tint) */}
                      <div 
                        onClick={() => toggleGroup(testCase)}
                        className={`grid grid-cols-12 gap-4 px-6 py-3 items-center cursor-pointer transition-colors duration-200 ${isExpanded ? catStyles.bgExpanded : catStyles.bg} ${catStyles.hover}`}
                      >
                        <div className="col-span-12 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-5 h-5 rounded flex items-center justify-center bg-white border ${catStyles.border} shadow-sm transition-transform duration-300 group-hover/accordion:shadow ${isExpanded ? 'rotate-90' : ''}`}>
                              <svg className={`w-3.5 h-3.5 ${catStyles.text} group-hover/accordion:-translate-y-0.5 transition-transform`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                            
                            <div className={`relative flex items-center justify-center w-2.5 h-2.5`}>
                              {(status === 'critical' || status === 'warning') && (
                                <span className={`absolute inline-flex w-full h-full rounded-full animate-ping opacity-60 ${statusVisuals.bg}`}></span>
                              )}
                              <span className={`relative inline-flex w-2.5 h-2.5 rounded-full ${statusVisuals.bg} ${statusVisuals.glow} ring-[3px] ${statusVisuals.ring} animate-pulse`} style={{ animationDuration: '3s' }}></span>
                            </div>

                            <span className={`text-sm font-semibold tracking-tight flex items-center gap-2 ${statusVisuals.text}`}>
                              <span>{testCase.split(' (')[0]}</span>
                              {testCase.includes(' (') && (
                                <span className="font-jetbrains text-xs text-zinc-400 font-normal">
                                  [Type: {testCase.split(' (')[1].replace(')', '')}]
                                </span>
                              )}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-2 group-hover/accordion:-translate-x-1 transition-transform duration-300">
                             <span className={`font-jetbrains px-2 py-0.5 rounded border bg-white/80 ${catStyles.border} ${catStyles.text} font-medium text-xs shadow-sm`}>
                               {items.length} node{items.length !== 1 ? 's' : ''}
                             </span>
                          </div>
                        </div>
                      </div>

                      {/* Tighter Density Accordion Content */}
                      <div 
                        className="grid transition-all duration-300 ease-in-out bg-white"
                        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
                      >
                        <div className="overflow-hidden">
                          <div className="flex flex-col">
                            {items.map((item, idx) => {
                              const tData = parseThroughput(item.throughput);
                              const isLast = idx === items.length - 1;
                              const gaugeColor = 
                                tData.cpuPercent > 95 ? 'from-red-500 to-red-600 shadow-[0_0_12px_rgba(239,68,68,0.5)]' :
                                tData.cpuPercent > 90 ? 'from-orange-400 to-orange-500 shadow-[0_0_12px_rgba(249,115,22,0.5)]' :
                                'from-emerald-400 to-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]';

                              const srx400Ref = useRef(null);
                              const srx440Ref = useRef(null);

                              return (
                                <div 
                                  key={item.id}
                                  className={`grid grid-cols-12 gap-4 px-6 py-2.5 items-center group/row hover:bg-slate-50 transition-all duration-200 relative ${!isLast ? 'border-b border-slate-100' : ''}`}
                                >
                                  {/* Indentation logic */}
                                  <div className="absolute left-[33px] top-0 bottom-0 w-px bg-slate-200 group-hover/row:bg-emerald-300 transition-colors"></div>

                                  <div className="col-span-4 flex items-center pl-8">
                                    <div className="w-3 h-px bg-slate-200 mr-3 group-hover/row:bg-emerald-300 transition-colors"></div>
                                    <span 
                                      className="font-jetbrains inline-flex items-center px-2.5 py-0.5 rounded-md bg-[#edfcf7] text-emerald-800 border border-emerald-200 text-xs font-medium cursor-help hover:bg-emerald-100 hover:text-emerald-900 hover:border-emerald-300 hover:scale-[1.03] transition-all duration-200 shadow-sm"
                                      title="Click to view detailed packet configuration parameters"
                                    >
                                      {item.parameter}
                                    </span>
                                  </div>

                                  {/* SRX 400 Telemetry Column */}
                                  <div 
                                    ref={srx400Ref}
                                    className="col-span-4 flex flex-col justify-center gap-1"
                                    onMouseEnter={() => setHoveredCell(`${item.id}-srx400`)}
                                    onMouseLeave={() => setHoveredCell(null)}
                                  >
                                    {isNumericOnly(item.throughput) ? (
                                      <a
                                        {...getThroughputLink(item)}
                                        className="inline-flex items-center gap-1 rounded group/link transition-all duration-200 w-max"
                                      >
                                        <span className="font-jetbrains text-sm font-medium text-slate-700 group-hover/link:text-emerald-600 transition-all">
                                          {Number(item.throughput).toLocaleString()}
                                        </span>
                                        <svg className="w-3.5 h-3.5 text-emerald-500 opacity-0 group-hover/link:opacity-100 group-hover/link:-translate-y-0.5 group-hover/link:translate-x-0.5 transition-all duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 19L20 5m0 0H9m11 0v11" />
                                        </svg>
                                      </a>
                                    ) : (
                                      <a
                                        {...getThroughputLink(item)}
                                        className="flex flex-col gap-1.5 w-full max-w-[200px] group/link cursor-pointer"
                                      >
                                        <div className="flex justify-between items-end">
                                          <span className="font-jetbrains text-sm font-medium text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded-md border border-slate-200 shadow-sm leading-tight group-hover/link:bg-emerald-50 group-hover/link:text-emerald-700 group-hover/link:border-emerald-300 transition-all">
                                            {tData.throughputText}
                                          </span>
                                          {tData.hasCPU && (
                                            <span className={`font-jetbrains text-xs font-bold tracking-tight ${tData.cpuPercent > 90 ? 'text-orange-600' : 'text-slate-500'}`}>
                                              CPU {tData.cpuPercent}%
                                            </span>
                                          )}
                                        </div>
                                        
                                        {tData.hasCPU && (
                                          <div className="relative w-full h-[4px] bg-slate-200 rounded-full overflow-hidden shadow-inner border border-slate-300/50">
                                            <div className="absolute top-0 bottom-0 left-[80%] w-px bg-slate-400 z-10"></div>
                                            <div className="absolute top-0 bottom-0 left-[90%] w-px bg-slate-400 z-10"></div>
                                            <div 
                                              className={`absolute left-0 top-0 bottom-0 bg-gradient-to-r ${gaugeColor} transition-all duration-500`}
                                              style={{ width: `${tData.cpuPercent}%` }}
                                            >
                                              <div className="absolute top-0 w-full h-full bg-gradient-to-r from-transparent via-white/50 to-transparent -translate-x-full animate-[scan_2s_ease-in-out_infinite]" style={{ animationDuration: '3s' }}></div>
                                            </div>
                                          </div>
                                        )}
                                      </a>
                                    )}
                                    
                                    <MetricsTooltip 
                                      targetRef={srx400Ref}
                                      isVisible={hoveredCell === `${item.id}-srx400`}
                                      data={item}
                                    />
                                  </div>

                                  {/* SRX 440 Telemetry Column */}
                                  <div 
                                    ref={srx440Ref}
                                    className="col-span-4 flex flex-col justify-center gap-1"
                                    onMouseEnter={() => setHoveredCell(`${item.id}-srx440`)}
                                    onMouseLeave={() => setHoveredCell(null)}
                                  >
                                    {isNumericOnly(item.throughput) ? (
                                      <a
                                        {...getThroughputLink(item)}
                                        className="inline-flex items-center gap-1 rounded group/link transition-all duration-200 w-max"
                                      >
                                        <span className="font-jetbrains text-sm font-medium text-slate-700 group-hover/link:text-emerald-600 transition-all">
                                          {Number(item.throughput).toLocaleString()}
                                        </span>
                                        <svg className="w-3.5 h-3.5 text-emerald-500 opacity-0 group-hover/link:opacity-100 group-hover/link:-translate-y-0.5 group-hover/link:translate-x-0.5 transition-all duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 19L20 5m0 0H9m11 0v11" />
                                        </svg>
                                      </a>
                                    ) : (
                                      <a
                                        {...getThroughputLink(item)}
                                        className="flex flex-col gap-1.5 w-full max-w-[200px] group/link cursor-pointer"
                                      >
                                        <div className="flex justify-between items-end">
                                          <span className="font-jetbrains text-sm font-medium text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded-md border border-slate-200 shadow-sm leading-tight group-hover/link:bg-emerald-50 group-hover/link:text-emerald-700 group-hover/link:border-emerald-300 transition-all">
                                            {tData.throughputText}
                                          </span>
                                          {tData.hasCPU && (
                                            <span className={`font-jetbrains text-xs font-bold tracking-tight ${tData.cpuPercent > 90 ? 'text-orange-600' : 'text-slate-500'}`}>
                                              CPU {tData.cpuPercent}%
                                            </span>
                                          )}
                                        </div>
                                        
                                        {tData.hasCPU && (
                                          <div className="relative w-full h-[4px] bg-slate-200 rounded-full overflow-hidden shadow-inner border border-slate-300/50">
                                            <div className="absolute top-0 bottom-0 left-[80%] w-px bg-slate-400 z-10"></div>
                                            <div className="absolute top-0 bottom-0 left-[90%] w-px bg-slate-400 z-10"></div>
                                            <div 
                                              className={`absolute left-0 top-0 bottom-0 bg-gradient-to-r ${gaugeColor} transition-all duration-500`}
                                              style={{ width: `${tData.cpuPercent}%` }}
                                            >
                                              <div className="absolute top-0 w-full h-full bg-gradient-to-r from-transparent via-white/50 to-transparent -translate-x-full animate-[scan_2s_ease-in-out_infinite]" style={{ animationDuration: '3s' }}></div>
                                            </div>
                                          </div>
                                        )}
                                      </a>
                                    )}
                                    
                                    <MetricsTooltip 
                                      targetRef={srx440Ref}
                                      isVisible={hoveredCell === `${item.id}-srx440`}
                                      data={item}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </main>
      </div>
    </>
      )}
    </>
  );
};

export default DailySanityDashboard;

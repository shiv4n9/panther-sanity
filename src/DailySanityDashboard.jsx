import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { loadCSVFromServer } from './utils/csvParser';
import { API_BASE } from './config/api';

// Tooltip Component using Portal — uses mouse position, no refs needed
const MetricsTooltip = ({ position, isVisible, data }) => {
  if (!isVisible || !position) return null;

  return createPortal(
    <div 
      className="fixed z-[9999] animate-fade-in-up pointer-events-none"
      style={{ 
        top: `${position.y + 8}px`, 
        left: `${position.x}px`,
        animationDuration: '200ms'
      }}
    >
      <div className="bg-slate-900 text-white rounded-lg shadow-2xl border border-slate-700 p-3 min-w-[200px]">
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
        const result = await loadCSVFromServer();
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
  const [hoveredCell, setHoveredCell] = useState(null); // { id, x, y } | null
  const [ingestStatus, setIngestStatus] = useState(null); // null | 'loading' | 'success' | 'error'
  const [ingestMessage, setIngestMessage] = useState('');

  const triggerIngest = async () => {
    setIngestStatus('loading');
    setIngestMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/ingest?force=true`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ingest failed');
      if (json.status === 'skipped') {
        setIngestStatus('success');
        setIngestMessage('Already up to date');
      } else {
        setIngestStatus('success');
        setIngestMessage(`Ingested ${json.inserted} rows from ${json.filename}`);
      }
    } catch (err) {
      setIngestStatus('error');
      setIngestMessage(err.message);
    } finally {
      setTimeout(() => setIngestStatus(null), 4000);
    }
  };

  const isNumericOnly = (value) => {
    return /^\d+$/.test(value.trim());
  };

  // Get the appropriate link for throughput value
  const getThroughputLink = (item) => {
    if (isNumericOnly(item.throughput)) {
      // GNATS issue link
      return {
        href: `https://gnats.juniper.net/web/default/${item.throughput}#description_tab`,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: 'View GNATS issue details'
      };
    } else {
      // Historical view link — encode item data as URL params
      const params = new URLSearchParams({
        tc: item.testCase,
        p:  item.parameter,
        t:  item.throughput,
      });
      return {
        href: `#/history/${item.id}?${params.toString()}`,
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

  // Initial group expansion — useEffect because it triggers state updates
  useEffect(() => {
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

  const getCategoryStyles = (testCase) => {
    const lowerCase = testCase.toLowerCase();
    if (lowerCase.includes('firewall') || lowerCase.includes('udp')) return { bg: 'bg-blue-50/60', bgExpanded: 'bg-blue-50/40', hover: 'hover:bg-blue-50/80', text: 'text-blue-800', border: 'border-blue-200', accent: 'border-l-blue-500', dot: 'bg-blue-500', dotGlow: 'shadow-[0_0_8px_rgba(59,130,246,0.5)]' };
    if (lowerCase.includes('ipsec')) return { bg: 'bg-indigo-50/60', bgExpanded: 'bg-indigo-50/40', hover: 'hover:bg-indigo-50/80', text: 'text-indigo-800', border: 'border-indigo-200', accent: 'border-l-indigo-500', dot: 'bg-indigo-500', dotGlow: 'shadow-[0_0_8px_rgba(99,102,241,0.5)]' };
    if (lowerCase.includes('appsec')) return { bg: 'bg-amber-50/60', bgExpanded: 'bg-amber-50/40', hover: 'hover:bg-amber-50/80', text: 'text-amber-800', border: 'border-amber-200', accent: 'border-l-amber-500', dot: 'bg-amber-500', dotGlow: 'shadow-[0_0_8px_rgba(245,158,11,0.5)]' };
    return { bg: 'bg-slate-50/60', bgExpanded: 'bg-slate-50/40', hover: 'hover:bg-slate-50/80', text: 'text-slate-700', border: 'border-slate-200', accent: 'border-l-slate-400', dot: 'bg-slate-400', dotGlow: 'shadow-[0_0_8px_rgba(148,163,184,0.5)]' };
  };

  const blobColors = ['bg-emerald-100/30', 'bg-blue-100/20'];

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

      
      <div 
        className={`min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-800 relative overflow-hidden pb-16 transition-colors duration-1000`}
        style={{ fontFamily: "'Inter', sans-serif" }}
      >
        
        {/* Dynamic Atmospheric Glows */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
          <div className={`absolute -top-40 -right-20 w-[50rem] h-[50rem] rounded-full blur-[100px] animate-blob ${blobColors[0]} transition-colors duration-1000`}></div>
          <div className={`absolute top-60 -left-40 w-[40rem] h-[40rem] rounded-full blur-[100px] animate-blob ${blobColors[1]} transition-colors duration-1000`} style={{ animationDelay: '4s' }}></div>
        </div>

        {/* Premium Enterprise Header */}
        <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 py-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
                  <span className="w-1.5 h-8 bg-gradient-to-b from-emerald-400 to-teal-600 rounded-full shadow-[0_0_12px_rgba(16,185,129,0.4)]"></span>
                  <span className="bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text">PANTHER</span>
                  <span className="font-semibold text-slate-600">Daily Sanity Dashboard</span>
                </h1>
                <p className="text-sm font-medium text-slate-400 mt-1 ml-[1.85rem] tracking-wide">
                  Automated Test Execution Results
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* AppSec Performance Button */}
                <a
                  href="#/appsec-performance"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-purple-200 bg-gradient-to-b from-purple-50 to-purple-100/80 text-purple-700 text-xs font-bold uppercase tracking-wider shadow-sm hover:shadow-md hover:border-purple-300 hover:from-purple-100 hover:to-purple-150 transition-all duration-200"
                  title="View SRX440 AppSec Performance Results"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  AppSec
                </a>

                {/* Ingest Latest Button */}
                <button
                  onClick={triggerIngest}
                  disabled={ingestStatus === 'loading'}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold uppercase tracking-wider shadow-sm transition-all duration-200
                    ${
                      ingestStatus === 'loading'
                        ? 'bg-slate-100 border-slate-300 text-slate-400 cursor-wait'
                        : ingestStatus === 'success'
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                        : ingestStatus === 'error'
                        ? 'bg-red-50 border-red-300 text-red-700'
                        : 'bg-white border-slate-300 text-slate-600 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700'
                    }`
                  }
                >
                  {ingestStatus === 'loading' ? (
                    <>
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                      </svg>
                      Ingesting...
                    </>
                  ) : ingestStatus === 'success' ? (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      {ingestMessage}
                    </>
                  ) : ingestStatus === 'error' ? (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      {ingestMessage}
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      Ingest Latest
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-6 py-6 relative z-10 space-y-4">
          
          {/* Search Bar */}
          <div 
            className="animate-fade-in-up relative group transition-shadow duration-300 rounded-2xl"
            style={{ animationDelay: '200ms' }}
          >
            <svg className="absolute left-5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-300 group-focus-within:text-emerald-500 transition-colors duration-300 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search test cases or parameters..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-5 py-3.5 bg-white/90 backdrop-blur-md border border-slate-200 rounded-2xl
                        focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 focus:shadow-[0_0_0_4px_rgba(16,185,129,0.08)]
                        transition-all duration-300 text-slate-800 text-sm font-medium placeholder-slate-400
                        shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
            />
          </div>

          {/* Image Info Bar with Longevity Button */}
          {metadata.image && metadata.image !== 'Loading...' && (
            <div 
              className="animate-fade-in-up bg-white/90 backdrop-blur-md border border-slate-200 border-l-[3px] border-l-teal-500 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)]"
              style={{ animationDelay: '250ms' }}
            >
              <div className="px-5 py-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Image Version</span>
                    <div className="h-4 w-px bg-slate-300"></div>
                    <span className="text-xs font-semibold text-slate-400">{metadata.platform}:</span>
                    <span className="font-jetbrains text-sm font-bold text-slate-700">{metadata.image}</span>
                  </div>
                  
                  {/* Longevity Portal Button */}
                  <button
                    onClick={() => window.open('http://10.204.134.80:3000/?device=snpsrx400c-proto', '_blank')}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-blue-400 bg-white text-blue-600 text-xs font-semibold uppercase tracking-wider shadow-sm hover:bg-blue-50 hover:border-blue-500 transition-all duration-200"
                    title="View SRX 400 telemetry in Longevity Portal"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Longevity
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* High Density Accordion Table */}
          <div 
            className="animate-fade-in-up bg-white/95 backdrop-blur-xl rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.06)] border border-slate-200/80 overflow-hidden flex flex-col"
            style={{ animationDelay: '300ms' }}
          >
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-gradient-to-r from-slate-800 to-slate-900 border-b border-slate-700">
              <div className="col-span-4 text-xs font-semibold text-slate-300 uppercase tracking-[0.1em] pl-1">Test Case / Configuration</div>
              <div className="col-span-4 text-xs font-semibold text-slate-300 uppercase tracking-[0.1em]">SRX 400</div>
              <div className="col-span-4 text-xs font-semibold text-slate-300 uppercase tracking-[0.1em]">SRX 440</div>
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
                  const catStyles = getCategoryStyles(testCase);
                  
                  const statusVisuals = { ring: 'ring-slate-400/30', bg: catStyles.dot, glow: catStyles.dotGlow, text: catStyles.text };

                  return (
                    <div 
                      key={testCase} 
                      className="animate-fade-in-up flex flex-col group/accordion transition-colors duration-200 border-b border-slate-200 last:border-0"
                      style={{ animationDelay: `${500 + index * 100}ms` }}
                    >
                      {/* Accordion Header Row (Categorized Tint) */}
                      <div 
                        onClick={() => toggleGroup(testCase)}
                        className={`grid grid-cols-12 gap-4 px-6 py-3.5 items-center cursor-pointer transition-all duration-200 border-l-[3px] ${catStyles.accent} ${isExpanded ? catStyles.bgExpanded : catStyles.bg} ${catStyles.hover}`}
                      >
                        <div className="col-span-12 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-5 h-5 rounded flex items-center justify-center bg-white border ${catStyles.border} shadow-sm transition-transform duration-300 group-hover/accordion:shadow ${isExpanded ? 'rotate-90' : ''}`}>
                              <svg className={`w-3.5 h-3.5 ${catStyles.text} group-hover/accordion:-translate-y-0.5 transition-transform`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                            
                            <div className={`relative flex items-center justify-center w-2.5 h-2.5`}>
                              <span className={`relative inline-flex w-2.5 h-2.5 rounded-full ${statusVisuals.bg} ${statusVisuals.glow} ring-[3px] ${statusVisuals.ring}`}></span>
                            </div>

                            <span className={`text-sm font-semibold tracking-tight ${statusVisuals.text}`}>
                              <div className="flex flex-col">
                                <span>{testCase.includes('Throughput') ? testCase.replace('Firewall Throughput', 'UDP Throughput') : testCase.split(' (')[0]}</span>
                                {testCase.includes('Firewall Throughput') && (
                                  <span className="font-jetbrains text-xs text-slate-400 font-normal">
                                    Firewall Throughput
                                  </span>
                                )}
                                {testCase.includes(' (') && !testCase.includes('Firewall Throughput') && (
                                  <span className="font-jetbrains text-xs text-slate-400 font-normal">
                                    {testCase.split(' (')[1].replace(')', '')}
                                  </span>
                                )}
                              </div>
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
                              // Use neutral color for all CPU bars
                              const gaugeColor = 'from-emerald-400 to-teal-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]';

                              const handleCellEnter = (e, cellId) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setHoveredCell({ id: cellId, x: rect.left, y: rect.bottom });
                              };

                              return (
                                <div 
                                  key={item.id}
                                  className={`grid grid-cols-12 gap-4 px-6 py-2.5 items-center group/row hover:bg-slate-50 transition-all duration-200 relative ${!isLast ? 'border-b border-slate-100' : ''}`}
                                >
                                  {/* Indentation logic */}
                                  <div className="absolute left-[33px] top-0 bottom-0 w-px bg-slate-200 group-hover/row:bg-emerald-300 transition-colors"></div>

                                  <div className="col-span-4 flex items-center pl-8">
                                    <div className="w-3 h-px bg-slate-200 mr-3 group-hover/row:bg-emerald-300 transition-colors"></div>
                                    <span className={`text-sm font-medium text-slate-700 leading-relaxed`}>
                                      {testCase.includes('Firewall Throughput') 
                                        ? `Firewall UDP (${item.parameter})`
                                        : testCase.includes('Throughput')
                                        ? `${testCase.split(' (')[0]} (${item.parameter})`
                                        : `${testCase} (${item.parameter})`
                                      }
                                    </span>
                                  </div>

                                  {/* SRX 400 Column */}
                                  <div 
                                    className="col-span-4 flex flex-col justify-center gap-1"
                                    onMouseEnter={(e) => !isNumericOnly(item.throughput) && handleCellEnter(e, `${item.id}-srx400`)}
                                    onMouseLeave={() => setHoveredCell(null)}
                                  >
                                    {isNumericOnly(item.throughput) ? (
                                      <a
                                        {...getThroughputLink(item)}
                                        className="inline-flex items-center gap-1 rounded group/link transition-all duration-200 w-max"
                                      >
                                        <span className="font-jetbrains text-sm font-medium text-slate-700 group-hover/link:text-emerald-600 transition-all">
                                          PR:{item.throughput}
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
                                        <span className="font-jetbrains text-sm font-medium text-slate-800 bg-gradient-to-r from-slate-50 to-slate-100 px-2.5 py-1 rounded-lg border border-slate-200/80 shadow-[0_1px_2px_rgba(0,0,0,0.04)] leading-tight group-hover/link:from-emerald-50 group-hover/link:to-emerald-100/80 group-hover/link:text-emerald-700 group-hover/link:border-emerald-300 transition-all">
                                          {tData.throughputText}
                                        </span>
                                        
                                        {tData.hasCPU && (
                                          <div className="relative w-full h-[5px] bg-slate-100 rounded-full overflow-hidden shadow-inner border border-slate-200/50">
                                            <div className="absolute top-0 bottom-0 left-[80%] w-px bg-slate-300/60 z-10"></div>
                                            <div className="absolute top-0 bottom-0 left-[90%] w-px bg-slate-300/60 z-10"></div>
                                            <div 
                                              className={`absolute left-0 top-0 bottom-0 bg-gradient-to-r ${gaugeColor} rounded-full transition-all duration-700 ease-out`}
                                              style={{ width: `${tData.cpuPercent}%` }}
                                            >
                                              <div className="absolute top-0 w-full h-full bg-gradient-to-r from-transparent via-white/40 to-transparent -translate-x-full animate-[scan_2s_ease-in-out_infinite]" style={{ animationDuration: '3s' }}></div>
                                            </div>
                                          </div>
                                        )}
                                      </a>
                                    )}
                                    
                                    <MetricsTooltip 
                                      position={hoveredCell?.id === `${item.id}-srx400` ? hoveredCell : null}
                                      isVisible={hoveredCell?.id === `${item.id}-srx400`}
                                      data={item}
                                    />
                                  </div>

                                  {/* SRX 440 Column */}
                                  <div 
                                    className="col-span-4 flex flex-col justify-center gap-1"
                                    onMouseEnter={(e) => item.throughput440 && !isNumericOnly(item.throughput440) && handleCellEnter(e, `${item.id}-srx440`)}
                                    onMouseLeave={() => setHoveredCell(null)}
                                  >
                                    {item.throughput440 ? (
                                      // Has real 440 data — render same as 400
                                      isNumericOnly(item.throughput440) ? (
                                        <a
                                          href={`https://gnats.juniper.net/web/default/${item.throughput440}#description_tab`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 rounded group/link transition-all duration-200 w-max"
                                        >
                                          <span className="font-jetbrains text-sm font-medium text-slate-700 group-hover/link:text-emerald-600 transition-all">
                                            PR:{item.throughput440}
                                          </span>
                                          <svg className="w-3.5 h-3.5 text-emerald-500 opacity-0 group-hover/link:opacity-100 transition-all duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 19L20 5m0 0H9m11 0v11" />
                                          </svg>
                                        </a>
                                      ) : (
                                        <span className="font-jetbrains text-sm font-medium text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded-md border border-slate-200 shadow-sm leading-tight">
                                          {item.throughput440}
                                        </span>
                                      )
                                    ) : (
                                      // No 440 data — show N/A
                                      <span className="font-jetbrains text-sm text-slate-300 select-none">—</span>
                                    )}

                                    <MetricsTooltip 
                                      position={hoveredCell?.id === `${item.id}-srx440` ? hoveredCell : null}
                                      isVisible={hoveredCell?.id === `${item.id}-srx440`}
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

        {/* Footer with Database Sync Time */}
        <footer className="bg-white/80 backdrop-blur-md border-t border-slate-200/60">
          <div className="h-px bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent"></div>
          <div className="max-w-7xl mx-auto px-6 py-3.5">
            <div className="flex items-center justify-center gap-2.5 text-xs text-slate-500">
              <div className="flex items-center gap-1.5 text-emerald-600">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              </div>
              <span className="font-medium">Last Database Sync:</span>
              <span className="font-jetbrains font-semibold text-slate-700">{new Date().toLocaleTimeString()}</span>
              <span className="text-slate-300">•</span>
              <span className="text-slate-400">{new Date().toLocaleDateString()}</span>
            </div>
          </div>
        </footer>
      </div>
    </>
      )}
    </>
  );
};

export default DailySanityDashboard;

import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { loadDatasheet, mergeSheets } from './utils/xlsxParser';
import { SANITY_TEST_CASES } from './config/sanityTestCases';
import { API_BASE } from './config/api';

// ─── Tooltip Portal ──────────────────────────────────────────
const MetricsTooltip = ({ position, isVisible, data }) => {
  if (!isVisible || !position || !data) return null;
  return createPortal(
    <div
      className="fixed z-[9999] animate-fade-in-up pointer-events-none"
      style={{ top: `${position.y + 8}px`, left: `${position.x}px`, animationDuration: '200ms' }}
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
            <span className="text-xs text-slate-400">Global Data SHM:</span>
            <span className="font-jetbrains text-sm font-semibold text-purple-400">{data.shm || 'N/A'}</span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

// ─── Category Color Map ──────────────────────────────────────
const getCategoryStyles = (category) => {
  const lc = category.toLowerCase();
  if (lc.includes('http ') && lc.includes('cps'))
    return { bg: 'bg-blue-50/60', hover: 'hover:bg-blue-50/80', text: 'text-blue-800', border: 'border-blue-200', accent: 'border-l-blue-500', dot: 'bg-blue-500', dotGlow: 'shadow-[0_0_8px_rgba(59,130,246,0.5)]' };
  if (lc.includes('https'))
    return { bg: 'bg-indigo-50/60', hover: 'hover:bg-indigo-50/80', text: 'text-indigo-800', border: 'border-indigo-200', accent: 'border-l-indigo-500', dot: 'bg-indigo-500', dotGlow: 'shadow-[0_0_8px_rgba(99,102,241,0.5)]' };
  if (lc.includes('cps'))
    return { bg: 'bg-amber-50/60', hover: 'hover:bg-amber-50/80', text: 'text-amber-800', border: 'border-amber-200', accent: 'border-l-amber-500', dot: 'bg-amber-500', dotGlow: 'shadow-[0_0_8px_rgba(245,158,11,0.5)]' };
  if (lc.includes('udp') || lc.includes('ipsec'))
    return { bg: 'bg-rose-50/60', hover: 'hover:bg-rose-50/80', text: 'text-rose-800', border: 'border-rose-200', accent: 'border-l-rose-500', dot: 'bg-rose-500', dotGlow: 'shadow-[0_0_8px_rgba(244,63,94,0.5)]' };
  if (lc.includes('scaling'))
    return { bg: 'bg-teal-50/60', hover: 'hover:bg-teal-50/80', text: 'text-teal-800', border: 'border-teal-200', accent: 'border-l-teal-500', dot: 'bg-teal-500', dotGlow: 'shadow-[0_0_8px_rgba(20,184,166,0.5)]' };
  return { bg: 'bg-slate-50/60', hover: 'hover:bg-slate-50/80', text: 'text-slate-700', border: 'border-slate-200', accent: 'border-l-slate-400', dot: 'bg-slate-400', dotGlow: 'shadow-[0_0_8px_rgba(148,163,184,0.5)]' };
};

// ─── Main Component ──────────────────────────────────────────
const DailySanityDashboard = () => {
  const [mergedData, setMergedData] = useState([]);
  const [releases, setReleases] = useState({ srx400: '', srx440: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeView, setActiveView] = useState('sanity');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [hoveredCell, setHoveredCell] = useState(null);
  const [ingestStatus, setIngestStatus] = useState(null);
  const [ingestMessage, setIngestMessage] = useState('');
  const [showCompare, setShowCompare] = useState(false);

  const isSanity = activeView === 'sanity';
  const show3XX = isSanity && showCompare;

  // ── Load XLSX on mount ──
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await loadDatasheet();
        const merged = mergeSheets(data.srx400, data.srx440);
        setMergedData(merged);
        setReleases({ srx400: data.srx400.release, srx440: data.srx440.release });
        // Expand all sections by default
        const expanded = {};
        merged.forEach(s => { expanded[s.category] = true; });
        setExpandedGroups(expanded);
      } catch (err) {
        console.error('Failed to load datasheet:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Ingest trigger (kept for legacy DB pipeline) ──
  const triggerIngest = async () => {
    setIngestStatus('loading');
    setIngestMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/ingest?force=true`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Ingest failed');
      setIngestStatus('success');
      setIngestMessage(json.status === 'skipped' ? 'Already up to date' : `Ingested ${json.inserted} rows`);
    } catch (err) {
      setIngestStatus('error');
      setIngestMessage(err.message);
    } finally {
      setTimeout(() => setIngestStatus(null), 4000);
    }
  };

  // ── View filter: sanity vs. regression ──
  const viewFilteredData = useMemo(() => {
    if (activeView === 'regression') return mergedData;

    // Sanity view: collect matching rows, re-group by sanity label
    const sanityGroups = SANITY_TEST_CASES.map(sc => ({
      category: sc.label,
      tests: [],
    }));

    for (const section of mergedData) {
      for (const test of section.tests) {
        const tcName = test.testCase.trim();
        // Check each sanity group's matchers
        let matched = false;
        for (let i = 0; i < SANITY_TEST_CASES.length && !matched; i++) {
          for (const m of SANITY_TEST_CASES[i].matchers) {
            // If the matcher specifies a category constraint, check the parent section
            if (m.category && !m.category.test(section.category)) continue;
            if (m.match(tcName)) {
              sanityGroups[i].tests.push(test);
              matched = true;
              break;
            }
          }
        }
      }
    }

    return sanityGroups.filter(g => g.tests.length > 0);
  }, [mergedData, activeView]);

  // ── Search filter (applied on top of view filter) ──
  const displayData = useMemo(() => {
    if (!searchTerm.trim()) return viewFilteredData;
    const lower = searchTerm.toLowerCase();
    return viewFilteredData
      .map(section => ({
        ...section,
        tests: section.tests.filter(t =>
          t.testCase.toLowerCase().includes(lower) ||
          section.category.toLowerCase().includes(lower)
        ),
      }))
      .filter(section => section.tests.length > 0);
  }, [viewFilteredData, searchTerm]);

  const toggleGroup = (cat) => {
    setExpandedGroups(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const handleCellEnter = (e, cellId, metrics) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredCell({ id: cellId, x: rect.left, y: rect.bottom, ...metrics });
  };

  // ── Render ──
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="relative inline-flex items-center justify-center mb-6">
            <div className="absolute w-16 h-16 rounded-full border-2 border-emerald-400/30 animate-pulse-ring"></div>
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-2 border-transparent border-t-emerald-400 border-r-blue-400"></div>
          </div>
          <p className="text-slate-300 font-medium tracking-wide">Loading SRX4XX Datasheet…</p>
          <p className="text-slate-500 text-xs mt-1">Parsing Excel telemetry data</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Failed to Load Datasheet</h2>
          <p className="text-slate-600">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-emerald-50/20 text-slate-800 relative overflow-hidden pb-16" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* Atmospheric Glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-40 -right-20 w-[50rem] h-[50rem] rounded-full blur-[120px] animate-blob bg-gradient-to-br from-emerald-200/40 to-teal-100/30"></div>
        <div className="absolute top-60 -left-40 w-[40rem] h-[40rem] rounded-full blur-[120px] animate-blob bg-gradient-to-br from-blue-200/30 to-indigo-100/20" style={{ animationDelay: '4s' }}></div>
        <div className="absolute bottom-20 right-1/3 w-[30rem] h-[30rem] rounded-full blur-[100px] animate-blob bg-gradient-to-br from-purple-100/20 to-pink-100/15" style={{ animationDelay: '8s' }}></div>
      </div>

      {/* ── Header ── */}
      <header className="glass sticky top-0 z-50 border-b border-white/20 shadow-[0_4px_30px_rgba(0,0,0,0.08)]">
        <div className="h-[2px] w-full bg-gradient-to-r from-emerald-500 via-blue-500 to-purple-500 animate-gradient"></div>
        <div className="max-w-[90rem] mx-auto px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-3">
                <span className="relative w-2 h-9 rounded-full overflow-hidden">
                  <span className="absolute inset-0 bg-gradient-to-b from-emerald-400 via-blue-500 to-purple-500 animate-gradient"></span>
                  <span className="absolute inset-0 bg-gradient-to-b from-emerald-400 via-blue-500 to-purple-500 blur-md opacity-60"></span>
                </span>
                <span className="bg-gradient-to-r from-emerald-600 via-blue-600 to-purple-600 bg-clip-text text-transparent animate-gradient">PANTHER</span>
                <span className="font-semibold text-slate-700">Daily Sanity Dashboard</span>
              </h1>
              <p className="text-sm font-medium text-slate-400 mt-1 ml-[1.85rem] tracking-wide">SRX4XX Performance Telemetry — XLSX Pipeline</p>
            </div>
            <div className="flex items-center gap-2">
              <a href="#/appsec-performance" className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-purple-200/80 bg-gradient-to-r from-purple-50 to-fuchsia-50 text-purple-700 text-xs font-bold uppercase tracking-wider shadow-sm hover:shadow-lg hover:shadow-purple-200/50 hover:border-purple-300 hover:-translate-y-0.5 transition-all duration-300" title="View SRX440 AppSec Performance Results">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                AppSec
              </a>
              <button onClick={triggerIngest} disabled={ingestStatus === 'loading'} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold uppercase tracking-wider shadow-sm transition-all duration-300 hover:-translate-y-0.5 ${ingestStatus === 'loading' ? 'bg-slate-100 border-slate-300 text-slate-400 cursor-wait' : ingestStatus === 'success' ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : ingestStatus === 'error' ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-slate-300 text-slate-600 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700 hover:shadow-lg hover:shadow-emerald-200/50'}`}>
                {ingestStatus === 'loading' ? 'Ingesting…' : ingestStatus === 'success' ? ingestMessage : ingestStatus === 'error' ? ingestMessage : 'Ingest Latest'}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="max-w-[90rem] mx-auto px-6 py-6 relative z-10 space-y-4">

        {/* Search Bar */}
        <div className="animate-fade-in-up relative group" style={{ animationDelay: '200ms' }}>
          <svg className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-300 group-focus-within:text-emerald-500 transition-colors duration-300 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search test cases…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-5 py-3.5 glass rounded-2xl border border-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-300 transition-all duration-300 text-slate-800 text-sm font-medium placeholder-slate-400 shadow-[0_4px_20px_rgba(0,0,0,0.04)]"
          />
        </div>

        {/* View Toggle — Pill Segmented Control */}
        <div className="animate-fade-in-up flex items-center justify-center" style={{ animationDelay: '220ms' }}>
          <div className="inline-flex items-center glass-dark rounded-full p-1 shadow-xl border border-white/10">
            <button
              onClick={() => { setActiveView('sanity'); setShowCompare(false); }}
              className={`relative px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
                activeView === 'sanity'
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-[0_0_20px_rgba(16,185,129,0.5)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Daily Sanity
              </span>
            </button>
            <button
              onClick={() => setActiveView('regression')}
              className={`relative px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
                activeView === 'regression'
                  ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-[0_0_20px_rgba(59,130,246,0.5)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                Full Regression
              </span>
            </button>
          </div>
        </div>

        {/* Release Info Bar */}
        <div className="animate-fade-in-up glass rounded-xl border border-white/30 shadow-[0_4px_20px_rgba(0,0,0,0.04)]" style={{ animationDelay: '250ms' }}>
          <div className="h-[2px] rounded-t-xl bg-gradient-to-r from-emerald-400 via-blue-400 to-purple-400"></div>
          <div className="px-5 py-2.5 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">SRX400</span>
                <span className="font-jetbrains text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{releases.srx400}</span>
              </div>
              <div className="h-4 w-px bg-gradient-to-b from-transparent via-slate-300 to-transparent"></div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">SRX440</span>
                <span className="font-jetbrains text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{releases.srx440}</span>
              </div>
            </div>
            <button onClick={() => window.open('http://10.204.134.80:3000/?device=snpsrx400c-proto', '_blank')} className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-blue-300 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-600 text-xs font-semibold uppercase tracking-wider shadow-sm hover:shadow-md hover:shadow-blue-200/50 hover:-translate-y-0.5 transition-all duration-300" title="View SRX 400 telemetry in Longevity Portal">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
              Longevity
            </button>
          </div>
        </div>

        {/* ── Data Table ── */}
        <div className="animate-fade-in-up glass rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.08)] border border-white/30 overflow-hidden" style={{ animationDelay: '300ms' }}>

          {/* Table Header */}
          <div className={`grid gap-0 px-6 py-3 bg-gradient-to-r from-slate-800 via-slate-900 to-slate-800 border-b border-slate-700/50 transition-all duration-300 ${show3XX ? 'grid-cols-[2fr_repeat(5,1fr)]' : 'grid-cols-12'}`}>
            <div className={`text-xs font-semibold text-slate-300 uppercase tracking-[0.1em] pl-1 ${show3XX ? '' : 'col-span-3'}`}>Test Case</div>
            <div className={`text-xs font-semibold text-slate-300 uppercase tracking-[0.1em] ${show3XX ? '' : 'col-span-3'}`}>SRX 400</div>
            <div className={`text-xs font-semibold text-slate-300 uppercase tracking-[0.1em] ${show3XX ? '' : 'col-span-3'}`}>SRX 440</div>
            {show3XX ? (
              <>
                <div className="text-xs font-semibold text-orange-300 uppercase tracking-[0.1em]">SRX 300</div>
                <div className="text-xs font-semibold text-orange-300 uppercase tracking-[0.1em]">SRX 320</div>
                <div className="text-xs font-semibold text-orange-300 uppercase tracking-[0.1em] flex items-center justify-between">
                  SRX 340
                  <button onClick={() => setShowCompare(false)} className="ml-2 text-slate-400 hover:text-white transition-colors" title="Close comparison">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </>
            ) : (
              <div className="col-span-3 text-xs font-semibold text-slate-300 uppercase tracking-[0.1em]">
                {isSanity ? (
                  <button
                    onClick={() => setShowCompare(true)}
                    className="flex items-center gap-1.5 text-orange-300 hover:text-orange-200 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                    Compare 3XX
                  </button>
                ) : 'Comments'}
              </div>
            )}
          </div>

          {/* Table Body — Accordion Sections */}
          <div className="flex flex-col bg-white">
            {displayData.length === 0 ? (
              <div className="px-6 py-20 text-center"><p className="text-slate-500 font-medium text-sm">No results found. Adjust your search.</p></div>
            ) : (
              displayData.map((section, sIdx) => {
                const isExpanded = expandedGroups[section.category] ?? true;
                const styles = getCategoryStyles(section.category);
                const testCount = section.tests.filter(t => t.srx400.throughput || t.srx440.throughput).length;

                return (
                  <div key={section.category} className="animate-fade-in-up flex flex-col border-b border-slate-200 last:border-0" style={{ animationDelay: `${400 + sIdx * 80}ms` }}>

                    {/* Section Header */}
                    <div
                      onClick={() => toggleGroup(section.category)}
                      className={`grid grid-cols-12 gap-0 px-6 py-3.5 items-center cursor-pointer transition-all duration-200 border-l-[3px] ${styles.accent} ${styles.bg} ${styles.hover}`}
                    >
                      <div className="col-span-12 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded flex items-center justify-center bg-white border ${styles.border} shadow-sm transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`}>
                            <svg className={`w-3.5 h-3.5 ${styles.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
                          </div>
                          <span className={`relative flex items-center justify-center w-2.5 h-2.5`}>
                            <span className={`relative inline-flex w-2.5 h-2.5 rounded-full ${styles.dot} ${styles.dotGlow} ring-[3px] ring-slate-400/30`}></span>
                          </span>
                          <span className={`text-sm font-semibold tracking-tight ${styles.text}`}>{section.category}</span>
                        </div>
                        <span className="text-xs font-jetbrains text-slate-400">{testCount} / {section.tests.length} tested</span>
                      </div>
                    </div>

                    {/* Expandable Content */}
                    <div className="grid transition-all duration-300 ease-in-out bg-white" style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}>
                      <div className="overflow-hidden">
                        <div className="flex flex-col">
                          {section.tests.map((item, idx) => {
                            const isLast = idx === section.tests.length - 1;
                            const has400 = !!item.srx400.throughput;
                            const has440 = !!item.srx440.throughput;
                            const comments = item.srx440.comments || item.srx400.comments || '';

                            return (
                              <div key={idx} className={`grid gap-0 px-6 py-2.5 items-center group/row hover:bg-slate-50 transition-all duration-200 relative ${show3XX ? 'grid-cols-[2fr_repeat(5,1fr)]' : 'grid-cols-12'} ${!isLast ? 'border-b border-slate-100' : ''}`}>

                                {/* Tree connector */}
                                <div className="absolute left-[33px] top-0 bottom-0 w-px bg-slate-200 group-hover/row:bg-emerald-300 transition-colors"></div>

                                {/* Test Case Name */}
                                <div className={`flex items-center pl-8 ${show3XX ? '' : 'col-span-3'}`}>
                                  <div className="w-3 h-px bg-slate-200 mr-3 group-hover/row:bg-emerald-300 transition-colors"></div>
                                  <span className="text-sm font-medium text-slate-700 leading-relaxed">{item.testCase}</span>
                                </div>

                                {/* SRX 400 */}
                                <div
                                  className={`flex flex-col justify-center gap-1 px-2 ${show3XX ? '' : 'col-span-3'}`}
                                  onMouseEnter={(e) => has400 && handleCellEnter(e, `400-${sIdx}-${idx}`, { cpu: item.srx400.cpu, shm: item.srx400.shm })}
                                  onMouseLeave={() => setHoveredCell(null)}
                                >
                                  {has400 ? (
                                    <span className="font-jetbrains text-xs font-medium text-slate-800 bg-gradient-to-r from-slate-50 to-slate-100 px-2 py-1 rounded-lg border border-slate-200/80 shadow-[0_1px_2px_rgba(0,0,0,0.04)] leading-tight group-hover/row:from-emerald-50 group-hover/row:to-emerald-100/80 group-hover/row:text-emerald-700 group-hover/row:border-emerald-300 transition-all cursor-default w-fit">
                                      {item.srx400.throughput}
                                    </span>
                                  ) : (
                                    <span className="font-jetbrains text-xs text-slate-300 select-none">—</span>
                                  )}
                                  <MetricsTooltip
                                    position={hoveredCell?.id === `400-${sIdx}-${idx}` ? hoveredCell : null}
                                    isVisible={hoveredCell?.id === `400-${sIdx}-${idx}`}
                                    data={hoveredCell?.id === `400-${sIdx}-${idx}` ? hoveredCell : null}
                                  />
                                </div>

                                {/* SRX 440 */}
                                <div
                                  className={`flex flex-col justify-center gap-1 px-2 ${show3XX ? '' : 'col-span-3'}`}
                                  onMouseEnter={(e) => has440 && handleCellEnter(e, `440-${sIdx}-${idx}`, { cpu: item.srx440.cpu, shm: item.srx440.shm })}
                                  onMouseLeave={() => setHoveredCell(null)}
                                >
                                  {has440 ? (
                                    <span className="font-jetbrains text-xs font-medium text-slate-800 bg-gradient-to-r from-slate-50 to-slate-100 px-2 py-1 rounded-lg border border-slate-200/80 shadow-[0_1px_2px_rgba(0,0,0,0.04)] leading-tight group-hover/row:from-blue-50 group-hover/row:to-blue-100/80 group-hover/row:text-blue-700 group-hover/row:border-blue-300 transition-all cursor-default w-fit">
                                      {item.srx440.throughput}
                                    </span>
                                  ) : (
                                    <span className="font-jetbrains text-xs text-slate-300 select-none">—</span>
                                  )}
                                  <MetricsTooltip
                                    position={hoveredCell?.id === `440-${sIdx}-${idx}` ? hoveredCell : null}
                                    isVisible={hoveredCell?.id === `440-${sIdx}-${idx}`}
                                    data={hoveredCell?.id === `440-${sIdx}-${idx}` ? hoveredCell : null}
                                  />
                                </div>

                                {/* Last columns: 3XX data OR Compare button OR Comments */}
                                {show3XX ? (
                                  <>
                                    <div className="px-2">
                                      <span className="font-jetbrains text-xs text-slate-300 select-none">—</span>
                                    </div>
                                    <div className="px-2">
                                      <span className="font-jetbrains text-xs text-slate-300 select-none">—</span>
                                    </div>
                                    <div className="px-2">
                                      <span className="font-jetbrains text-xs text-slate-300 select-none">—</span>
                                    </div>
                                  </>
                                ) : (
                                  <div className="col-span-3 px-2">
                                    {isSanity ? (
                                      <button
                                        onClick={() => setShowCompare(true)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 text-xs font-bold uppercase tracking-wider hover:border-orange-300 hover:text-orange-600 hover:bg-orange-50/50 transition-all duration-200"
                                      >
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                                        Compare
                                      </button>
                                    ) : (
                                      comments ? (
                                        <span className="font-jetbrains text-xs text-slate-500 leading-relaxed">{comments}</span>
                                      ) : (
                                        <span className="font-jetbrains text-xs text-slate-300 select-none">—</span>
                                      )
                                    )}
                                  </div>
                                )}
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

      {/* Footer */}
      <footer className="glass border-t border-white/20">
        <div className="h-[2px] bg-gradient-to-r from-emerald-400 via-blue-400 to-purple-500 animate-gradient"></div>
        <div className="max-w-[90rem] mx-auto px-6 py-3.5">
          <div className="flex items-center justify-center gap-2.5 text-xs text-slate-500">
            <div className="flex items-center gap-1.5 text-emerald-600">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>
            <span className="font-medium">Data Source:</span>
            <span className="font-jetbrains font-semibold bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent">SRX4XX_Datasheet.xlsx</span>
            <span className="text-slate-300">•</span>
            <span className="text-slate-400">{new Date().toLocaleDateString()}</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default DailySanityDashboard;

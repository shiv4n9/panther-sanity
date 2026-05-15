import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { loadDatasheet, mergeSheets } from './utils/xlsxParser';
import { SANITY_TEST_CASES } from './config/sanityTestCases';
import { BRANCH_DEVICES, getBranchData } from './config/branchData';
import { API_BASE } from './config/api';
import HistoryModal from './components/HistoryModal';
import ChangelogBanner from './components/ChangelogBanner';
import { normalizeTo90Cpu } from './utils/normalize';

// ─── PR Links for known blocked test cases ───────────────────
const PR_LINKS = [
  {
    match: (tc) => /^ipsec\(site-2-site\)\s+udp throughput with.*aes-gcm256/i.test(tc),
    pr: '1940446',
  },
];

function getPR(testCaseName) {
  const entry = PR_LINKS.find(p => p.match(testCaseName));
  return entry ? entry.pr : null;
}

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

// ─── Category Color Map (Vivid Light Theme) ─────────────────
const getCategoryStyles = (category) => {
  const lc = category.toLowerCase();
  if (lc.includes('http') && lc.includes('throughput'))
    return { bg: 'bg-gradient-to-r from-sky-50 to-blue-50/80', hover: 'hover:from-sky-100 hover:to-blue-100/80', text: 'text-sky-700', border: 'border-sky-200', accent: 'border-l-sky-500', dot: 'bg-sky-500', dotGlow: 'shadow-[0_0_10px_rgba(14,165,233,0.6)]', badge: 'bg-sky-100 text-sky-700 border-sky-200' };
  if (lc.includes('cps'))
    return { bg: 'bg-gradient-to-r from-amber-50 to-orange-50/80', hover: 'hover:from-amber-100 hover:to-orange-100/80', text: 'text-amber-700', border: 'border-amber-200', accent: 'border-l-amber-500', dot: 'bg-amber-500', dotGlow: 'shadow-[0_0_10px_rgba(245,158,11,0.6)]', badge: 'bg-amber-100 text-amber-700 border-amber-200' };
  if (lc.includes('udp') || lc.includes('ipsec'))
    return { bg: 'bg-gradient-to-r from-rose-50 to-pink-50/80', hover: 'hover:from-rose-100 hover:to-pink-100/80', text: 'text-rose-700', border: 'border-rose-200', accent: 'border-l-rose-500', dot: 'bg-rose-500', dotGlow: 'shadow-[0_0_10px_rgba(244,63,94,0.6)]', badge: 'bg-rose-100 text-rose-700 border-rose-200' };
  if (lc.includes('scaling'))
    return { bg: 'bg-gradient-to-r from-teal-50 to-emerald-50/80', hover: 'hover:from-teal-100 hover:to-emerald-100/80', text: 'text-teal-700', border: 'border-teal-200', accent: 'border-l-teal-500', dot: 'bg-teal-500', dotGlow: 'shadow-[0_0_10px_rgba(20,184,166,0.6)]', badge: 'bg-teal-100 text-teal-700 border-teal-200' };
  return { bg: 'bg-gradient-to-r from-violet-50 to-purple-50/80', hover: 'hover:from-violet-100 hover:to-purple-100/80', text: 'text-violet-700', border: 'border-violet-200', accent: 'border-l-violet-500', dot: 'bg-violet-500', dotGlow: 'shadow-[0_0_10px_rgba(139,92,246,0.6)]', badge: 'bg-violet-100 text-violet-700 border-violet-200' };
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
  const [historyModal, setHistoryModal] = useState({ open: false, testCase: '', platform: '', category: '', value: '' });
  const [isNormalized, setIsNormalized] = useState(false);

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

  // ── Ingest trigger — stores XLSX snapshot to DB for history tracking ──
  const triggerIngest = async () => {
    setIngestStatus('loading');
    setIngestMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/ingest-xlsx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();

      if (!res.ok) throw new Error(json.error || 'Ingest failed');

      const parts = [`${json.inserted} rows stored`];
      if (json.updated > 0) parts.push(`${json.updated} updated`);
      if (json.added > 0) parts.push(`${json.added} new`);
      setIngestStatus('success');
      setIngestMessage(parts.join(', '));
    } catch (err) {
      setIngestStatus('error');
      setIngestMessage(err.message);
    } finally {
      setTimeout(() => setIngestStatus(null), 5000);
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

  // ── Computed stats ──
  const totalTests = displayData.reduce((sum, s) => sum + s.tests.length, 0);
  const testedCount = displayData.reduce((sum, s) => sum + s.tests.filter(t => t.srx400.throughput || t.srx440.throughput).length, 0);
  const passRate = totalTests > 0 ? Math.round((testedCount / totalTests) * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-emerald-50/20 text-slate-800 relative overflow-hidden pb-16" style={{ fontFamily: "'Inter', sans-serif" }}>


      {/* ── Header ── */}
      <header className="bg-white sticky top-0 z-50 border-b border-slate-200 shadow-sm">
        <div className="h-[3px] w-full bg-gradient-to-r from-emerald-500 via-cyan-500 via-blue-500 to-purple-500"></div>
        <div className="max-w-[90rem] mx-auto px-6 py-3">
          <div className="flex items-center justify-between gap-4">

            {/* Left — Device Chips */}
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50/80 border border-emerald-200/80 shadow-sm hover:shadow-md hover:shadow-emerald-200/30 transition-all duration-200">
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">SRX 400</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50/80 border border-blue-200/80 shadow-sm hover:shadow-md hover:shadow-blue-200/30 transition-all duration-200">
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-blue-700">SRX 440</span>
              </div>
            </div>

            {/* Center — Title */}
            <div className="flex items-center gap-3">
              <span className="relative w-1.5 h-10 rounded-full overflow-hidden">
                <span className="absolute inset-0 bg-gradient-to-b from-emerald-400 via-cyan-500 to-purple-500"></span>
              </span>
              <h1 className="text-[1.6rem] font-extrabold tracking-tight flex items-center gap-2.5">
                <span className="bg-gradient-to-r from-emerald-500 via-cyan-500 to-purple-600 bg-clip-text text-transparent font-black tracking-tight">PANTHER</span>
                <span className="font-semibold text-slate-600 tracking-tight">SNP</span>
                <span className="font-medium text-slate-400 tracking-tight">Dashboard</span>
              </h1>
              <span className="relative w-1.5 h-10 rounded-full overflow-hidden">
                <span className="absolute inset-0 bg-gradient-to-b from-purple-500 via-cyan-500 to-emerald-400"></span>
              </span>
            </div>

            {/* Right — Actions */}
            <div className="flex items-center gap-2">
              <a href="#/appsec-performance" className="shine-on-hover flex items-center gap-1.5 px-4 py-2 rounded-xl border border-purple-200/80 bg-gradient-to-r from-purple-50 to-fuchsia-50 text-purple-700 text-xs font-bold uppercase tracking-wider shadow-sm hover:shadow-lg hover:shadow-purple-200/50 hover:border-purple-300 hover:-translate-y-0.5 transition-all duration-300" title="View SRX440 AppSec Performance Results">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                AppSec
              </a>
              <button onClick={triggerIngest} disabled={ingestStatus === 'loading'} className={`shine-on-hover flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold uppercase tracking-wider shadow-sm transition-all duration-300 hover:-translate-y-0.5 ${ingestStatus === 'loading' ? 'bg-slate-100 border-slate-300 text-slate-400 cursor-wait' : ingestStatus === 'success' ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : ingestStatus === 'error' ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-slate-300 text-slate-600 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700 hover:shadow-lg hover:shadow-emerald-200/50'}`}>
                {ingestStatus === 'loading' ? 'Ingesting…' : ingestStatus === 'success' ? ingestMessage : ingestStatus === 'error' ? ingestMessage : 'Ingest Latest'}
              </button>
            </div>

          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="max-w-[90rem] mx-auto px-6 py-5 relative z-10 space-y-3">

        {/* View Toggle — Pill Segmented Control */}
        <div className="flex items-center justify-center">
          <div className="inline-flex items-center bg-white rounded-full p-1 shadow-lg shadow-slate-200/50 border border-slate-200">
            <button
              onClick={() => { setActiveView('sanity'); setShowCompare(false); setExpandedGroups({}); }}
              className={`relative px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
                activeView === 'sanity'
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-300/40'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Daily Sanity
              </span>
            </button>
            <button
              onClick={() => { setActiveView('regression'); setExpandedGroups({}); }}
              className={`relative px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
                activeView === 'regression'
                  ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg shadow-blue-300/40'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                Full Regression
              </span>
            </button>

            {/* Normalize Toggle */}
            <button
              onClick={() => setIsNormalized(!isNormalized)}
              className={`relative px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all duration-300 border ${
                isNormalized
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-300/40 border-amber-400'
                  : 'bg-white text-slate-400 hover:text-amber-600 hover:border-amber-300 hover:bg-amber-50/50 border-slate-200'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {isNormalized ? 'Normalized @90%' : 'Normalize CPU'}
              </span>
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative group">
          <svg className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-300 group-focus-within:text-emerald-500 transition-colors duration-300 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search test cases…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-5 py-3.5 glass rounded-2xl border border-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 focus:border-emerald-300 transition-all duration-300 text-slate-800 text-sm font-medium placeholder-slate-400 shadow-[0_4px_20px_rgba(0,0,0,0.04)]"
          />
        </div>

        {/* Release Info Bar */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="h-[2px] rounded-t-xl bg-gradient-to-r from-emerald-400 via-cyan-400 via-blue-400 to-purple-400"></div>
          <div className="px-5 py-2.5 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 release-chip rounded-lg px-3 py-1 bg-emerald-50/80 border border-emerald-200 transition-all hover:shadow-md hover:shadow-emerald-200/30">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">SRX400</span>
                <div className="h-3 w-px bg-emerald-200"></div>
                <span className="font-jetbrains text-xs font-semibold text-emerald-700">{releases.srx400}</span>
              </div>
              <div className="flex items-center gap-2 release-chip rounded-lg px-3 py-1 bg-blue-50/80 border border-blue-200 transition-all hover:shadow-md hover:shadow-blue-200/30">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-600">SRX440</span>
                <div className="h-3 w-px bg-blue-200"></div>
                <span className="font-jetbrains text-xs font-semibold text-blue-700">{releases.srx440}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isSanity && (
                <button
                  onClick={() => setShowCompare(!showCompare)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg border text-xs font-bold uppercase tracking-wider shadow-sm transition-all duration-300 hover:-translate-y-0.5 ${
                    showCompare
                      ? 'bg-orange-50 border-orange-300 text-orange-700 shadow-orange-100/50'
                      : 'bg-white border-slate-200 text-slate-500 hover:border-orange-300 hover:text-orange-600 hover:bg-orange-50/50'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                  {showCompare ? 'Hide 3XX' : 'Compare 3XX'}
                </button>
              )}
              <button onClick={() => window.open('http://10.204.134.80:3000/?device=snpsrx400c-proto', '_blank')} className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-blue-300 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-600 text-xs font-semibold uppercase tracking-wider shadow-sm hover:shadow-md hover:shadow-blue-200/50 hover:-translate-y-0.5 transition-all duration-300" title="View SRX 400 telemetry in Longevity Portal">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                Longevity
              </button>
            </div>
          </div>
        </div>

        {/* ── Changelog Banner ── */}
        <ChangelogBanner />

        {/* ── Data Table ── */}
        <div className="rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden bg-white">

          {/* Table Header */}
          <div className={`grid gap-0 px-0 py-3 bg-gradient-to-r from-slate-800 via-slate-900 to-slate-800 border-b border-slate-700/50 ${show3XX ? 'grid-cols-[3fr_repeat(7,1fr)]' : isSanity ? 'grid-cols-[5fr_3fr_3fr]' : 'grid-cols-[4fr_3fr_3fr_2fr]'}`}>
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-[0.1em] px-6">Test Case</div>
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-[0.1em] px-5 border-l border-slate-700">SRX 400</div>
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-[0.1em] px-5 border-l border-slate-700">SRX 440</div>
            {show3XX ? (
              <>
                {BRANCH_DEVICES.map((dev, i) => (
                  <div key={dev} className={`text-xs font-semibold text-orange-300 uppercase tracking-[0.1em] px-4 border-l border-slate-700 ${i === BRANCH_DEVICES.length - 1 ? 'flex items-center justify-between' : ''}`}>
                    {dev}
                    {i === BRANCH_DEVICES.length - 1 && (
                      <button onClick={() => setShowCompare(false)} className="ml-1 text-slate-400 hover:text-white transition-colors" title="Close comparison">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                ))}
              </>
            ) : !isSanity && (
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-[0.1em] px-5 border-l border-slate-700">
                Comments
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
                  <div key={section.category} className="flex flex-col border-b border-slate-200 last:border-0">

                    <div
                      onClick={() => toggleGroup(section.category)}
                      className={`grid grid-cols-12 gap-0 px-6 py-3 items-center cursor-pointer border-l-[3px] ${styles.accent} ${styles.bg} ${styles.hover}`}
                    >
                      <div className="col-span-12 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded flex items-center justify-center bg-white border ${styles.border} shadow-sm transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`}>
                            <svg className={`w-3.5 h-3.5 ${styles.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
                          </div>
                          <span className={`relative flex items-center justify-center w-2.5 h-2.5`}>
                            <span className={`relative inline-flex w-2.5 h-2.5 rounded-full ${styles.dot}`}></span>
                          </span>
                          <span className={`text-sm font-semibold tracking-tight section-underline ${styles.text}`}>{section.category}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {/* Mini progress bar */}
                          <div className="hidden sm:flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-slate-200/60 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${testCount === section.tests.length ? 'bg-emerald-500' : testCount > 0 ? 'bg-amber-400' : 'bg-slate-300'}`}
                                style={{ width: `${section.tests.length > 0 ? (testCount / section.tests.length) * 100 : 0}%` }}
                              ></div>
                            </div>
                          </div>
                          <span className={`text-xs font-jetbrains px-2 py-0.5 rounded-md ${testCount === section.tests.length ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : testCount > 0 ? 'text-amber-700 bg-amber-50 border border-amber-200' : 'text-slate-400 bg-slate-50 border border-slate-200'}`}>{testCount} / {section.tests.length} tested</span>
                        </div>
                      </div>
                    </div>

                    {/* Expandable Content */}
                    <div className="overflow-hidden bg-white" style={{ display: isExpanded ? 'block' : 'none' }}>
                      <div className="overflow-hidden">
                        <div className="flex flex-col">
                          {section.tests.map((item, idx) => {
                            const isLast = idx === section.tests.length - 1;
                            const has400 = !!item.srx400.throughput;
                            const has440 = !!item.srx440.throughput;
                            const comments = item.srx440.comments || item.srx400.comments || '';

                            // CPU normalization
                            const norm400 = isNormalized && has400 ? normalizeTo90Cpu(item.srx400.throughput, item.srx400.cpu) : { value: item.srx400.throughput, wasNormalized: false };
                            const norm440 = isNormalized && has440 ? normalizeTo90Cpu(item.srx440.throughput, item.srx440.cpu) : { value: item.srx440.throughput, wasNormalized: false };

                            return (
                              <div key={idx} className={`grid gap-0 px-0 py-3 items-center group/row row-hover relative ${show3XX ? 'grid-cols-[3fr_repeat(7,1fr)]' : isSanity ? 'grid-cols-[5fr_3fr_3fr]' : 'grid-cols-[4fr_3fr_3fr_2fr]'} border-b border-slate-200`} style={{ fontVariantNumeric: 'tabular-nums' }}>

                                {/* Test Case Name */}
                                <div className="flex items-center px-6">
                                  <span className="text-[13px] font-medium text-slate-700 leading-snug">{item.testCase}</span>
                                </div>

                                <div
                                  className="flex flex-col justify-center gap-1 px-5 border-l border-slate-200"
                                  onMouseEnter={(e) => has400 && handleCellEnter(e, `400-${sIdx}-${idx}`, { cpu: item.srx400.cpu, shm: item.srx400.shm })}
                                  onMouseLeave={() => setHoveredCell(null)}
                                >
                                  {has400 ? (
                                    <span
                                      className={`font-jetbrains text-xs font-semibold cursor-pointer hover:underline underline-offset-2 transition-colors ${
                                        norm400.wasNormalized ? 'text-amber-700 hover:text-amber-800' : 'text-slate-800 hover:text-emerald-600'
                                      }`}
                                      onClick={() => setHistoryModal({ open: true, testCase: item.testCase, platform: 'SRX400', category: section.category, value: item.srx400.throughput })}
                                      title={norm400.wasNormalized ? `Raw: ${item.srx400.throughput} @ ${item.srx400.cpu} CPU → Normalized to 90%` : undefined}
                                    >
                                      {norm400.wasNormalized && <span className="text-amber-500 mr-1">⚡</span>}
                                      {norm400.value}
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

                                <div
                                  className="flex flex-col justify-center gap-1 px-5 border-l border-slate-200"
                                  onMouseEnter={(e) => has440 && handleCellEnter(e, `440-${sIdx}-${idx}`, { cpu: item.srx440.cpu, shm: item.srx440.shm })}
                                  onMouseLeave={() => setHoveredCell(null)}
                                >
                                  {has440 ? (
                                    <span
                                      className={`font-jetbrains text-xs font-semibold cursor-pointer hover:underline underline-offset-2 transition-colors ${
                                        norm440.wasNormalized ? 'text-amber-700 hover:text-amber-800' : 'text-slate-800 hover:text-blue-600'
                                      }`}
                                      onClick={() => setHistoryModal({ open: true, testCase: item.testCase, platform: 'SRX440', category: section.category, value: item.srx440.throughput })}
                                      title={norm440.wasNormalized ? `Raw: ${item.srx440.throughput} @ ${item.srx440.cpu} CPU → Normalized to 90%` : undefined}
                                    >
                                      {norm440.wasNormalized && <span className="text-amber-500 mr-1">⚡</span>}
                                      {norm440.value}
                                    </span>
                                  ) : (() => {
                                    const pr = getPR(item.testCase);
                                    return pr ? (
                                      <a
                                        href={`https://gnats.juniper.net/web/default/${pr}#description_tab`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="pr-badge inline-flex items-center gap-1 font-jetbrains text-[11px] font-bold text-red-600 px-2 py-0.5 rounded-md cursor-pointer w-fit transition-all"
                                        title={`Open PR ${pr} in GNATS`}
                                      >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                                        PR:{pr}
                                      </a>
                                    ) : (
                                      <span className="font-jetbrains text-xs text-slate-300 select-none">—</span>
                                    );
                                  })()
                                  }
                                  <MetricsTooltip
                                    position={hoveredCell?.id === `440-${sIdx}-${idx}` ? hoveredCell : null}
                                    isVisible={hoveredCell?.id === `440-${sIdx}-${idx}`}
                                    data={hoveredCell?.id === `440-${sIdx}-${idx}` ? hoveredCell : null}
                                  />
                                </div>

                                {/* Last columns: Branch 3XX data OR Compare button OR Comments */}
                                {show3XX ? (
                                  <>
                                    {BRANCH_DEVICES.map(dev => {
                                      const bd = getBranchData(item.testCase);
                                      const val = bd ? bd[dev] : null;
                                      return (
                                        <div key={dev} className="px-4 border-l border-slate-200">
                                          {val ? (
                                            <span className="font-jetbrains text-[11px] font-semibold text-slate-700 whitespace-nowrap">
                                              {val}
                                            </span>
                                          ) : (
                                            <span className="font-jetbrains text-xs text-slate-300 select-none">—</span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </>
                                ) : !isSanity ? (
                                  <div className="px-5 border-l border-slate-200">
                                    {comments ? (
                                      <span className="font-jetbrains text-xs text-slate-500 leading-relaxed">{comments}</span>
                                    ) : (
                                      <span className="font-jetbrains text-xs text-slate-300 select-none">—</span>
                                    )}
                                  </div>
                                ) : null}
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
      <footer className="bg-white border-t border-slate-200">
        <div className="h-[2px] bg-gradient-to-r from-emerald-400 via-blue-400 to-purple-500"></div>
        <div className="max-w-[90rem] mx-auto px-6 py-3.5">
          <div className="flex items-center justify-center gap-2.5 text-xs text-slate-500">
            <div className="flex items-center gap-1.5 text-emerald-600">
              <span className="relative flex h-2 w-2">
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

      {/* History Modal */}
      <HistoryModal
        isOpen={historyModal.open}
        onClose={() => setHistoryModal({ open: false, testCase: '', platform: '', category: '', value: '' })}
        testCase={historyModal.testCase}
        platform={historyModal.platform}
        category={historyModal.category}
        currentValue={historyModal.value}
      />
    </div>
  );
};

export default DailySanityDashboard;

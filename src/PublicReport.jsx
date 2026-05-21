import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { loadDatasheet, mergeSheets } from './utils/xlsxParser';
import { SANITY_TEST_CASES } from './config/sanityTestCases';
import { BRANCH_DEVICES, getBranchData } from './config/branchData';
import { normalizeTo90Cpu, calculatePercentageDiff, isScalingCategory } from './utils/normalize';

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

// ─── Tooltip Portal — Performance Diff ───────────────────────
const DiffTooltip = ({ position, isVisible, data }) => {
  if (!isVisible || !position || !data) return null;
  const { diff, val400, val440 } = data;
  return createPortal(
    <div
      className="fixed z-[9999] animate-fade-in-up pointer-events-none"
      style={{ top: `${position.y + 8}px`, left: `${position.x}px`, animationDuration: '200ms' }}
    >
      <div className="bg-slate-900 text-white rounded-lg shadow-2xl border border-slate-700 p-3 min-w-[240px]">
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700">
          <div className="w-2 h-2 bg-juniper rounded-full shadow-[0_0_8px_var(--color-juniper-glow)]"></div>
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Performance Diff</span>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">SRX 400:</span>
            <span className="font-jetbrains text-sm font-semibold text-juniper">{diff ? diff.val400 : val400 || '—'}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">SRX 440:</span>
            <span className="font-jetbrains text-sm font-semibold text-blue-400">{diff ? diff.val440 : val440 || '—'}</span>
          </div>
          {diff && (
            <div className="flex justify-between items-center pt-1.5 mt-0.5 border-t border-slate-700">
              <span className="text-xs text-slate-400">Difference:</span>
              <span className={`font-jetbrains text-sm font-bold ${diff.pct >= 0 ? 'text-juniper' : 'text-red-400'}`}>
                {diff.pct >= 0 ? '▲' : '▼'} {Math.abs(diff.pct)}%
              </span>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

// ─── Main Component ──────────────────────────────────────────
const PublicReport = () => {
  const [mergedData, setMergedData] = useState([]);
  const [releases, setReleases] = useState({ srx400: '', srx440: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeView, setActiveView] = useState('regression');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [hoveredDiff, setHoveredDiff] = useState(null);
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
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const isEmptyValue = (val) =>
    !val || val.trim() === '' || val.trim() === '-' || val.trim() === '—';

  const handleDiffEnter = (e, cellId, val400, val440) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const diff = calculatePercentageDiff(val400, val440);
    setHoveredDiff({ id: cellId, x: rect.left, y: rect.bottom, diff, val400, val440 });
  };

  // ── View filter: sanity vs. regression ──
  const viewFilteredData = useMemo(() => {
    if (activeView === 'regression') return mergedData;

    const sanityGroups = SANITY_TEST_CASES.map(sc => ({
      category: sc.label,
      tests: [],
    }));

    for (const section of mergedData) {
      for (const test of section.tests) {
        const tcName = test.testCase.trim();
        let matched = false;
        for (let i = 0; i < SANITY_TEST_CASES.length && !matched; i++) {
          for (const m of SANITY_TEST_CASES[i].matchers) {
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

  // ── Always normalize + filter empty rows + exclude scaling ──
  const displayData = useMemo(() => {
    let data = viewFilteredData
      .filter(s => !isScalingCategory(s.category))
      .map(section => ({
        ...section,
        tests: section.tests.filter(
          t => !isEmptyValue(t.srx400.throughput) || !isEmptyValue(t.srx440.throughput) || getPR(t.testCase),
        ),
      }))
      .filter(s => s.tests.length > 0);

    // Pin UDP/IPSec sections to the top
    data.sort((a, b) => {
      const aIsUdp = /udp|ipsec/i.test(a.category);
      const bIsUdp = /udp|ipsec/i.test(b.category);
      if (aIsUdp && !bIsUdp) return -1;
      if (!aIsUdp && bIsUdp) return 1;
      return 0;
    });

    // Search filter
    if (searchTerm.trim()) {
      const lower = searchTerm.toLowerCase();
      data = data
        .map(section => ({
          ...section,
          tests: section.tests.filter(
            t =>
              t.testCase.toLowerCase().includes(lower) ||
              section.category.toLowerCase().includes(lower),
          ),
        }))
        .filter(s => s.tests.length > 0);
    }

    return data;
  }, [viewFilteredData, searchTerm]);

  const toggleGroup = (cat) => {
    setExpandedGroups(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="relative inline-flex items-center justify-center mb-6">
            <div className="absolute w-16 h-16 rounded-full border-2 border-juniper/30 animate-pulse-ring"></div>
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-2 border-transparent border-t-juniper border-r-blue-400"></div>
          </div>
          <p className="text-slate-300 font-medium tracking-wide">Loading SRX4XX Datasheet…</p>
          <p className="text-slate-500 text-xs mt-1">Parsing Excel telemetry data</p>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Failed to Load Datasheet</h2>
          <p className="text-slate-600">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-juniper-dark text-white rounded-lg hover:bg-juniper-darker transition-colors">Retry</button>
        </div>
      </div>
    );
  }

  // ── Stats ──
  const totalTests = displayData.reduce((sum, s) => sum + s.tests.length, 0);

  return (
    <div className="min-h-screen bg-white text-slate-800 relative overflow-hidden pb-16" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── Header ── */}
      <header className="bg-white/90 backdrop-blur-sm sticky top-0 z-50 border-b border-juniper/20 shadow-sm shadow-juniper/5">
        <div className="h-[3px] w-full bg-gradient-to-r from-juniper via-juniper-dark to-juniper"></div>
        <div className="max-w-[90rem] mx-auto px-6 py-3">
          <div className="flex items-center justify-center relative">

            {/* Center — Title */}
            <div className="flex items-center gap-3">
              <span className="relative w-1.5 h-10 rounded-full overflow-hidden">
                <span className="absolute inset-0 bg-gradient-to-b from-juniper via-juniper-dark to-purple-500"></span>
              </span>
              <h1 className="text-[1.6rem] font-extrabold tracking-tight flex items-center gap-2.5">
                <span className="bg-gradient-to-r from-juniper via-juniper-dark to-purple-600 bg-clip-text text-transparent font-black tracking-tight">PANTHER</span>
                <span className="font-semibold text-slate-600 tracking-tight">SNP</span>
                <span className="font-medium text-slate-400 tracking-tight">Report</span>
              </h1>
              <span className="relative w-1.5 h-10 rounded-full overflow-hidden">
                <span className="absolute inset-0 bg-gradient-to-b from-purple-500 via-juniper-dark to-juniper"></span>
              </span>
            </div>

          </div>
        </div>
        {/* Device Chips — inside header */}
        <div className="max-w-[90rem] mx-auto px-6 pb-3 flex items-center justify-center gap-3">
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-juniper-light border border-juniper/30 shadow-sm">
            <span className="relative flex h-2 w-2"><span className="relative inline-flex rounded-full h-2 w-2 bg-juniper"></span></span>
            <span className="text-xs font-bold uppercase tracking-wider text-juniper-darker">SRX 400</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-blue-50/80 border border-blue-200/80 shadow-sm">
            <span className="relative flex h-2 w-2"><span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span></span>
            <span className="text-xs font-bold uppercase tracking-wider text-blue-700">SRX 440</span>
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="max-w-[90rem] mx-auto px-6 py-3 relative z-10 space-y-3">

        {/* View Toggle — Pill Segmented Control */}
        <div className="flex items-center justify-center">
          <div className="inline-flex items-center bg-white rounded-full p-1 shadow-lg shadow-juniper/20 border border-juniper/30">
            <button
              onClick={() => { setActiveView('regression'); setExpandedGroups({}); }}
              className={`relative px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
                activeView === 'regression'
                  ? 'bg-slate-800 text-white shadow-lg shadow-slate-800/40'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                Full Regression
              </span>
            </button>
            <button
              onClick={() => { setActiveView('sanity'); setShowCompare(false); setExpandedGroups({}); }}
              className={`relative px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
                activeView === 'sanity'
                  ? 'bg-juniper text-black shadow-lg shadow-juniper/40'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Daily Sanity
              </span>
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative group">
          <svg className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-300 group-focus-within:text-juniper transition-colors duration-300 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search test cases…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-5 py-3.5 glass rounded-2xl border border-white/40 focus:outline-none focus:ring-2 focus:ring-juniper/50 focus:border-juniper transition-all duration-300 text-slate-800 text-sm font-medium placeholder-slate-400 shadow-[0_4px_20px_rgba(0,0,0,0.04)]"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2">
          {isSanity && (
            <button
              onClick={() => setShowCompare(!showCompare)}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg border text-xs font-bold uppercase tracking-wider shadow-sm transition-all duration-300 hover:-translate-y-0.5 ${
                showCompare
                  ? 'bg-orange-50 border-orange-300 text-orange-700 shadow-orange-100/50'
                  : 'bg-white border-juniper/30 text-slate-500 hover:border-orange-300 hover:text-orange-600 hover:bg-orange-50/50'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
              {showCompare ? 'Hide 3XX' : 'Compare 3XX'}
            </button>
          )}
        </div>

        {/* ── Data Table ── */}
        <div className="rounded-2xl shadow-xl shadow-juniper/5 border border-juniper/15 overflow-hidden bg-white">

          {/* Table Header */}
          <div className={`grid gap-0 px-0 py-2.5 bg-juniper border-b-2 border-juniper-dark items-center ${show3XX ? 'grid-cols-[2.5fr_1.5fr_1.5fr_repeat(5,1fr)]' : 'grid-cols-[4fr_3fr_3fr]'}`}>
            <div className="text-xs font-bold text-black uppercase tracking-[0.1em] px-6">Test Case</div>
            <div className="flex flex-col gap-0.5 px-5 border-l border-juniper-dark/40">
              <span className="text-xs font-semibold text-black uppercase tracking-[0.1em]">SRX 400</span>
              <span className="font-jetbrains text-[11px] font-semibold text-black/60">{releases.srx400}</span>
            </div>
            <div className="flex flex-col gap-0.5 px-5 border-l border-juniper-dark/40">
              <span className="text-xs font-semibold text-black uppercase tracking-[0.1em]">SRX 440</span>
              <span className="font-jetbrains text-[11px] font-semibold text-black/60">{releases.srx440}</span>
            </div>
            {show3XX && (
              <>
                {BRANCH_DEVICES.map((dev, i) => (
                  <div key={dev} className={`text-xs font-bold text-black uppercase tracking-[0.1em] px-3 border-l border-juniper-dark/40 flex items-center ${i === BRANCH_DEVICES.length - 1 ? 'justify-between' : ''}`}>
                    {dev}
                    {i === BRANCH_DEVICES.length - 1 && (
                      <button onClick={() => setShowCompare(false)} className="ml-1 text-black/50 hover:text-black transition-colors" title="Close comparison">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Table Body — Accordion Sections */}
          <div className="flex flex-col bg-white">
            {displayData.length === 0 ? (
              <div className="px-6 py-20 text-center"><p className="text-slate-500 font-medium text-sm">No results found. Adjust your search.</p></div>
            ) : (
              displayData.map((section) => {
                const isExpanded = expandedGroups[section.category] ?? true;

                return (
                  <div key={section.category} className="flex flex-col border-b border-juniper/30 last:border-0">

                    {/* Section Header */}
                    <div
                      onClick={() => toggleGroup(section.category)}
                      className="grid grid-cols-12 gap-0 px-6 py-3 items-center cursor-pointer border-l-[3px] border-l-slate-300 bg-slate-50/80 hover:bg-slate-100/80"
                    >
                      <div className="col-span-12 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded flex items-center justify-center bg-white border border-juniper/40 shadow-sm transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`}>
                            <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
                          </div>
                          <span className="relative flex items-center justify-center w-2.5 h-2.5">
                            <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                          </span>
                          <span className="text-sm font-bold tracking-tight section-underline text-slate-800">{section.category}</span>
                        </div>
                      </div>
                    </div>

                    {/* Expandable Content */}
                    <div className="bg-white" style={{ display: isExpanded ? 'block' : 'none' }}>
                      <div>
                        <div className="flex flex-col">
                          {section.tests.map((item, idx) => {
                            const sIdx = displayData.indexOf(section);
                            const has400 = !!item.srx400.throughput && !isEmptyValue(item.srx400.throughput);
                            const has440 = !!item.srx440.throughput && !isEmptyValue(item.srx440.throughput);

                            // Always normalize (skip scaling/capacity sections)
                            const scaling = isScalingCategory(section.category);
                            const norm400 = !scaling && has400
                              ? normalizeTo90Cpu(item.srx400.throughput, item.srx400.cpu)
                              : { value: item.srx400.throughput, wasNormalized: false };
                            const norm440 = !scaling && has440
                              ? normalizeTo90Cpu(item.srx440.throughput, item.srx440.cpu)
                              : { value: item.srx440.throughput, wasNormalized: false };

                            return (
                              <div key={idx} className={`grid gap-0 px-0 py-3 items-center group/row row-hover relative border-b border-juniper/30 ${show3XX ? 'grid-cols-[2.5fr_1.5fr_1.5fr_repeat(5,1fr)]' : 'grid-cols-[4fr_3fr_3fr]'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>

                                {/* Test Case Name + Diff Tooltip */}
                                <div
                                  className="flex items-center px-6 relative cursor-default"
                                  onMouseEnter={(e) => (has400 || has440) && handleDiffEnter(e, `tc-${sIdx}-${idx}`, norm400.value, norm440.value)}
                                  onMouseLeave={() => setHoveredDiff(null)}
                                >
                                  <span className="text-[13px] font-medium text-slate-700 leading-snug">{item.testCase}</span>
                                  <DiffTooltip
                                    position={hoveredDiff?.id === `tc-${sIdx}-${idx}` ? hoveredDiff : null}
                                    isVisible={hoveredDiff?.id === `tc-${sIdx}-${idx}`}
                                    data={hoveredDiff?.id === `tc-${sIdx}-${idx}` ? hoveredDiff : null}
                                  />
                                </div>

                                {/* SRX 400 */}
                                <div className="flex flex-col justify-center gap-1 px-5 border-l border-juniper/30">
                                  {has400 ? (
                                    <span className="font-jetbrains text-[13px] font-semibold text-slate-800">
                                      {norm400.value}
                                    </span>
                                  ) : (
                                    <span className="font-jetbrains text-[13px] text-slate-300 select-none">—</span>
                                  )}
                                </div>

                                {/* SRX 440 */}
                                <div className="flex flex-col justify-center gap-1 px-5 border-l border-juniper/30">
                                  {has440 ? (
                                    <span className="font-jetbrains text-[13px] font-semibold text-slate-800">
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
                                      <span className="font-jetbrains text-[13px] text-slate-300 select-none">—</span>
                                    );
                                  })()}
                                </div>

                                {/* Branch 3XX columns */}
                                {show3XX && (
                                  <>
                                    {BRANCH_DEVICES.map(dev => {
                                      const bd = getBranchData(item.testCase);
                                      const val = bd ? bd[dev] : null;
                                      return (
                                        <div key={dev} className="px-4 border-l border-juniper/30 flex items-center">
                                          {val ? (
                                            <span className="font-jetbrains text-[13px] font-semibold text-slate-700 whitespace-nowrap">{val}</span>
                                          ) : (
                                            <span className="font-jetbrains text-xs text-slate-300 select-none">—</span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </>
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
      <footer className="bg-white border-t border-juniper/30">
        <div className="h-[2px] bg-gradient-to-r from-juniper via-blue-400 to-purple-500"></div>
        <div className="max-w-[90rem] mx-auto px-6 py-3.5">
          <div className="flex items-center justify-center gap-2.5 text-xs text-slate-500">
            <div className="flex items-center gap-1.5 text-juniper-dark">
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-juniper"></span>
              </span>
            </div>
            <span className="font-medium">Data Source:</span>
            <span className="font-jetbrains font-semibold bg-gradient-to-r from-juniper-dark to-blue-600 bg-clip-text text-transparent">SRX4XX_Datasheet.xlsx</span>
            <span className="text-slate-300">•</span>
            <span className="text-slate-400">{new Date().toLocaleDateString()}</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default PublicReport;

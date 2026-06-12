import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { loadDatasheet, mergeSheets } from './utils/xlsxParser';
import { SANITY_TEST_CASES } from './config/sanityTestCases';
import { BRANCH_DEVICES, getBranchData } from './config/branchData';
import { normalizeTo90Cpu, calculatePercentageDiff, isScalingCategory } from './utils/normalize';
import SanityOverviewChart from './components/SanityOverviewChart';
import { API_BASE } from './config/api';

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

// Extract a PR number from a comment string (e.g. "PR 1954277" or "PR:1954277")
function getPRFromComment(comment) {
  if (!comment) return null;
  const m = String(comment).match(/PR[:\s]*(\d{6,})/i);
  return m ? m[1] : null;
}

// Resolve which PR to display: a PR mentioned in the comment takes precedence
// over the hardcoded PR_LINKS mapping.
function resolvePR(testCaseName, comment) {
  return getPRFromComment(comment) || getPR(testCaseName);
}

// ─── Comment cell ────────────────────────────────────────────
// Renders a comment string with any "PR <number>" turned into a red, clickable
// GNATS link, keeping the rest of the comment text intact. When the comment has
// no PR of its own, a hardcoded PR (from PR_LINKS) is appended if one applies.
const PRLink = ({ pr }) => (
  <a
    href={`https://gnats.juniper.net/web/default/${pr}#description_tab`}
    target="_blank"
    rel="noopener noreferrer"
    className="font-bold text-red-600 hover:underline"
    title={`Open PR ${pr} in GNATS`}
  >
    PR {pr}
  </a>
);

const CommentWithPR = ({ comment, testCase, prOnly = false }) => {
  const text = String(comment || '').trim();
  const m = text.match(/PR[\s:#-]*(\d{6,})/i);

  if (m) {
    const pr = m[1];
    if (prOnly) {
      return (
        <span className="font-jetbrains text-[11px] text-slate-500 leading-snug">
          <PRLink pr={pr} />
        </span>
      );
    }
    const before = text.slice(0, m.index).replace(/[-–—\s]+$/, ' ');
    const after = text.slice(m.index + m[0].length);
    return (
      <span className="font-jetbrains text-[11px] text-slate-500 leading-snug">
        {before}<PRLink pr={pr} />{after}
      </span>
    );
  }

  const fallbackPR = getPR(testCase);
  if (fallbackPR) {
    return (
      <span className="font-jetbrains text-[11px] text-slate-500 leading-snug">
        {!prOnly && text && <>{text} · </>}<PRLink pr={fallbackPR} />
      </span>
    );
  }
  if (prOnly) return null;
  if (text) {
    return <span className="font-jetbrains text-[11px] text-slate-500 leading-snug">{text}</span>;
  }
  return null;
};

// ─── Tooltip Portal — System Metrics ─────────────────────────
const MetricsTooltip = ({ position, isVisible, data }) => {
  if (!isVisible || !position || !data) return null;
  return createPortal(
    <div
      className="fixed z-[9999] animate-fade-in-up pointer-events-none"
      style={{ top: `${position.y + 8}px`, left: `${position.x}px`, transform: 'translateX(-50%)', animationDuration: '200ms' }}
    >
      <div className="bg-slate-900 text-white rounded-lg shadow-2xl border border-slate-700 p-3 min-w-[200px]">
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700">
          <div className="w-2 h-2 bg-juniper rounded-full shadow-[0_0_8px_var(--color-juniper-glow)]"></div>
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">System Metrics</span>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">CPU Usage:</span>
            <span className="font-jetbrains text-sm font-semibold text-juniper">{data.cpu || 'N/A'}</span>
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

// ─── Tooltip Portal — Performance Diff ───────────────────────
const DiffTooltip = ({ position, isVisible, data }) => {
  if (!isVisible || !position || !data) return null;
  const { diff, val400, val440 } = data;
  return createPortal(
    <div
      className="fixed z-[9999] animate-fade-in-up pointer-events-none"
      style={{ top: `${position.y + 8}px`, left: `${position.x}px`, transform: 'translateX(-50%)', animationDuration: '200ms' }}
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
  const [activeView, setActiveView] = useState('sanity');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [hoveredDiff, setHoveredDiff] = useState(null);
  const [hoveredCell, setHoveredCell] = useState(null);
  const [showCompare, setShowCompare] = useState(false);
  const [ds1Releases, setDs1Releases] = useState([]);
  const [selectedSanityRelease, setSelectedSanityRelease] = useState('');
  const [isNormalized, setIsNormalized] = useState(false);
  const [flashedCells, setFlashedCells] = useState(new Set());
  const [showReleaseHint, setShowReleaseHint] = useState(false);
  const prevDataRef = useRef(null);

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

        // DS-1 release data for Daily Sanity view
        if (data.ds1 && data.ds1.length > 0) {
          setDs1Releases(data.ds1);
          setSelectedSanityRelease(data.ds1[0].release);
        }

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

  // ── Track page visit (silent, fire-and-forget) ──
  useEffect(() => {
    fetch(`${API_BASE}/api/track-visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: 'public-report' }),
    }).catch(() => {});
  }, []);

  // ── First-visit attention hint for the release selector ──
  useEffect(() => {
    try {
      if (!localStorage.getItem('seenReleaseHint')) setShowReleaseHint(true);
    } catch { /* ignore */ }
  }, []);

  const dismissReleaseHint = () => {
    setShowReleaseHint(false);
    try { localStorage.setItem('seenReleaseHint', '1'); } catch { /* ignore */ }
  };

  const isEmptyValue = (val) =>
    !val || val.trim() === '' || val.trim() === '-' || val.trim() === '—';

  const handleDiffEnter = (e, cellId, val400, val440) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const diff = calculatePercentageDiff(val400, val440);
    setHoveredDiff({ id: cellId, x: rect.left + rect.width / 2, y: rect.bottom, diff, val400, val440 });
  };

  const handleCellEnter = (e, cellId, metrics) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredCell({ id: cellId, x: rect.left + rect.width / 2, y: rect.bottom, ...metrics });
  };

  // ── View filter: sanity vs. regression ──
  const viewFilteredData = useMemo(() => {
    if (activeView === 'regression') return mergedData;

    // Sanity view: use DS-1 sheet data if available
    if (ds1Releases.length > 0 && selectedSanityRelease) {
      const releaseBlock = ds1Releases.find(r => r.release === selectedSanityRelease);
      if (releaseBlock) {
        return releaseBlock.merged;
      }
    }

    // Fallback: use old SANITY_TEST_CASES matching
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
  }, [mergedData, activeView, ds1Releases, selectedSanityRelease]);

  // ── Diff highlight: flash cells whose values changed on release switch ──
  useEffect(() => {
    if (!prevDataRef.current || !isSanity) {
      prevDataRef.current = viewFilteredData;
      return;
    }
    const changed = new Set();
    const prevMap = {};
    for (const sec of prevDataRef.current) {
      for (const t of sec.tests) {
        prevMap[t.testCase] = { t400: t.srx400?.throughput, t440: t.srx440?.throughput };
      }
    }
    for (const sec of viewFilteredData) {
      for (const t of sec.tests) {
        const prev = prevMap[t.testCase];
        if (prev) {
          if (prev.t400 !== t.srx400?.throughput) changed.add(`400-${t.testCase}`);
          if (prev.t440 !== t.srx440?.throughput) changed.add(`440-${t.testCase}`);
        }
      }
    }
    prevDataRef.current = viewFilteredData;
    if (changed.size > 0) {
      setFlashedCells(changed);
      const timer = setTimeout(() => setFlashedCells(new Set()), 1600);
      return () => clearTimeout(timer);
    }
  }, [viewFilteredData, isSanity]);

  // ── Always normalize + filter empty rows + exclude scaling ──
  const displayData = useMemo(() => {
    let data = viewFilteredData
      .filter(s => !isScalingCategory(s.category))
      .map(section => ({
        ...section,
        tests: section.tests.filter(
          t => !isEmptyValue(t.srx400.throughput) || !isEmptyValue(t.srx440.throughput) || resolvePR(t.testCase, t.srx400.comments || t.srx440.comments),
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
    <div className="min-h-screen bg-gradient-to-br from-[#f0f7e6] via-white to-[#eef6e1] text-slate-800 relative overflow-hidden pb-16" style={{ fontFamily: "'Inter', sans-serif" }}>

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

      {/* ── Title Page (PDF only — page 1) ── */}
      <section className="report-title-page print-only max-w-4xl mx-auto px-8 py-16 print:py-0 print:px-0 print:max-w-full">
        <div className="bg-white rounded-3xl shadow-xl shadow-juniper/10 border border-juniper/15 overflow-hidden print:shadow-none print:border-none print:rounded-none">
          {/* Top accent bar */}
          <div className="h-2 bg-gradient-to-r from-juniper via-juniper-dark to-purple-600"></div>

          <div className="px-12 py-14 text-center space-y-10">
            {/* Logo / Brand Mark */}
            <div className="flex items-center justify-center gap-3 opacity-60">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-juniper to-juniper-dark flex items-center justify-center shadow-lg shadow-juniper/30">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
              </div>
              <span className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">Juniper Networks · Security S&P</span>
            </div>

            {/* Title */}
            <div className="space-y-4">
              <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-tight">
                <span className="bg-gradient-to-r from-juniper via-juniper-dark to-purple-600 bg-clip-text text-transparent">SRX4XX Platform</span>
                <br />
                <span className="text-slate-800">Scale & Performance Report</span>
              </h1>
              <p className="text-lg text-slate-400 font-medium tracking-wide">
                Panther Sanity & Regression Analysis
              </p>
            </div>

            {/* Divider */}
            <div className="flex items-center justify-center gap-4">
              <div className="h-px w-20 bg-gradient-to-r from-transparent to-juniper/40"></div>
              <div className="w-2 h-2 rounded-full bg-juniper shadow-[0_0_8px_var(--color-juniper-glow)]"></div>
              <div className="h-px w-20 bg-gradient-to-l from-transparent to-juniper/40"></div>
            </div>

            {/* Metadata Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mx-auto">
              <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Release</div>
                <div className="font-jetbrains text-sm font-bold text-slate-700">{selectedSanityRelease || releases.srx400 || '—'}</div>
              </div>
              <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Platforms</div>
                <div className="font-jetbrains text-sm font-bold text-slate-700">SRX 400 / 440</div>
              </div>
              <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Test Cases</div>
                <div className="font-jetbrains text-sm font-bold text-slate-700">{totalTests}</div>
              </div>
              <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Date</div>
                <div className="font-jetbrains text-sm font-bold text-slate-700">{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
              </div>
            </div>
          </div>

          {/* Bottom accent */}
          <div className="h-1 bg-gradient-to-r from-purple-600 via-juniper-dark to-juniper"></div>
        </div>
      </section>

      {/* ── Abstract / Intro / Methodology (PDF only — page 2) ── */}
      <section className="report-prose-page print-only max-w-4xl mx-auto px-8 print:px-0 print:max-w-full">
        <div className="bg-white rounded-3xl shadow-xl shadow-juniper/10 border border-juniper/15 overflow-hidden print:shadow-none print:border-none print:rounded-none">
          <div className="px-12 py-10 space-y-6 text-left max-w-3xl mx-auto">
            <div>
              <h2 className="text-xs font-black uppercase tracking-[0.15em] text-juniper-dark mb-2 flex items-center gap-2">
                <span className="w-6 h-px bg-juniper"></span>
                Abstract
              </h2>
              <p className="text-sm leading-relaxed text-slate-600">
                This report presents the scale and performance benchmarking results for the Juniper Networks SRX 400 and SRX 440 next-generation firewall platforms. Metrics include UDP/IPSec throughput, HTTP throughput, connections per second (CPS), and transactions per second (TPS) across a range of security profiles and traffic configurations.
              </p>
            </div>

            <div>
              <h2 className="text-xs font-black uppercase tracking-[0.15em] text-juniper-dark mb-2 flex items-center gap-2">
                <span className="w-6 h-px bg-juniper"></span>
                Introduction
              </h2>
              <p className="text-sm leading-relaxed text-slate-600">
                The SRX4XX series platforms are purpose-built for branch and edge deployments requiring high-throughput security inspection. This daily sanity execution validates performance baselines against established thresholds, ensuring that new builds maintain expected throughput and session capacity. Each test case is executed under controlled lab conditions using standardized traffic profiles. Results are compared across the SRX 400 and SRX 440 platforms to provide a side-by-side performance perspective.
              </p>
            </div>

            <div>
              <h2 className="text-xs font-black uppercase tracking-[0.15em] text-juniper-dark mb-2 flex items-center gap-2">
                <span className="w-6 h-px bg-juniper"></span>
                Methodology
              </h2>
              <p className="text-sm leading-relaxed text-slate-600">
                Tests are driven by Memory Hog and Memory Hog based traffic generators pushing through the DUT (Device Under Test) in inline mode. CPU utilization, memory (SHM), and throughput values are captured at steady state. When the Normalize CPU toggle is enabled, throughput numbers are linearly scaled to a 90% CPU baseline, removing variance caused by differing CPU utilization across test runs.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Main Content ── */}
      <main className="max-w-[90rem] mx-auto px-6 py-3 relative z-10 space-y-3">

        {/* View Toggle — Pill Segmented Control */}
        <div className="flex items-center justify-center">
          <div className="inline-flex items-center bg-white rounded-full p-1 shadow-lg shadow-juniper/20 border border-juniper/30">
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
        <div className="flex items-center justify-between gap-2">
          {/* DS-1 Release Selector — Sanity view only */}
          <div className={`relative ${showReleaseHint ? 'release-hint-zone' : ''}`}>
            {isSanity && ds1Releases.length > 0 && (
              <div className="release-box-glow flex flex-col gap-1.5 rounded-2xl border-2 border-lime-300 bg-gradient-to-br from-lime-200/80 via-lime-100/70 to-green-200/70 px-3.5 py-3 shadow-lg shadow-lime-300/50">
                <span className={`text-xs font-extrabold uppercase tracking-widest pl-0.5 ${showReleaseHint ? 'release-hint-label' : 'text-slate-600'}`}>Select a release</span>
              <div className="release-shine relative inline-flex items-center gap-2 min-w-[360px] bg-gradient-to-r from-juniper-light via-white to-blue-50 border-2 border-purple-500/70 rounded-xl px-3 py-1.5 shadow-lg shadow-purple-300/40 hover:shadow-xl hover:shadow-purple-400/40 hover:border-purple-600/80 transition-all duration-300 group">
                <div className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-juniper-dark animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" /></svg>
                  <span className="text-[10px] font-bold text-juniper-darker uppercase tracking-widest">Release</span>
                </div>
                <select
                  value={selectedSanityRelease}
                  onChange={(e) => { setSelectedSanityRelease(e.target.value); dismissReleaseHint(); }}
                  onMouseDown={dismissReleaseHint}
                  onFocus={dismissReleaseHint}
                  className="flex-1 bg-transparent border-none text-slate-800 text-xs font-bold tracking-wide focus:outline-none cursor-pointer appearance-none pr-5"
                >
                  {ds1Releases.map((rel) => (
                    <option key={rel.release} value={rel.release}>{rel.release}</option>
                  ))}
                </select>
                <svg className="w-3.5 h-3.5 text-juniper-dark absolute right-3 pointer-events-none group-hover:translate-y-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
              </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
          {/* Normalize CPU Toggle */}
          <div className="relative group/norm">
          <label className="print-hide flex items-center gap-2 cursor-pointer select-none px-3.5 py-1.5 rounded-lg border border-juniper/30 bg-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-50/50">
            <div
              onClick={() => setIsNormalized(!isNormalized)}
              className={`relative w-9 h-[18px] rounded-full transition-colors duration-300 ${isNormalized ? 'bg-amber-500' : 'bg-slate-300'}`}
            >
              <div className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] bg-white rounded-full shadow-sm transition-transform duration-300 ${isNormalized ? 'translate-x-[18px]' : ''}`} />
            </div>
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Normalize
            </span>
          </label>
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-1.5 bg-slate-800 text-slate-300 text-[11px] font-medium rounded-lg shadow-lg whitespace-nowrap opacity-0 pointer-events-none group-hover/norm:opacity-100 transition-opacity duration-150 z-[60]">
            Normalize throughput to 90% CPU baseline
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-800"></div>
          </div>
          </div>
          <button
            onClick={() => window.print()}
            className="print-hide flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-juniper/30 bg-white text-slate-500 text-xs font-bold uppercase tracking-wider shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-juniper hover:text-juniper-dark hover:bg-juniper-light hover:shadow-lg hover:shadow-juniper/15"
            title="Download report as PDF"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            PDF
          </button>
          </div>
        </div>

        {/* ── Data Table ── */}
        <div className="rounded-2xl shadow-xl shadow-juniper/5 border border-juniper/15 overflow-hidden bg-white">

          {/* Table Header */}
          <div className={`grid gap-0 px-0 py-2.5 bg-juniper border-b-2 border-juniper-dark items-center ${show3XX ? 'grid-cols-[2.5fr_1.5fr_1.5fr_repeat(5,1fr)]' : 'grid-cols-[4fr_3fr_3fr]'}`}>
            <div className="text-xs font-bold text-black uppercase tracking-[0.1em] px-6">Test Case</div>
            <div className="flex flex-col gap-0.5 px-5 border-l border-juniper-dark/40">
              <span className="text-xs font-semibold text-black uppercase tracking-[0.1em]">SRX 400</span>
              <span className="font-jetbrains text-[11px] font-semibold text-black/60">{isSanity && selectedSanityRelease ? selectedSanityRelease : releases.srx400}</span>
            </div>
            <div className="flex flex-col gap-0.5 px-5 border-l border-juniper-dark/40">
              <span className="text-xs font-semibold text-black uppercase tracking-[0.1em]">SRX 440</span>
              <span className="font-jetbrains text-[11px] font-semibold text-black/60">{isSanity && selectedSanityRelease ? selectedSanityRelease : releases.srx440}</span>
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
              displayData.map((section, sIdx) => {
                const isExpanded = expandedGroups[section.category] ?? true;

                return (
                  <div key={section.category} className="flex flex-col border-b border-juniper/30 last:border-0 animate-section-enter" style={{ animationDelay: `${sIdx * 0.1}s` }}>

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

                            // Normalize when toggle is on (skip scaling/capacity sections)
                            const shouldNormalize = isNormalized && !isScalingCategory(section.category);
                            const norm400 = shouldNormalize && has400
                              ? normalizeTo90Cpu(item.srx400.throughput, item.srx400.cpu)
                              : { value: item.srx400.throughput, wasNormalized: false };
                            const norm440 = shouldNormalize && has440
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
                                <div
                                  className={`flex flex-col justify-center gap-1 px-5 border-l border-juniper/30 ${flashedCells.has(`400-${item.testCase}`) ? 'diff-flash' : ''}`}
                                  onMouseEnter={(e) => has400 && handleCellEnter(e, `400-${sIdx}-${idx}`, { cpu: shouldNormalize && item.srx400.cpu && parseInt(item.srx400.cpu) > 90 ? '90%' : item.srx400.cpu, shm: item.srx400.shm })}
                                  onMouseLeave={() => setHoveredCell(null)}
                                >
                                  {has400 ? (
                                    <span className="font-jetbrains text-[13px] font-semibold text-slate-800">
                                      {norm400.value}
                                    </span>
                                  ) : (
                                    <span className="font-jetbrains text-[13px] text-slate-300 select-none">—</span>
                                  )}
                                  {isSanity ? <CommentWithPR comment={item.srx400.comments || item.srx440.comments} testCase={item.testCase} prOnly /> : <CommentWithPR comment={item.srx400.comments || item.srx440.comments} testCase={item.testCase} />}
                                  <MetricsTooltip
                                    position={hoveredCell?.id === `400-${sIdx}-${idx}` ? hoveredCell : null}
                                    isVisible={hoveredCell?.id === `400-${sIdx}-${idx}`}
                                    data={hoveredCell?.id === `400-${sIdx}-${idx}` ? hoveredCell : null}
                                  />
                                </div>

                                {/* SRX 440 */}
                                <div
                                  className={`flex flex-col justify-center gap-1 px-5 border-l border-juniper/30 ${flashedCells.has(`440-${item.testCase}`) ? 'diff-flash' : ''}`}
                                  onMouseEnter={(e) => has440 && handleCellEnter(e, `440-${sIdx}-${idx}`, { cpu: shouldNormalize && item.srx440.cpu && parseInt(item.srx440.cpu) > 90 ? '90%' : item.srx440.cpu, shm: item.srx440.shm })}
                                  onMouseLeave={() => setHoveredCell(null)}
                                >
                                  {has440 ? (
                                    <span className="font-jetbrains text-[13px] font-semibold text-slate-800">
                                      {norm440.value}
                                    </span>
                                  ) : (
                                    <span className="font-jetbrains text-[13px] text-slate-300 select-none">—</span>
                                  )}
                                  {isSanity ? <CommentWithPR comment={item.srx440.comments || item.srx400.comments} testCase={item.testCase} prOnly /> : <CommentWithPR comment={item.srx440.comments || item.srx400.comments} testCase={item.testCase} />}
                                  <MetricsTooltip
                                    position={hoveredCell?.id === `440-${sIdx}-${idx}` ? hoveredCell : null}
                                    isVisible={hoveredCell?.id === `440-${sIdx}-${idx}`}
                                    data={hoveredCell?.id === `440-${sIdx}-${idx}` ? hoveredCell : null}
                                  />
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

        {/* ── Performance Overview Chart (Sanity view only) ── */}
        <div className="print-chart-page">
        {isSanity && !isNormalized && <SanityOverviewChart displayData={displayData} />}
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
            <span className="font-jetbrains font-semibold bg-gradient-to-r from-juniper-dark to-blue-600 bg-clip-text text-transparent">SRX4XX_Datasheet</span>
            <span className="text-slate-300">•</span>
            <span className="text-slate-400">{new Date().toLocaleDateString()}</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default PublicReport;

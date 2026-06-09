import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { loadDatasheet, mergeSheets } from './utils/xlsxParser';
import { SANITY_TEST_CASES } from './config/sanityTestCases';
import { BRANCH_DEVICES, getBranchData } from './config/branchData';
import { API_BASE } from './config/api';
import HistoryModal from './components/HistoryModal';
import ChangelogBanner from './components/ChangelogBanner';
import SanityOverviewChart from './components/SanityOverviewChart';
import AnimatedMetric from './components/AnimatedMetric';
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

const DiffTooltip = ({ position, isVisible, data }) => {
  if (!isVisible || !position || !data) return null;
  const { diff, val400, val440 } = data;
  
  return createPortal(
    <div
      className="fixed z-[9999] animate-fade-in-up pointer-events-none"
      style={{ top: `${position.y + 8}px`, left: `${position.x}px`, animationDuration: '200ms' }}
    >
      <div className="bg-slate-900 text-white rounded-lg shadow-2xl border border-slate-700 p-3 min-w-[240px]">
        {/* Header — matches System Metrics style */}
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700">
          <div className="w-2 h-2 bg-juniper rounded-full shadow-[0_0_8px_var(--color-juniper-glow)]"></div>
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Performance Diff</span>
        </div>
        {/* Data rows — same layout as CPU/SHM */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">SRX 400:</span>
            <span className="font-jetbrains text-sm font-semibold text-juniper">
              {diff ? diff.val400 : val400 || '—'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">SRX 440:</span>
            <span className="font-jetbrains text-sm font-semibold text-blue-400">
              {diff ? diff.val440 : val440 || '—'}
            </span>
          </div>
          {diff && (
            <div className="flex justify-between items-center pt-1.5 mt-0.5 border-t border-slate-700">
              <span className="text-xs text-slate-400">Difference:</span>
              <span className={`font-jetbrains text-sm font-bold ${
                diff.pct >= 0 ? 'text-juniper' : 'text-red-400'
              }`}>
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
    return { bg: 'bg-gradient-to-r from-juniper-light to-juniper-light', hover: 'hover:from-juniper-light hover:to-juniper/20', text: 'text-juniper-dark', border: 'border-juniper/30', accent: 'border-l-juniper', dot: 'bg-juniper', dotGlow: 'shadow-[0_0_10px_var(--color-juniper-glow)]', badge: 'bg-juniper-light text-juniper-dark border-juniper/30' };
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
  const [hoveredDiff, setHoveredDiff] = useState(null);
  const [ingestStatus, setIngestStatus] = useState(null);
  const [ingestMessage, setIngestMessage] = useState('');
  const [showCompare, setShowCompare] = useState(false);
  const [historyModal, setHistoryModal] = useState({ open: false, testCase: '', platform: '', category: '', value: '' });
  const [isNormalized, setIsNormalized] = useState(false);
  const [isOptimized, setIsOptimized] = useState(false);
  const [changelogRefresh, setChangelogRefresh] = useState(0);
  const [ds1Releases, setDs1Releases] = useState([]);       // [{ release, merged }]
  const [selectedSanityRelease, setSelectedSanityRelease] = useState('');
  const [flashedCells, setFlashedCells] = useState(new Set());
  const [visitorCount, setVisitorCount] = useState(null);
  const prevDataRef = useRef(null);

  const isSanity = activeView === 'sanity';
  const show3XX = isSanity && showCompare;

  // Cap CPU display to 90% when normalization is active
  const capCpu = (cpuStr) => {
    if (!isNormalized || !cpuStr) return cpuStr;
    const m = cpuStr.match(/(\d+)/);
    if (!m) return cpuStr;
    const val = parseInt(m[1], 10);
    return val > 90 ? '90%' : cpuStr;
  };

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
        console.error('Failed to load datasheet:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Fetch public-report visitor count ──
  useEffect(() => {
    fetch(`${API_BASE}/api/visit-count?page=public-report`)
      .then(r => r.json())
      .then(d => setVisitorCount(d))
      .catch(() => {});
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
      if (json.skipped_platforms && json.skipped_platforms.length > 0) {
        parts.push(`${json.skipped_platforms.join(', ')} unchanged`);
      }
      setIngestStatus('success');
      setIngestMessage(parts.join(', '));
      setChangelogRefresh(prev => prev + 1);
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

    // Sanity view: use DS-1 sheet data if available
    if (ds1Releases.length > 0 && selectedSanityRelease) {
      const releaseBlock = ds1Releases.find(r => r.release === selectedSanityRelease);
      if (releaseBlock) {
        return releaseBlock.merged;
      }
    }

    // Fallback: use old SANITY_TEST_CASES matching against SRX400/SRX440 sheets
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

  // ── Helper: detect truly-empty throughput values ──
  const isEmptyValue = (val) => !val || val.trim() === '' || val.trim() === '-' || val.trim() === '—';

  // ── Search + Optimized filter (applied on top of view filter) ──
  const displayData = useMemo(() => {
    let data = viewFilteredData;

    // Search filter
    if (searchTerm.trim()) {
      const lower = searchTerm.toLowerCase();
      data = data
        .map(section => ({
          ...section,
          tests: section.tests.filter(t =>
            t.testCase.toLowerCase().includes(lower) ||
            section.category.toLowerCase().includes(lower)
          ),
        }))
        .filter(section => section.tests.length > 0);
    }

    // Optimized view: hide rows with no data for either device,
    // and drop categories that become entirely empty.
    if (isOptimized) {
      data = data
        .map(section => ({
          ...section,
          tests: section.tests.filter(t =>
            !isEmptyValue(t.srx400.throughput) || !isEmptyValue(t.srx440.throughput) ||
            resolvePR(t.testCase, t.srx400.comments || t.srx440.comments)
          ),
        }))
        .filter(section => section.tests.length > 0);
    }

    // Pin UDP/IPSec sections to the top
    data.sort((a, b) => {
      const aIsUdp = /udp|ipsec/i.test(a.category);
      const bIsUdp = /udp|ipsec/i.test(b.category);
      if (aIsUdp && !bIsUdp) return -1;
      if (!aIsUdp && bIsUdp) return 1;
      return 0;
    });

    return data;
  }, [viewFilteredData, searchTerm, isOptimized]);

  const toggleGroup = (cat) => {
    setExpandedGroups(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const handleCellEnter = (e, cellId, metrics) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredCell({ id: cellId, x: rect.left, y: rect.bottom, ...metrics });
  };

  const handleDiffEnter = (e, cellId, val400, val440) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const diff = calculatePercentageDiff(val400, val440);
    setHoveredDiff({ id: cellId, x: rect.left, y: rect.bottom, diff, val400, val440 });
  };

  // ── Render ──
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

  // ── Computed stats ──
  const totalTests = displayData.reduce((sum, s) => sum + s.tests.length, 0);
  const testedCount = displayData.reduce((sum, s) => sum + s.tests.filter(t => t.srx400.throughput || t.srx440.throughput).length, 0);
  const passRate = totalTests > 0 ? Math.round((testedCount / totalTests) * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f0f7e6] via-white to-[#eef6e1] text-slate-800 relative overflow-hidden pb-16" style={{ fontFamily: "'Inter', sans-serif" }}>


      {/* ── Header ── */}
      <header className="bg-white/90 backdrop-blur-sm sticky top-0 z-50 border-b border-juniper/20 shadow-sm shadow-juniper/5">
        <div className="h-[3px] w-full bg-gradient-to-r from-juniper via-juniper-dark to-juniper"></div>
        <div className="max-w-[90rem] mx-auto px-6 py-3">
          <div className="flex items-center justify-end relative">

            {/* Center — Title (absolute centered) */}
            <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-3">
              <span className="relative w-1.5 h-10 rounded-full overflow-hidden">
                <span className="absolute inset-0 bg-gradient-to-b from-juniper via-juniper-dark to-purple-500"></span>
              </span>
              <h1 className="text-[1.6rem] font-extrabold tracking-tight flex items-center gap-2.5">
                <span className="bg-gradient-to-r from-juniper via-juniper-dark to-purple-600 bg-clip-text text-transparent font-black tracking-tight">PANTHER</span>
                <span className="font-semibold text-slate-600 tracking-tight">SNP</span>
                <span className="font-medium text-slate-400 tracking-tight">Dashboard</span>
              </h1>
              <span className="relative w-1.5 h-10 rounded-full overflow-hidden">
                <span className="absolute inset-0 bg-gradient-to-b from-purple-500 via-juniper-dark to-juniper"></span>
              </span>
            </div>

            {/* Right — Actions */}
            <div className="flex items-center gap-2">
              <a
                href="#/public-report"
                className="shine-on-hover flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-juniper/30 bg-white text-slate-600 text-xs font-bold uppercase tracking-wider shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-juniper-light hover:border-juniper/50 hover:text-juniper-darker hover:shadow-lg hover:shadow-juniper/20"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                Public
              </a>
              <button onClick={triggerIngest} disabled={ingestStatus === 'loading'} className={`shine-on-hover flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold uppercase tracking-wider shadow-sm transition-all duration-300 hover:-translate-y-0.5 ${ingestStatus === 'loading' ? 'bg-slate-100 border-slate-300 text-slate-400 cursor-wait' : ingestStatus === 'success' ? 'bg-juniper-light border-juniper/40 text-juniper-darker' : ingestStatus === 'error' ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-slate-300 text-slate-600 hover:bg-juniper-light hover:border-juniper/50 hover:text-juniper-darker hover:shadow-lg hover:shadow-juniper/20'}`}>
                {ingestStatus === 'loading' ? 'Ingesting…' : ingestStatus === 'success' ? ingestMessage : ingestStatus === 'error' ? ingestMessage : 'Ingest Latest'}
              </button>
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

        {/* View Toggle + Switches Row */}
        <div className="flex items-center justify-between">
          {/* Left — Pill Segmented Control */}
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
          </div>

          {/* Right — Toggle Switches in matching pill container */}
          <div className="inline-flex items-center bg-white rounded-full p-1 shadow-lg shadow-juniper/20 border border-juniper/30 gap-1 overflow-visible">
            {/* Normalize CPU Toggle */}
            <div className="relative group/norm">
            <label className="flex items-center gap-2 cursor-pointer select-none px-4 py-2 rounded-full transition-all duration-300 hover:bg-slate-50">
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
                Normalize CPU
              </span>
            </label>
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-1.5 bg-slate-800 text-slate-300 text-[11px] font-medium rounded-lg shadow-lg whitespace-nowrap opacity-0 pointer-events-none group-hover/norm:opacity-100 transition-opacity duration-150 z-[60]">
              Normalize throughput to 90% CPU baseline
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-800"></div>
            </div>
            </div>

            {/* Optimized View Toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none px-4 py-2 rounded-full transition-all duration-300 hover:bg-slate-50">
              <div
                onClick={() => setIsOptimized(!isOptimized)}
                className={`relative w-9 h-[18px] rounded-full transition-colors duration-300 ${isOptimized ? 'bg-juniper' : 'bg-slate-300'}`}
              >
                <div className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] bg-white rounded-full shadow-sm transition-transform duration-300 ${isOptimized ? 'translate-x-[18px]' : ''}`} />
              </div>
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                Optimized View
              </span>
            </label>
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
          <div className="flex flex-col gap-1">
            {isSanity && ds1Releases.length > 0 && (
              <>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest pl-1">Select a release</span>
              <div className="relative inline-flex items-center gap-2 bg-gradient-to-r from-juniper-light via-white to-blue-50 border-2 border-juniper/40 rounded-xl px-3 py-1.5 shadow-lg shadow-juniper/15 hover:shadow-xl hover:shadow-juniper/25 transition-all duration-300 group">
                <div className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-juniper-dark animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" /></svg>
                  <span className="text-[10px] font-bold text-juniper-darker uppercase tracking-widest">Release</span>
                </div>
                <select
                  value={selectedSanityRelease}
                  onChange={(e) => setSelectedSanityRelease(e.target.value)}
                  className="bg-transparent border-none text-slate-800 text-xs font-bold tracking-wide focus:outline-none cursor-pointer appearance-none pr-5"
                >
                  {ds1Releases.map((rel) => (
                    <option key={rel.release} value={rel.release}>{rel.release}</option>
                  ))}
                </select>
                <svg className="w-3.5 h-3.5 text-juniper-dark absolute right-3 pointer-events-none group-hover:translate-y-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
              </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
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
          <button onClick={() => window.open('http://10.204.134.80:3000/?device=snpsrx400c-proto', '_blank')} className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-blue-300 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-600 text-xs font-semibold uppercase tracking-wider shadow-sm hover:shadow-md hover:shadow-blue-200/50 hover:-translate-y-0.5 transition-all duration-300" title="View SRX 400 telemetry in Longevity Portal">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            Longevity
          </button>
          </div>
        </div>

        {/* ── Changelog Banner ── */}
        <ChangelogBanner refreshKey={changelogRefresh} />

        {/* ── Data Table ── */}
        <div className="rounded-2xl shadow-xl shadow-juniper/5 border border-juniper/15 overflow-hidden bg-white">

          {/* Table Header */}
          <div className={`grid gap-0 px-0 py-2.5 bg-juniper border-b-2 border-juniper-dark items-center ${show3XX ? 'grid-cols-[2.5fr_1.5fr_1.5fr_repeat(5,1fr)]' : isSanity ? 'grid-cols-[5fr_3fr_3fr]' : 'grid-cols-[4fr_3fr_3fr_2fr]'}`}>
            <div className="text-xs font-bold text-black uppercase tracking-[0.1em] px-6">Test Case</div>
            <div className="flex flex-col gap-0.5 px-5 border-l border-juniper-dark/40">
              <span className="text-xs font-semibold text-black uppercase tracking-[0.1em]">SRX 400</span>
              <span className="font-jetbrains text-[11px] font-semibold text-black/60">{isSanity && selectedSanityRelease ? selectedSanityRelease : releases.srx400}</span>
            </div>
            <div className="flex flex-col gap-0.5 px-5 border-l border-juniper-dark/40">
              <span className="text-xs font-semibold text-black uppercase tracking-[0.1em]">SRX 440</span>
              <span className="font-jetbrains text-[11px] font-semibold text-black/60">{isSanity && selectedSanityRelease ? selectedSanityRelease : releases.srx440}</span>
            </div>
            {show3XX ? (
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
            ) : !isSanity && (
              <div className="text-xs font-semibold text-black uppercase tracking-[0.1em] px-5 border-l border-juniper-dark/40">
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
                  <motion.div
                    key={section.category}
                    layout
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, delay: Math.min(sIdx * 0.06, 0.4), ease: [0.22, 1, 0.36, 1] }}
                    className="flex flex-col border-b border-juniper/30 last:border-0"
                  >

                    <div
                      onClick={() => toggleGroup(section.category)}
                      className={`grid grid-cols-12 gap-0 px-6 py-3 items-center cursor-pointer border-l-[3px] border-l-slate-300 bg-slate-50/80 hover:bg-slate-100/80`}
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
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          key="content"
                          className="bg-white overflow-hidden"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        >
                      <div>
                        <div className="flex flex-col">
                          {section.tests.map((item, idx) => {
                            const isLast = idx === section.tests.length - 1;
                            const has400 = !!item.srx400.throughput;
                            const has440 = !!item.srx440.throughput;
                            const comments = item.srx440.comments || item.srx400.comments || '';

                            // CPU normalization — skip scaling/capacity sections
                            const shouldNormalize = isNormalized && !isScalingCategory(section.category);
                            const norm400 = shouldNormalize && has400 ? normalizeTo90Cpu(item.srx400.throughput, item.srx400.cpu) : { value: item.srx400.throughput, wasNormalized: false };
                            const norm440 = shouldNormalize && has440 ? normalizeTo90Cpu(item.srx440.throughput, item.srx440.cpu) : { value: item.srx440.throughput, wasNormalized: false };

                            return (
                              <motion.div
                                key={idx}
                                layout
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.35, delay: Math.min(idx * 0.03, 0.3), ease: 'easeOut' }}
                                className={`grid gap-0 px-0 py-3 items-center group/row row-hover relative ${show3XX ? 'grid-cols-[2.5fr_1.5fr_1.5fr_repeat(5,1fr)]' : isSanity ? 'grid-cols-[5fr_3fr_3fr]' : 'grid-cols-[4fr_3fr_3fr_2fr]'} border-b border-juniper/30`}
                                style={{ fontVariantNumeric: 'tabular-nums' }}
                              >

                                {/* Test Case Name + Comparison Tooltip */}
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

                                <div
                                  className={`flex flex-col justify-center gap-1 px-5 border-l border-juniper/30 ${flashedCells.has(`400-${item.testCase}`) ? 'diff-flash' : ''}`}
                                  onMouseEnter={(e) => has400 && handleCellEnter(e, `400-${sIdx}-${idx}`, { cpu: capCpu(item.srx400.cpu), shm: item.srx400.shm })}
                                  onMouseLeave={() => setHoveredCell(null)}
                                >
                                  {has400 ? (
                                    <span
                                      className={`font-jetbrains text-[13px] font-semibold cursor-pointer hover:underline underline-offset-2 transition-colors ${
                                        norm400.wasNormalized ? 'text-amber-700 hover:text-amber-800' : 'text-slate-800 hover:text-juniper-dark'
                                      }`}
                                      onClick={() => setHistoryModal({ open: true, testCase: item.testCase, platform: 'SRX400', category: section.category, value: item.srx400.throughput })}
                                      title={norm400.wasNormalized ? `Raw: ${item.srx400.throughput} @ ${item.srx400.cpu} CPU → Normalized to 90%` : undefined}
                                    >
                                      {norm400.wasNormalized && <span className="text-amber-500 mr-1">⚡</span>}
                                      <AnimatedMetric value={norm400.value} />
                                    </span>
                                  ) : (() => {
                                    const pr = resolvePR(item.testCase, item.srx400.comments || comments);
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
                                  <MetricsTooltip
                                    position={hoveredCell?.id === `400-${sIdx}-${idx}` ? hoveredCell : null}
                                    isVisible={hoveredCell?.id === `400-${sIdx}-${idx}`}
                                    data={hoveredCell?.id === `400-${sIdx}-${idx}` ? hoveredCell : null}
                                  />
                                </div>

                                <div
                                  className={`flex flex-col justify-center gap-1 px-5 border-l border-juniper/30 ${flashedCells.has(`440-${item.testCase}`) ? 'diff-flash' : ''}`}
                                  onMouseEnter={(e) => has440 && handleCellEnter(e, `440-${sIdx}-${idx}`, { cpu: capCpu(item.srx440.cpu), shm: item.srx440.shm })}
                                  onMouseLeave={() => setHoveredCell(null)}
                                >
                                  {has440 ? (
                                    <span
                                      className={`font-jetbrains text-[13px] font-semibold cursor-pointer hover:underline underline-offset-2 transition-colors ${
                                        norm440.wasNormalized ? 'text-amber-700 hover:text-amber-800' : 'text-slate-800 hover:text-blue-600'
                                      }`}
                                      onClick={() => setHistoryModal({ open: true, testCase: item.testCase, platform: 'SRX440', category: section.category, value: item.srx440.throughput })}
                                      title={norm440.wasNormalized ? `Raw: ${item.srx440.throughput} @ ${item.srx440.cpu} CPU → Normalized to 90%` : undefined}
                                    >
                                      {norm440.wasNormalized && <span className="text-amber-500 mr-1">⚡</span>}
                                      <AnimatedMetric value={norm440.value} />
                                    </span>
                                  ) : (() => {
                                    const pr = resolvePR(item.testCase, item.srx440.comments || comments);
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
                                        <div 
                                          key={dev} 
                                          className="px-4 border-l border-juniper/30 flex items-center"
                                          onMouseEnter={(e) => val && handleCellEnter(e, `${dev}-${sIdx}-${idx}`, { device: dev, value: val })}
                                          onMouseLeave={() => setHoveredCell(null)}
                                        >
                                          {val ? (
                                            <span className="font-jetbrains text-[13px] font-semibold text-slate-700 whitespace-nowrap cursor-pointer hover:text-orange-600 transition-colors">
                                              {val}
                                            </span>
                                          ) : (
                                            <span className="font-jetbrains text-xs text-slate-300 select-none">—</span>
                                          )}
                                          <MetricsTooltip
                                            position={hoveredCell?.id === `${dev}-${sIdx}-${idx}` ? hoveredCell : null}
                                            isVisible={hoveredCell?.id === `${dev}-${sIdx}-${idx}`}
                                            data={hoveredCell?.id === `${dev}-${sIdx}-${idx}` ? hoveredCell : null}
                                          />
                                        </div>
                                      );
                                    })}
                                  </>
                                ) : !isSanity ? (
                                  <div className="px-5 border-l border-juniper/30">
                                    {comments ? (
                                      <span className="font-jetbrains text-xs text-slate-500 leading-relaxed">{comments}</span>
                                    ) : (
                                      <span className="font-jetbrains text-xs text-slate-300 select-none">—</span>
                                    )}
                                  </div>
                                ) : null}
                              </motion.div>
                            );
                          })}
                        </div>
                      </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>

        {/* ── Performance Overview Chart (Daily Sanity only, hidden when normalized) ── */}
        {isSanity && !isNormalized && <SanityOverviewChart displayData={displayData} />}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-juniper/30">
        <div className="h-[2px] bg-gradient-to-r from-juniper via-blue-400 to-purple-500"></div>
        <div className="max-w-[90rem] mx-auto px-6 py-3.5">
          <div className="flex items-center justify-center gap-3 text-xs text-slate-500">
            <div className="flex items-center gap-1.5 text-juniper-dark">
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-juniper"></span>
              </span>
            </div>
            <span className="font-medium">Data Source:</span>
            <span className="font-jetbrains font-semibold bg-gradient-to-r from-juniper-dark to-blue-600 bg-clip-text text-transparent">SRX4XX_Datasheet.xlsx</span>
            <span className="text-slate-300">•</span>
            <span className="text-slate-400">{new Date().toLocaleDateString()}</span>
            {visitorCount && (
              <div className="flex items-center gap-2 ml-1 px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-1.5">
                  <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  <span className="font-semibold text-slate-600">{visitorCount.total.toLocaleString()}</span>
                  <span className="text-slate-400">views</span>
                </div>
                <span className="w-px h-3 bg-slate-200"></span>
                <div className="flex items-center gap-1.5">
                  <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  <span className="font-semibold text-slate-600">{visitorCount.unique.toLocaleString()}</span>
                  <span className="text-slate-400">unique</span>
                </div>
                {visitorCount.today > 0 && (
                  <>
                    <span className="w-px h-3 bg-slate-200"></span>
                    <div className="flex items-center gap-1">
                      <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-juniper opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-juniper"></span></span>
                      <span className="font-semibold text-juniper-dark">{visitorCount.today}</span>
                      <span className="text-slate-400">today</span>
                    </div>
                  </>
                )}
              </div>
            )}
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

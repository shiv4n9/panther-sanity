import { useState, useMemo, useEffect, useRef, useImperativeHandle, forwardRef, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { loadDatasheet, mergeSheets } from './utils/xlsxParser';
import { SANITY_TEST_CASES } from './config/sanityTestCases';
import { BRANCH_DEVICES, getBranchComparison } from './config/branchData';
import { API_BASE } from './config/api';
import HistoryModal from './components/HistoryModal';
import ChangelogBanner from './components/ChangelogBanner';
import SanityOverviewChart from './components/SanityOverviewChart';
import AnimatedMetric from './components/AnimatedMetric';
import { normalizeTo90Cpu, normalizeToTargetCpu, calculatePercentageDiff, isScalingCategory, extractMbpsValue } from './utils/normalize';

// ─── PR Links for known blocked test cases ───────────────────
const PR_LINKS = [];

// ─── Local PR details fallback ────────────────────────────────
// Used until the GNATS REST API access is granted. Sourced from the GNATS
// PR export XML (synopsis + state). Once the live API returns data, it
// overrides these entries automatically.
const PR_DETAILS_FALLBACK = {
  '1954277': {
    description:
      '25.4X300-202604190112.0-EVO: Packet drops are seen during rekey while doing ipsec performance test, observing NIC drops at high CPU (~90%)',
    status: 'Open',
    responsible: 'mingl',
  },
};

const PRIORITY_SANITY_RELEASE = '25.4X300-D10.2-EVO';

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

function normalizeUnitLabel(label) {
  if (!label) return null;
  const upper = label.toUpperCase();
  if (upper === 'MBPS') return 'Mbps';
  return upper;
}

function parseCompareMetric(rawValue, sourceMetric = '', scaleKcps = false) {
  const value = String(rawValue || '').trim();
  if (!value) return null;

  const buildRow = (rawPart, fallbackLabel = null) => {
    const part = String(rawPart || '').trim();
    if (!part) return null;
    const valueMatch = part.match(/[\d.]+/);
    const unitMatch = part.match(/\b(KPPS|KCPS|CPS|TPS|MBPS|GBPS)\b/i);
    const rawLabel = normalizeUnitLabel(unitMatch?.[1] || fallbackLabel);
    let displayValue = valueMatch ? valueMatch[0] : part;
    let displayLabel = rawLabel;

    if (rawLabel === 'KCPS' && valueMatch) {
      // Branch 3XX values are stored in KCPS and shown as CPS (x1000).
      // Datasheet SRX400/440 values are already in CPS, so only relabel.
      if (scaleKcps) {
        const numericValue = parseFloat(valueMatch[0]);
        if (!Number.isNaN(numericValue)) {
          const scaledValue = numericValue * 1000;
          displayValue = Number.isInteger(scaledValue)
            ? String(scaledValue)
            : String(Number(scaledValue.toFixed(2)));
          displayLabel = 'CPS';
        }
      } else {
        displayLabel = 'CPS';
      }
    }

    return {
      label: displayLabel,
      value: displayValue,
    };
  };

  let splitFallbackLabels = null;
  if (/kpps\s*\/\s*mbps/i.test(sourceMetric)) splitFallbackLabels = ['KPPS', 'Mbps'];
  else if (/cps\s*\/\s*mbps/i.test(sourceMetric)) splitFallbackLabels = ['CPS', 'Mbps'];
  else if (/tps\s*\/\s*mbps/i.test(sourceMetric)) splitFallbackLabels = ['TPS', 'Mbps'];

  if ((splitFallbackLabels || value.includes('/')) && value.includes('/')) {
    const rows = value
      .split('/')
      .map((part, idx) => buildRow(part, splitFallbackLabels?.[idx]))
      .filter(Boolean);

    if (rows.length) {
      return {
        layout: rows.length > 1 ? 'split' : 'single',
        rows,
      };
    }
  }

  let singleFallback = null;
  if (/kcps/i.test(sourceMetric)) singleFallback = 'KCPS';
  else if (/\bcps\b/i.test(sourceMetric)) singleFallback = 'CPS';
  else if (/\btps\b/i.test(sourceMetric)) singleFallback = 'TPS';
  else if (/\bmbps\b/i.test(sourceMetric)) singleFallback = 'Mbps';

  const singleRow = buildRow(value, singleFallback);

  return {
    layout: 'single',
    rows: singleRow ? [singleRow] : [],
  };
}

// Restrict a parsed metric to its Mbps row only (used for throughput test
// cases that should be compared in Mbps regardless of the KPPS source value).
function filterToMbps(parsedMetric) {
  if (!parsedMetric?.rows?.length) return parsedMetric;
  const rows = parsedMetric.rows.filter((row) => row.label === 'Mbps');
  if (!rows.length) return parsedMetric;
  return { layout: 'single', rows };
}

function renderCompareMetricRows(parsedMetric, renderLabel) {
  if (!parsedMetric?.rows?.length) return null;

  return (
    <div className="flex flex-col divide-y divide-juniper/15 leading-tight">
      {parsedMetric.rows.map((row) => (
        <div key={`${row.label || 'value'}-${row.value}`} className="min-h-[24px] flex items-center py-0.5">
          {renderLabel ? (
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{row.label || 'Value'}</span>
          ) : (
            <span className="whitespace-nowrap">{row.value}</span>
          )}
        </div>
      ))}
    </div>
  );
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

// ─── Tooltip Portal ──────────────────────────────────────────
const MetricsTooltip = ({ position, isVisible, data }) => {
  if (!isVisible || !position || !data) return null;
  if (data.kind === 'branch') {
    const parsedValue = parseCompareMetric(data.value, data.sourceMetric, true);
    return createPortal(
      <div
        className="fixed z-[9999] animate-fade-in-up pointer-events-none"
        style={{ top: `${position.y + 8}px`, left: `${position.x}px`, transform: 'translateX(-50%)', animationDuration: '200ms' }}
      >
        <div className="bg-slate-900 text-white rounded-lg shadow-2xl border border-slate-700 p-3 min-w-[280px] max-w-[360px]">
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700">
            <div className="w-2 h-2 bg-orange-400 rounded-full shadow-[0_0_8px_rgba(251,146,60,0.6)]"></div>
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Branch Compare</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between items-center gap-4">
              <span className="text-xs text-slate-400">Device:</span>
              <span className="font-jetbrains text-sm font-semibold text-orange-300">{data.device}</span>
            </div>
            {parsedValue?.rows?.map((row) => (
              <div key={`${data.device}-${row.label || row.value}`} className="flex justify-between items-center gap-4">
                <span className="text-xs text-slate-400">{row.label || 'Value'}:</span>
                <span className="font-jetbrains text-sm font-semibold text-white">{row.value}</span>
              </div>
            ))}
            <div className="pt-2 border-t border-slate-700/70 space-y-1">
              <div className="text-xs text-slate-400">Workbook Test</div>
              <div className="text-sm text-slate-200 leading-snug">{data.sourceTest}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-slate-400">Metric</div>
              <div className="text-sm text-slate-200 leading-snug">{data.sourceMetric}</div>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }
  return createPortal(
    <div
      className="fixed z-[9999] animate-fade-in-up pointer-events-none"
      style={{ top: `${position.y + 8}px`, left: `${position.x}px`, animationDuration: '200ms' }}
    >
      <div className="bg-slate-900/80 backdrop-blur-md text-white rounded-lg shadow-2xl border border-slate-700/60 p-3 min-w-[200px]">
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
      style={{ top: `${position.y + 8}px`, left: `${position.x}px`, transform: 'translateX(-50%)', animationDuration: '200ms' }}
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
              {diff ? diff.val400 : val400 || '-'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">SRX 440:</span>
            <span className="font-jetbrains text-sm font-semibold text-blue-400">
              {diff ? diff.val440 : val440 || '-'}
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

// ─── All-Releases Matrix Table ───────────────────────────────
// Shows every daily-sanity test case (rows) against all releases (columns)
// for a single device, in Mbps only. The first data column is a Baseline
// (D10.2 image normalized to 90% CPU). Values with an associated PR are shown
// in red and link to GNATS. The priority release (25.4X300-D10.2-EVO) is the
// first release column; remaining releases follow in descending date order.

// Extract the Mbps display value from a raw throughput string, formatted for
// display. Falls back to the sole numeric value for non-throughput metrics
// (e.g. pure CPS test cases) so their numbers are not dropped.
function mbpsDisplay(raw) {
  const v = extractMbpsValue(raw);
  if (v === null) return null;
  return Number.isInteger(v) ? String(v) : String(v);
}

// Produce a shorter, display-friendly test-case label without altering the
// underlying data key (used for lookups/PR mapping). Only trims the verbose
// UDP/IPSec throughput descriptions; other cases are returned unchanged.
//   "IPSec(site-2-site) UDP throughput with IKEv2,PSK,AES-GCM256- Packet size IMIX(ratio ...)"
//     -> "IPSec(site-2-site) - IKEv2,PSK,AES-GCM256 - IMIX"
//   "Firewall UDP throughput- Packet size 64bytes" -> "Firewall UDP - 64bytes"
function shortenTestCase(name) {
  if (!name) return name;
  const s = String(name).trim();

  // Packet-size descriptor (word after "Packet size"), dropping "(ratio ...)".
  const sizeMatch = s.match(/packet size\s*([^(]+?)(?:\s*\(|$)/i);
  const size = sizeMatch ? sizeMatch[1].trim() : '';

  const ipsec = s.match(/^(ipsec\(site-2-site\))\s+udp throughput with\s+(.*?)-\s*packet size/i);
  if (ipsec) {
    return `${ipsec[1]} - ${ipsec[2].trim()} - ${size || 'IMIX'}`;
  }

  const udp = s.match(/^(firewall udp|packet mode udp)\s+throughput-\s*packet size/i);
  if (udp) {
    const prefix = /packet mode/i.test(udp[1]) ? 'Packet mode UDP' : 'Firewall UDP';
    return `${prefix} - ${size}`;
  }

  return s;
}

// Split a release name into wrapped display lines: the base image on the first
// line and the build timestamp on the second (dropping the trailing "-EVO").
//   "25.4X300-D10-202606040154.0-EVO" -> ["25.4X300-D10", "202606040154.0"]
//   "25.4X300-D10.2-EVO"              -> ["25.4X300-D10.2"]
function releaseLines(release) {
  const s = String(release || '').replace(/-EVO$/i, '');
  const m = s.match(/^(.*?)-(\d{12}[\d.]*)$/);
  if (m) return [m[1], m[2]];
  return [s];
}

// Escape a string for safe inclusion in generated clipboard HTML.
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Write rich HTML (with a plain-text fallback) to the clipboard so it can be
// pasted as a formatted table into Outlook/Word.
// Copies rich HTML to the clipboard so it pastes as a formatted table in
// Outlook/Word. Uses the async Clipboard API in secure contexts (HTTPS or
// localhost) and falls back to a selection + execCommand approach for plain
// HTTP servers, where navigator.clipboard is unavailable.
function legacyCopyHtml(html) {
  const container = document.createElement('div');
  container.setAttribute('contenteditable', 'true');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.opacity = '0';
  container.innerHTML = html;
  document.body.appendChild(container);

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(container);
  selection.removeAllRanges();
  selection.addRange(range);

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  selection.removeAllRanges();
  document.body.removeChild(container);
  return ok;
}

async function writeHtmlToClipboard(html) {
  if (window.isSecureContext && navigator.clipboard && window.ClipboardItem) {
    try {
      const blob = new Blob([html], { type: 'text/html' });
      const text = new Blob([html.replace(/<[^>]+>/g, '')], { type: 'text/plain' });
      await navigator.clipboard.write([new window.ClipboardItem({ 'text/html': blob, 'text/plain': text })]);
      return;
    } catch {
      // Fall through to the legacy path below.
    }
  }
  if (legacyCopyHtml(html)) return;
  throw new Error('Clipboard copy failed');
}

const ReleaseMatrixTable = forwardRef(({ device, label, releases }, ref) => {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const toggleCategory = (cat) => setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }));

  const matrix = useMemo(() => {
    // Keep only releases that actually report data for this device.
    const cols = releases.filter(r => !r.devices?.length || r.devices.includes(device));

    // Build an ordered list of categories -> test cases from the union of all
    // releases, preserving first-seen order (priority release first).
    const categoryOrder = [];
    const catMap = new Map(); // category -> { tests: string[], seen: Set }
    for (const rel of cols) {
      for (const section of rel.merged) {
        if (!catMap.has(section.category)) {
          catMap.set(section.category, { tests: [], seen: new Set() });
          categoryOrder.push(section.category);
        }
        const entry = catMap.get(section.category);
        for (const t of section.tests) {
          if (!entry.seen.has(t.testCase)) {
            entry.seen.add(t.testCase);
            entry.tests.push(t.testCase);
          }
        }
      }
    }

    // Per-release lookup: testCase -> device data ({ throughput, comments, ... }).
    const lookups = cols.map(rel => {
      const map = new Map();
      for (const section of rel.merged) {
        for (const t of section.tests) {
          map.set(t.testCase, t[device] || null);
        }
      }
      return map;
    });

    // Baseline lookup: the D10.2 priority release for this device.
    const priorityIndex = cols.findIndex(c => c.release === PRIORITY_SANITY_RELEASE);
    const baselineLookup = priorityIndex >= 0 ? lookups[priorityIndex] : null;

    return { cols, categoryOrder, catMap, lookups, baselineLookup };
  }, [releases, device]);

  // Baseline = D10.2 throughput normalized to 90% CPU, in Mbps. Scaling
  // categories are never CPU-normalized.
  const baselineFor = (testCase, category) => {
    const data = matrix.baselineLookup?.get(testCase);
    if (!data?.throughput) return null;
    const norm = isScalingCategory(category)
      ? { value: data.throughput }
      : normalizeTo90Cpu(data.throughput, data.cpu);
    return mbpsDisplay(norm.value);
  };

  const buildOutlookHtml = () => {
    if (matrix.cols.length === 0) return '';
    const colCount = matrix.cols.length + 2;
    const border = 'border:1px solid #4a5f1e;padding:5px 9px;';
    const baselineHeadBg = 'background:#c5db8f;white-space:nowrap;';
    const baselineCellStyle = `${border}text-align:center;background:#eef3e0;color:#3f5417;font-weight:bold;white-space:nowrap;`;
    // Outlook/Word drops <caption>, so emit the title + notes as block-level
    // <div>s directly before the table instead.
    let html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:10pt;">`;
    html += `<div style="font-weight:bold;text-decoration:underline;">${escapeHtml(label)}</div>`;
    html += `<div style="font-style:italic;font-size:9pt;">All values in Mbps , except CPS cases</div>`;
    html += `<div style="font-style:italic;font-size:9pt;">Values in <span style="color:#DC2626;font-weight:bold;">red</span> have a <span style="color:#DC2626;font-weight:bold;">PR</span> associated with them</div>`;
    html += `</div>`;
    html += `<table style="border-collapse:collapse;table-layout:fixed;font-family:Calibri,Arial,sans-serif;font-size:10pt;">`;
    html += `<colgroup><col style="width:280px;"><col style="width:90px;">${matrix.cols.map(() => '<col style="width:150px;">').join('')}</colgroup>`;
    let headHtml = `<th style="${border}text-align:left;">Test Case</th>`;
    headHtml += `<th style="${border}text-align:left;${baselineHeadBg}">Baseline</th>`;
    for (const c of matrix.cols) {
      headHtml += `<th style="${border}text-align:left;">${releaseLines(c.release).map(escapeHtml).join('<br>')}</th>`;
    }
    html += `<thead><tr style="background:#84a63a;color:#000;">${headHtml}</tr></thead><tbody>`;
    for (const category of matrix.categoryOrder) {
      html += `<tr style="background:#eef3e0;font-weight:bold;"><td colspan="${colCount}" style="${border}">${escapeHtml(category)}</td></tr>`;
      for (const testCase of matrix.catMap.get(category).tests) {
        html += `<tr><td style="${border}">${escapeHtml(shortenTestCase(testCase))}</td>`;
        const base = baselineFor(testCase, category);
        html += `<td style="${baselineCellStyle}">${escapeHtml(base ?? '-')}</td>`;
        for (const lookup of matrix.lookups) {
          const data = lookup.get(testCase);
          const val = data?.throughput ? mbpsDisplay(data.throughput) : null;
          const pr = resolvePR(testCase, data?.comments);
          const style = pr ? `${border}text-align:center;color:#DC2626;font-weight:bold;` : `${border}text-align:center;`;
          const cell = val ?? '-';
          html += `<td style="${style}">${escapeHtml(cell)}</td>`;
        }
        html += `</tr>`;
      }
    }
    html += `</tbody></table>`;
    return html;
  };

  useImperativeHandle(ref, () => ({ getOutlookHtml: buildOutlookHtml }));

  if (matrix.cols.length === 0) return null;

  const copyToOutlook = async () => {
    try {
      await writeHtmlToClipboard(buildOutlookHtml());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-6 rounded-2xl border border-juniper/30 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-gradient-to-r from-juniper to-juniper-dark flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h3 className="text-sm font-bold text-white tracking-wide">{label} - All Releases</h3>
          <span className="px-2 py-0.5 rounded-md bg-white/20 text-white text-[10px] font-bold uppercase tracking-widest">Mbps · CPS · TPS</span>
        </div>
        <button
          onClick={copyToOutlook}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/90 text-juniper-darker text-[11px] font-bold uppercase tracking-wider shadow-sm hover:bg-white transition-colors"
          title="Copy this table as a formatted table you can paste into Outlook"
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              Copied
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              Copy to Outlook
            </>
          )}
        </button>
      </div>
      <div className="px-5 py-1.5 bg-juniper-light/40 border-b border-juniper/20 text-[11px] text-slate-500">
        All values in <span className="font-semibold text-juniper-dark">Mbps</span>, except <span className="font-semibold text-juniper-dark">CPS</span> cases. Values in <span className="font-bold text-red-600">red</span> have a PR associated with them (click to open in GNATS).
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-juniper-light/60">
              <th className="sticky left-0 z-20 bg-juniper-light/60 text-left px-6 py-2.5 font-semibold text-juniper-dark border-b border-juniper/30 w-64 min-w-[16rem]">
                Test Case
              </th>
              <th className="sticky left-64 z-20 bg-lime-100/80 text-center px-4 py-2.5 font-semibold text-juniper-darker border-b border-l border-juniper/30 min-w-[8rem]">
                Baseline
              </th>
              {matrix.cols.map(rel => (
                <th key={rel.release} className="text-center px-5 py-2.5 font-jetbrains font-semibold text-juniper-dark border-b border-l border-juniper/30 min-w-[9rem] leading-tight">
                  {releaseLines(rel.release).map((line, i) => (
                    <div key={i} className={i === 0 ? '' : 'text-[11px] font-normal text-slate-500'}>{line}</div>
                  ))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.categoryOrder.map(category => {
              const isExpanded = !collapsed[category];
              return (
              <Fragment key={category}>
                <tr onClick={() => toggleCategory(category)} className="cursor-pointer select-none hover:bg-slate-100/80">
                  <td colSpan={matrix.cols.length + 2} className="px-6 py-3 bg-slate-50/80 border-l-[3px] border-l-slate-300 text-sm font-bold tracking-tight text-slate-800 border-b border-juniper/30">
                    <div className="flex items-center gap-3">
                      <span className={`w-5 h-5 rounded flex items-center justify-center bg-white border border-juniper/40 shadow-sm transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`}>
                        <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
                      </span>
                      <span>{category}</span>
                    </div>
                  </td>
                </tr>
                {isExpanded && matrix.catMap.get(category).tests.map((testCase) => {
                  const baseline = baselineFor(testCase, category);
                  return (
                    <tr key={testCase} className="border-b border-juniper/30 row-hover">
                      <td className="sticky left-0 z-10 bg-white px-6 py-3 border-b border-juniper/30 align-top">
                        <span className="text-[13px] font-medium text-slate-700 leading-snug" title={testCase}>{shortenTestCase(testCase)}</span>
                      </td>
                      <td className="sticky left-64 z-10 bg-lime-50/70 px-4 py-3 border-b border-l border-juniper/30 align-top text-center font-jetbrains text-[13px] font-semibold text-juniper-darker" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {baseline ?? <span className="text-slate-300 select-none">-</span>}
                      </td>
                      {matrix.lookups.map((lookup, cIdx) => {
                        const data = lookup.get(testCase);
                        const val = data?.throughput ? mbpsDisplay(data.throughput) : null;
                        const pr = resolvePR(testCase, data?.comments);
                        return (
                          <td key={matrix.cols[cIdx].release} className="px-5 py-3 border-b border-l border-juniper/30 align-top text-center font-jetbrains text-[13px] font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {val === null ? (
                              <span className="text-slate-300 select-none">-</span>
                            ) : pr ? (
                              <a
                                href={`https://gnats.juniper.net/web/default/${pr}#description_tab`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-bold text-red-600 hover:underline"
                                title={`Blocked by PR ${pr} — open in GNATS`}
                              >
                                {val}
                              </a>
                            ) : (
                              <span className="text-slate-800">{val}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
ReleaseMatrixTable.displayName = 'ReleaseMatrixTable';

// ─── PR Status Table ─────────────────────────────────────────
// Lists every PR referenced across all releases/devices, with description and
// current status pulled from GNATS (via the backend proxy). Degrades
// gracefully to just the PR number + affected test cases if GNATS is
// unreachable or not yet configured.
const STATUS_STYLES = {
  open: 'bg-red-50 text-red-700 border-red-200',
  analyzed: 'bg-amber-50 text-amber-700 border-amber-200',
  'in-progress': 'bg-blue-50 text-blue-700 border-blue-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed: 'bg-slate-100 text-slate-600 border-slate-200',
};

function statusStyle(status) {
  const key = String(status || '').toLowerCase().replace(/\s+/g, '-');
  return STATUS_STYLES[key] || 'bg-slate-100 text-slate-500 border-slate-200';
}

const PRStatusTable = forwardRef(({ releases }, ref) => {
  const [details, setDetails] = useState(PR_DETAILS_FALLBACK); // pr -> { description, status }
  const [copied, setCopied] = useState(false);

  // Collect unique PRs referenced anywhere, with the test cases they block.
  const prList = useMemo(() => {
    const map = new Map(); // pr -> Set(testCase)
    for (const rel of releases) {
      for (const section of rel.merged || []) {
        for (const t of section.tests || []) {
          // One PR per test case: a PR mentioned in either device's comment
          // takes precedence; only fall back to the hardcoded mapping if none.
          const commentPR = getPRFromComment(t.srx400?.comments) || getPRFromComment(t.srx440?.comments);
          const pr = commentPR || getPR(t.testCase);
          if (pr) {
            if (!map.has(pr)) map.set(pr, new Set());
            map.get(pr).add(t.testCase);
          }
        }
      }
    }
    return [...map.entries()]
      .map(([pr, tcs]) => ({ pr, testCases: [...tcs] }))
      .sort((a, b) => a.pr.localeCompare(b.pr));
  }, [releases]);

  // Fetch descriptions/statuses from the GNATS proxy.
  useEffect(() => {
    if (prList.length === 0) return;
    const prs = prList.map(p => p.pr).join(',');
    fetch(`${API_BASE}/api/pr-status?prs=${encodeURIComponent(prs)}`)
      .then(r => (r.ok ? r.json() : {}))
      .then(d => setDetails({ ...PR_DETAILS_FALLBACK, ...(d && typeof d === 'object' ? d : {}) }))
      .catch(() => setDetails(PR_DETAILS_FALLBACK));
  }, [prList]);

  const buildOutlookHtml = () => {
    if (prList.length === 0) return '';
    const border = 'border:1px solid #b45309;padding:5px 9px;';
    const nowrap = 'white-space:nowrap;';
    const cols = [
      { h: 'PR', w: '90px', nowrap: false },
      { h: 'Description', w: '520px', nowrap: false },
      { h: 'Status', w: '90px', nowrap: true },
      { h: 'Responsible', w: '130px', nowrap: true },
    ];
    let html = `<table style="border-collapse:collapse;table-layout:fixed;font-family:Calibri,Arial,sans-serif;font-size:10pt;">`;
    html += `<colgroup>${cols.map(c => `<col style="width:${c.w};">`).join('')}</colgroup>`;
    html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:10pt;font-weight:bold;text-decoration:underline;">Open PRs</div>` + html;
    html += `<thead><tr style="background:#c00000;color:#fff;">`;
    for (const c of cols) {
      html += `<th style="${border}text-align:left;${c.nowrap ? nowrap : ''}">${escapeHtml(c.h)}</th>`;
    }
    html += `</tr></thead><tbody>`;
    for (const { pr } of prList) {
      const info = details[pr] || {};
      const prUrl = `https://gnats.juniper.net/web/default/${encodeURIComponent(pr)}#description_tab`;
      html += `<tr>`;
      html += `<td style="${border}font-weight:bold;"><a href="${prUrl}" style="color:#0000FF;text-decoration:underline;font-weight:bold;">PR ${escapeHtml(pr)}</a></td>`;
      html += `<td style="${border}">${escapeHtml(info.description || '—')}</td>`;
      html += `<td style="${border}${nowrap}">${escapeHtml(info.status || 'Unknown')}</td>`;
      html += `<td style="${border}${nowrap}">${escapeHtml(info.responsible || '—')}</td>`;
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    return html;
  };

  useImperativeHandle(ref, () => ({ getOutlookHtml: buildOutlookHtml }));

  if (prList.length === 0) return null;

  const gnatsUrl = (pr) => `https://gnats.juniper.net/web/default/${pr}#description_tab`;

  const copyToOutlook = async () => {
    try {
      await writeHtmlToClipboard(buildOutlookHtml());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-6 rounded-2xl border border-red-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-gradient-to-r from-[#02838F] to-[#03a0ad] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h3 className="text-sm font-bold text-white tracking-wide">Open PRs</h3>
          <span className="px-2 py-0.5 rounded-md bg-white/20 text-white text-[10px] font-bold uppercase tracking-widest">{prList.length}</span>
        </div>
        <button
          onClick={copyToOutlook}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/90 text-[#02838F] text-[11px] font-bold uppercase tracking-wider shadow-sm hover:bg-white transition-colors"
          title="Copy this table as a formatted table you can paste into Outlook"
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              Copied
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              Copy to Outlook
            </>
          )}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-red-50/80">
              <th className="text-left px-5 py-2.5 font-semibold text-[#02838F] border-b border-red-200 w-28 min-w-[7rem]">PR</th>
              <th className="text-left px-5 py-2.5 font-semibold text-[#02838F] border-b border-l border-red-200 min-w-[18rem]">Description</th>
              <th className="text-left px-5 py-2.5 font-semibold text-[#02838F] border-b border-l border-red-200 w-32 min-w-[8rem]">Status</th>
              <th className="text-left px-5 py-2.5 font-semibold text-[#02838F] border-b border-l border-red-200 min-w-[16rem]">Responsible</th>
            </tr>
          </thead>
          <tbody>
            {prList.map(({ pr }) => {
              const info = details[pr] || {};
              return (
                <tr key={pr} className="border-b border-red-100 row-hover align-top">
                  <td className="px-5 py-3 border-b border-red-100 align-top">
                    <a href={gnatsUrl(pr)} target="_blank" rel="noopener noreferrer" className="font-bold text-red-600 hover:underline font-jetbrains" title={`Open PR ${pr} in GNATS`}>
                      PR {pr}
                    </a>
                  </td>
                  <td className="px-5 py-3 border-b border-l border-red-100 align-top text-slate-700 leading-snug">
                    {info.description || <span className="text-slate-400 italic">Fetching from GNATS…</span>}
                  </td>
                  <td className="px-5 py-3 border-b border-l border-red-100 align-top">
                    <span className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-bold uppercase tracking-wide ${statusStyle(info.status)}`}>
                      {info.status || 'Unknown'}
                    </span>
                  </td>
                  <td className="px-5 py-3 border-b border-l border-red-100 align-top text-[12px] text-slate-600 leading-snug">
                    {info.responsible || <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
PRStatusTable.displayName = 'PRStatusTable';

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
  const [srx400CpuOverride, setSrx400CpuOverride] = useState(null);
  const [srx440CpuOverride, setSrx440CpuOverride] = useState(null);
  const [changelogRefresh, setChangelogRefresh] = useState(0);
  const [ds1Releases, setDs1Releases] = useState([]);       // [{ release, merged }]
  const [selectedSanityRelease, setSelectedSanityRelease] = useState('');
  const [flashedCells, setFlashedCells] = useState(new Set());
  const [visitorCount, setVisitorCount] = useState(null);
  const [showReleaseHint, setShowReleaseHint] = useState(false);
  const srx400Ref = useRef(null);
  const srx440Ref = useRef(null);
  const prTableRef = useRef(null);
  const [allCopied, setAllCopied] = useState(false);

  const copyAllToOutlook = async () => {
    const parts = [srx400Ref, srx440Ref, prTableRef]
      .map(r => r.current?.getOutlookHtml?.())
      .filter(Boolean);
    if (parts.length === 0) return;
    try {
      await writeHtmlToClipboard(parts.join('<br/><br/>'));
      setAllCopied(true);
      setTimeout(() => setAllCopied(false), 2000);
    } catch {
      setAllCopied(false);
    }
  };
  const prevDataRef = useRef(null);

  const isSanity = activeView === 'sanity';
  const show3XX = isSanity && showCompare;
  const hasCpuOverride = srx400CpuOverride !== null || srx440CpuOverride !== null;
  const disableModeToggles = hasCpuOverride;
  const disableCpuAdjusters = isNormalized || isOptimized;

  const handleNormalizeToggle = () => {
    if (disableModeToggles) return;
    setIsNormalized(prev => !prev);
  };

  const handleOptimizedToggle = () => {
    if (disableModeToggles) return;
    setIsOptimized(prev => !prev);
  };

  const handleCpuOverrideChange = (platform, value) => {
    if (disableCpuAdjusters) return;
    const parsed = value === 'none' ? null : parseInt(value, 10);
    if (platform === 'srx400') {
      setSrx400CpuOverride(parsed);
      return;
    }
    setSrx440CpuOverride(parsed);
  };

  // Which devices the selected DS-1 release actually reports. A release may
  // carry data for only one device — in that case we render just that column
  // instead of showing the other device blank.
  const sanityDeviceKeys = useMemo(() => {
    if (isSanity && ds1Releases.length > 0 && selectedSanityRelease) {
      const block = ds1Releases.find(r => r.release === selectedSanityRelease);
      if (block?.devices?.length) return block.devices;
    }
    return ['srx400', 'srx440'];
  }, [isSanity, ds1Releases, selectedSanityRelease]);
  const show400 = sanityDeviceKeys.includes('srx400');
  const show440 = sanityDeviceKeys.includes('srx440');
  // Compare (3XX) and regression views always render both base columns.
  const render400 = !isSanity || show3XX || show400;
  const render440 = !isSanity || show3XX || show440;
  const sanityGrid = (show400 && show440) ? 'grid-cols-[5fr_3fr_3fr]' : 'grid-cols-[5fr_3fr]';
  const gridClass = show3XX
    ? 'grid-cols-[2.3fr_.75fr_1.4fr_1.4fr_repeat(5,1fr)]'
    : isSanity ? sanityGrid : 'grid-cols-[4fr_3fr_3fr_2fr]';

  // First-visit hint: glow the release selector until the user interacts with it.
  useEffect(() => {
    try {
      if (!localStorage.getItem('seenReleaseHint')) setShowReleaseHint(true);
    } catch { /* localStorage unavailable */ }
  }, []);

  const dismissReleaseHint = () => {
    if (!showReleaseHint) return;
    setShowReleaseHint(false);
    try { localStorage.setItem('seenReleaseHint', '1'); } catch { /* ignore */ }
  };

  // Show the effective CPU reference currently applied to displayed metrics.
  const capCpu = (cpuStr, overrideCpu = null) => {
    if (overrideCpu !== null) return `${overrideCpu}%`;
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
          // Release columns are ordered by build date, newest first. The date
          // comes from the embedded YYYYMMDDHHMM timestamp in the release name;
          // named builds without a timestamp use an explicit known date.
          const NAMED_RELEASE_DATES = { '25.4X300-D10.2-EVO': 202606140000 };
          const releaseTimestamp = (name) => {
            if (NAMED_RELEASE_DATES[name]) return NAMED_RELEASE_DATES[name];
            const m = String(name || '').match(/(\d{12})/);
            return m ? Number(m[1]) : 0;
          };
          const orderedDs1 = [...data.ds1].sort(
            (a, b) => releaseTimestamp(b.release) - releaseTimestamp(a.release)
          );
          setDs1Releases(orderedDs1);
          const defaultRel = orderedDs1.find(r => r.release === PRIORITY_SANITY_RELEASE) || orderedDs1[0];
          setSelectedSanityRelease(defaultRel.release);
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

    // Full Regression view: sort test cases within each section in
    // descending order of value (prefer Mbps, fall back to first numeric).
    if (activeView === 'regression') {
      const sortVal = (raw) => {
        const str = String(raw || '');
        const mbps = str.match(/([\d.]+)\s*mbps/i);
        if (mbps) return parseFloat(mbps[1]);
        const first = str.match(/[\d.]+/);
        return first ? parseFloat(first[0]) : -Infinity;
      };
      const rowVal = (t) => Math.max(sortVal(t.srx440?.throughput), sortVal(t.srx400?.throughput));
      data = data.map(section => ({
        ...section,
        tests: [...section.tests].sort((a, b) => rowVal(b) - rowVal(a)),
      }));
    }

    return data;
  }, [viewFilteredData, searchTerm, isOptimized, activeView]);

  const toggleGroup = (cat) => {
    setExpandedGroups(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const handleCellEnter = (e, cellId, metrics) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredCell({ id: cellId, x: e.clientX, y: rect.bottom, ...metrics });
  };

  const handleDiffEnter = (e, cellId, val400, val440) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const diff = calculatePercentageDiff(val400, val440);
    setHoveredDiff({ id: cellId, x: rect.left + rect.width / 2, y: rect.bottom, diff, val400, val440 });
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

            {/* Right — Toggle Switches + Full Regression CPU adjusters */}
            <div className="flex items-center gap-2">
            <div className="inline-flex items-center bg-white rounded-full p-1 shadow-lg shadow-juniper/20 border border-juniper/30 gap-1 overflow-visible">
            {/* Normalize CPU Toggle */}
            <div className="relative group/norm">
              <label
                className={`flex items-center gap-2 select-none px-4 py-2 rounded-full transition-all duration-300 ${disableModeToggles ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-50'}`}
                title={disableModeToggles ? 'Clear SRX CPU overrides to enable Normalize CPU' : undefined}
              >
              <div
                  onClick={handleNormalizeToggle}
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
              <label
                className={`flex items-center gap-2 select-none px-4 py-2 rounded-full transition-all duration-300 ${disableModeToggles ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-50'}`}
                title={disableModeToggles ? 'Clear SRX CPU overrides to enable Optimized View' : undefined}
              >
              <div
                  onClick={handleOptimizedToggle}
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
          <div className={`grid gap-0 px-0 py-2.5 bg-juniper border-b-2 border-juniper-dark items-center ${gridClass}`}>
            <div className="text-xs font-bold text-black uppercase tracking-[0.1em] px-6">Test Case</div>
            {show3XX && <div className="text-xs font-bold text-black uppercase tracking-[0.1em] px-3 border-l border-juniper-dark/40">Units</div>}
            {render400 && (
              <div className="flex flex-col gap-0.5 px-5 border-l border-juniper-dark/40">
                <span className="text-xs font-semibold text-black uppercase tracking-[0.1em]">SRX 400</span>
                <span className="font-jetbrains text-[11px] font-semibold text-black/60">{isSanity && selectedSanityRelease ? selectedSanityRelease : releases.srx400}</span>
              </div>
            )}
            {render440 && (
              <div className="flex flex-col gap-0.5 px-5 border-l border-juniper-dark/40">
                <span className="text-xs font-semibold text-black uppercase tracking-[0.1em]">SRX 440</span>
                <span className="font-jetbrains text-[11px] font-semibold text-black/60">{isSanity && selectedSanityRelease ? selectedSanityRelease : releases.srx440}</span>
              </div>
            )}
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

            {/* Regression-only CPU adjuster row aligned to table columns */}
            {activeView === 'regression' && (
              <div className={`grid gap-0 px-0 py-2 bg-slate-50 border-b border-juniper/25 items-center ${gridClass}`}>
                <div className="px-6 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                  CPU Target Adjusters
                </div>
                {render400 && (
                  <div className="px-5 border-l border-juniper/20">
                    <div className="inline-flex items-center gap-1.5 rounded-md border border-juniper/25 bg-juniper-light/40 px-2 py-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-juniper-darker">SRX 400 CPU</span>
                      <select
                        disabled={disableCpuAdjusters}
                        value={srx400CpuOverride === null ? 'none' : String(srx400CpuOverride)}
                        onChange={(e) => handleCpuOverrideChange('srx400', e.target.value)}
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${disableCpuAdjusters ? 'bg-slate-200 border-slate-300 text-slate-500 cursor-not-allowed' : 'bg-white border-juniper/30 text-slate-700'}`}
                        title={disableCpuAdjusters ? 'Turn off Normalize CPU and Optimized View to use SRX 400 CPU override' : 'Adjust SRX 400 throughput to selected CPU target'}
                      >
                        <option value="none">Clear/None</option>
                        <option value="60">60%</option>
                        <option value="65">65%</option>
                        <option value="70">70%</option>
                      </select>
                    </div>
                  </div>
                )}
                {render440 && (
                  <div className="px-5 border-l border-juniper/20">
                    <div className="inline-flex items-center gap-1.5 rounded-md border border-blue-200/80 bg-blue-50/70 px-2 py-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">SRX 440 CPU</span>
                      <select
                        disabled={disableCpuAdjusters}
                        value={srx440CpuOverride === null ? 'none' : String(srx440CpuOverride)}
                        onChange={(e) => handleCpuOverrideChange('srx440', e.target.value)}
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${disableCpuAdjusters ? 'bg-slate-200 border-slate-300 text-slate-500 cursor-not-allowed' : 'bg-white border-blue-200 text-slate-700'}`}
                        title={disableCpuAdjusters ? 'Turn off Normalize CPU and Optimized View to use SRX 440 CPU override' : 'Adjust SRX 440 throughput to selected CPU target'}
                      >
                        <option value="none">Clear/None</option>
                        <option value="70">70%</option>
                        <option value="75">75%</option>
                        <option value="80">80%</option>
                      </select>
                    </div>
                  </div>
                )}
                <div className="px-5 border-l border-juniper/20 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {disableCpuAdjusters ? 'Disable Normalize/Optimized to edit' : 'Set per-platform CPU targets'}
                </div>
              </div>
            )}

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
                            const branch = getBranchComparison(item.testCase);

                              // CPU transforms are disabled for scaling/capacity sections.
                              const canAdjustCpu = !isScalingCategory(section.category);
                              const shouldNormalize = isNormalized && canAdjustCpu;
                              const adjusted400 = canAdjustCpu && has400 && srx400CpuOverride !== null
                                ? normalizeToTargetCpu(item.srx400.throughput, item.srx400.cpu, srx400CpuOverride)
                                : null;
                              const adjusted440 = canAdjustCpu && has440 && srx440CpuOverride !== null
                                ? normalizeToTargetCpu(item.srx440.throughput, item.srx440.cpu, srx440CpuOverride)
                                : null;
                              const norm400 = adjusted400 || (shouldNormalize && has400
                                ? normalizeTo90Cpu(item.srx400.throughput, item.srx400.cpu)
                                : { value: item.srx400.throughput, wasNormalized: false });
                              const norm440 = adjusted440 || (shouldNormalize && has440
                                ? normalizeTo90Cpu(item.srx440.throughput, item.srx440.cpu)
                                : { value: item.srx440.throughput, wasNormalized: false });
                            const mbpsOnly = !!branch?.mbpsOnly;
                            const parsed400 = show3XX ? (mbpsOnly ? filterToMbps(parseCompareMetric(norm400.value, branch?.sourceMetric)) : parseCompareMetric(norm400.value, branch?.sourceMetric)) : null;
                            const parsed440 = show3XX ? (mbpsOnly ? filterToMbps(parseCompareMetric(norm440.value, branch?.sourceMetric)) : parseCompareMetric(norm440.value, branch?.sourceMetric)) : null;
                            const compareMetric = show3XX ? (parsed400?.rows?.length ? parsed400 : parsed440) : null;

                            return (
                              <motion.div
                                key={idx}
                                layout
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.35, delay: Math.min(idx * 0.03, 0.3), ease: 'easeOut' }}
                                className={`grid gap-0 px-0 py-3 items-center group/row row-hover relative ${gridClass} border-b border-juniper/30`}
                                style={{ fontVariantNumeric: 'tabular-nums' }}
                              >

                                {/* Test Case Name + Comparison Tooltip */}
                                <div 
                                  className="flex items-center px-6 relative cursor-default"
                                  onMouseEnter={(e) => !show3XX && (has400 || has440) && handleDiffEnter(e, `tc-${sIdx}-${idx}`, norm400.value, norm440.value)}
                                  onMouseLeave={() => setHoveredDiff(null)}
                                >
                                  <span className="text-[13px] font-medium text-slate-700 leading-snug">{item.testCase}</span>
                                  
                                  {!show3XX && (
                                    <DiffTooltip 
                                      position={hoveredDiff?.id === `tc-${sIdx}-${idx}` ? hoveredDiff : null}
                                      isVisible={hoveredDiff?.id === `tc-${sIdx}-${idx}`}
                                      data={hoveredDiff?.id === `tc-${sIdx}-${idx}` ? hoveredDiff : null}
                                    />
                                  )}
                                </div>

                                {show3XX && (
                                  <div className="px-3 border-l border-juniper/30 flex items-stretch">
                                    <div className="w-full">
                                      {compareMetric ? renderCompareMetricRows(compareMetric, true) : <span className="text-[10px] text-slate-300 select-none">-</span>}
                                    </div>
                                  </div>
                                )}

                                {render400 && (
                                <div
                                  className={`flex flex-col justify-center gap-1 px-5 border-l border-juniper/30 ${flashedCells.has(`400-${item.testCase}`) ? 'diff-flash' : ''}`}
                                    onMouseEnter={(e) => !show3XX && has400 && handleCellEnter(e, `400-${sIdx}-${idx}`, { cpu: capCpu(item.srx400.cpu, canAdjustCpu ? srx400CpuOverride : null), shm: item.srx400.shm })}
                                  onMouseLeave={() => setHoveredCell(null)}
                                >
                                  {(() => {
                                    return has400 ? (
                                      show3XX && parsed400?.rows?.length ? (
                                        <div
                                          className={`font-jetbrains text-[13px] font-semibold cursor-pointer transition-colors leading-tight py-0.5 ${
                                            norm400.wasNormalized ? 'text-amber-700 hover:text-amber-800' : 'text-slate-800 hover:text-juniper-dark'
                                          }`}
                                          onClick={() => setHistoryModal({ open: true, testCase: item.testCase, platform: 'SRX400', category: section.category, value: item.srx400.throughput })}
                                            title={norm400.wasNormalized ? (adjusted400 ? `Raw: ${item.srx400.throughput} @ ${item.srx400.cpu} CPU → Adjusted to ${srx400CpuOverride}% CPU` : `Raw: ${item.srx400.throughput} @ ${item.srx400.cpu} CPU → Normalized to 90%`) : undefined}
                                        >
                                          {renderCompareMetricRows(parsed400, false)}
                                        </div>
                                      ) : (
                                        <span
                                          className={`font-jetbrains text-[13px] font-semibold cursor-pointer hover:underline underline-offset-2 transition-colors ${
                                            norm400.wasNormalized ? 'text-amber-700 hover:text-amber-800' : 'text-slate-800 hover:text-juniper-dark'
                                          }`}
                                          onClick={() => setHistoryModal({ open: true, testCase: item.testCase, platform: 'SRX400', category: section.category, value: item.srx400.throughput })}
                                            title={norm400.wasNormalized ? (adjusted400 ? `Raw: ${item.srx400.throughput} @ ${item.srx400.cpu} CPU → Adjusted to ${srx400CpuOverride}% CPU` : `Raw: ${item.srx400.throughput} @ ${item.srx400.cpu} CPU → Normalized to 90%`) : undefined}
                                        >
                                          {norm400.wasNormalized && <span className="text-amber-500 mr-1">⚡</span>}
                                          <AnimatedMetric value={norm400.value} />
                                        </span>
                                      )
                                    ) : (
                                      <span className="font-jetbrains text-[13px] text-slate-300 select-none">-</span>
                                    );
                                  })()}
                                  {isSanity && <CommentWithPR comment={item.srx400.comments || comments} testCase={item.testCase} prOnly />}
                                  {!show3XX && (
                                    <MetricsTooltip
                                      position={hoveredCell?.id === `400-${sIdx}-${idx}` ? hoveredCell : null}
                                      isVisible={hoveredCell?.id === `400-${sIdx}-${idx}`}
                                      data={hoveredCell?.id === `400-${sIdx}-${idx}` ? hoveredCell : null}
                                    />
                                  )}
                                </div>
                                )}

                                {render440 && (
                                <div
                                  className={`flex flex-col justify-center gap-1 px-5 border-l border-juniper/30 ${flashedCells.has(`440-${item.testCase}`) ? 'diff-flash' : ''}`}
                                    onMouseEnter={(e) => !show3XX && has440 && handleCellEnter(e, `440-${sIdx}-${idx}`, { cpu: capCpu(item.srx440.cpu, canAdjustCpu ? srx440CpuOverride : null), shm: item.srx440.shm })}
                                  onMouseLeave={() => setHoveredCell(null)}
                                >
                                  {(() => {
                                    return has440 ? (
                                      show3XX && parsed440?.rows?.length ? (
                                        <div
                                          className={`font-jetbrains text-[13px] font-semibold cursor-pointer transition-colors leading-tight py-0.5 ${
                                            norm440.wasNormalized ? 'text-amber-700 hover:text-amber-800' : 'text-slate-800 hover:text-blue-600'
                                          }`}
                                          onClick={() => setHistoryModal({ open: true, testCase: item.testCase, platform: 'SRX440', category: section.category, value: item.srx440.throughput })}
                                            title={norm440.wasNormalized ? (adjusted440 ? `Raw: ${item.srx440.throughput} @ ${item.srx440.cpu} CPU → Adjusted to ${srx440CpuOverride}% CPU` : `Raw: ${item.srx440.throughput} @ ${item.srx440.cpu} CPU → Normalized to 90%`) : undefined}
                                        >
                                          {renderCompareMetricRows(parsed440, false)}
                                        </div>
                                      ) : (
                                        <span
                                          className={`font-jetbrains text-[13px] font-semibold cursor-pointer hover:underline underline-offset-2 transition-colors ${
                                            norm440.wasNormalized ? 'text-amber-700 hover:text-amber-800' : 'text-slate-800 hover:text-blue-600'
                                          }`}
                                          onClick={() => setHistoryModal({ open: true, testCase: item.testCase, platform: 'SRX440', category: section.category, value: item.srx440.throughput })}
                                            title={norm440.wasNormalized ? (adjusted440 ? `Raw: ${item.srx440.throughput} @ ${item.srx440.cpu} CPU → Adjusted to ${srx440CpuOverride}% CPU` : `Raw: ${item.srx440.throughput} @ ${item.srx440.cpu} CPU → Normalized to 90%`) : undefined}
                                        >
                                          {norm440.wasNormalized && <span className="text-amber-500 mr-1">⚡</span>}
                                          <AnimatedMetric value={norm440.value} />
                                        </span>
                                      )
                                    ) : (
                                      <span className="font-jetbrains text-[13px] text-slate-300 select-none">-</span>
                                    );
                                  })()}
                                  {isSanity && <CommentWithPR comment={item.srx440.comments || comments} testCase={item.testCase} prOnly />}
                                  {!show3XX && (
                                    <MetricsTooltip
                                      position={hoveredCell?.id === `440-${sIdx}-${idx}` ? hoveredCell : null}
                                      isVisible={hoveredCell?.id === `440-${sIdx}-${idx}`}
                                      data={hoveredCell?.id === `440-${sIdx}-${idx}` ? hoveredCell : null}
                                    />
                                  )}
                                </div>
                                )}

                                {/* Last columns: Branch 3XX data OR Compare button OR Comments */}
                                {show3XX ? (
                                  <>
                                    {BRANCH_DEVICES.map(dev => {
                                      const val = branch?.values?.[dev] || null;
                                      const parsedValue = mbpsOnly ? filterToMbps(parseCompareMetric(val, branch?.sourceMetric, true)) : parseCompareMetric(val, branch?.sourceMetric, true);
                                      return (
                                        <div 
                                          key={dev} 
                                          className="px-4 border-l border-juniper/30 flex items-center"
                                        >
                                          {val ? (
                                            <div className="font-jetbrains text-[13px] font-semibold text-slate-700 leading-tight py-0.5">
                                              {parsedValue?.rows?.length ? (
                                                renderCompareMetricRows(parsedValue, false)
                                              ) : (
                                                <span className="whitespace-nowrap">{val}</span>
                                              )}
                                            </div>
                                          ) : (
                                            <span className="font-jetbrains text-xs text-slate-300 select-none">-</span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </>
                                ) : !isSanity ? (
                                  <div className="px-5 border-l border-juniper/30">
                                    {comments ? (
                                      <CommentWithPR comment={comments} testCase={item.testCase} />
                                    ) : (
                                      <span className="font-jetbrains text-xs text-slate-300 select-none">-</span>
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

        {/* ── All-Releases Matrix Tables (Daily Sanity only) ── */}
        {isSanity && ds1Releases.length > 0 && (
          <div className="mt-2 space-y-3">
            <div className="flex justify-end">
              <button
                onClick={copyAllToOutlook}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-[#02838F] to-[#03a0ad] text-white text-[11px] font-bold uppercase tracking-wider shadow-sm hover:brightness-110 transition"
                title="Copy the full report (SRX 400, SRX 440 and Open PRs) for pasting into Outlook"
              >
                {allCopied ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                    Report Copied
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" /><path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.44A1.5 1.5 0 008.378 6H4.5z" /></svg>
                    Copy Full Report
                  </>
                )}
              </button>
            </div>
            <ReleaseMatrixTable ref={srx400Ref} device="srx400" label="SRX 400" releases={ds1Releases} />
            <ReleaseMatrixTable ref={srx440Ref} device="srx440" label="SRX 440" releases={ds1Releases} />
            <PRStatusTable ref={prTableRef} releases={ds1Releases.filter(r => r.release === selectedSanityRelease)} />
          </div>
        )}
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

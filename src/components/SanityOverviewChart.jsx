import React, { useMemo } from 'react';
import { extractMbpsValue } from '../utils/normalize';

// ─── PR detection (mirror of dashboard/public-report logic) ───
const PR_LINKS = [
  {
    match: (tc) => /^ipsec\(site-2-site\)\s+udp throughput with.*aes-gcm256/i.test(tc),
    pr: '1940446',
  },
];

function getPRFromComment(comment) {
  if (!comment) return null;
  const m = String(comment).match(/PR[:\s]*(\d{6,})/i);
  return m ? m[1] : null;
}

/**
 * Returns a PR number for a test case if it is blocked, else null.
 * A test with a PR should be excluded from the performance chart.
 */
function resolvePR(testCaseName, comment) {
  if (getPRFromComment(comment)) return getPRFromComment(comment);
  const entry = PR_LINKS.find(p => p.match(testCaseName));
  return entry ? entry.pr : null;
}

/**
 * Determines if a section category is a CPS/TPS metric (vs. throughput/Mbps).
 */
function isCpsCategory(category) {
  if (!category) return false;
  const lc = category.toLowerCase();
  return (
    lc.includes('cps performance') ||
    lc.includes('tps performance') ||
    (lc.startsWith('cps') && !lc.includes('throughput'))
  );
}

/**
 * Extracts the CPS or TPS numeric value from a throughput string.
 * e.g. "1700 CPS / 940 Mbps" → 1700
 *      "28009" → 28009
 */
function extractCpsValue(str) {
  if (!str || str.trim() === '' || str.trim() === '—' || str.trim() === '-') return null;

  if (/cps|tps/i.test(str)) {
    const parts = str.split('/');
    for (const part of parts) {
      if (/cps|tps/i.test(part)) {
        const m = part.match(/([\d.]+)/);
        return m ? parseFloat(m[1]) : null;
      }
    }
  }

  const m = str.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Shortens a test case name for chart X-axis labels.
 */
function shortenName(name) {
  if (!name) return '';
  return name
    .replace(/throughput/gi, 'Thru')
    .replace(/Firewall\s*/gi, 'FW ')
    .replace(/Packet\s*size\s*/gi, '')
    .replace(/\s*-\s*/g, ' ')
    .replace(/\(ratio[^)]*\)/gi, '')
    .replace(/\(site-2-site\)/gi, 'S2S')
    .replace(/IPSec/gi, 'IPSec')
    .replace(/Source NAT44/gi, 'SNAT44')
    .replace(/Distributed Sessions Throughput/gi, 'Dist Sess')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/**
 * Formats large numbers for axis ticks and bar value labels.
 */
function formatTick(val) {
  if (Number.isInteger(val)) return val.toString();
  return val.toFixed(1);
}

/**
 * Compute nice round tick values for an axis.
 */
function computeTicks(maxVal, count = 5) {
  if (maxVal <= 0) return [0];
  const rawStep = maxVal / (count - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = Math.ceil(rawStep / magnitude) * magnitude;
  const ticks = [];
  for (let i = 0; i < count; i++) {
    ticks.push(step * i);
  }
  return ticks;
}

/**
 * SanityOverviewChart — Vertical grouped bar chart with dual Y-axes.
 *
 * Left Y-Axis:  Throughput (Mbps) — for throughput test cases.
 * Right Y-Axis: Connections (CPS / TPS) — for connection/session test cases.
 *
 * Green bars = SRX 400, Blue bars = SRX 440.
 * Axis binding is determined by the section category.
 */
const SanityOverviewChart = ({ displayData }) => {
  const chartData = useMemo(() => {
    const rows = [];
    for (const section of displayData) {
      const isCps = isCpsCategory(section.category);
      for (const test of section.tests) {
        // Skip tests that are blocked by a PR — they should not appear in the chart.
        if (resolvePR(test.testCase, test.srx400.comments || test.srx440.comments)) {
          continue;
        }
        const v400 = isCps
          ? extractCpsValue(test.srx400.throughput)
          : extractMbpsValue(test.srx400.throughput);
        const v440 = isCps
          ? extractCpsValue(test.srx440.throughput)
          : extractMbpsValue(test.srx440.throughput);

        if (v400 != null || v440 != null) {
          rows.push({
            name: shortenName(test.testCase),
            fullName: test.testCase,
            category: section.category,
            isCps,
            v400: v400 || 0,
            v440: v440 || 0,
            label400: test.srx400.throughput || '—',
            label440: test.srx440.throughput || '—',
          });
        }
      }
    }
    return rows;
  }, [displayData]);

  if (chartData.length === 0) return null;

  // Separate max values per axis type
  const mbpsRows = chartData.filter(d => !d.isCps);
  const cpsRows = chartData.filter(d => d.isCps);

  const rawMaxMbps = mbpsRows.length > 0 ? Math.max(...mbpsRows.map(d => Math.max(d.v400, d.v440))) : 0;
  const rawMaxCps = cpsRows.length > 0 ? Math.max(...cpsRows.map(d => Math.max(d.v400, d.v440))) : 0;

  const mbpsTicks = computeTicks(rawMaxMbps);
  const cpsTicks = computeTicks(rawMaxCps);
  const maxMbps = mbpsTicks[mbpsTicks.length - 1] || 1;
  const maxCps = cpsTicks[cpsTicks.length - 1] || 1;

  // Chart dimensions
  const chartW = 960;
  const chartH = 500;
  const margin = { top: 55, right: 90, bottom: 140, left: 90 };
  const plotW = chartW - margin.left - margin.right;
  const plotH = chartH - margin.top - margin.bottom;

  // X positioning
  const groupW = plotW / chartData.length;
  const barW = Math.min((groupW - 10) / 2, 34);
  const barGap = 4;

  // Y scaling
  const yMbps = (val) => plotH - (val / maxMbps) * plotH;
  const yCps = (val) => plotH - (val / maxCps) * plotH;

  return (
    <div className="animate-chart-enter rounded-2xl shadow-xl border border-juniper/15 overflow-hidden bg-[#f7faf4]">
      <div className="h-1 w-full bg-gradient-to-r from-juniper via-juniper-dark to-blue-500" />

      {/* Header */}
      <div className="px-6 py-4 border-b border-juniper/15 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <svg className="w-4.5 h-4.5 text-juniper-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Performance Overview
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">Daily Sanity — SRX 400 vs SRX 440 · Dual-Axis Scale</p>
        </div>
        <div className="flex items-center gap-4 text-xs font-bold flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded" style={{ background: 'linear-gradient(135deg, #85B135, #6C912A)' }} />
            <span className="text-slate-500">SRX 400</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded" style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }} />
            <span className="text-slate-500">SRX 440</span>
          </span>
          <span className="text-slate-300">|</span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-slate-400 font-medium">Mbps (Left Axis)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-slate-400 font-medium">CPS / TPS (Right Axis)</span>
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="px-4 py-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${chartW} ${chartH}`}
          className="w-full"
          style={{ minWidth: '700px' }}
        >
          {/* ── Left Y-Axis: Throughput (Mbps) ── */}
          <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotH} stroke="#cbd5e1" strokeWidth="1" />
          {mbpsTicks.map((tick, i) => {
            const y = margin.top + yMbps(tick);
            return (
              <g key={`mbps-${i}`}>
                <line x1={margin.left - 4} y1={y} x2={margin.left} y2={y} stroke="#94a3b8" strokeWidth="1" />
                <line x1={margin.left} y1={y} x2={margin.left + plotW} y2={y} stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray="3,3" />
                <text x={margin.left - 8} y={y} fontSize="9" fill="#64748b" textAnchor="end" dominantBaseline="middle" fontFamily="JetBrains Mono, monospace">
                  {formatTick(tick)}
                </text>
              </g>
            );
          })}
          <text
            x={18}
            y={margin.top + plotH / 2}
            fontSize="11"
            fill="#16a34a"
            fontWeight="700"
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(-90, 18, ${margin.top + plotH / 2})`}
          >
            Throughput (Mbps)
          </text>

          {/* ── Right Y-Axis: Connections (CPS / TPS) ── */}
          <line x1={margin.left + plotW} y1={margin.top} x2={margin.left + plotW} y2={margin.top + plotH} stroke="#cbd5e1" strokeWidth="1" />
          {cpsTicks.map((tick, i) => {
            const y = margin.top + yCps(tick);
            return (
              <g key={`cps-${i}`}>
                <line x1={margin.left + plotW} y1={y} x2={margin.left + plotW + 4} y2={y} stroke="#94a3b8" strokeWidth="1" />
                <text x={margin.left + plotW + 8} y={y} fontSize="9" fill="#b45309" textAnchor="start" dominantBaseline="middle" fontFamily="JetBrains Mono, monospace">
                  {formatTick(tick)}
                </text>
              </g>
            );
          })}
          <text
            x={chartW - 18}
            y={margin.top + plotH / 2}
            fontSize="11"
            fill="#b45309"
            fontWeight="700"
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(90, ${chartW - 18}, ${margin.top + plotH / 2})`}
          >
            Connections (CPS / TPS)
          </text>

          {/* ── X-Axis baseline ── */}
          <line x1={margin.left} y1={margin.top + plotH} x2={margin.left + plotW} y2={margin.top + plotH} stroke="#cbd5e1" strokeWidth="1" />

          {/* ── Bars ── */}
          {chartData.map((d, i) => {
            const yScale = d.isCps ? yCps : yMbps;
            const groupX = margin.left + i * groupW;
            const centerX = groupX + groupW / 2;
            const x400 = centerX - barW - barGap / 2;
            const x440 = centerX + barGap / 2;

            const h400 = Math.max(plotH - yScale(d.v400), 0);
            const h440 = Math.max(plotH - yScale(d.v440), 0);
            const y400 = margin.top + plotH - h400;
            const y440 = margin.top + plotH - h440;

            const delay400 = `${i * 0.15 + 0.2}s`;
            const delay440 = `${i * 0.15 + 0.28}s`;

            return (
              <g key={i}>
                {/* Hover background */}
                <rect
                  x={groupX} y={margin.top} width={groupW} height={plotH}
                  fill="transparent" rx={4}
                  style={{ pointerEvents: 'all' }}
                  onMouseEnter={(e) => e.currentTarget.setAttribute('fill', 'rgba(133,177,53,0.04)')}
                  onMouseLeave={(e) => e.currentTarget.setAttribute('fill', 'transparent')}
                />

                {/* SRX 400 bar (green) */}
                <rect x={x400} y={y400} width={barW} height={h400} rx={3} fill="url(#grad400v)" opacity="0">
                  <animate attributeName="height" from="0" to={h400} dur="1.2s" fill="freeze" begin={delay400} calcMode="spline" keySplines="0.22 1 0.36 1" keyTimes="0;1" />
                  <animate attributeName="y" from={margin.top + plotH} to={y400} dur="1.2s" fill="freeze" begin={delay400} calcMode="spline" keySplines="0.22 1 0.36 1" keyTimes="0;1" />
                  <animate attributeName="opacity" from="0" to="1" dur="0.4s" fill="freeze" begin={delay400} />
                  <title>{d.fullName} — SRX 400: {d.label400}</title>
                </rect>

                {/* SRX 440 bar (blue) */}
                <rect x={x440} y={y440} width={barW} height={h440} rx={3} fill="url(#grad440v)" opacity="0">
                  <animate attributeName="height" from="0" to={h440} dur="1.2s" fill="freeze" begin={delay440} calcMode="spline" keySplines="0.22 1 0.36 1" keyTimes="0;1" />
                  <animate attributeName="y" from={margin.top + plotH} to={y440} dur="1.2s" fill="freeze" begin={delay440} calcMode="spline" keySplines="0.22 1 0.36 1" keyTimes="0;1" />
                  <animate attributeName="opacity" from="0" to="1" dur="0.4s" fill="freeze" begin={delay440} />
                  <title>{d.fullName} — SRX 440: {d.label440}</title>
                </rect>

                {/* Value labels on top of bars */}
                {d.v400 > 0 && (
                  <text x={x400 + barW / 2} y={y400 - 5} fontSize="8" fill="#6C912A" fontWeight="700" textAnchor="middle" fontFamily="JetBrains Mono, monospace" opacity="0">
                    {Number.isInteger(d.v400) ? d.v400 : d.v400.toFixed(1)}
                    <animate attributeName="opacity" from="0" to="1" dur="0.4s" fill="freeze" begin={`${i * 0.15 + 1.0}s`} />
                  </text>
                )}
                {d.v440 > 0 && (
                  <text x={x440 + barW / 2} y={y440 - 5} fontSize="8" fill="#2563eb" fontWeight="700" textAnchor="middle" fontFamily="JetBrains Mono, monospace" opacity="0">
                    {Number.isInteger(d.v440) ? d.v440 : d.v440.toFixed(1)}
                    <animate attributeName="opacity" from="0" to="1" dur="0.4s" fill="freeze" begin={`${i * 0.15 + 1.0}s`} />
                  </text>
                )}

                {/* Axis indicator — amber dot for CPS tests */}
                {d.isCps && (
                  <circle cx={centerX} cy={margin.top + plotH + 7} r={2.5} fill="#d97706" opacity="0.8" />
                )}

                {/* X-axis label (rotated) */}
                <text
                  x={centerX}
                  y={margin.top + plotH + 14}
                  fontSize="9"
                  fill="#475569"
                  fontWeight="500"
                  textAnchor="end"
                  dominantBaseline="hanging"
                  transform={`rotate(-40, ${centerX}, ${margin.top + plotH + 14})`}
                >
                  <title>{d.fullName}{d.isCps ? ' (CPS/TPS → Right Axis)' : ' (Mbps → Left Axis)'}</title>
                  {d.name}
                </text>
              </g>
            );
          })}

          {/* ── Gradient definitions ── */}
          <defs>
            <linearGradient id="grad400v" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#85B135" />
              <stop offset="100%" stopColor="#6C912A" />
            </linearGradient>
            <linearGradient id="grad440v" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
};

export default SanityOverviewChart;

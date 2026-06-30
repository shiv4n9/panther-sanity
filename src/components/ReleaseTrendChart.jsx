import React, { useMemo } from 'react';
import { extractMbpsValue } from '../utils/normalize';

/** Whether a section category is a CPS/TPS metric (vs. throughput/Mbps). */
function isCpsCategory(category) {
  if (!category) return false;
  const lc = category.toLowerCase();
  return (
    lc.includes('cps performance') ||
    lc.includes('tps performance') ||
    (lc.startsWith('cps') && !lc.includes('throughput'))
  );
}

/** Extract the CPS/TPS numeric value from a throughput string. */
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

function formatTick(val) {
  if (Number.isInteger(val)) return val.toString();
  return val.toFixed(1);
}

function computeTicks(maxVal, count = 5) {
  if (maxVal <= 0) return [0];
  const rawStep = maxVal / (count - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = Math.ceil(rawStep / magnitude) * magnitude;
  const ticks = [];
  for (let i = 0; i < count; i++) ticks.push(step * i);
  return ticks;
}

/** Shorten a release string for legend labels (drop the common branch prefix). */
function shortenRelease(rel) {
  if (!rel) return '';
  return rel.replace(/^25\.4X300-/, '').replace(/-EVO$/, '');
}

/** Shorten a test case name for X-axis labels. */
function shortenName(name) {
  if (!name) return '';
  return name
    .replace(/throughput/gi, 'Thru')
    .replace(/Firewall\s*/gi, 'FW ')
    .replace(/Packet\s*size\s*/gi, '')
    .replace(/\s*-\s*/g, ' ')
    .replace(/\(ratio[^)]*\)/gi, '')
    .replace(/\(site-2-site\)/gi, 'S2S')
    .replace(/Source NAT44/gi, 'SNAT44')
    .replace(/Distributed Sessions Throughput/gi, 'Dist Sess')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/** Distinct color per release (cycled if there are more releases than colors). */
const RELEASE_COLORS = [
  { from: '#85B135', to: '#6C912A', text: '#6C912A' }, // green
  { from: '#60a5fa', to: '#3b82f6', text: '#2563eb' }, // blue
  { from: '#a78bfa', to: '#7c3aed', text: '#7c3aed' }, // purple
  { from: '#fbbf24', to: '#d97706', text: '#b45309' }, // amber
  { from: '#f472b6', to: '#db2777', text: '#db2777' }, // pink
  { from: '#2dd4bf', to: '#0d9488', text: '#0d9488' }, // teal
  { from: '#fb923c', to: '#ea580c', text: '#ea580c' }, // orange
  { from: '#94a3b8', to: '#475569', text: '#475569' }, // slate
];

const DEVICE_ACCENT = {
  srx400: '#6C912A',
  srx440: '#2563eb',
};

/**
 * ReleaseTrendChart — Dual-axis grouped bar chart of every daily-sanity test
 * case across all releases for one device. Each release is a colored series;
 * Mbps test cases bind to the left axis and CPS/TPS test cases to the right.
 */
const ReleaseTrendChart = ({ device, label, releases }) => {
  // Releases that actually report data for this device, keeping table order.
  const cols = useMemo(
    () => releases.filter(r => !r.devices?.length || r.devices.includes(device)),
    [releases, device]
  );

  // Ordered list of { testCase, category } from the union of all releases.
  const testCases = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const rel of cols) {
      for (const section of rel.merged) {
        for (const t of section.tests) {
          if (!seen.has(t.testCase)) {
            seen.add(t.testCase);
            list.push({ testCase: t.testCase, category: section.category });
          }
        }
      }
    }
    return list;
  }, [cols]);

  // One group per test case; each group holds a value per release.
  const chartData = useMemo(() => {
    return testCases
      .map(tc => {
        const isCps = isCpsCategory(tc.category);
        const values = cols.map(rel => {
          let raw = '';
          for (const section of rel.merged) {
            const hit = section.tests.find(t => t.testCase === tc.testCase);
            if (hit) { raw = hit[device]?.throughput || ''; break; }
          }
          const value = isCps ? extractCpsValue(raw) : extractMbpsValue(raw);
          return { release: rel.release, value: value || 0, label: raw || '-' };
        });
        return { testCase: tc.testCase, name: shortenName(tc.testCase), isCps, values };
      })
      .filter(d => d.values.some(v => v.value > 0));
  }, [testCases, cols, device]);

  if (chartData.length === 0) return null;

  const accent = DEVICE_ACCENT[device] || DEVICE_ACCENT.srx400;

  // Separate max values per axis type.
  const mbpsGroups = chartData.filter(d => !d.isCps);
  const cpsGroups = chartData.filter(d => d.isCps);
  const rawMaxMbps = mbpsGroups.length ? Math.max(...mbpsGroups.map(d => Math.max(...d.values.map(v => v.value)))) : 0;
  const rawMaxCps = cpsGroups.length ? Math.max(...cpsGroups.map(d => Math.max(...d.values.map(v => v.value)))) : 0;

  const mbpsTicks = computeTicks(rawMaxMbps);
  const cpsTicks = computeTicks(rawMaxCps);
  const maxMbps = mbpsTicks[mbpsTicks.length - 1] || 1;
  const maxCps = cpsTicks[cpsTicks.length - 1] || 1;

  // Chart dimensions.
  const chartW = 1100;
  const chartH = 460;
  const margin = { top: 40, right: 90, bottom: 170, left: 90 };
  const plotW = chartW - margin.left - margin.right;
  const plotH = chartH - margin.top - margin.bottom;

  // X positioning — thin bars grouped per test case.
  const groupW = plotW / chartData.length;
  const innerW = groupW * 0.82;
  const slot = innerW / Math.max(cols.length, 1);
  const barW = Math.min(slot * 0.82, 14);

  // Y scaling per axis.
  const yMbps = (val) => plotH - (val / maxMbps) * plotH;
  const yCps = (val) => plotH - (val / maxCps) * plotH;

  return (
    <div className="animate-chart-enter rounded-2xl shadow-xl border border-juniper/15 overflow-hidden bg-[#f7faf4]">
      <div className="h-1 w-full" style={{ background: `linear-gradient(to right, ${accent}, #3b82f6)` }} />

      {/* Header + legend */}
      <div className="px-6 py-4 border-b border-juniper/15 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <svg className="w-4.5 h-4.5" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            {label} - Release Trend
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">All test cases across releases · Dual-Axis (Mbps / CPS · TPS)</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* Release color legend */}
          <div className="flex items-center gap-3 text-xs font-bold flex-wrap justify-end max-w-[640px]">
            {cols.map((rel, i) => {
              const c = RELEASE_COLORS[i % RELEASE_COLORS.length];
              return (
                <span key={rel.release} className="flex items-center gap-1.5" title={rel.release}>
                  <span className="inline-block w-3 h-3 rounded" style={{ background: `linear-gradient(135deg, ${c.from}, ${c.to})` }} />
                  <span className="text-slate-500 font-jetbrains text-[10px]">{shortenRelease(rel.release)}</span>
                </span>
              );
            })}
          </div>
          {/* Axis legend */}
          <div className="flex items-center gap-4 text-xs font-bold flex-wrap justify-end">
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
      </div>

      {/* Chart */}
      <div className="px-4 py-4 overflow-x-auto">
        <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full" style={{ minWidth: '760px' }}>
          {/* ── Left Y-Axis: Throughput (Mbps) ── */}
          <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotH} stroke="#cbd5e1" strokeWidth="1" />
          {mbpsTicks.map((tick, i) => {
            const ty = margin.top + yMbps(tick);
            return (
              <g key={`mbps-${i}`}>
                <line x1={margin.left - 4} y1={ty} x2={margin.left} y2={ty} stroke="#94a3b8" strokeWidth="1" />
                <line x1={margin.left} y1={ty} x2={margin.left + plotW} y2={ty} stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray="3,3" />
                <text x={margin.left - 8} y={ty} fontSize="9" fill="#64748b" textAnchor="end" dominantBaseline="middle" fontFamily="JetBrains Mono, monospace">
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
            const ty = margin.top + yCps(tick);
            return (
              <g key={`cps-${i}`}>
                <line x1={margin.left + plotW} y1={ty} x2={margin.left + plotW + 4} y2={ty} stroke="#94a3b8" strokeWidth="1" />
                <text x={margin.left + plotW + 8} y={ty} fontSize="9" fill="#b45309" textAnchor="start" dominantBaseline="middle" fontFamily="JetBrains Mono, monospace">
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
          {chartData.map((d, gi) => {
            const yScale = d.isCps ? yCps : yMbps;
            const groupX = margin.left + gi * groupW;
            const centerX = groupX + groupW / 2;
            const startX = groupX + (groupW - innerW) / 2;
            return (
              <g key={d.testCase}>
                {/* Hover background */}
                <rect
                  x={groupX} y={margin.top} width={groupW} height={plotH}
                  fill="transparent" rx={4}
                  style={{ pointerEvents: 'all' }}
                  onMouseEnter={(e) => e.currentTarget.setAttribute('fill', 'rgba(133,177,53,0.05)')}
                  onMouseLeave={(e) => e.currentTarget.setAttribute('fill', 'transparent')}
                />
                {d.values.map((v, j) => {
                  const c = RELEASE_COLORS[j % RELEASE_COLORS.length];
                  const cx = startX + j * slot + slot / 2;
                  const x = cx - barW / 2;
                  const h = Math.max(plotH - yScale(v.value), 0);
                  const barY = margin.top + plotH - h;
                  const delay = `${gi * 0.1 + j * 0.05 + 0.15}s`;
                  const labelDelay = `${gi * 0.1 + j * 0.05 + 0.7}s`;
                  const valStr = Number.isInteger(v.value) ? String(v.value) : v.value.toFixed(1);
                  // Vertical value label: drawn inside the bar (white) when it is
                  // tall enough, otherwise just above the bar (release color).
                  const labelLen = valStr.length * 6.2 + 6;
                  const inside = h > labelLen + 6;
                  return (
                    <g key={v.release}>
                      <rect x={x} y={barY} width={barW} height={h} rx={2} fill={`url(#rel-${device}-${j % RELEASE_COLORS.length})`} opacity="0">
                        <animate attributeName="height" from="0" to={h} dur="1.1s" fill="freeze" begin={delay} calcMode="spline" keySplines="0.22 1 0.36 1" keyTimes="0;1" />
                        <animate attributeName="y" from={margin.top + plotH} to={barY} dur="1.1s" fill="freeze" begin={delay} calcMode="spline" keySplines="0.22 1 0.36 1" keyTimes="0;1" />
                        <animate attributeName="opacity" from="0" to="1" dur="0.4s" fill="freeze" begin={delay} />
                        <title>{shortenRelease(v.release)} · {d.testCase}: {v.label}</title>
                      </rect>
                      {v.value > 0 && (
                        <text
                          x={cx}
                          y={inside ? barY + 5 : barY - 4}
                          fontSize="9"
                          fontWeight="700"
                          fill={inside ? '#ffffff' : c.text}
                          textAnchor={inside ? 'end' : 'start'}
                          dominantBaseline="central"
                          fontFamily="JetBrains Mono, monospace"
                          transform={`rotate(-90, ${cx}, ${inside ? barY + 5 : barY - 4})`}
                          opacity="0"
                          style={{ pointerEvents: 'none' }}
                        >
                          {valStr}
                          <animate attributeName="opacity" from="0" to="1" dur="0.4s" fill="freeze" begin={labelDelay} />
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Axis indicator — amber dot for CPS tests */}
                {d.isCps && <circle cx={centerX} cy={margin.top + plotH + 7} r={2.5} fill="#d97706" opacity="0.8" />}

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
                  <title>{d.testCase}{d.isCps ? ' (CPS/TPS → Right Axis)' : ' (Mbps → Left Axis)'}</title>
                  {d.name}
                </text>
              </g>
            );
          })}

          {/* ── Gradient definitions (one per release color) ── */}
          <defs>
            {RELEASE_COLORS.map((c, i) => (
              <linearGradient key={i} id={`rel-${device}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c.from} />
                <stop offset="100%" stopColor={c.to} />
              </linearGradient>
            ))}
          </defs>
        </svg>
      </div>
    </div>
  );
};

export default ReleaseTrendChart;
